import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { tasks } from "@workspace/db/schema";
import { getTodayLocal } from "../lib/overdue";
import { logger } from "../lib/logger";
import { ACTIVE_STATUSES } from "./calendarTasksQuery";

const log = logger.child({ module: "calendarOrder" });

/** Hoje em America/Sao_Paulo (mesma referência do overdue), YYYY-MM-DD. */
export function todayYmdSP(): string {
  return getTodayLocal().toISOString().slice(0, 10);
}

/**
 * Regra do calendário ao trocar responsável ou virar urgente: a tarefa vai para
 * o fim da coluna do dia do responsável (max + 1), ou para o topo se urgente
 * (min - 1). Coluna sem ordem manual → null (vale a ordem padrão).
 * Âncora = planned_date ?? due_date; sem data e urgente = hoje; passada = hoje.
 *
 * `clearPlannedDate`: ao VIRAR urgente a data pretendida é descartada (urgente
 * pertence a hoje); sem isso uma pretendida futura mantinha a tarefa lá.
 * Mudança de prazo não mexe em planned_date.
 */
export interface OrderRuleOptions {
  clearPlannedDate?: boolean;
}

export async function applyOrderRules(
  taskId: string,
  todayOverride?: string,
  opts: OrderRuleOptions = {},
): Promise<void> {
  if (opts.clearPlannedDate) {
    await db.update(tasks).set({ plannedDate: null }).where(eq(tasks.id, taskId));
  }
  const [t] = await db
    .select({
      id: tasks.id, status: tasks.status, assignedTo: tasks.assignedTo,
      plannedDate: tasks.plannedDate, dueDate: tasks.dueDate, scheduleMode: tasks.scheduleMode,
    })
    .from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!t || !(ACTIVE_STATUSES as readonly string[]).includes(t.status)) return;

  const today = todayOverride ?? todayYmdSP();
  const urgente = t.scheduleMode === "urgente";
  let d = t.plannedDate ?? (t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null);
  if (!d) {
    if (!urgente) {
      await db.update(tasks).set({ plannedOrder: null }).where(eq(tasks.id, taskId));
      return;
    }
    d = today;
  }
  if (d < today) d = today;

  const anchor = sql`COALESCE(${tasks.plannedDate}, (${tasks.dueDate})::date)`;
  const anchorCond = d === today
    ? or(sql`${anchor} <= ${today}::date`, and(eq(tasks.scheduleMode, "urgente"), sql`${anchor} IS NULL`))
    : sql`${anchor} = ${d}::date`;

  const [agg] = await db
    .select({
      min: sql<number | null>`MIN(${tasks.plannedOrder})`,
      max: sql<number | null>`MAX(${tasks.plannedOrder})`,
    })
    .from(tasks)
    .where(and(
      t.assignedTo ? eq(tasks.assignedTo, t.assignedTo) : isNull(tasks.assignedTo),
      ne(tasks.id, taskId),
      inArray(tasks.status, [...ACTIVE_STATUSES]),
      anchorCond,
    ));
  const min = agg?.min == null ? null : Number(agg.min);
  const max = agg?.max == null ? null : Number(agg.max);
  const next = urgente ? (min == null ? 0 : min - 1) : (max == null ? null : max + 1);
  await db.update(tasks).set({ plannedOrder: next }).where(eq(tasks.id, taskId));
}

/** Versão best-effort para as rotas: a mutação principal já foi gravada. */
export async function safeApplyOrderRules(taskId: string, opts: OrderRuleOptions = {}): Promise<void> {
  try {
    await applyOrderRules(taskId, undefined, opts);
  } catch (err) {
    log.error({ taskId, err: err instanceof Error ? { message: err.message, cause: err.cause } : String(err) },
      "applyOrderRules failed (best-effort, swallowed)");
  }
}
