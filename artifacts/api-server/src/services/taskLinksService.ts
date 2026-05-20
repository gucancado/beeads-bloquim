import { db } from "@workspace/db";
import {
  tasks,
  taskLinks,
  taskAttachments,
  attachments,
} from "@workspace/db/schema";
import { and, eq, inArray, or, sql } from "drizzle-orm";

/**
 * Service for the task-link feature + attachment inheritance.
 * Spec: docs/specs/task-linking-and-attachment-inheritance.md
 *
 * Reads/writes ONLY the new join table `task_attachments` (and `task_links`).
 * The legacy `attachments.task_id` + `attachments.kind` columns are kept in
 * sync by `taskAttachmentsService` during the Phase A→B window — this service
 * doesn't touch them directly.
 */

const MAX_PROPAGATION_DEPTH = 10;

export class TaskLinkError extends Error {
  constructor(
    public code:
      | "LINK_OUT_OF_PLAN"
      | "LINK_SELF"
      | "LINK_EXISTS"
      | "LINK_NOT_FOUND"
      | "TASK_NOT_FOUND"
      | "ATTACHMENT_NOT_LINKED"
      | "LINK_DEPTH_EXCEEDED",
    message: string,
    public httpStatus = 422,
  ) {
    super(message);
    this.name = "TaskLinkError";
  }
}

interface PlanContext {
  planId: string;
  workspaceId: string;
}

/**
 * Loads both tasks and checks they belong to the same plan (D7). Throws
 * LINK_OUT_OF_PLAN if either is missing a map_id, or if their map_ids differ.
 */
async function validateLinkScope(
  sourceTaskId: string,
  targetTaskId: string,
): Promise<PlanContext> {
  if (sourceTaskId === targetTaskId) {
    throw new TaskLinkError(
      "LINK_SELF",
      "Não é possível vincular uma tarefa a si mesma.",
      400,
    );
  }
  const rows = await db
    .select({
      id: tasks.id,
      mapId: tasks.mapId,
      workspaceId: tasks.workspaceId,
    })
    .from(tasks)
    .where(inArray(tasks.id, [sourceTaskId, targetTaskId]));

  if (rows.length < 2) {
    throw new TaskLinkError(
      "TASK_NOT_FOUND",
      "Uma das tarefas não existe.",
      404,
    );
  }
  const source = rows.find((r) => r.id === sourceTaskId)!;
  const target = rows.find((r) => r.id === targetTaskId)!;
  if (!source.mapId || !target.mapId || source.mapId !== target.mapId) {
    throw new TaskLinkError(
      "LINK_OUT_OF_PLAN",
      "Tarefas precisam estar no mesmo plano para serem vinculadas.",
    );
  }
  if (!source.workspaceId || source.workspaceId !== target.workspaceId) {
    // Should never happen if map_id matches (tasks in same map share workspace).
    throw new TaskLinkError(
      "LINK_OUT_OF_PLAN",
      "Tarefas estão em workspaces diferentes.",
    );
  }
  return { planId: source.mapId, workspaceId: source.workspaceId };
}

export interface TaskLinkRow {
  id: string;
  sourceTaskId: string;
  sourceTitle: string;
  targetTaskId: string;
  targetTitle: string;
  planId: string;
  createdAt: Date;
  createdBy: string | null;
}

/**
 * Returns links where `taskId` is either source or target. Caller filters by
 * direction.
 */
export async function listTaskLinks(
  taskId: string,
): Promise<{ outgoing: TaskLinkRow[]; incoming: TaskLinkRow[] }> {
  const sourceTasks = db.$with("source_tasks").as(
    db.select({ id: tasks.id, title: tasks.title }).from(tasks),
  );
  const rows = await db
    .with(sourceTasks)
    .select({
      id: taskLinks.id,
      sourceTaskId: taskLinks.sourceTaskId,
      targetTaskId: taskLinks.targetTaskId,
      planId: taskLinks.planId,
      createdAt: taskLinks.createdAt,
      createdBy: taskLinks.createdBy,
      sourceTitle: sql<string>`(SELECT title FROM ${tasks} WHERE id = ${taskLinks.sourceTaskId})`,
      targetTitle: sql<string>`(SELECT title FROM ${tasks} WHERE id = ${taskLinks.targetTaskId})`,
    })
    .from(taskLinks)
    .where(
      or(
        eq(taskLinks.sourceTaskId, taskId),
        eq(taskLinks.targetTaskId, taskId),
      ),
    );

  const outgoing: TaskLinkRow[] = [];
  const incoming: TaskLinkRow[] = [];
  for (const r of rows) {
    if (r.sourceTaskId === taskId) outgoing.push(r);
    else incoming.push(r);
  }
  return { outgoing, incoming };
}

/**
 * Creates a directed link source→target inside a single plan, then propagates
 * every deliverable-kind attachment from source to target as standard (one
 * level — propagation only chains via explicit promotion downstream).
 *
 * Returns { link, inheritedCount } so the route can write activity metadata.
 */
export async function createTaskLink(
  sourceTaskId: string,
  targetTaskId: string,
  userId: string,
): Promise<{ link: typeof taskLinks.$inferSelect; inheritedCount: number }> {
  const ctx = await validateLinkScope(sourceTaskId, targetTaskId);

  return await db.transaction(async (tx) => {
    // Insert link (idempotent via unique index). Conflict → fetch existing.
    const inserted = await tx
      .insert(taskLinks)
      .values({
        workspaceId: ctx.workspaceId,
        planId: ctx.planId,
        sourceTaskId,
        targetTaskId,
        createdBy: userId,
      })
      .onConflictDoNothing({
        target: [taskLinks.sourceTaskId, taskLinks.targetTaskId],
      })
      .returning();

    let link = inserted[0];
    if (!link) {
      const [existing] = await tx
        .select()
        .from(taskLinks)
        .where(
          and(
            eq(taskLinks.sourceTaskId, sourceTaskId),
            eq(taskLinks.targetTaskId, targetTaskId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new TaskLinkError(
          "LINK_EXISTS",
          "Conflito ao criar vínculo.",
          409,
        );
      }
      // Already existed — return idempotent success without re-inheriting.
      return { link: existing, inheritedCount: 0 };
    }

    // Propagate source's current deliverables → target as standard.
    const result = await tx.execute(sql`
      INSERT INTO task_attachments (
        task_id, attachment_id, kind, inherited_from_task_id, created_by, created_at
      )
      SELECT
        ${targetTaskId}::uuid,
        ta.attachment_id,
        'standard'::task_attachment_kind,
        ${sourceTaskId}::uuid,
        ${userId}::uuid,
        now()
      FROM task_attachments ta
      JOIN attachments a ON a.id = ta.attachment_id
      WHERE ta.task_id = ${sourceTaskId}
        AND ta.kind = 'deliverable'
        AND a.deleted_at IS NULL
      ON CONFLICT (task_id, attachment_id) DO NOTHING
    `);
    // pg driver returns `rowCount` on the result; drizzle wraps it.
    const inheritedCount = Number((result as { rowCount?: number }).rowCount ?? 0);

    return { link, inheritedCount };
  });
}

/**
 * Removes a link by id and runs the demote-cascade for any attachments that
 * had been inherited from the source into the target side. Returns the removed
 * link metadata (or null if not found) plus the count of attachment links
 * cleaned up downstream.
 */
export async function removeTaskLink(
  linkId: string,
): Promise<{ link: typeof taskLinks.$inferSelect; removedAttachmentCount: number } | null> {
  return await db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(taskLinks)
      .where(eq(taskLinks.id, linkId))
      .limit(1);
    if (!link) return null;

    // Collect attachments inherited into target from source — these are the
    // ones the cascade will need to clear if they're still standard.
    const inheritedRows = await tx
      .select({ attachmentId: taskAttachments.attachmentId })
      .from(taskAttachments)
      .where(
        and(
          eq(taskAttachments.taskId, link.targetTaskId),
          eq(taskAttachments.inheritedFromTaskId, link.sourceTaskId),
          eq(taskAttachments.kind, "standard"),
        ),
      );

    let removedCount = 0;
    for (const { attachmentId } of inheritedRows) {
      removedCount += await demoteCascadeForAttachment(
        tx,
        attachmentId,
        link.sourceTaskId,
      );
    }

    await tx.delete(taskLinks).where(eq(taskLinks.id, linkId));

    return { link, removedAttachmentCount: removedCount };
  });
}

/**
 * Cascades the removal of "standard, inherited from N" rows of an attachment
 * across the downstream chain. Each iteration deletes rows whose
 * inherited_from_task_id matches a frontier task, and then expands the
 * frontier to any task that just lost the attachment (those become origins
 * for further deletion). Depth guard at MAX_PROPAGATION_DEPTH.
 */
async function demoteCascadeForAttachment(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  attachmentId: string,
  rootTaskId: string,
): Promise<number> {
  let frontier: string[] = [rootTaskId];
  let depth = 0;
  let totalRemoved = 0;
  const visited = new Set<string>([rootTaskId]);

  while (frontier.length > 0) {
    if (depth > MAX_PROPAGATION_DEPTH) {
      throw new TaskLinkError(
        "LINK_DEPTH_EXCEEDED",
        "A cadeia de propagação tem mais de 10 níveis. Remova vínculos intermediários antes de continuar.",
      );
    }
    const deleted = await tx
      .delete(taskAttachments)
      .where(
        and(
          eq(taskAttachments.attachmentId, attachmentId),
          inArray(taskAttachments.inheritedFromTaskId, frontier),
          eq(taskAttachments.kind, "standard"),
        ),
      )
      .returning({ taskId: taskAttachments.taskId });

    totalRemoved += deleted.length;
    frontier = [];
    for (const { taskId } of deleted) {
      if (!visited.has(taskId)) {
        visited.add(taskId);
        frontier.push(taskId);
      }
    }
    depth++;
  }
  return totalRemoved;
}

/**
 * Promotes (B, X) to deliverable and propagates X to every downstream target
 * of B as standard. Returns the number of new task_attachments rows created
 * downstream (used by activity log).
 */
export async function promoteAttachmentInTask(
  taskId: string,
  attachmentId: string,
  userId: string,
): Promise<{ propagatedToCount: number }> {
  return await db.transaction(async (tx) => {
    const updated = await tx
      .update(taskAttachments)
      .set({ kind: "deliverable" })
      .where(
        and(
          eq(taskAttachments.taskId, taskId),
          eq(taskAttachments.attachmentId, attachmentId),
        ),
      )
      .returning({ taskId: taskAttachments.taskId });
    if (updated.length === 0) {
      throw new TaskLinkError(
        "ATTACHMENT_NOT_LINKED",
        "Anexo não está vinculado a esta tarefa.",
        404,
      );
    }

    // Propagate to downstream targets as standard.
    const result = await tx.execute(sql`
      INSERT INTO task_attachments (
        task_id, attachment_id, kind, inherited_from_task_id, created_by, created_at
      )
      SELECT
        tl.target_task_id,
        ${attachmentId}::uuid,
        'standard'::task_attachment_kind,
        ${taskId}::uuid,
        ${userId}::uuid,
        now()
      FROM task_links tl
      JOIN attachments a ON a.id = ${attachmentId}::uuid
      WHERE tl.source_task_id = ${taskId}
        AND a.deleted_at IS NULL
      ON CONFLICT (task_id, attachment_id) DO NOTHING
    `);
    const propagatedToCount = Number(
      (result as { rowCount?: number }).rowCount ?? 0,
    );
    return { propagatedToCount };
  });
}

/**
 * Demotes (B, X) to standard and runs the demote cascade on B as origin —
 * downstream rows that were standard with inherited_from=B get cleared.
 */
export async function demoteAttachmentInTask(
  taskId: string,
  attachmentId: string,
): Promise<{ removedFromCount: number }> {
  return await db.transaction(async (tx) => {
    const updated = await tx
      .update(taskAttachments)
      .set({ kind: "standard" })
      .where(
        and(
          eq(taskAttachments.taskId, taskId),
          eq(taskAttachments.attachmentId, attachmentId),
        ),
      )
      .returning({ taskId: taskAttachments.taskId });
    if (updated.length === 0) {
      throw new TaskLinkError(
        "ATTACHMENT_NOT_LINKED",
        "Anexo não está vinculado a esta tarefa.",
        404,
      );
    }
    const removedFromCount = await demoteCascadeForAttachment(
      tx,
      attachmentId,
      taskId,
    );
    return { removedFromCount };
  });
}

/**
 * Unlinks an attachment from a task (removes the join row). If the row was
 * a deliverable, also runs the demote cascade so downstream targets that
 * inherited from this task lose the attachment.
 *
 * Returns true if a row was removed, false if no such link existed.
 */
export async function unlinkAttachmentFromTask(
  taskId: string,
  attachmentId: string,
): Promise<{ removed: boolean; downstreamRemovedCount: number }> {
  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ kind: taskAttachments.kind })
      .from(taskAttachments)
      .where(
        and(
          eq(taskAttachments.taskId, taskId),
          eq(taskAttachments.attachmentId, attachmentId),
        ),
      )
      .limit(1);

    if (!existing) return { removed: false, downstreamRemovedCount: 0 };

    let downstreamRemovedCount = 0;
    if (existing.kind === "deliverable") {
      downstreamRemovedCount = await demoteCascadeForAttachment(
        tx,
        attachmentId,
        taskId,
      );
    }

    await tx
      .delete(taskAttachments)
      .where(
        and(
          eq(taskAttachments.taskId, taskId),
          eq(taskAttachments.attachmentId, attachmentId),
        ),
      );

    return { removed: true, downstreamRemovedCount };
  });
}

/**
 * Returns how many tasks an attachment is currently linked to (alive only).
 * Used by the confirm-delete modal to warn "this attachment is on N tasks".
 */
export async function getAttachmentUsageCount(
  attachmentId: string,
): Promise<{ taskCount: number; taskIds: string[] }> {
  const rows = await db
    .select({ taskId: taskAttachments.taskId })
    .from(taskAttachments)
    .where(eq(taskAttachments.attachmentId, attachmentId));
  const taskIds = rows.map((r) => r.taskId);
  return { taskCount: taskIds.length, taskIds };
}

/**
 * Removes all links where `taskId` is source or target, running the cascade
 * for each (so downstream targets lose attachments inherited from `taskId`).
 * Intended to be called from the detach-task handler before
 * `UPDATE tasks SET map_id = NULL`. Returns the list of "other endpoints"
 * affected, so the caller can write activity entries on each.
 */
export async function cascadeRemoveForTask(
  taskId: string,
): Promise<{ removedLinks: Array<{ id: string; otherTaskId: string; isSource: boolean }> }> {
  return await db.transaction(async (tx) => {
    const links = await tx
      .select()
      .from(taskLinks)
      .where(
        or(
          eq(taskLinks.sourceTaskId, taskId),
          eq(taskLinks.targetTaskId, taskId),
        ),
      );

    for (const link of links) {
      if (link.sourceTaskId === taskId) {
        // Find attachments target has that were inherited from this task,
        // then cascade.
        const inheritedRows = await tx
          .select({ attachmentId: taskAttachments.attachmentId })
          .from(taskAttachments)
          .where(
            and(
              eq(taskAttachments.taskId, link.targetTaskId),
              eq(taskAttachments.inheritedFromTaskId, taskId),
              eq(taskAttachments.kind, "standard"),
            ),
          );
        for (const { attachmentId } of inheritedRows) {
          await demoteCascadeForAttachment(tx, attachmentId, taskId);
        }
      }
      // For incoming links (taskId is target), no attachment cascade is
      // needed — the inherited rows live on this task and will be cleaned
      // up by the broader detach flow (caller can choose to clear them).
    }

    if (links.length > 0) {
      await tx.delete(taskLinks).where(
        inArray(
          taskLinks.id,
          links.map((l) => l.id),
        ),
      );
    }

    return {
      removedLinks: links.map((l) => ({
        id: l.id,
        otherTaskId: l.sourceTaskId === taskId ? l.targetTaskId : l.sourceTaskId,
        isSource: l.sourceTaskId === taskId,
      })),
    };
  });
}
