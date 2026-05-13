import { db } from "@workspace/db";
import {
  tasks,
  cards,
  cardConnections,
  users,
} from "@workspace/db/schema";
import { eq, and, asc, inArray, ne } from "drizzle-orm";
import { computeOverdue } from "../lib/overdue";
import {
  syncCardVisual,
  toVisualStatus,
} from "./taskVisualSyncService";
import {
  getApprovalChainInfo,
  computeTerminalCardId,
} from "./approvalChainService";
import { recordTaskActivity } from "./taskActivitiesService";

export interface ApprovalDecisionResult {
  /** The updated approval task row, ready to be returned by the route. */
  updated: typeof tasks.$inferSelect;
}

/**
 * Approve an approval task. Mirrors the previous inline route logic exactly:
 *   - marks the approval task as completed/approved with the given comment;
 *   - records `task_approved` on the approval task and `approval_comment`
 *     (decision="approved") on the parent;
 *   - in `sequential` mode, activates the next pending sibling approval;
 *   - when ALL siblings are approved, sets `parentApprovalStatus="approved"`
 *     on the parent and activates downstream cards reachable from the
 *     terminal approval card whose prerequisites are all done.
 *
 * Returns `null` if no approval task with `(taskId, workspaceId,
 * isApprovalTask=true)` exists, so the caller can return 404.
 */
export async function approveApprovalTask(
  workspaceId: string,
  taskId: string,
  actorId: string,
  comment: string | null,
  source: string | null = null,
): Promise<ApprovalDecisionResult | null> {
  const [approvalTask] = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.workspaceId, workspaceId),
        eq(tasks.isApprovalTask, true),
      ),
    )
    .limit(1);

  if (!approvalTask) return null;

  const [updated] = await db
    .update(tasks)
    .set({
      status: "completed",
      approvalStatus: "approved",
      approvalComment: comment,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId))
    .returning();

  await syncCardVisual(taskId, updated.status, !!updated.overdue);

  const [actorUserApprove] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, actorId))
    .limit(1);

  await recordTaskActivity({
    taskId,
    actorId,
    type: "task_approved",
    metadata: {
      actorName: actorUserApprove?.name ?? null,
      comment,
    },
    source,
  });

  if (approvalTask.parentTaskId) {
    await recordTaskActivity({
      taskId: approvalTask.parentTaskId,
      actorId,
      type: "approval_comment",
      metadata: {
        actorName: actorUserApprove?.name ?? null,
        decision: "approved",
        comment,
        approvalTaskTitle: approvalTask.title,
      },
      source,
    });

    // Check if all sibling approval tasks are now approved.
    // Use both status=completed AND approvalStatus=approved to be cycle-safe:
    // a sibling may have approvalStatus="approved" from a previous cycle if
    // the parent was reset.
    const allSiblings = await db
      .select({
        id: tasks.id,
        status: tasks.status,
        approvalStatus: tasks.approvalStatus,
        approvalOrder: tasks.approvalOrder,
        dueDate: tasks.dueDate,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.parentTaskId, approvalTask.parentTaskId),
          eq(tasks.isApprovalTask, true),
        ),
      )
      .orderBy(asc(tasks.approvalOrder));

    const [parentTaskForMode] = await db
      .select({ approvalMode: tasks.approvalMode })
      .from(tasks)
      .where(eq(tasks.id, approvalTask.parentTaskId))
      .limit(1);
    const parentApprovalMode = parentTaskForMode?.approvalMode ?? "sequential";

    const allApproved = allSiblings.every((t) =>
      t.id === taskId
        ? true
        : t.status === "completed" && t.approvalStatus === "approved",
    );

    if (!allApproved && parentApprovalMode === "sequential") {
      // In sequential mode, after one approver completes, activate the next
      // pending task in order.
      const nextPending = allSiblings.find(
        (t) =>
          t.id !== taskId &&
          t.status === "pending" &&
          (t.approvalOrder ?? 0) > (approvalTask.approvalOrder ?? -1),
      );
      if (nextPending) {
        const nextOverdue = computeOverdue(nextPending.dueDate, "in_progress");
        await db
          .update(tasks)
          .set({
            status: "in_progress",
            overdue: nextOverdue,
            updatedAt: new Date(),
          })
          .where(eq(tasks.id, nextPending.id));
        await syncCardVisual(nextPending.id, "in_progress", nextOverdue);
      }
    }

    if (allApproved) {
      await db
        .update(tasks)
        .set({ parentApprovalStatus: "approved", updatedAt: new Date() })
        .where(eq(tasks.id, approvalTask.parentTaskId));

      // Trigger downstream activation from the terminal card of the approval
      // chain. Downstream connections are re-routed to the terminal approval
      // card when approvers are added/reordered, so we must activate from
      // there (not the parent card).
      const chainInfo = await getApprovalChainInfo(approvalTask.parentTaskId);
      const terminalCardId = chainInfo
        ? computeTerminalCardId(
            chainInfo.approvalTasksSorted,
            chainInfo.approvalCardByTaskId,
            chainInfo.parentCardId,
            parentApprovalMode,
          )
        : null;

      if (terminalCardId) {
        const outgoingConnections = await db
          .select()
          .from(cardConnections)
          .where(
            and(
              eq(cardConnections.sourceCardId, terminalCardId),
              eq(cardConnections.sourceHandle, "source-right"),
            ),
          );

        for (const conn of outgoingConnections) {
          const [targetCard] = await db
            .select()
            .from(cards)
            .where(eq(cards.id, conn.targetCardId))
            .limit(1);

          if (!targetCard?.taskId) continue;

          const [targetTask] = await db
            .select()
            .from(tasks)
            .where(eq(tasks.id, targetCard.taskId))
            .limit(1);

          if (!targetTask || targetTask.status !== "pending") continue;

          const prerequisites = await db
            .select()
            .from(cardConnections)
            .where(
              and(
                eq(cardConnections.targetCardId, conn.targetCardId),
                eq(cardConnections.targetHandle, "target-left"),
              ),
            );

          let allPrerequisitesDone = true;
          for (const prereq of prerequisites) {
            const [prereqCard] = await db
              .select()
              .from(cards)
              .where(eq(cards.id, prereq.sourceCardId))
              .limit(1);

            if (!prereqCard?.taskId) {
              allPrerequisitesDone = false;
              break;
            }

            const [prereqTask] = await db
              .select()
              .from(tasks)
              .where(eq(tasks.id, prereqCard.taskId))
              .limit(1);

            if (
              !prereqTask ||
              (prereqTask.status !== "completed" &&
                prereqTask.status !== "blocked")
            ) {
              allPrerequisitesDone = false;
              break;
            }
          }

          if (!allPrerequisitesDone) continue;

          const childOverdue = computeOverdue(
            targetTask.dueDate,
            "in_progress",
          );
          const childVisual = toVisualStatus("in_progress", childOverdue);

          await db
            .update(tasks)
            .set({
              status: "in_progress",
              overdue: childOverdue,
              updatedAt: new Date(),
            })
            .where(eq(tasks.id, targetCard.taskId));

          await db
            .update(cards)
            .set({ statusVisual: childVisual, updatedAt: new Date() })
            .where(eq(cards.id, conn.targetCardId));
        }
      }
    }
  }

  return { updated };
}

/**
 * Reject an approval task. Mirrors the previous inline route logic exactly:
 *   - marks the approval task as `pending`/`rejected` with the given comment;
 *   - records `task_rejected` on the approval task;
 *   - flips the parent back to `in_progress` (if it isn't already) and sets
 *     `parentApprovalStatus="rejected"`;
 *   - resets all SIBLING approvals back to a clean `pending` state so the
 *     next cycle starts fresh; the rejected task keeps its decision;
 *   - records `approval_comment` (decision="rejected") on the parent.
 *
 * Returns `null` if no approval task with `(taskId, workspaceId,
 * isApprovalTask=true)` exists, so the caller can return 404.
 */
export async function rejectApprovalTask(
  workspaceId: string,
  taskId: string,
  actorId: string,
  comment: string | null,
  source: string | null = null,
): Promise<ApprovalDecisionResult | null> {
  const [approvalTask] = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.workspaceId, workspaceId),
        eq(tasks.isApprovalTask, true),
      ),
    )
    .limit(1);

  if (!approvalTask) return null;

  const [updated] = await db
    .update(tasks)
    .set({
      status: "pending",
      approvalStatus: "rejected",
      approvalComment: comment,
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId))
    .returning();

  await syncCardVisual(taskId, updated.status, !!updated.overdue);

  const [actorUserReject] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, actorId))
    .limit(1);

  await recordTaskActivity({
    taskId,
    actorId,
    type: "task_rejected",
    metadata: {
      actorName: actorUserReject?.name ?? null,
      comment,
    },
    source,
  });

  if (approvalTask.parentTaskId) {
    const [parentTask] = await db
      .select({
        id: tasks.id,
        status: tasks.status,
        dueDate: tasks.dueDate,
      })
      .from(tasks)
      .where(eq(tasks.id, approvalTask.parentTaskId))
      .limit(1);

    const parentOverdue = computeOverdue(
      parentTask?.dueDate ?? null,
      "in_progress",
    );
    const parentUpdateData: Record<string, unknown> = {
      parentApprovalStatus: "rejected",
      updatedAt: new Date(),
    };
    if (parentTask && parentTask.status !== "in_progress") {
      parentUpdateData.status = "in_progress";
      parentUpdateData.overdue = parentOverdue;
    }
    await db
      .update(tasks)
      .set(parentUpdateData)
      .where(eq(tasks.id, approvalTask.parentTaskId));

    if (parentUpdateData.status === "in_progress") {
      await syncCardVisual(
        approvalTask.parentTaskId,
        "in_progress",
        parentOverdue,
      );
    }

    // Reset all sibling approval task decisions (except the rejected one
    // which keeps its decision) so that in the next cycle all approvers must
    // re-approve from a clean state.
    const siblingApprovalTasks = await db
      .select({ id: tasks.id, overdue: tasks.overdue })
      .from(tasks)
      .where(
        and(
          eq(tasks.parentTaskId, approvalTask.parentTaskId),
          eq(tasks.isApprovalTask, true),
          ne(tasks.id, taskId),
        ),
      );
    const siblingIds = siblingApprovalTasks.map((s) => s.id);
    if (siblingIds.length > 0) {
      await db
        .update(tasks)
        .set({
          approvalStatus: null,
          approvalComment: null,
          status: "pending",
          completedAt: null,
          updatedAt: new Date(),
        })
        .where(inArray(tasks.id, siblingIds));
      for (const sibling of siblingApprovalTasks) {
        await syncCardVisual(sibling.id, "pending", !!sibling.overdue);
      }
    }

    await recordTaskActivity({
      taskId: approvalTask.parentTaskId,
      actorId,
      type: "approval_comment",
      metadata: {
        actorName: actorUserReject?.name ?? null,
        decision: "rejected",
        comment,
        approvalTaskTitle: approvalTask.title,
      },
      source,
    });
  }

  return { updated };
}
