import { db } from "@workspace/db";
import { tasks, subtasks, taskActivities } from "@workspace/db/schema";
import type { RecurrenceConfig, ScheduleMode } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";
import { isWithinScheduleWindow } from "./scheduleMode";

type TaskPriority = "low" | "medium" | "high" | "critical";

interface RecurringTaskSource {
  id: string;
  workspaceId: string | null;
  title: string;
  description: string | null;
  assignedTo: string | null;
  ownerId: string | null;
  priority: string | null;
  scheduleMode: ScheduleMode;
  startAt: Date | null;
  dueDate: Date | null;
  recurrenceConfig: unknown;
}

const VALID_PRIORITIES: TaskPriority[] = ["low", "medium", "high", "critical"];

function toValidPriority(value: string | null | undefined): TaskPriority {
  if (value && VALID_PRIORITIES.includes(value as TaskPriority)) {
    return value as TaskPriority;
  }
  return "medium";
}

/**
 * Decide the effective modality for the duplicated task. Degenerate cases
 * (no next date, or an `entre` task whose original bounds are missing) are
 * downgraded to `sem_prazo` so the new instance is born in a valid state.
 * The recurrence chain itself continues — next completion will retry.
 */
function effectiveMode(
  original: { scheduleMode: ScheduleMode; startAt: Date | null; dueDate: Date | null },
  nextDueDate: Date | null,
): ScheduleMode {
  if (nextDueDate === null) return "sem_prazo";
  if (original.scheduleMode === "entre" && (!original.startAt || !original.dueDate)) {
    return "sem_prazo";
  }
  return original.scheduleMode;
}

/**
 * Project (startAt, dueDate) onto the duplicated task. Assumes `mode` is the
 * effective mode (post-degradation) — callers must use {@link effectiveMode}
 * first so that degenerate cases land on `sem_prazo` rather than fall through
 * here with invalid inputs.
 *
 *   - `sem_prazo` → both null
 *   - `ate`       → startAt null, dueDate = nextDueDate
 *   - `em`        → startAt = dueDate = nextDueDate
 *   - `entre`     → both bounds shifted by the same delta so the window
 *                   length is preserved
 */
function projectSchedule(
  mode: ScheduleMode,
  originalStartAt: Date | null,
  originalDueDate: Date | null,
  nextDueDate: Date | null,
): { startAt: Date | null; dueDate: Date | null } {
  if (mode === "sem_prazo" || mode === "urgente") return { startAt: null, dueDate: null };
  if (mode === "ate") return { startAt: null, dueDate: nextDueDate };
  if (mode === "em") return { startAt: nextDueDate, dueDate: nextDueDate };
  // "entre" — invariant from effectiveMode: bounds and nextDueDate are present
  const deltaMs = nextDueDate!.getTime() - originalDueDate!.getTime();
  return {
    startAt: new Date(originalStartAt!.getTime() + deltaMs),
    dueDate: nextDueDate,
  };
}

/**
 * Decide whether the new instance is born active or waiting for its window.
 * `ate` and `sem_prazo` have no window and are always active; `em`/`entre`
 * defer to the schedule-window check. Fast-forward guarantees the dueDate
 * is today-or-future, so `overdue` is always false at birth.
 */
function initialStatus(
  mode: ScheduleMode,
  startAt: Date | null,
  dueDate: Date | null,
): "pending" | "in_progress" {
  if (mode === "ate" || mode === "sem_prazo" || mode === "urgente") return "in_progress";
  return isWithinScheduleWindow(mode, startAt, dueDate) ? "in_progress" : "pending";
}

/**
 * Duplicate a recurring task when it transitions to completed, producing a
 * new instance for the next occurrence and resetting subtasks to incomplete.
 * Uses a DB transaction for atomicity (same pattern as POST /:taskId/duplicate).
 *
 * `nextDueDate` should come from `calculateNextDueDateInFuture` — i.e. already
 * fast-forwarded past today. A `null` here means the recurrence engine could
 * not produce a future date; the new task is downgraded to `sem_prazo` so the
 * chain stays alive without inventing a date.
 */
export async function duplicateRecurringTask(
  original: RecurringTaskSource,
  nextDueDate: Date | null,
  actorId: string,
  workspaceId: string | undefined,
): Promise<void> {
  const mode = effectiveMode(original, nextDueDate);
  const schedule = projectSchedule(mode, original.startAt, original.dueDate, nextDueDate);
  const status = initialStatus(mode, schedule.startAt, schedule.dueDate);

  await db.transaction(async (tx) => {
    const originalSubtasks = await tx
      .select()
      .from(subtasks)
      .where(eq(subtasks.taskId, original.id))
      .orderBy(asc(subtasks.order), asc(subtasks.createdAt));

    const [newTask] = await tx.insert(tasks).values({
      workspaceId: original.workspaceId,
      mapId: null,
      title: original.title,
      description: original.description,
      assignedTo: original.assignedTo,
      ownerId: original.ownerId,
      priority: toValidPriority(original.priority),
      status,
      overdue: false,
      scheduleMode: mode,
      startAt: schedule.startAt,
      dueDate: schedule.dueDate,
      isRecurring: true,
      recurrenceConfig: original.recurrenceConfig as RecurrenceConfig,
    }).returning();

    if (originalSubtasks.length > 0) {
      await tx.insert(subtasks).values(
        originalSubtasks.map((s) => ({
          taskId: newTask.id,
          text: s.text,
          completed: false,
          order: s.order,
        }))
      );
    }

    await tx.insert(taskActivities).values({
      taskId: newTask.id,
      actorId,
      type: "task_duplicated",
      metadata: { originalTaskId: original.id, workspaceId: workspaceId ?? original.workspaceId ?? null },
    });
  });
}
