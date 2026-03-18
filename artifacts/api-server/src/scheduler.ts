import { db } from "@workspace/db";
import { tasks, cards } from "@workspace/db/schema";
import { eq, and, lt, gte, ne, isNotNull } from "drizzle-orm";
import { sql } from "drizzle-orm";

export async function syncOverdueFlags() {
  const now = new Date();

  // Mark as overdue: due_date in the past, not completed, not yet flagged
  const toOverdue = await db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(and(lt(tasks.dueDate, now), ne(tasks.status, "completed"), eq(tasks.overdue, false)));

  for (const t of toOverdue) {
    await db.update(tasks).set({ overdue: true, updatedAt: now }).where(eq(tasks.id, t.id));
    // Sync card statusVisual
    await db
      .update(cards)
      .set({ statusVisual: "overdue", updatedAt: now })
      .where(eq(cards.taskId, t.id));
  }

  // Clear overdue flag: due_date is now in the future (or null), and flag is still set
  const toClear = await db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.overdue, true), ne(tasks.status, "completed")));

  for (const t of toClear) {
    const [full] = await db.select({ dueDate: tasks.dueDate }).from(tasks).where(eq(tasks.id, t.id)).limit(1);
    if (full?.dueDate && full.dueDate < now) continue; // still overdue
    await db.update(tasks).set({ overdue: false, updatedAt: now }).where(eq(tasks.id, t.id));
    // Restore statusVisual to task status
    const [fullTask] = await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, t.id)).limit(1);
    if (fullTask) {
      await db
        .update(cards)
        .set({ statusVisual: fullTask.status as any, updatedAt: now })
        .where(eq(cards.taskId, t.id));
    }
  }

  // Also clear overdue for completed tasks
  const completedOverdue = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.status, "completed"), eq(tasks.overdue, true)));

  for (const t of completedOverdue) {
    await db.update(tasks).set({ overdue: false, updatedAt: now }).where(eq(tasks.id, t.id));
    await db
      .update(cards)
      .set({ statusVisual: "completed", updatedAt: now })
      .where(eq(cards.taskId, t.id));
  }

  if (toOverdue.length > 0 || toClear.length > 0 || completedOverdue.length > 0) {
    console.log(`[scheduler] overdue sync: +${toOverdue.length} flagged, ${toClear.length + completedOverdue.length} cleared`);
  }
}

export function startScheduler() {
  // Run immediately on startup
  syncOverdueFlags().catch(console.error);
  // Then every 5 minutes
  setInterval(() => syncOverdueFlags().catch(console.error), 5 * 60 * 1000);
  console.log("[scheduler] overdue sync started (every 5 min)");
}
