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
      })
      .from(tasks)
      .where(base),
    db.select(sample).from(tasks).where(and(base, eq(tasks.overdue, true), inArray(tasks.status, [...ACTIVE]))).limit(500),
    db.select(sample).from(tasks).where(and(base, eq(tasks.status, "in_progress"), sql`${lastActivity} < now() - interval '7 days'`)).limit(500),
    db.select(sample).from(tasks).where(and(base, inArray(tasks.status, [...OPEN]), isNull(tasks.assignedTo))).limit(500),
    db.select(sample).from(tasks).where(and(base, eq(tasks.scheduleMode, "urgente"), inArray(tasks.status, [...OPEN]), sql`${tasks.createdAt} < now() - interval '7 days'`)).limit(500),
    db.select(sample).from(tasks).where(and(base, eq(tasks.status, "blocked"), sql`${tasks.cancelledAt} < now() - interval '14 days'`)).limit(500),
    db.select(sample).from(tasks).where(and(base, inArray(tasks.status, [...OPEN]), sql`${tasks.createdAt} < now() - interval '90 days'`)).limit(500),
  ]);

  const t = totals ?? { active: 0, open: 0, inProgress: 0 };
  const cap = (n: number, max: number) => Math.min(n, max);
  const toSample = (rows: Array<{ id: unknown; title: unknown }>) =>
    rows.slice(0, 10).map((r) => ({ taskId: String(r.id), title: String(r.title) }));

  const signals: Signal[] = [
    {
      key: "overdue",
      label: "Tarefas atrasadas",
      value: overdueRows.length,
      of: t.active,
      deduction: t.active > 0 ? Math.round((overdueRows.length / t.active) * 30) : 0,
      sample: toSample(overdueRows),
      recommendation: `${overdueRows.length} de ${t.active} tarefas ativas estão atrasadas — repactuar prazos ou repriorizar.`,
    },
    {
      key: "stale_in_progress",
      label: "Em andamento paradas (7+ dias sem atividade)",
      value: staleRows.length,
      of: t.inProgress,
      deduction: t.inProgress > 0 ? Math.round((staleRows.length / t.inProgress) * 20) : 0,
      sample: toSample(staleRows),
      recommendation: `${staleRows.length} de ${t.inProgress} tarefas em andamento sem atividade há 7+ dias — cobrar status ou devolver pra fila.`,
    },
    {
      key: "unassigned_backlog",
      label: "Abertas sem responsável",
      value: unassignedRows.length,
      of: t.open,
      deduction: t.open > 0 ? Math.round((unassignedRows.length / t.open) * 15) : 0,
      sample: toSample(unassignedRows),
      recommendation: `${unassignedRows.length} de ${t.open} tarefas abertas sem dono — atribuir responsável.`,
    },
    {
      key: "old_urgent",
      label: "Urgentes antigas (7+ dias)",
      value: urgentRows.length,
      of: null,
      deduction: cap(urgentRows.length * 5, 15),
      sample: toSample(urgentRows),
      recommendation: `${urgentRows.length} tarefas marcadas urgentes há 7+ dias — ou não eram urgentes, ou precisam de ação imediata.`,
    },
    {
      key: "old_blocked",
      label: "Bloqueadas antigas (14+ dias)",
      value: blockedRows.length,
      of: null,
      deduction: cap(blockedRows.length * 5, 10),
      sample: toSample(blockedRows),
      recommendation: `${blockedRows.length} tarefas bloqueadas há 14+ dias — resolver o impedimento ou cancelar.`,
    },
    {
      key: "old_tail",
      label: "Abertas há mais de 90 dias",
      value: tailRows.length,
      of: null,
      deduction: cap(tailRows.length * 2, 10),
      sample: toSample(tailRows),
      recommendation: `${tailRows.length} tarefas abertas há 90+ dias — concluir, arquivar ou assumir que não vão acontecer.`,
    },
  ];

  const score = Math.max(0, 100 - signals.reduce((s, x) => s + x.deduction, 0));
  const band = score >= 80 ? "saudavel" : score >= 50 ? "atencao" : "critico";
  return { score, band, signals, totals: t };
}
