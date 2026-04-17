import { db } from "@workspace/db";
import { tasks, subtasks } from "@workspace/db/schema";
import { eq, and, asc } from "drizzle-orm";

/** Generic { status, body } envelope so route handlers stay one-liners. */
export interface ServiceResponse<T = unknown> {
  status: number;
  body: T;
}

/**
 * Confirms the given task exists in the given workspace. Used as a
 * lightweight ownership check before any subtask mutation.
 */
async function taskBelongsToWorkspace(
  workspaceId: string,
  taskId: string,
): Promise<boolean> {
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  return !!task;
}

export interface SubtaskItemInput {
  id?: string;
  text: string;
  completed?: boolean;
  order?: number;
}

export interface CreateSubtaskInput {
  text: string;
  completed?: boolean;
  order?: number;
}

export interface UpdateSubtaskInput {
  text?: string;
  completed?: boolean;
  order?: number;
}

/**
 * List the subtasks of `taskId`, ordered by `order` then `createdAt`.
 *   404 — parent task not found in this workspace
 *   200 — array of subtask rows
 */
export async function listSubtasks(
  workspaceId: string,
  taskId: string,
): Promise<ServiceResponse> {
  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    return { status: 404, body: { error: "Not found" } };
  }
  const items = await db
    .select()
    .from(subtasks)
    .where(eq(subtasks.taskId, taskId))
    .orderBy(asc(subtasks.order), asc(subtasks.createdAt));
  return { status: 200, body: items };
}

/**
 * Bulk-replace the subtask list for `taskId`. Empty-text items are filtered
 * out. The previous list is wiped and recreated; missing `order` falls back
 * to the array index.
 *   404 — parent task not found
 *   200 — the freshly-fetched subtask list (post-replacement)
 */
export async function replaceSubtasks(
  workspaceId: string,
  taskId: string,
  items: SubtaskItemInput[],
): Promise<ServiceResponse> {
  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    return { status: 404, body: { error: "Not found" } };
  }

  const incoming = items.filter((s) => s.text.trim() !== "");

  await db.delete(subtasks).where(eq(subtasks.taskId, taskId));

  if (incoming.length > 0) {
    await db.insert(subtasks).values(
      incoming.map((s, idx) => ({
        id: s.id,
        taskId,
        text: s.text.trim(),
        completed: s.completed ?? false,
        order: s.order ?? idx,
      })),
    );
  }

  const result = await db
    .select()
    .from(subtasks)
    .where(eq(subtasks.taskId, taskId))
    .orderBy(asc(subtasks.order), asc(subtasks.createdAt));
  return { status: 200, body: result };
}

/**
 * Create a single subtask under `taskId`. If `order` is omitted, it appends
 * (last order + 1, or 0 if there are none).
 *   404 — parent task not found
 *   201 — the inserted subtask row
 */
export async function createSubtask(
  workspaceId: string,
  taskId: string,
  input: CreateSubtaskInput,
): Promise<ServiceResponse> {
  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    return { status: 404, body: { error: "Not found" } };
  }

  const existing = await db
    .select({ order: subtasks.order })
    .from(subtasks)
    .where(eq(subtasks.taskId, taskId))
    .orderBy(asc(subtasks.order));
  const nextOrder =
    input.order ??
    (existing.length > 0 ? existing[existing.length - 1].order + 1 : 0);

  const [created] = await db
    .insert(subtasks)
    .values({
      taskId,
      text: input.text,
      completed: input.completed ?? false,
      order: nextOrder,
    })
    .returning();

  return { status: 201, body: created };
}

/**
 * Patch a subtask. Only the provided fields are updated; `updatedAt` is
 * always bumped.
 *   404 — parent task or subtask not found (and subtask must belong to the
 *         given parent task)
 *   200 — the updated subtask row
 */
export async function updateSubtask(
  workspaceId: string,
  taskId: string,
  subtaskId: string,
  input: UpdateSubtaskInput,
): Promise<ServiceResponse> {
  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    return { status: 404, body: { error: "Not found" } };
  }

  const [existing] = await db
    .select()
    .from(subtasks)
    .where(and(eq(subtasks.id, subtaskId), eq(subtasks.taskId, taskId)))
    .limit(1);
  if (!existing) {
    return { status: 404, body: { error: "Subtask not found" } };
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (input.text !== undefined) updateData.text = input.text;
  if (input.completed !== undefined) updateData.completed = input.completed;
  if (input.order !== undefined) updateData.order = input.order;

  const [updated] = await db
    .update(subtasks)
    .set(updateData)
    .where(eq(subtasks.id, subtaskId))
    .returning();
  return { status: 200, body: updated };
}

/**
 * Delete a subtask scoped to (taskId, subtaskId).
 *   404 — parent task not found
 *   200 — { success: true } (idempotent — does not 404 on missing subtask,
 *         matching the pre-extraction behavior)
 */
export async function deleteSubtask(
  workspaceId: string,
  taskId: string,
  subtaskId: string,
): Promise<ServiceResponse> {
  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    return { status: 404, body: { error: "Not found" } };
  }
  await db
    .delete(subtasks)
    .where(and(eq(subtasks.id, subtaskId), eq(subtasks.taskId, taskId)));
  return { status: 200, body: { success: true } };
}
