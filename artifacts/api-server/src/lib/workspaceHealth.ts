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

  // `value` de cada sinal SEMPRE sai de count(*) filter (...) sem teto: as
  // queries de `sample` são capadas em SAMPLE_LIMIT e não servem de contagem
  // (um workspace com 600 atrasadas reportaria 500 e deduziria menos —
  // erro sempre na direção de fazer o workspace doente parecer saudável).
  const SAMPLE_LIMIT = 10;
  const isOverdue = sql`${tasks.overdue} = true and ${tasks.status} in ('pending','in_progress')`;
  const isStale = sql`${tasks.status} = 'in_progress' and ${lastActivity} < now() - interval '7 days'`;
  const isUnassigned = sql`${tasks.status} in ('pending','in_progress','blocked') and ${tasks.assignedTo} is null`;
  const isOldUrgent = sql`${tasks.scheduleMode} = 'urgente' and ${tasks.status} in ('pending','in_progress','blocked') and ${tasks.createdAt} < now() - interval '7 days'`;
  const isOldBlocked = sql`${tasks.status} = 'blocked' and ${tasks.cancelledAt} < now() - interval '14 days'`;
  const isOldTail = sql`${tasks.status} in ('pending','in_progress','blocked') and ${tasks.createdAt} < now() - interval '90 days'`;

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
        active: sql<number>`count(*) filter (where ${tasks.status} in ('pending','in_progress'))::int`,
        open: sql<number>`count(*) filter (where ${tasks.status} in ('pending','in_progress','blocked'))::int`,
        inProgress: sql<number>`count(*) filter (where ${tasks.status} = 'in_progress')::int`,
        overdue: sql<number>`count(*) filter (where ${isOverdue})::int`,
        stale: sql<number>`count(*) filter (where ${isStale})::int`,
        unassigned: sql<number>`count(*) filter (where ${isUnassigned})::int`,
        oldUrgent: sql<number>`count(*) filter (where ${isOldUrgent})::int`,
        oldBlocked: sql<number>`count(*) filter (where ${isOldBlocked})::int`,
        oldTail: sql<number>`count(*) filter (where ${isOldTail})::int`,
      })
      .from(tasks)
      .where(base),
    db.select(sample).from(tasks).where(and(base, eq(tasks.overdue, true), inArray(tasks.status, [...ACTIVE]))).limit(SAMPLE_LIMIT),
    db.select(sample).from(tasks).where(and(base, eq(tasks.status, "in_progress"), sql`${lastActivity} < now() - interval '7 days'`)).limit(SAMPLE_LIMIT),
    db.select(sample).from(tasks).where(and(base, inArray(tasks.status, [...OPEN]), isNull(tasks.assignedTo))).limit(SAMPLE_LIMIT),
    db.select(sample).from(tasks).where(and(base, eq(tasks.scheduleMode, "urgente"), inArray(tasks.status, [...OPEN]), sql`${tasks.createdAt} < now() - interval '7 days'`)).limit(SAMPLE_LIMIT),
    db.select(sample).from(tasks).where(and(base, eq(tasks.status, "blocked"), sql`${tasks.cancelledAt} < now() - interval '14 days'`)).limit(SAMPLE_LIMIT),
    db.select(sample).from(tasks).where(and(base, inArray(tasks.status, [...OPEN]), sql`${tasks.createdAt} < now() - interval '90 days'`)).limit(SAMPLE_LIMIT),
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
