import { db } from "@workspace/db";
import {
  taskAttachments,
  attachments,
  cards,
  cardConnections,
  tasks,
} from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";

/**
 * Attachment-inheritance service. The directed link between tasks lives in
 * `card_connections` on the canvas (source_card_id → target_card_id), not in
 * a dedicated table. Listings JOIN against card_connections + tasks.status to
 * compute which deliverables flow into the current task, gated on the source
 * being `completed`.
 *
 * Spec: docs/specs/task-linking-and-attachment-inheritance.md
 *
 * Only mutations covered here:
 *   - `promoteAttachmentInTask(B, X)`   — UPSERT into task_attachments(B, X, deliverable)
 *   - `demoteAttachmentInTask(B, X)`    — UPDATE/DELETE task_attachments(B, X)
 *   - `unlinkAttachmentFromTask(B, X)`  — DELETE task_attachments(B, X)
 *   - `getAttachmentUsageCount(X)`      — for the delete-confirm modal
 *
 * Reads are in `taskAttachmentsService.listTaskAttachments` (UNION of native
 * rows + dynamic inheritance via card_connections).
 */

export class TaskLinkError extends Error {
  constructor(
    public code: "ATTACHMENT_NOT_LINKED" | "TASK_NOT_FOUND" | "ATTACHMENT_NOT_FOUND",
    message: string,
    public httpStatus = 422,
  ) {
    super(message);
    this.name = "TaskLinkError";
  }
}

/**
 * For an attachment that's reaching a task B via inheritance (no row in
 * task_attachments yet), find the upstream source task that exposes it as a
 * deliverable. Used when promoting: we want to remember where it came from
 * so the listing can later show "Herdado de X". If multiple sources exist
 * (B has connections from A1 and A2, both with X as deliverable), we pick
 * any one — the user can see only one chain anyway.
 */
async function lookupInheritanceSource(
  targetTaskId: string,
  attachmentId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ taskId: cards.taskId })
    .from(cards)
    .innerJoin(cardConnections, eq(cardConnections.sourceCardId, cards.id))
    .innerJoin(
      sql`cards target_card`,
      sql`target_card.id = ${cardConnections.targetCardId} AND target_card.task_id = ${targetTaskId}`,
    )
    .innerJoin(
      taskAttachments,
      and(
        eq(taskAttachments.taskId, cards.taskId),
        eq(taskAttachments.attachmentId, attachmentId),
        eq(taskAttachments.kind, "deliverable"),
      ),
    )
    .limit(1);
  return row?.taskId ?? null;
}

/**
 * Promotes attachment X in task B to `deliverable`, so it flows downstream
 * via inheritance (to tasks linked from B via card_connections, gated on B
 * being completed at read time).
 *
 * Works in three scenarios:
 *   1. X is a native upload on B (row exists, kind=standard).
 *   2. X is already a row on B with kind=deliverable (no-op effectively).
 *   3. X is inherited from a source A (no row exists). Then we INSERT a new
 *      row pointing at A as inherited_from_task_id.
 *
 * Returns the resulting row.
 */
export async function promoteAttachmentInTask(
  taskId: string,
  attachmentId: string,
  userId: string,
): Promise<{ taskId: string; attachmentId: string; kind: "deliverable" }> {
  // Verify the attachment exists at all (otherwise the UPSERT will silently
  // INSERT a phantom row pointing at a non-existent attachment_id — the FK
  // would actually catch it, but giving a clearer error is nicer).
  const [att] = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);
  if (!att) {
    throw new TaskLinkError("ATTACHMENT_NOT_FOUND", "Anexo não encontrado.", 404);
  }

  return await db.transaction(async (tx) => {
    // Try update first — if a row exists, just flip kind.
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

    if (updated.length > 0) {
      return { taskId, attachmentId, kind: "deliverable" as const };
    }

    // No row → infer source via card_connections and INSERT.
    const inheritedFrom = await lookupInheritanceSource(taskId, attachmentId);
    if (!inheritedFrom) {
      throw new TaskLinkError(
        "ATTACHMENT_NOT_LINKED",
        "Anexo não está vinculado a esta tarefa nem é herdado de tarefa conectada.",
        404,
      );
    }
    await tx.insert(taskAttachments).values({
      taskId,
      attachmentId,
      kind: "deliverable",
      inheritedFromTaskId: inheritedFrom,
      createdBy: userId,
    });
    return { taskId, attachmentId, kind: "deliverable" as const };
  });
}

/**
 * Demotes attachment X in task B from `deliverable` to `standard`.
 * If the row had `inherited_from_task_id IS NOT NULL` (it was a promoted
 * inheritance, not a native upload), removing the deliverable flag means it
 * should fall back to the inherited-only state — so we DELETE the row
 * entirely; the read-time JOIN will still surface X as `pending`/`available`
 * via card_connections.
 *
 * For native uploads (inherited_from_task_id IS NULL), we UPDATE to standard.
 *
 * Either way, downstream tasks lose access (the read-time JOIN no longer sees
 * a deliverable row on B).
 */
export async function demoteAttachmentInTask(
  taskId: string,
  attachmentId: string,
): Promise<{ taskId: string; attachmentId: string; kind: "standard" } | null> {
  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        inheritedFromTaskId: taskAttachments.inheritedFromTaskId,
      })
      .from(taskAttachments)
      .where(
        and(
          eq(taskAttachments.taskId, taskId),
          eq(taskAttachments.attachmentId, attachmentId),
        ),
      )
      .limit(1);
    if (!existing) return null;

    if (existing.inheritedFromTaskId !== null) {
      // Promoted-from-inheritance row → remove it; the inherited listing
      // (via card_connections JOIN) continues to surface the attachment.
      await tx
        .delete(taskAttachments)
        .where(
          and(
            eq(taskAttachments.taskId, taskId),
            eq(taskAttachments.attachmentId, attachmentId),
          ),
        );
    } else {
      await tx
        .update(taskAttachments)
        .set({ kind: "standard" })
        .where(
          and(
            eq(taskAttachments.taskId, taskId),
            eq(taskAttachments.attachmentId, attachmentId),
          ),
        );
    }
    return { taskId, attachmentId, kind: "standard" as const };
  });
}

/**
 * Unlinks the attachment from a task by removing the row in task_attachments.
 * If the row was kind=deliverable, downstream tasks stop seeing X (read-time
 * JOIN sees no deliverable). The file stays in storage.
 *
 * If the task is only seeing X via inheritance (no row exists), there's
 * nothing to remove — the caller should disable the action in that case.
 */
export async function unlinkAttachmentFromTask(
  taskId: string,
  attachmentId: string,
): Promise<{ removed: boolean }> {
  const result = await db
    .delete(taskAttachments)
    .where(
      and(
        eq(taskAttachments.taskId, taskId),
        eq(taskAttachments.attachmentId, attachmentId),
      ),
    )
    .returning({ taskId: taskAttachments.taskId });
  return { removed: result.length > 0 };
}

/**
 * Counts the tasks an attachment is currently linked to (alive rows only).
 * Used by the delete-confirm modal so the user knows "this file is on N
 * tasks". This counts ONLY explicit rows in task_attachments — not the
 * dynamic inheritance reach (since deleting the file is a hard delete and
 * the FK CASCADE handles all rows automatically).
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

// Suppress unused-import warnings for symbols kept available to callers.
void tasks;
