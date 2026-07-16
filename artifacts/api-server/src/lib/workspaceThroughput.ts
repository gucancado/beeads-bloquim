// artifacts/api-server/src/lib/workspaceThroughput.ts
// Série criadas×concluídas + lead time do workspace. Conclusão = ÚLTIMO evento
// status_changed→completed por task dentro da janela (1 task = 1 bucket;
// re-conclusão não duplica). Buckets no fuso America/Sao_Paulo, zero-fill via
// generate_series. tasks.created_at é timestamp NAIVE (UTC de fato) — por isso
// o duplo AT TIME ZONE.
import { sql } from "drizzle-orm";
import type { db as Db } from "@workspace/db";

export type ThroughputResult = {
  series: Array<{ bucketStart: string; created: number; completed: number }>;
  leadTimeDays: { avg: number | null; median: number | null; p90: number | null; count: number };
  byAssignee: Array<{ userId: string | null; name: string | null; completed: number }>;
};

const round1 = (v: unknown): number | null => (v == null ? null : Math.round(Number(v) * 10) / 10);

// Whitelist de granularity — nunca interpolar um valor não-whitelistado via
// sql.raw. A rota (workspaceTasks.ts) já valida antes de chamar esta função,
// mas o cheque é repetido aqui porque é ESTE módulo que decide usar sql.raw
// (defesa em profundidade: nenhum chamador futuro pode contornar o gate só
// porque validou em outro lugar).
const GRANULARITIES = ["day", "week", "month"] as const;
type Granularity = (typeof GRANULARITIES)[number];

export async function computeThroughput(
  db: typeof Db,
  workspaceId: string,
  opts: { since: Date; until: Date; granularity: Granularity },
): Promise<ThroughputResult> {
  const { since, until, granularity } = opts;
  if (!GRANULARITIES.includes(granularity)) {
    throw new Error(`invalid granularity: ${granularity}`);
  }
  // sql.raw SÓ depois do whitelist check acima — nunca em cima de opts.granularity
  // cru. `gran` entra como texto literal na query (não como bind param): é a
  // única forma de compor `interval '1 ${gran}'`, já que um placeholder de bind
  // não pode viver dentro de um literal de interval/string.
  const gran = sql.raw(granularity);
  const sinceIso = since.toISOString();
  const untilIso = until.toISOString();

  // completions: último evento de conclusão por task na janela (mesmo padrão
  // do workspaceHealth.ts — activity log, nunca completedAt/updatedAt, porque
  // essas colunas são resetadas no reabrir).
  //
  // FONTE ÚNICA — não reescreva esta CTE à mão em nenhuma das 3 queries abaixo.
  // Ela é a definição canônica de "conclusão" da spec, e as três métricas
  // (series.completed, leadTimeDays, byAssignee) TÊM que contar exatamente o
  // mesmo conjunto de tasks. Se as cópias driftarem, a falha é silenciosa —
  // não crasha, só devolve métricas que não fecham entre si
  // (series.completed ≠ Σ byAssignee.completed). O drizzle aninha fragmentos
  // `SQL` preservando os bind params, então interpolar é seguro.
  //
  // `completed_at` fica no SELECT mesmo sendo usado só por series/lead: o
  // assigneeQuery ignora a coluna (só agrupa por assigned_to). Uma coluna a
  // mais numa linha já lida não muda o DISTINCT ON (a dedup é pela expressão
  // do ON; o ORDER BY decide o vencedor) — o custo é irrelevante e vale menos
  // que manter duas variantes da regra canônica.
  const completionsCte = sql`completions AS (
      SELECT DISTINCT ON (a.task_id) a.task_id, a.created_at AS completed_at
        FROM task_activities a
        JOIN tasks t ON t.id = a.task_id
       WHERE t.workspace_id = ${workspaceId}
         AND NOT (t.is_approval_task = true AND t.status = 'draft')
         AND a.type = 'status_changed'
         AND a.metadata->>'newStatus' = 'completed'
         AND a.created_at >= ${sinceIso}::timestamptz AT TIME ZONE 'UTC'
         AND a.created_at < ${untilIso}::timestamptz AT TIME ZONE 'UTC'
       ORDER BY a.task_id, a.created_at DESC
    )`;

  const seriesQuery = db.execute(sql`
    WITH ${completionsCte},
    buckets AS (
      SELECT generate_series(
        date_trunc('${gran}', (${sinceIso}::timestamptz) AT TIME ZONE 'America/Sao_Paulo'),
        date_trunc('${gran}', ((${untilIso}::timestamptz) - interval '1 microsecond') AT TIME ZONE 'America/Sao_Paulo'),
        interval '1 ${gran}'
      ) AS b
    ),
    created_counts AS (
      SELECT date_trunc('${gran}', t.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo') AS b, COUNT(*)::int AS c
        FROM tasks t
       WHERE t.workspace_id = ${workspaceId}
         AND NOT (t.is_approval_task = true AND t.status = 'draft')
         AND t.created_at >= (${sinceIso}::timestamptz AT TIME ZONE 'UTC')
         AND t.created_at < (${untilIso}::timestamptz AT TIME ZONE 'UTC')
       GROUP BY 1
    ),
    completed_counts AS (
      SELECT date_trunc('${gran}', c.completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo') AS b, COUNT(*)::int AS c
        FROM completions c
       GROUP BY 1
    )
    SELECT to_char(buckets.b, 'YYYY-MM-DD') AS bucket_start,
           COALESCE(cr.c, 0) AS created,
           COALESCE(co.c, 0) AS completed
      FROM buckets
      LEFT JOIN created_counts cr ON cr.b = buckets.b
      LEFT JOIN completed_counts co ON co.b = buckets.b
     ORDER BY buckets.b
  `);

  const leadQuery = db.execute(sql`
    WITH ${completionsCte}
    SELECT COUNT(*)::int AS count,
           AVG(EXTRACT(EPOCH FROM (c.completed_at - t.created_at)) / 86400.0) AS avg_days,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (c.completed_at - t.created_at)) / 86400.0) AS median_days,
           PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (c.completed_at - t.created_at)) / 86400.0) AS p90_days
      FROM completions c
      JOIN tasks t ON t.id = c.task_id
  `);

  const assigneeQuery = db.execute(sql`
    WITH ${completionsCte}
    SELECT t.assigned_to AS user_id, u.name, COUNT(*)::int AS completed
      FROM completions c
      JOIN tasks t ON t.id = c.task_id
      LEFT JOIN users u ON u.id = t.assigned_to
     GROUP BY t.assigned_to, u.name
     ORDER BY completed DESC
  `);

  const [seriesRes, leadRes, assigneeRes] = await Promise.all([seriesQuery, leadQuery, assigneeQuery]);
  const lead = (leadRes as any).rows?.[0] ?? {};
  const seriesRows = (seriesRes as any).rows ?? [];
  const assigneeRows = (assigneeRes as any).rows ?? [];

  return {
    series: seriesRows.map((r: any) => ({ bucketStart: r.bucket_start, created: Number(r.created), completed: Number(r.completed) })),
    leadTimeDays: {
      avg: round1(lead.avg_days),
      median: round1(lead.median_days),
      p90: round1(lead.p90_days),
      count: Number(lead.count ?? 0),
    },
    byAssignee: assigneeRows.map((r: any) => ({ userId: r.user_id ?? null, name: r.name ?? null, completed: Number(r.completed) })),
  };
}
