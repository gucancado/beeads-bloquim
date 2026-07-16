// artifacts/api-server/src/lib/workspaceHealth.ts
// Health score dedutivo do workspace (spec fase 2 do bloquim-mcp):
// score = 100 − Σ deduções, piso 0. Sempre retorna os 6 sinais (deduction 0
// quando saudável). Thresholds fixos: 7d (stale/urgente), 14d (blocked), 90d (cauda).
import { and, eq, inArray, isNull, ne, not, sql } from "drizzle-orm";
import type { db as Db } from "@workspace/db";
import { tasks } from "@workspace/db/schema";

export type Signal = {
  key: string;
  label: string;
  value: number;
  of: number | null;
  deduction: number;
  sample: Array<{ taskId: string; title: string }>;
  recommendation: string;
};

export type HealthResult = {
  score: number;
  band: "saudavel" | "atencao" | "critico";
  signals: Signal[];
  totals: { active: number; open: number; inProgress: number };
};

const OPEN = ["pending", "in_progress", "blocked"] as const;
const ACTIVE = ["pending", "in_progress"] as const;

export async function computeHealth(db: typeof Db, workspaceId: string): Promise<HealthResult> {
  const notApprovalDraft = not(and(eq(tasks.isApprovalTask, true), eq(tasks.status, "draft")));
  const base = and(eq(tasks.workspaceId, workspaceId), notApprovalDraft, ne(tasks.status, "draft"));
  const lastActivity = sql`COALESCE((SELECT MAX(a.created_at) FROM task_activities a WHERE a.task_id = ${tasks.id}), ${tasks.createdAt})`;

  // "Bloqueada desde" sai do activity log, NÃO de `tasks.cancelled_at` — mesmo
  // canon que o projeto já aplica pra conclusão ("conclusão é o activity log,
  // nunca completedAt"), pela mesma razão: a coluna não é confiável.
  //   - PATCH .../cards/:cardId/task/status (cards.ts) bloqueia a tarefa e
  //     NUNCA escreve cancelled_at. Como `NULL < now() - interval '14 days'`
  //     é NULL (não false), a linha sumia do FILTER sem erro: no DB dev 100%
  //     das tarefas blocked têm cancelled_at NULL, incluindo uma bloqueada há
  //     66 dias — o sinal era peso morto.
  //   - cancelled_at também reiniciava o relógio num PATCH blocked→blocked
  //     redundante e sobrevivia ao desbloqueio (cards.ts nunca limpa), fazendo
  //     um re-block hoje contar como "bloqueada há meses". O activity log é
  //     gravado só quando o status MUDA de fato, então não sofre de nenhum dos
  //     dois.
  // O COALESCE pro createdAt é LOAD-BEARING — não remova. Ele cobre a tarefa
  // blocked SEM evento correspondente no log: linhas anteriores ao activity
  // log, backfills, ou um pruning futuro de activities antigas. Sem ele a
  // subquery devolve NULL, `NULL < now() - interval` é NULL (não false), e a
  // linha sumiria do FILTER em silêncio — exatamente o bug do cancelled_at que
  // este código existe pra matar.
  // (Não confunda com "tarefa que nasceu blocked": esse caso NÃO existe — o
  // default do schema é 'pending' e nenhum caminho de produção cria task
  // blocked. Concluir daí que o COALESCE é código morto reintroduz o NULL-drop.)
  // No fallback, createdAt ≤ data real do bloqueio, então o erro aponta pra
  // "mais doente" — direção segura: superexpõe em vez de esconder.
  // O filtro `newStatus = 'blocked'` também é defensivo e NÃO tem teste que o
  // proteja: hoje os dois writers de status logam só quando o status MUDA, então
  // numa task blocked o último status_changed é sempre →blocked e MAX(todos) dá
  // o mesmo resultado. Isso vale por construção, não por contrato — um writer
  // futuro que logue sem mudar status (ou que mude status sem logar) quebraria a
  // equivalência e o MAX pegaria um evento de desbloqueio. Manter.
  const blockedSince = sql`COALESCE((SELECT MAX(a.created_at) FROM task_activities a WHERE a.task_id = ${tasks.id} AND a.type = 'status_changed' AND a.metadata->>'newStatus' = 'blocked'), ${tasks.createdAt})`;

  // Cada predicado é definido UMA vez e interpolado nos dois consumidores
  // (contagem e amostra) — escrevê-lo em dois dialetos deixaria `value` e
  // `sample` divergirem em silêncio num drift futuro. O and() do drizzle já
  // emite SQL parentizado, então entra direto no FILTER (WHERE …).
  const isActive = inArray(tasks.status, [...ACTIVE]);
  const isOpen = inArray(tasks.status, [...OPEN]);
  const isInProgress = eq(tasks.status, "in_progress");
  const isOverdue = and(eq(tasks.overdue, true), isActive);
  const isStale = and(isInProgress, sql`${lastActivity} < now() - interval '7 days'`);
  const isUnassigned = and(isOpen, isNull(tasks.assignedTo));
  const isOldUrgent = and(eq(tasks.scheduleMode, "urgente"), isOpen, sql`${tasks.createdAt} < now() - interval '7 days'`);
  const isOldBlocked = and(eq(tasks.status, "blocked"), sql`${blockedSince} < now() - interval '14 days'`);
  const isOldTail = and(isOpen, sql`${tasks.createdAt} < now() - interval '90 days'`);

  // `value` de cada sinal SEMPRE sai de count(*) filter (...) sem teto: as
  // queries de `sample` são capadas em SAMPLE_LIMIT e não servem de contagem
  // (um workspace com 600 atrasadas reportaria 500 e deduziria menos —
  // erro sempre na direção de fazer o workspace doente parecer saudável).
  const SAMPLE_LIMIT = 10;
  const sample = { id: tasks.id, title: tasks.title };
  const [
    [totals],
    overdueRows,
    staleRows,
    unassignedRows,
    urgentRows,
    blockedRows,
    tailRows,
  ] = await Promise.all([
    db
      .select({
        active: sql<number>`count(*) filter (where ${isActive})::int`,
        open: sql<number>`count(*) filter (where ${isOpen})::int`,
        inProgress: sql<number>`count(*) filter (where ${isInProgress})::int`,
        overdue: sql<number>`count(*) filter (where ${isOverdue})::int`,
        stale: sql<number>`count(*) filter (where ${isStale})::int`,
        unassigned: sql<number>`count(*) filter (where ${isUnassigned})::int`,
        oldUrgent: sql<number>`count(*) filter (where ${isOldUrgent})::int`,
        oldBlocked: sql<number>`count(*) filter (where ${isOldBlocked})::int`,
        oldTail: sql<number>`count(*) filter (where ${isOldTail})::int`,
      })
      .from(tasks)
      .where(base),
    db.select(sample).from(tasks).where(and(base, isOverdue)).limit(SAMPLE_LIMIT),
    db.select(sample).from(tasks).where(and(base, isStale)).limit(SAMPLE_LIMIT),
    db.select(sample).from(tasks).where(and(base, isUnassigned)).limit(SAMPLE_LIMIT),
    db.select(sample).from(tasks).where(and(base, isOldUrgent)).limit(SAMPLE_LIMIT),
    db.select(sample).from(tasks).where(and(base, isOldBlocked)).limit(SAMPLE_LIMIT),
    db.select(sample).from(tasks).where(and(base, isOldTail)).limit(SAMPLE_LIMIT),
  ]);

  const t = totals ?? {
    active: 0,
    open: 0,
    inProgress: 0,
    overdue: 0,
    stale: 0,
    unassigned: 0,
    oldUrgent: 0,
    oldBlocked: 0,
    oldTail: 0,
  };
  const cap = (n: number, max: number) => Math.min(n, max);
  const toSample = (rows: Array<{ id: unknown; title: unknown }>) =>
    rows.map((r) => ({ taskId: String(r.id), title: String(r.title) }));

  const signals: Signal[] = [
    {
      key: "overdue",
      label: "Tarefas atrasadas",
      value: t.overdue,
      of: t.active,
      deduction: t.active > 0 ? Math.round((t.overdue / t.active) * 30) : 0,
      sample: toSample(overdueRows),
      recommendation: `${t.overdue} de ${t.active} tarefas ativas estão atrasadas — repactuar prazos ou repriorizar.`,
    },
    {
      key: "stale_in_progress",
      label: "Em andamento paradas (7+ dias sem atividade)",
      value: t.stale,
      of: t.inProgress,
      deduction: t.inProgress > 0 ? Math.round((t.stale / t.inProgress) * 20) : 0,
      sample: toSample(staleRows),
      recommendation: `${t.stale} de ${t.inProgress} tarefas em andamento sem atividade há 7+ dias — cobrar status ou devolver pra fila.`,
    },
    {
      key: "unassigned_backlog",
      label: "Abertas sem responsável",
      value: t.unassigned,
      of: t.open,
      deduction: t.open > 0 ? Math.round((t.unassigned / t.open) * 15) : 0,
      sample: toSample(unassignedRows),
      recommendation: `${t.unassigned} de ${t.open} tarefas abertas sem dono — atribuir responsável.`,
    },
    {
      key: "old_urgent",
      label: "Urgentes antigas (7+ dias)",
      value: t.oldUrgent,
      of: null,
      deduction: cap(t.oldUrgent * 5, 15),
      sample: toSample(urgentRows),
      recommendation: `${t.oldUrgent} tarefas marcadas urgentes há 7+ dias — ou não eram urgentes, ou precisam de ação imediata.`,
    },
    {
      key: "old_blocked",
      label: "Bloqueadas antigas (14+ dias)",
      value: t.oldBlocked,
      of: null,
      deduction: cap(t.oldBlocked * 5, 10),
      sample: toSample(blockedRows),
      recommendation: `${t.oldBlocked} tarefas bloqueadas há 14+ dias — resolver o impedimento ou cancelar.`,
    },
    {
      key: "old_tail",
      label: "Abertas há mais de 90 dias",
      value: t.oldTail,
      of: null,
      deduction: cap(t.oldTail * 2, 10),
      sample: toSample(tailRows),
      recommendation: `${t.oldTail} tarefas abertas há 90+ dias — concluir, arquivar ou assumir que não vão acontecer.`,
    },
  ];

  const score = Math.max(0, 100 - signals.reduce((s, x) => s + x.deduction, 0));
  const band = score >= 80 ? "saudavel" : score >= 50 ? "atencao" : "critico";
  return {
    score,
    band,
    signals,
    totals: { active: t.active, open: t.open, inProgress: t.inProgress },
  };
}
