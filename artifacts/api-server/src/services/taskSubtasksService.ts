import { db } from "@workspace/db";
import { tasks, subtasks } from "@workspace/db/schema";
import { eq, and, asc, isNull } from "drizzle-orm";
import { recordTaskActivity } from "./taskActivitiesService";

/** Generic { status, body } envelope so route handlers stay one-liners. */
export interface ServiceResponse<T = unknown> {
  status: number;
  body: T;
}

export interface SubtaskItemInput {
  id?: string;
  text: string;
  completed?: boolean;
  order?: number;
}

/** New shape for batch insert: same as SubtaskItemInput but without `id`. */
export interface ChecklistItemInput {
  text: string;
  completed?: boolean;
  order?: number;
}

export interface UpdateSubtaskInput {
  text?: string;
  completed?: boolean;
  order?: number;
}

export interface ActorContext {
  userId: string | null;
  source: string | null;
}

// ---------------------------------------------------------------------------
// Ownership guards
// ---------------------------------------------------------------------------

/**
 * Confirms the task exists in the given workspace. Lightweight check used
 * before any workspace-scoped subtask mutation.
 */
async function taskBelongsToWorkspace(
  workspaceId: string,
  taskId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  return !!row;
}

/**
 * Confirms the task is standalone (workspaceId IS NULL) and assigned to
 * `userId`. Mirror of taskBelongsToWorkspace for the standalone scope.
 */
async function taskBelongsToPersonal(
  taskId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.id, taskId),
        isNull(tasks.workspaceId),
        eq(tasks.assignedTo, userId),
      ),
    )
    .limit(1);
  return !!row;
}

// ---------------------------------------------------------------------------
// Pure CRUD (no permission checks — callers must guard ownership first)
// ---------------------------------------------------------------------------

async function listByTaskId(taskId: string) {
  return db
    .select()
    .from(subtasks)
    .where(eq(subtasks.taskId, taskId))
    .orderBy(asc(subtasks.order), asc(subtasks.createdAt));
}

async function replaceByTaskId(taskId: string, items: SubtaskItemInput[]) {
  const incoming = items.filter((s) => s.text.trim() !== "");

  await db.transaction(async (tx) => {
    await tx.delete(subtasks).where(eq(subtasks.taskId, taskId));
    if (incoming.length > 0) {
      await tx.insert(subtasks).values(
        incoming.map((s, idx) => ({
          id: s.id,
          taskId,
          text: s.text.trim(),
          completed: s.completed ?? false,
          order: s.order ?? idx,
        })),
      );
    }
  });

  return listByTaskId(taskId);
}

/**
 * Append `items` to the task's checklist in a single transaction. Items
 * without an explicit `order` are appended after the current max(order),
 * preserving the order they appear in the array. Records ONE
 * `checklist_items_added` activity carrying itemCount + sampleText (the
 * first item's text, truncated to 80 chars) so the log stays compact even
 * when the agent dumps a long list.
 *
 * Returns the freshly-inserted rows in insertion order.
 */
async function appendByTaskId(
  taskId: string,
  items: ChecklistItemInput[],
  actor: ActorContext,
) {
  // Trim + drop empty rows up-front so auto-ordering counts what we will
  // actually insert.
  const clean = items
    .map((s) => ({
      text: s.text.trim(),
      completed: s.completed ?? false,
      order: s.order,
    }))
    .filter((s) => s.text !== "");

  if (clean.length === 0) {
    return [];
  }

  const inserted = await db.transaction(async (tx) => {
    // Find the highest existing order to append after it. Tasks rarely have
    // more than a handful of items, so picking max in JS keeps the SQL simple.
    const currentOrders = await tx
      .select({ value: subtasks.order })
      .from(subtasks)
      .where(eq(subtasks.taskId, taskId));
    const baseOrder = currentOrders.length > 0
      ? Math.max(...currentOrders.map((r) => r.value)) + 1
      : 0;

    return tx
      .insert(subtasks)
      .values(
        clean.map((s, idx) => ({
          taskId,
          text: s.text,
          completed: s.completed,
          order: s.order ?? baseOrder + idx,
        })),
      )
      .returning();
  });

  // One aggregated activity per call — verbose-but-batched, easy to audit
  // ("agent X added 5 items at HH:MM") without flooding the log.
  await recordTaskActivity({
    taskId,
    actorId: actor.userId,
    type: "checklist_items_added",
    metadata: {
      itemCount: String(inserted.length),
      sampleText: inserted[0]?.text.slice(0, 80) ?? null,
    },
    source: actor.source ?? null,
  });

  return inserted;
}

async function updateByTaskId(
  taskId: string,
  subtaskId: string,
  patch: UpdateSubtaskInput,
) {
  const [existing] = await db
    .select()
    .from(subtasks)
    .where(and(eq(subtasks.id, subtaskId), eq(subtasks.taskId, taskId)))
    .limit(1);
  if (!existing) return null;

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.text !== undefined) updateData.text = patch.text;
  if (patch.completed !== undefined) updateData.completed = patch.completed;
  if (patch.order !== undefined) updateData.order = patch.order;

  const [updated] = await db
    .update(subtasks)
    .set(updateData)
    .where(eq(subtasks.id, subtaskId))
    .returning();
  return updated;
}

async function deleteByTaskId(taskId: string, subtaskId: string) {
  await db
    .delete(subtasks)
    .where(and(eq(subtasks.id, subtaskId), eq(subtasks.taskId, taskId)));
}

// ---------------------------------------------------------------------------
// Public API — workspace scope
// ---------------------------------------------------------------------------

export async function listSubtasks(
  workspaceId: string,
  taskId: string,
): Promise<ServiceResponse> {
  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    return { status: 404, body: { error: "Not found" } };
  }
  return { status: 200, body: await listByTaskId(taskId) };
}

export async function replaceSubtasks(
  workspaceId: string,
  taskId: string,
  items: SubtaskItemInput[],
): Promise<ServiceResponse> {
  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    return { status: 404, body: { error: "Not found" } };
  }
  return { status: 200, body: await replaceByTaskId(taskId, items) };
}

export async function createSubtasks(
  workspaceId: string,
  taskId: string,
  items: ChecklistItemInput[],
  actor: ActorContext,
): Promise<ServiceResponse> {
  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    return { status: 404, body: { error: "Not found" } };
  }
  const inserted = await appendByTaskId(taskId, items, actor);
  return { status: 201, body: inserted };
}

export async function updateSubtask(
  workspaceId: string,
  taskId: string,
  subtaskId: string,
  patch: UpdateSubtaskInput,
): Promise<ServiceResponse> {
  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    return { status: 404, body: { error: "Not found" } };
  }
  const updated = await updateByTaskId(taskId, subtaskId, patch);
  if (!updated) return { status: 404, body: { error: "Subtask not found" } };
  return { status: 200, body: updated };
}

export async function deleteSubtask(
  workspaceId: string,
  taskId: string,
  subtaskId: string,
): Promise<ServiceResponse> {
  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    return { status: 404, body: { error: "Not found" } };
  }
  await deleteByTaskId(taskId, subtaskId);
  return { status: 200, body: { success: true } };
}

// ---------------------------------------------------------------------------
// Public API — personal (standalone) scope
// ---------------------------------------------------------------------------

export async function listSubtasksPersonal(
  taskId: string,
  userId: string,
): Promise<ServiceResponse> {
  if (!(await taskBelongsToPersonal(taskId, userId))) {
    return { status: 404, body: { error: "Not found" } };
  }
  return { status: 200, body: await listByTaskId(taskId) };
}

export async function replaceSubtasksPersonal(
  taskId: string,
  userId: string,
  items: SubtaskItemInput[],
): Promise<ServiceResponse> {
  if (!(await taskBelongsToPersonal(taskId, userId))) {
    return { status: 404, body: { error: "Not found" } };
  }
  return { status: 200, body: await replaceByTaskId(taskId, items) };
}

export async function createSubtasksPersonal(
  taskId: string,
  userId: string,
  items: ChecklistItemInput[],
  actor: ActorContext,
): Promise<ServiceResponse> {
  if (!(await taskBelongsToPersonal(taskId, userId))) {
    return { status: 404, body: { error: "Not found" } };
  }
  const inserted = await appendByTaskId(taskId, items, actor);
  return { status: 201, body: inserted };
}

export async function updateSubtaskPersonal(
  taskId: string,
  userId: string,
  subtaskId: string,
  patch: UpdateSubtaskInput,
): Promise<ServiceResponse> {
  if (!(await taskBelongsToPersonal(taskId, userId))) {
    return { status: 404, body: { error: "Not found" } };
  }
  const updated = await updateByTaskId(taskId, subtaskId, patch);
  if (!updated) return { status: 404, body: { error: "Subtask not found" } };
  return { status: 200, body: updated };
}

export async function deleteSubtaskPersonal(
  taskId: string,
  userId: string,
  subtaskId: string,
): Promise<ServiceResponse> {
  if (!(await taskBelongsToPersonal(taskId, userId))) {
    return { status: 404, body: { error: "Not found" } };
  }
  await deleteByTaskId(taskId, subtaskId);
  return { status: 200, body: { success: true } };
}
