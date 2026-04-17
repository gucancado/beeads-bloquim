import { db } from "@workspace/db";
import {
  tasks,
  cards,
  cardConnections,
  users,
  workspaceMembers,
} from "@workspace/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { computeOverdue } from "../lib/overdue";
import {
  parseDateNoon,
  toVisualStatus,
} from "./taskVisualSyncService";
import {
  getApprovalChainInfo,
  computeTerminalCardId,
  rerouteDownstreamConnections,
} from "./approvalChainService";

type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "overdue"
  | "blocked"
  | "draft";

/**
 * Hard cap on the number of approvers a single task may have. Mirrored to the
 * route layer for the validation error message.
 */
export const MAX_APPROVERS = 3;

/**
 * Initial status of a freshly-created approval task, derived from the parent
 * task's current status. Approval cards on a draft parent stay draft, on a
 * pending parent stay pending; otherwise they become in_progress.
 *
 * Exported because it is also consumed by the (non-approval) bulk task
 * status update path in routes/workspaceTasks.ts.
 */
export function getApprovalTaskStatus(parentStatus: string): TaskStatus {
  if (parentStatus === "draft") return "draft";
  if (parentStatus === "pending") return "pending";
  return "in_progress";
}

/** Generic { status, body } envelope so route handlers stay one-liners. */
export interface ServiceResponse<T = unknown> {
  status: number;
  body: T;
}

/**
 * Add a new approver (an approval task + its card) under the given parent
 * task. Reroutes downstream connections from the old terminal card to the
 * newly-created approval card when the new approver becomes the terminal.
 *
 * Validation errors mapped to HTTP status:
 *   404 — parent task not found in this workspace
 *   400 — parent is itself an approval task
 *   400 — MAX_APPROVERS reached
 *   400 — approverId is already an approver for this parent
 *   400 — approverId is not a member of this workspace
 *   201 — created (returns the public approval row shape)
 */
export async function addApprover(
  workspaceId: string,
  taskId: string,
  input: { approverId: string; dueDate?: string | null },
): Promise<ServiceResponse> {
  const [parentTask] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  if (!parentTask) {
    return { status: 404, body: { error: "Not found" } };
  }
  if (parentTask.isApprovalTask) {
    return {
      status: 400,
      body: { error: "Cannot add approvers to an approval task" },
    };
  }

  const { approverId, dueDate } = input;

  const existing = await db
    .select({ id: tasks.id, assignedTo: tasks.assignedTo })
    .from(tasks)
    .where(
      and(eq(tasks.parentTaskId, taskId), eq(tasks.isApprovalTask, true)),
    );
  if (existing.length >= MAX_APPROVERS) {
    return {
      status: 400,
      body: { error: `Maximum of ${MAX_APPROVERS} approvers allowed` },
    };
  }

  const alreadyApprover = existing.some((t) => t.assignedTo === approverId);
  if (alreadyApprover) {
    return {
      status: 400,
      body: { error: "This member is already an approver for this task" },
    };
  }

  const [approverMember] = await db
    .select({ name: users.name, avatarUrl: users.avatarUrl })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, approverId),
      ),
    )
    .limit(1);
  if (!approverMember) {
    return {
      status: 400,
      body: { error: "Approver must be a member of this workspace" },
    };
  }

  const nextOrder = existing.length;

  // Capture chain state before inserting so we know the old terminal
  const oldChainInfoAdd = await getApprovalChainInfo(taskId);
  const oldTerminalCardIdAdd = oldChainInfoAdd
    ? computeTerminalCardId(
        oldChainInfoAdd.approvalTasksSorted,
        oldChainInfoAdd.approvalCardByTaskId,
        oldChainInfoAdd.parentCardId,
        parentTask.approvalMode ?? "sequential",
      )
    : null;

  const approvalStatus = getApprovalTaskStatus(parentTask.status);
  const dueDateValue =
    dueDate !== undefined ? parseDateNoon(dueDate) : parentTask.dueDate ?? null;

  const [approvalTask] = await db
    .insert(tasks)
    .values({
      workspaceId,
      mapId: parentTask.mapId,
      title: `aprovação: ${parentTask.title}`,
      assignedTo: approverId,
      dueDate: dueDateValue,
      priority: "medium",
      status: approvalStatus,
      isApprovalTask: true,
      parentTaskId: taskId,
      approvalOrder: nextOrder,
      overdue: computeOverdue(dueDateValue, approvalStatus),
    })
    .returning();

  let newApprovalCardId: string | undefined;
  if (parentTask.mapId) {
    const [parentCard] = await db
      .select({ positionX: cards.positionX, positionY: cards.positionY })
      .from(cards)
      .where(eq(cards.taskId, taskId))
      .limit(1);

    const offsetX = 350 + nextOrder * 50;
    const offsetY = 150 + nextOrder * 120;
    const approvalX = parentCard ? parentCard.positionX + offsetX : offsetX;
    const approvalY = parentCard ? parentCard.positionY + offsetY : offsetY;

    const [insertedApprovalCard] = await db
      .insert(cards)
      .values({
        mapId: parentTask.mapId,
        title: `aprovação: ${parentTask.title}`,
        positionX: approvalX,
        positionY: approvalY,
        taskId: approvalTask.id,
        statusVisual: toVisualStatus(
          approvalStatus,
          computeOverdue(dueDateValue, approvalStatus),
        ),
      })
      .returning({ id: cards.id });
    newApprovalCardId = insertedApprovalCard?.id;
  }

  // Reroute downstream connections to the new terminal
  if (oldChainInfoAdd && oldTerminalCardIdAdd && newApprovalCardId) {
    const newApprovalTasks = [
      ...oldChainInfoAdd.approvalTasksSorted,
      { id: approvalTask.id, approvalOrder: nextOrder },
    ];
    const newApprovalCardByTaskId = new Map(
      oldChainInfoAdd.approvalCardByTaskId,
    );
    newApprovalCardByTaskId.set(approvalTask.id, newApprovalCardId);
    const newChainCardIds = new Set<string>([
      oldChainInfoAdd.parentCardId,
      ...newApprovalCardByTaskId.values(),
    ]);
    const newTerminalCardId = computeTerminalCardId(
      newApprovalTasks,
      newApprovalCardByTaskId,
      oldChainInfoAdd.parentCardId,
      parentTask.approvalMode ?? "sequential",
    );
    await rerouteDownstreamConnections(
      oldTerminalCardIdAdd,
      newTerminalCardId,
      newChainCardIds,
    );
  }

  return {
    status: 201,
    body: {
      id: approvalTask.id,
      title: approvalTask.title,
      status: approvalTask.status,
      approvalOrder: approvalTask.approvalOrder,
      approvalStatus: approvalTask.approvalStatus,
      dueDate: approvalTask.dueDate,
      assignedTo: approvalTask.assignedTo,
      approverName: approverMember.name,
      approverAvatarUrl: approverMember.avatarUrl,
    },
  };
}

/**
 * Delete an approver (its approval task + card) from the given parent task.
 * If the deleted card was the terminal of the chain, downstream connections
 * are reconnected from the NEW terminal so the graph stays valid.
 *
 *   404 — parent task or approval task not found
 *   200 — { success: true }
 */
export async function deleteApprover(
  workspaceId: string,
  taskId: string,
  approvalTaskId: string,
): Promise<ServiceResponse> {
  const [parentTask] = await db
    .select({ id: tasks.id, approvalMode: tasks.approvalMode })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  if (!parentTask) {
    return { status: 404, body: { error: "Not found" } };
  }

  const [approvalTask] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.id, approvalTaskId),
        eq(tasks.parentTaskId, taskId),
        eq(tasks.isApprovalTask, true),
        eq(tasks.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!approvalTask) {
    return { status: 404, body: { error: "Approval task not found" } };
  }

  // Capture chain state and identify downstream connections before deleting
  const chainInfoDel = await getApprovalChainInfo(taskId);
  const oldTerminalCardIdDel = chainInfoDel
    ? computeTerminalCardId(
        chainInfoDel.approvalTasksSorted,
        chainInfoDel.approvalCardByTaskId,
        chainInfoDel.parentCardId,
        parentTask.approvalMode ?? "sequential",
      )
    : null;
  const deletedCardId = chainInfoDel?.approvalCardByTaskId.get(approvalTask.id);
  const isTerminalBeingDeleted =
    deletedCardId && deletedCardId === oldTerminalCardIdDel;

  // Save downstream targets from the deleted (terminal) card before CASCADE
  // removes them
  let downstreamTargets: Array<{
    targetCardId: string;
    sourceHandle: string | null;
    targetHandle: string | null;
  }> = [];
  if (isTerminalBeingDeleted && deletedCardId && chainInfoDel) {
    const conns = await db
      .select({
        targetCardId: cardConnections.targetCardId,
        sourceHandle: cardConnections.sourceHandle,
        targetHandle: cardConnections.targetHandle,
      })
      .from(cardConnections)
      .where(eq(cardConnections.sourceCardId, deletedCardId));
    downstreamTargets = conns.filter(
      (c) => !chainInfoDel.chainCardIds.has(c.targetCardId),
    );
  }

  await db.delete(cards).where(eq(cards.taskId, approvalTask.id));
  await db.delete(tasks).where(eq(tasks.id, approvalTask.id));

  const remaining = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(eq(tasks.parentTaskId, taskId), eq(tasks.isApprovalTask, true)),
    )
    .orderBy(asc(tasks.approvalOrder));

  for (let i = 0; i < remaining.length; i++) {
    await db
      .update(tasks)
      .set({ approvalOrder: i })
      .where(eq(tasks.id, remaining[i].id));
  }

  // Reconnect downstream targets from new terminal (if deleted card was
  // terminal)
  if (isTerminalBeingDeleted && downstreamTargets.length > 0 && chainInfoDel) {
    const remainingApprovalTasks = chainInfoDel.approvalTasksSorted.filter(
      (t) => t.id !== approvalTask.id,
    );
    const remainingApprovalCardByTaskId = new Map(
      chainInfoDel.approvalCardByTaskId,
    );
    remainingApprovalCardByTaskId.delete(approvalTask.id);
    const newTerminalCardId = computeTerminalCardId(
      remainingApprovalTasks,
      remainingApprovalCardByTaskId,
      chainInfoDel.parentCardId,
      parentTask.approvalMode ?? "sequential",
    );
    const [terminalCardRow] = await db
      .select({ mapId: cards.mapId })
      .from(cards)
      .where(eq(cards.id, newTerminalCardId))
      .limit(1);
    if (terminalCardRow) {
      for (const t of downstreamTargets) {
        const [existing] = await db
          .select({ id: cardConnections.id })
          .from(cardConnections)
          .where(
            and(
              eq(cardConnections.sourceCardId, newTerminalCardId),
              eq(cardConnections.targetCardId, t.targetCardId),
            ),
          )
          .limit(1);
        if (!existing) {
          await db.insert(cardConnections).values({
            mapId: terminalCardRow.mapId,
            sourceCardId: newTerminalCardId,
            targetCardId: t.targetCardId,
            sourceHandle: t.sourceHandle,
            targetHandle: t.targetHandle,
          });
        }
      }
    }
  }

  return { status: 200, body: { success: true } };
}

/**
 * Reorder the approvers under the given parent task. `orderedIds` MUST be a
 * permutation of the existing approval-task IDs (no extras, no duplicates,
 * none missing). Reroutes downstream connections from the old terminal to
 * the new terminal whenever the head/tail of the chain shifts.
 *
 *   404 — parent task not found
 *   400 — orderedIds does not match the existing approval-task ID set
 *   200 — { success: true }
 */
export async function reorderApprovals(
  workspaceId: string,
  taskId: string,
  orderedIds: string[],
): Promise<ServiceResponse> {
  const [parentTask] = await db
    .select({ id: tasks.id, approvalMode: tasks.approvalMode })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  if (!parentTask) {
    return { status: 404, body: { error: "Not found" } };
  }

  const existingApprovals = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(eq(tasks.parentTaskId, taskId), eq(tasks.isApprovalTask, true)),
    );

  const existingIds = new Set(existingApprovals.map((t) => t.id));

  const hasDuplicates = new Set(orderedIds).size !== orderedIds.length;
  const sameSet =
    orderedIds.length === existingIds.size &&
    orderedIds.every((id) => existingIds.has(id));
  if (hasDuplicates || !sameSet) {
    return {
      status: 400,
      body: {
        error:
          "orderedIds must contain exactly the approval task IDs for this task, without duplicates",
      },
    };
  }

  // Capture chain state before reordering to know the old terminal
  const chainInfoReorder = await getApprovalChainInfo(taskId);
  const mode = parentTask.approvalMode ?? "sequential";
  const oldTerminalCardIdReorder = chainInfoReorder
    ? computeTerminalCardId(
        chainInfoReorder.approvalTasksSorted,
        chainInfoReorder.approvalCardByTaskId,
        chainInfoReorder.parentCardId,
        mode,
      )
    : null;

  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(tasks)
      .set({ approvalOrder: i })
      .where(
        and(eq(tasks.id, orderedIds[i]), eq(tasks.parentTaskId, taskId)),
      );
  }

  // Compute new terminal after reorder and reroute downstream connections
  if (chainInfoReorder && oldTerminalCardIdReorder) {
    const newOrderedApprovalTasks = orderedIds.map((id, i) => ({
      id,
      approvalOrder: i,
    }));
    const newTerminalCardId = computeTerminalCardId(
      newOrderedApprovalTasks,
      chainInfoReorder.approvalCardByTaskId,
      chainInfoReorder.parentCardId,
      mode,
    );
    await rerouteDownstreamConnections(
      oldTerminalCardIdReorder,
      newTerminalCardId,
      chainInfoReorder.chainCardIds,
    );
  }

  return { status: 200, body: { success: true } };
}

/**
 * Switch the parent task's approval mode between `sequential` and `parallel`.
 * Reroutes downstream connections when the terminal card changes (terminal is
 * the last approver in sequential mode and the parent card in parallel mode).
 *
 *   404 — parent task not found
 *   200 — `{ id, approvalMode }` of the updated parent
 */
export async function setApprovalMode(
  workspaceId: string,
  taskId: string,
  newMode: "sequential" | "parallel",
): Promise<ServiceResponse> {
  // Capture chain state and old terminal before changing mode
  const [currentTask] = await db
    .select({ approvalMode: tasks.approvalMode })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  const chainInfoMode = currentTask ? await getApprovalChainInfo(taskId) : null;
  const oldTerminalCardIdMode = chainInfoMode
    ? computeTerminalCardId(
        chainInfoMode.approvalTasksSorted,
        chainInfoMode.approvalCardByTaskId,
        chainInfoMode.parentCardId,
        currentTask!.approvalMode ?? "sequential",
      )
    : null;

  const [updated] = await db
    .update(tasks)
    .set({ approvalMode: newMode, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .returning({ id: tasks.id, approvalMode: tasks.approvalMode });

  if (!updated) {
    return { status: 404, body: { error: "Not found" } };
  }

  // Reroute downstream connections if the terminal changed due to mode switch
  if (chainInfoMode && oldTerminalCardIdMode) {
    const newTerminalCardId = computeTerminalCardId(
      chainInfoMode.approvalTasksSorted,
      chainInfoMode.approvalCardByTaskId,
      chainInfoMode.parentCardId,
      newMode,
    );
    await rerouteDownstreamConnections(
      oldTerminalCardIdMode,
      newTerminalCardId,
      chainInfoMode.chainCardIds,
    );
  }

  return { status: 200, body: updated };
}
