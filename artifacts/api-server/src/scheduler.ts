import { db } from "@workspace/db";
import { tasks, cards } from "@workspace/db/schema";
import { eq, and, lt, lte, ne, isNotNull, notExists, inArray } from "drizzle-orm";
import { getTodayLocal } from "./lib/overdue";
import { tryActivateTask } from "./services/taskActivation";
import { isMeetingsAgendaEnabled } from "./lib/featureFlags";
import { runMeetingsSync } from "./services/meetingsSyncService";
import { runMeetingsDispatch } from "./services/meetingsDispatchService";
import { logger } from "./lib/logger";

const schedulerLogger = logger.child({ module: "scheduler" });

export async function syncOverdueFlags() {
  const now = new Date();
  const today = getTodayLocal();

  // Mark as overdue: due_date strictly before today (date-only), not completed, not yet flagged
  const toOverdue = await db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(and(lt(tasks.dueDate, today), ne(tasks.status, "completed"), eq(tasks.overdue, false)));

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
    if (full?.dueDate) {
      const due = new Date(full.dueDate);
      due.setUTCHours(0, 0, 0, 0);
      if (due < today) continue; // still overdue
    }
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
    schedulerLogger.info(
      {
        flagged: toOverdue.length,
        cleared: toClear.length + completedOverdue.length,
      },
      "overdue sync",
    );
  }
}

/**
 * Auto-activate `pending` tasks whose schedule window has been reached
 * (today >= startAt AND today <= dueDate) and whose prerequisites are
 * complete. Delegates the per-task decision to `tryActivateTask` so the
 * cascade and PATCH paths share the same eligibility rules.
 */
export async function activateScheduledTasks() {
  // `startAt` is persisted at 12:00 UTC by `parseDateNoon`, while
  // `getTodayLocal()` returns midnight UTC of today (in São Paulo). To
  // include any timestamp whose calendar date is "today or earlier" we
  // compare against the start of the next day rather than `lte(today)`,
  // which would otherwise miss start-day rows by ~12 hours.
  const today = getTodayLocal();
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const candidates = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.status, "pending"),
        isNotNull(tasks.startAt),
        lt(tasks.startAt, tomorrow),
      ),
    );

  if (candidates.length === 0) return;

  let activated = 0;
  for (const t of candidates) {
    if (await tryActivateTask(t.id)) activated += 1;
  }

  if (activated > 0) {
    schedulerLogger.info({ activated }, "schedule window sweep");
  }
}

export async function cleanupOrphanTasks() {
  const orphans = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        isNotNull(tasks.mapId),
        notExists(
          db.select({ taskId: cards.taskId }).from(cards).where(eq(cards.taskId, tasks.id))
        )
      )
    );

  if (orphans.length === 0) return;

  const ids = orphans.map((o) => o.id);
  await db.delete(tasks).where(inArray(tasks.id, ids));

  schedulerLogger.info(
    { orphansCleaned: orphans.length },
    "startup orphan task cleanup",
  );
}

/** Lê um intervalo em ms de env, com default e validação (positivo finito). */
function envIntervalMs(name: string, defaultMs: number): number {
  const raw = process.env[name];
  if (raw === undefined) return defaultMs;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : defaultMs;
}

export function startScheduler() {
  const onErr = (err: unknown) =>
    schedulerLogger.error({ err }, "scheduler task failed");
  // Clean up orphan tasks once on startup
  cleanupOrphanTasks().catch(onErr);
  // Run immediately on startup
  syncOverdueFlags().catch(onErr);
  activateScheduledTasks().catch(onErr);
  // Then every 5 minutes
  setInterval(() => syncOverdueFlags().catch(onErr), 5 * 60 * 1000);
  setInterval(() => activateScheduledTasks().catch(onErr), 5 * 60 * 1000);
  schedulerLogger.info({ intervalMs: 5 * 60 * 1000 }, "overdue sync started");

  // Crons da agenda de reuniões — atrás de gate estrito (default OFF): sync
  // GCal→meetings e dispatch da coleta. Só sobem com MEETINGS_AGENDA_ENABLED +
  // reuniões + Google Calendar habilitados.
  const SYNC_MS = envIntervalMs("MEETINGS_AGENDA_SYNC_INTERVAL_MS", 900_000);
  const DISPATCH_MS = envIntervalMs("MEETINGS_AGENDA_DISPATCH_INTERVAL_MS", 60_000);
  if (isMeetingsAgendaEnabled()) {
    runMeetingsSync().catch(onErr);
    setInterval(() => runMeetingsSync().catch(onErr), SYNC_MS);
    setInterval(() => runMeetingsDispatch().catch(onErr), DISPATCH_MS);
    schedulerLogger.info(
      { syncMs: SYNC_MS, dispatchMs: DISPATCH_MS },
      "meetings agenda crons started",
    );
  }
}
