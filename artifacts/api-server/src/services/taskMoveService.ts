import { db } from "@workspace/db";
import {
  tasks,
  users,
  workspaceMembers,
} from "@workspace/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { recordTaskActivity } from "./taskActivitiesService";

/**
 * Moves a standalone task into a workspace. One-way operation
 * (standalone → workspace) — the inverse is intentionally not exposed.
 *
 * Why a dedicated service instead of allowing workspaceId in PATCH:
 *   - Move has different semantics than "edit a field": it crosses scopes,
 *     changes the permission model, and emits its own activity event.
 *   - Encapsulates the cross-cutting validation (assignee resolution against
 *     the destination membership, parent/approval guards).
 *
 * About attachments: attachments.workspace_id is NOT NULL, so standalone
 * tasks (workspace_id IS NULL) cannot have attachments by construction —
 * the schema's CHECK constraint blocks inserts at the source. No attachment
 * fix-up is needed at move time.
 */

export interface MoveTaskInput {
  taskId: string;
  callerId: string;
  callerSource: string | null;
  targetWorkspaceId: string;
  /** undefined = keep caller as assignee; null = unassign; string = resolve */
  assignee?: { userId?: string; email?: string } | null;
}

export interface MoveTaskResult {
  status: number;
  body: unknown;
}

async function findMemberUserId(
  workspaceId: string,
  ref: { userId?: string; email?: string },
): Promise<string | null> {
  if (ref.userId) {
    const [m] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, ref.userId),
        ),
      )
      .limit(1);
    return m?.userId ?? null;
  }
  if (ref.email) {
    const [row] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(users.email, ref.email),
        ),
      )
      .limit(1);
    return row?.userId ?? null;
  }
  return null;
}

export async function moveStandaloneTaskToWorkspace(
  input: MoveTaskInput,
): Promise<MoveTaskResult> {
  const {
    taskId,
    callerId,
    callerSource,
    targetWorkspaceId,
    assignee,
  } = input;

  // 1. Load + validate the task. Must be standalone and owned by caller.
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) {
    return { status: 404, body: { error: "Not found", message: "Tarefa não encontrada" } };
  }
  if (task.workspaceId !== null) {
    return {
      status: 400,
      body: {
        error: "Invalid scope",
        message: "Esta tarefa já pertence a um workspace. Mover entre workspaces não é suportado.",
      },
    };
  }
  if (task.assignedTo !== callerId) {
    return {
      status: 403,
      body: { error: "Forbidden", message: "Apenas o dono da tarefa standalone pode movê-la." },
    };
  }
  if (task.parentTaskId !== null || task.isApprovalTask) {
    // Moving an approval child or a hierarchy node would break parent links
    // that the destination workspace can't follow.
    return {
      status: 400,
      body: {
        error: "Invalid task",
        message: "Tarefas filhas (subtask/aprovação) não podem ser movidas individualmente.",
      },
    };
  }

  // 2. Validate caller is a member of the destination.
  const [callerMembership] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, targetWorkspaceId),
        eq(workspaceMembers.userId, callerId),
      ),
    )
    .limit(1);
  if (!callerMembership) {
    return {
      status: 403,
      body: {
        error: "Forbidden",
        message: "Você precisa ser membro do workspace de destino.",
      },
    };
  }

  // 3. Resolve the new assignee.
  //   - undefined → keep caller (we just verified membership).
  //   - null      → unassign.
  //   - {userId|email} → resolve in the destination membership; reject if absent.
  let nextAssignee: string | null;
  if (assignee === undefined) {
    nextAssignee = callerId;
  } else if (assignee === null) {
    nextAssignee = null;
  } else {
    const resolved = await findMemberUserId(targetWorkspaceId, assignee);
    if (!resolved) {
      return {
        status: 400,
        body: {
          error: "Assignee not in workspace",
          message: "O assignee informado não é membro do workspace de destino.",
        },
      };
    }
    nextAssignee = resolved;
  }

  // 4. Apply the move in a transaction so the task + activity log land
  //    together. We re-check workspace_id IS NULL inside the UPDATE to
  //    guard against a concurrent move.
  await db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({
        workspaceId: targetWorkspaceId,
        assignedTo: nextAssignee,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, taskId), isNull(tasks.workspaceId)));
  });

  // Activity is recorded outside the transaction — recordTaskActivity does
  // its own insert and we don't want a log failure to roll back the move.
  await recordTaskActivity({
    taskId,
    actorId: callerId,
    type: "task_moved",
    metadata: {
      toWorkspaceId: targetWorkspaceId,
      fromAssigneeId: task.assignedTo ?? null,
      toAssigneeId: nextAssignee,
    },
    source: callerSource,
  });

  const [moved] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return { status: 200, body: moved };
}
