import { db } from "@workspace/db";
import {
  tasks,
  cards,
  users,
  type RecurrenceConfig,
} from "@workspace/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { computeOverdue } from "../lib/overdue";
import { calculateNextDueDate } from "../lib/recurrence";
import { duplicateRecurringTask } from "../lib/duplicateRecurring";
import { toVisualStatus, syncCardVisual } from "./taskVisualSyncService";
import { getApprovalTaskStatus } from "./approvalCrudService";
import { recordTaskActivity } from "./taskActivitiesService";

/** Generic { status, body } envelope so route handlers stay one-liners. */
export interface ServiceResponse<T = unknown> {
  status: number;
  body: T;
}

export type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | "draft";

export interface PatchStatusInput {
  status: TaskStatus;
  /** Only honored when the task has no `mapId` (recurrence is map-less). */
  isRecurring?: boolean;
  /** Only honored when the task has no `mapId`. `null` clears the config. */
  recurrenceConfig?: RecurrenceConfig | null;
}

/**
 * Patch a task's status and run all the bookkeeping that goes with it:
 *   - update the parent's `status`/`previousStatus`/`updatedAt`/`completedAt`
 *     and recompute `overdue`;
 *   - apply atomic recurrence-state changes when the task has no `mapId`
 *     (lets the client send `{ status, isRecurring, recurrenceConfig }` in a
 *     single request without a follow-up race);
 *   - reset `parentApprovalStatus` when going from `approved` back to one of
 *     {`in_progress`,`draft`,`pending`};
 *   - mirror the status to the linked card via `syncCardVisual`;
 *   - record a `status_changed` activity on the parent if (and only if) the
 *     status actually changed;
 *   - cascade into approval-children: in `sequential` mode a `completed`
 *     parent activates only the first child (others stay `pending`); other
 *     parent states map through `getApprovalTaskStatus`. Children also get
 *     their visual updated and a `status_changed` activity when their status
 *     actually changed. Resetting the parent to a non-completed state clears
 *     each child's `approvalStatus`/`approvalComment`;
 *   - when a `completed` transition happens with approval children, set the
 *     parent's `parentApprovalStatus` to `in_approval`;
 *   - when a recurring map-less task transitions INTO `completed`, duplicate
 *     it with the next due date computed from `recurrenceConfig`.
 *
 *   404 — task not found in this workspace
 *   200 — the updated parent task row
 */
export async function patchTaskStatus(
  workspaceId: string,
  taskId: string,
  actorId: string,
  input: PatchStatusInput,
  source: string | null = null,
): Promise<ServiceResponse> {
  const { status, isRecurring: bodyIsRecurring, recurrenceConfig: bodyRecurrenceConfig } = input;

  const [existing] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  if (!existing) {
    return { status: 404, body: { error: "Not found" } };
  }

  const previousStatus = existing.status;

  const updateData: Record<string, any> = {
    status,
    previousStatus,
    updatedAt: new Date(),
    completedAt: status === "completed" ? new Date() : null,
  };

  updateData.overdue = computeOverdue(existing.dueDate, status);
  // If client sends recurrence state alongside status, apply it atomically (prevents race condition)
  if (bodyIsRecurring !== undefined && !existing.mapId) updateData.isRecurring = bodyIsRecurring;
  if (bodyRecurrenceConfig !== undefined && !existing.mapId) updateData.recurrenceConfig = bodyRecurrenceConfig ?? null;

  // Reset parentApprovalStatus when task goes back to in_progress/draft/pending from approved
  if (["in_progress", "draft", "pending"].includes(status) && existing.parentApprovalStatus === "approved") {
    updateData.parentApprovalStatus = null;
  }

  const [updated] = await db.update(tasks).set(updateData).where(eq(tasks.id, taskId)).returning();

  await syncCardVisual(taskId, updated.status, !!updated.overdue);

  if (previousStatus !== status) {
    const [actorUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, actorId)).limit(1);
    await recordTaskActivity({
      taskId,
      actorId,
      type: "status_changed",
      metadata: {
        actorName: actorUser?.name ?? null,
        oldStatus: previousStatus,
        newStatus: status,
      },
      source,
    });
  }

  if (previousStatus !== status) {
    const approvalChildTasks = await db
      .select({ id: tasks.id, dueDate: tasks.dueDate, status: tasks.status, approvalOrder: tasks.approvalOrder })
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, taskId), eq(tasks.isApprovalTask, true)))
      .orderBy(asc(tasks.approvalOrder));

    const actorUserForCascade = (await db.select({ name: users.name }).from(users).where(eq(users.id, actorId)).limit(1))[0];

    // When resetting parent to a non-completed state, clear approval decisions so children
    // start fresh in the next cycle.
    const clearApprovalDecisions = ["in_progress", "draft", "pending", "blocked"].includes(status);

    // In sequential mode, when parent completes, only the first approval task activates;
    // the rest stay pending until each predecessor approves.
    const isSequential = (existing.approvalMode ?? "sequential") === "sequential";

    for (let i = 0; i < approvalChildTasks.length; i++) {
      const child = approvalChildTasks[i];
      const approvalTaskNewStatus =
        status === "completed" && isSequential && i > 0
          ? "pending"
          : getApprovalTaskStatus(status);
      const childOverdue = computeOverdue(child.dueDate, approvalTaskNewStatus);
      const childVisual = toVisualStatus(approvalTaskNewStatus, childOverdue);
      const childUpdateSet: Record<string, any> = { status: approvalTaskNewStatus, overdue: childOverdue, updatedAt: new Date() };
      if (clearApprovalDecisions) {
        childUpdateSet.approvalStatus = null;
        childUpdateSet.approvalComment = null;
      }
      await db.update(tasks)
        .set(childUpdateSet)
        .where(eq(tasks.id, child.id));
      await db.update(cards)
        .set({ statusVisual: childVisual, updatedAt: new Date() })
        .where(eq(cards.taskId, child.id));
      if (child.status !== approvalTaskNewStatus) {
        await recordTaskActivity({
          taskId: child.id,
          actorId,
          type: "status_changed",
          metadata: {
            actorName: actorUserForCascade?.name ?? null,
            oldStatus: child.status,
            newStatus: approvalTaskNewStatus,
          },
          source,
        });
      }
    }

    // When completing with any approval children, set parentApprovalStatus to in_approval.
    // Children are transitioned to in_progress regardless of their prior state,
    // so any completion with approval children enters the approval cycle.
    if (status === "completed" && approvalChildTasks.length > 0) {
      await db.update(tasks)
        .set({ parentApprovalStatus: "in_approval", updatedAt: new Date() })
        .where(eq(tasks.id, taskId));
      updated.parentApprovalStatus = "in_approval";
    }
  }

  // Handle recurrence: when a recurring task without mapId transitions INTO completed, duplicate it with the next due date
  // Use updated.isRecurring/recurrenceConfig so that recurrence state sent atomically with status is respected
  if (status === "completed" && previousStatus !== "completed" && updated.isRecurring && updated.recurrenceConfig && !existing.mapId) {
    const completedAt = updated.completedAt ?? new Date();
    const nextDueDate = calculateNextDueDate(existing.dueDate, updated.recurrenceConfig as RecurrenceConfig, completedAt);
    await duplicateRecurringTask(updated, nextDueDate, actorId, workspaceId);
  }

  return { status: 200, body: updated };
}
