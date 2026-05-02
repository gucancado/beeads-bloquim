import { db } from "@workspace/db";
import { tasks, cards, cardConnections } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { computeOverdue } from "../lib/overdue";
import { toVisualStatus } from "./taskVisualSyncService";
import { isWithinScheduleWindow } from "../lib/scheduleMode";

/**
 * Best-effort: if a task is currently `pending`, has all card prerequisites
 * resolved (or no prerequisites), and is inside its schedule window, advance
 * it to `in_progress` and sync the card visual state. Returns whether the
 * task was advanced. Safe to call after any schedule edit or status change.
 */
export async function tryActivateTask(taskId: string): Promise<boolean> {
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
  if ((t.scheduleMode ?? "ate") === "ate") return false;
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
  await db
    .update(tasks)
    .set({ status: "in_progress", overdue, updatedAt: now })
    .where(eq(tasks.id, taskId));
  if (card) {
    await db
      .update(cards)
      .set({ statusVisual: toVisualStatus("in_progress", overdue), updatedAt: now })
      .where(eq(cards.id, card.id));
  }
  return true;
}
