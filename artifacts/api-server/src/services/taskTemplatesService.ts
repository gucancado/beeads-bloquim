import { db } from "@workspace/db";
import {
  taskTemplates,
  taskTemplateSubtasks,
  tasks,
  subtasks,
  workspaceMembers,
} from "@workspace/db/schema";
import { and, asc, eq, or, isNull } from "drizzle-orm";

export interface ServiceResponse<T = unknown> {
  status: number;
  body: T;
}

type Priority = "low" | "medium" | "high" | "critical";

export interface TemplatePatch {
  name?: string | null;
  title?: string | null;
  description?: string | null;
  priority?: Priority | null;
}

export interface TemplateSubtaskPatch {
  title?: string;
  order?: number;
}

async function getOwnedTemplate(userId: string, templateId: string) {
  const [tpl] = await db
    .select()
    .from(taskTemplates)
    .where(and(eq(taskTemplates.id, templateId), eq(taskTemplates.userId, userId)))
    .limit(1);
  return tpl ?? null;
}

export async function listTemplates(userId: string): Promise<ServiceResponse> {
  const rows = await db
    .select()
    .from(taskTemplates)
    .where(eq(taskTemplates.userId, userId))
    .orderBy(asc(taskTemplates.createdAt));
  return { status: 200, body: rows };
}

export async function createTemplate(userId: string): Promise<ServiceResponse> {
  const [tpl] = await db
    .insert(taskTemplates)
    .values({ userId })
    .returning();
  return { status: 201, body: { ...tpl, subtasks: [] } };
}

export async function getTemplate(
  userId: string,
  templateId: string,
): Promise<ServiceResponse> {
  const tpl = await getOwnedTemplate(userId, templateId);
  if (!tpl) return { status: 404, body: { error: "Not found" } };
  const sub = await db
    .select()
    .from(taskTemplateSubtasks)
    .where(eq(taskTemplateSubtasks.templateId, templateId))
    .orderBy(asc(taskTemplateSubtasks.order), asc(taskTemplateSubtasks.createdAt));
  return { status: 200, body: { ...tpl, subtasks: sub } };
}

export async function updateTemplate(
  userId: string,
  templateId: string,
  patch: TemplatePatch,
): Promise<ServiceResponse> {
  const tpl = await getOwnedTemplate(userId, templateId);
  if (!tpl) return { status: 404, body: { error: "Not found" } };

  const data: Record<string, unknown> = { updatedAt: new Date() };
  if ("name" in patch) data.name = patch.name ?? null;
  if ("title" in patch) data.title = patch.title ?? null;
  if ("description" in patch) data.description = patch.description ?? null;
  if ("priority" in patch) data.priority = patch.priority ?? null;

  const [updated] = await db
    .update(taskTemplates)
    .set(data)
    .where(eq(taskTemplates.id, templateId))
    .returning();
  return { status: 200, body: updated };
}

export async function deleteTemplate(
  userId: string,
  templateId: string,
): Promise<ServiceResponse> {
  const tpl = await getOwnedTemplate(userId, templateId);
  if (!tpl) return { status: 404, body: { error: "Not found" } };
  await db.delete(taskTemplates).where(eq(taskTemplates.id, templateId));
  return { status: 200, body: { success: true } };
}

export async function createTemplateSubtask(
  userId: string,
  templateId: string,
  input: { title: string; order?: number },
): Promise<ServiceResponse> {
  const tpl = await getOwnedTemplate(userId, templateId);
  if (!tpl) return { status: 404, body: { error: "Not found" } };
  const existing = await db
    .select({ order: taskTemplateSubtasks.order })
    .from(taskTemplateSubtasks)
    .where(eq(taskTemplateSubtasks.templateId, templateId))
    .orderBy(asc(taskTemplateSubtasks.order));
  const nextOrder =
    input.order ??
    (existing.length > 0 ? existing[existing.length - 1].order + 1 : 0);
  const [created] = await db
    .insert(taskTemplateSubtasks)
    .values({ templateId, title: input.title, order: nextOrder })
    .returning();
  return { status: 201, body: created };
}

export async function updateTemplateSubtask(
  userId: string,
  templateId: string,
  subtaskId: string,
  patch: TemplateSubtaskPatch,
): Promise<ServiceResponse> {
  const tpl = await getOwnedTemplate(userId, templateId);
  if (!tpl) return { status: 404, body: { error: "Not found" } };
  const [existing] = await db
    .select()
    .from(taskTemplateSubtasks)
    .where(
      and(
        eq(taskTemplateSubtasks.id, subtaskId),
        eq(taskTemplateSubtasks.templateId, templateId),
      ),
    )
    .limit(1);
  if (!existing) return { status: 404, body: { error: "Subtask not found" } };

  const data: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.order !== undefined) data.order = patch.order;
  const [updated] = await db
    .update(taskTemplateSubtasks)
    .set(data)
    .where(eq(taskTemplateSubtasks.id, subtaskId))
    .returning();
  return { status: 200, body: updated };
}

export async function deleteTemplateSubtask(
  userId: string,
  templateId: string,
  subtaskId: string,
): Promise<ServiceResponse> {
  const tpl = await getOwnedTemplate(userId, templateId);
  if (!tpl) return { status: 404, body: { error: "Not found" } };
  await db
    .delete(taskTemplateSubtasks)
    .where(
      and(
        eq(taskTemplateSubtasks.id, subtaskId),
        eq(taskTemplateSubtasks.templateId, templateId),
      ),
    );
  return { status: 200, body: { success: true } };
}

/**
 * Reorder all subtasks of a template by replacing each row's `order` with
 * its index in the supplied id list.
 */
export async function reorderTemplateSubtasks(
  userId: string,
  templateId: string,
  ids: string[],
): Promise<ServiceResponse> {
  const tpl = await getOwnedTemplate(userId, templateId);
  if (!tpl) return { status: 404, body: { error: "Not found" } };
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx
        .update(taskTemplateSubtasks)
        .set({ order: i, updatedAt: new Date() })
        .where(
          and(
            eq(taskTemplateSubtasks.id, ids[i]),
            eq(taskTemplateSubtasks.templateId, templateId),
          ),
        );
    }
  });
  const sub = await db
    .select()
    .from(taskTemplateSubtasks)
    .where(eq(taskTemplateSubtasks.templateId, templateId))
    .orderBy(asc(taskTemplateSubtasks.order), asc(taskTemplateSubtasks.createdAt));
  return { status: 200, body: sub };
}

/**
 * Apply `templateId` to `taskId`. The task must belong to `userId` (either
 * the assignee on a standalone task, or in a workspace the user is a member
 * of) and be in `draft` status. Only fields filled in the template are
 * written; description is appended to existing text rather than replacing
 * it; subtasks from the template are appended to the task's existing list.
 */
export async function applyTemplateToTask(
  userId: string,
  templateId: string,
  taskId: string,
): Promise<ServiceResponse> {
  const tpl = await getOwnedTemplate(userId, templateId);
  if (!tpl) return { status: 404, body: { error: "Template not found" } };

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task) return { status: 404, body: { error: "Task not found" } };

  // Permission: user must be a member of the task's workspace, or own the
  // task (standalone) as assignee.
  if (task.workspaceId) {
    const [m] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, task.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);
    if (!m) return { status: 403, body: { error: "Forbidden" } };
  } else {
    if (task.assignedTo !== userId) {
      return { status: 403, body: { error: "Forbidden" } };
    }
  }

  if (task.status !== "draft") {
    return { status: 400, body: { error: "Task must be in draft to apply a template" } };
  }

  const [tplSubs] = await Promise.all([
    db
      .select()
      .from(taskTemplateSubtasks)
      .where(eq(taskTemplateSubtasks.templateId, templateId))
      .orderBy(asc(taskTemplateSubtasks.order), asc(taskTemplateSubtasks.createdAt)),
  ]);

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  const tplTitle = (tpl.title ?? "").trim();
  if (tplTitle) updateData.title = tplTitle;
  if (tpl.priority) updateData.priority = tpl.priority;

  const tplDesc = (tpl.description ?? "").trim();
  if (tplDesc) {
    const current = (task.description ?? "").trim();
    updateData.description = current ? `${task.description}\n\n${tpl.description}` : tpl.description;
  }

  await db.transaction(async (tx) => {
    if (Object.keys(updateData).length > 1) {
      await tx.update(tasks).set(updateData).where(eq(tasks.id, taskId));
    }
    if (tplSubs.length > 0) {
      const existing = await tx
        .select({ order: subtasks.order })
        .from(subtasks)
        .where(eq(subtasks.taskId, taskId))
        .orderBy(asc(subtasks.order));
      const baseOrder =
        existing.length > 0 ? existing[existing.length - 1].order + 1 : 0;
      await tx.insert(subtasks).values(
        tplSubs.map((s, i) => ({
          taskId,
          text: s.title,
          completed: false,
          order: baseOrder + i,
        })),
      );
    }
  });

  return { status: 200, body: { success: true, taskId } };
}
