import { db } from "@workspace/db";
import { tasks, cards, cardConnections } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { computeOverdue } from "../lib/overdue";
import { toVisualStatus } from "./taskVisualSyncService";
import { isWithinScheduleWindow } from "../lib/scheduleMode";
import { logger } from "../lib/logger";

const log = logger.child({ module: "taskActivation" });

/**
 * Best-effort: if a task is currently `pending`, has all card prerequisites
 * resolved (or no prerequisites), and is inside its schedule window, advance
 * it to `in_progress` and sync the card visual state. Returns whether the
 * task was advanced. Safe to call after any schedule edit or status change.
 *
 * Defensive by contract: this runs as a side-effect of edits/status changes,
 * so an unexpected state (race with a delete, missing card row, etc.) must
 * never throw into the caller's request. Any failure is logged and treated as
 * "not advanced" (returns false).
 */
export async function tryActivateTask(taskId: string): Promise<boolean> {
  try {
    return await activate(taskId);
  } catch (err) {
    const cause =
      err instanceof Error && err.cause !== undefined ? err.cause : undefined;
    log.error(
      {
        taskId,
        err:
          err instanceof Error
            ? { message: err.message, stack: err.stack, cause }
            : { message: String(err) },
      },
      "tryActivateTask failed (best-effort, swallowed)",
    );
    return false;
  }
}

async function activate(taskId: string): Promise<boolean> {
  const [t] = await db
    .select({
      id: tasks.id,
      status: tasks.status,
      startAt: tasks.startAt,
      dueDate: tasks.dueDate,
      scheduleMode: tasks.scheduleMode,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!t || t.status !== "pending") return false;
  // `ate` tasks intentionally do NOT auto-activate from edit or scheduler
  // paths. They follow the legacy cascade-only behavior implemented inline
  // in cards.ts (advance only when an upstream dependency completes).
  // Edits to dueDate/startAt on an `ate` task must not silently move it to
  // in_progress.
  const mode = t.scheduleMode ?? "ate";
  // "ate", "sem_prazo", and "urgente" follow the legacy cascade-only path —
  // no schedule window to fire activation from, so the cards.ts dependency
  // cascade is the only thing that advances them.
  if (mode === "ate" || mode === "sem_prazo" || mode === "urgente") return false;
  if (!isWithinScheduleWindow(t.scheduleMode, t.startAt, t.dueDate)) return false;

  const [card] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.taskId, taskId))
    .limit(1);

  if (card) {
    const prereqs = await db
      .select({ sourceCardId: cardConnections.sourceCardId })
      .from(cardConnections)
      .where(
        and(
          eq(cardConnections.targetCardId, card.id),
          eq(cardConnections.targetHandle, "target-left"),
        ),
      );
    for (const pr of prereqs) {
      const [prCard] = await db
        .select({ taskId: cards.taskId })
        .from(cards)
        .where(eq(cards.id, pr.sourceCardId))
        .limit(1);
      if (!prCard?.taskId) return false;
      const [prTask] = await db
        .select({ status: tasks.status })
        .from(tasks)
        .where(eq(tasks.id, prCard.taskId))
        .limit(1);
      if (!prTask || (prTask.status !== "completed" && prTask.status !== "blocked")) {
        return false;
      }
    }
  }

  const overdue = computeOverdue(t.dueDate, "in_progress");
  const now = new Date();
  // Advance task + card visual atomically so we never leave a task
  // `in_progress` with a stale card (or vice-versa) if one update fails.
  await db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({ status: "in_progress", overdue, updatedAt: now })
      .where(eq(tasks.id, taskId));
    if (card) {
      await tx
        .update(cards)
        .set({ statusVisual: toVisualStatus("in_progress", overdue), updatedAt: now })
        .where(eq(cards.id, card.id));
    }
  });
  return true;
}
