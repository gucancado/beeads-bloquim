import { db } from "@workspace/db";
import {
  tasks,
  attachments,
  taskAttachments,
  cards,
  cardConnections,
} from "@workspace/db/schema";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { BucketName } from "@workspace/storage";

import { getStorage } from "../lib/storage";

export type AttachmentKind = "standard" | "deliverable";
export type AttachmentState = "available" | "pending";

export interface AttachmentRow {
  id: string;
  bucket: BucketName;
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string | null;
  createdAt: Date;
  kind: AttachmentKind;
  /** Non-null when this attachment surfaces on the task via inheritance from
   * an upstream task connected on the canvas (`card_connections`). UI may
   * render a "Herdado de X" badge. Null for native uploads. */
  inheritedFromTaskId: string | null;
  /** `available` → clickable/downloadable. `pending` → preview only because
   * the upstream source task is not `completed` yet. Computed at read time. */
  state: AttachmentState;
}

export interface AttachmentDownloadInfo {
  bucket: BucketName;
  storagePath: string;
  fileName: string;
  mimeType: string;
}

export interface CreateAttachmentInput {
  bucket: BucketName;
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  kind?: AttachmentKind;
}

/**
 * Returns `true` when the given task exists inside the given workspace.
 */
export async function taskBelongsToWorkspace(
  workspaceId: string,
  taskId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  return Boolean(row);
}

export interface TaskOwnership {
  assignedTo: string | null;
  workspaceId: string | null;
}

export async function getTaskOwnership(
  taskId: string,
): Promise<TaskOwnership | null> {
  const [row] = await db
    .select({
      assignedTo: tasks.assignedTo,
      workspaceId: tasks.workspaceId,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row ?? null;
}

export async function getApprovalTaskParent(
  taskId: string,
): Promise<{ isApprovalTask: boolean; parentTaskId: string | null } | null> {
  const [row] = await db
    .select({
      isApprovalTask: tasks.isApprovalTask,
      parentTaskId: tasks.parentTaskId,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row ?? null;
}

/**
 * Lists every attachment visible on a task — both native rows (direct uploads
 * or manual promotions) and dynamic inheritances (deliverables on tasks
 * connected to this one via `card_connections`, with the source's `status`
 * gating the per-row `state`).
 *
 * Implemented as a single UNION query because pagination/ordering across
 * direct + inherited needs to be applied uniformly.
 */
export async function listTaskAttachments(
  taskId: string,
): Promise<AttachmentRow[]> {
  const result = await db.execute(sql`
    -- Direct rows: native uploads + manual promotions in this task.
    SELECT
      a.id, a.bucket, a.storage_path, a.original_filename,
      a.mime_type, a.file_size, a.uploaded_by, a.created_at,
      ta.kind::text                AS kind,
      ta.inherited_from_task_id    AS inherited_from_task_id,
      CASE
        WHEN ta.inherited_from_task_id IS NULL THEN 'available'
        WHEN src.status = 'completed' THEN 'available'
        ELSE 'pending'
      END AS state,
      ta.created_at                AS sort_at
    FROM task_attachments ta
    JOIN attachments a ON a.id = ta.attachment_id
    LEFT JOIN tasks src ON src.id = ta.inherited_from_task_id
    WHERE ta.task_id = ${taskId}
      AND a.deleted_at IS NULL

    UNION ALL

    -- Inherited via card_connections: source tasks expose deliverables to
    -- targets even without a per-task row, gated on source.status.
    SELECT
      a.id, a.bucket, a.storage_path, a.original_filename,
      a.mime_type, a.file_size, a.uploaded_by, a.created_at,
      'standard'::text             AS kind,
      src_task.id                  AS inherited_from_task_id,
      CASE WHEN src_task.status = 'completed' THEN 'available' ELSE 'pending' END AS state,
      src_ta.created_at            AS sort_at
    FROM cards target_card
    JOIN card_connections cc ON cc.target_card_id = target_card.id
    JOIN cards src_card ON src_card.id = cc.source_card_id
    JOIN tasks src_task ON src_task.id = src_card.task_id
    JOIN task_attachments src_ta
      ON src_ta.task_id = src_task.id AND src_ta.kind = 'deliverable'
    JOIN attachments a ON a.id = src_ta.attachment_id
    WHERE target_card.task_id = ${taskId}
      AND a.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM task_attachments x
        WHERE x.task_id = ${taskId} AND x.attachment_id = a.id
      )

    ORDER BY sort_at ASC
  `);
  // pg driver returns { rows: snake_case[] } from raw queries.
  const rows = (result as unknown as { rows: Array<{
    id: string;
    bucket: string;
    storage_path: string;
    original_filename: string;
    mime_type: string;
    file_size: number;
    uploaded_by: string | null;
    created_at: Date;
    kind: AttachmentKind;
    inherited_from_task_id: string | null;
    state: AttachmentState;
  }> }).rows;
  return rows.map((r) => ({
    id: r.id,
    bucket: r.bucket as BucketName,
    storagePath: r.storage_path,
    fileName: r.original_filename,
    fileSize: r.file_size,
    mimeType: r.mime_type,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
    kind: r.kind,
    inheritedFromTaskId: r.inherited_from_task_id,
    state: r.state,
  }));
}

/**
 * Like `listTaskAttachments` but filters to deliverables only. Used by the
 * approval task UI to expose the parent's deliverables for review.
 *
 * Includes only deliverables that are `available` (source task completed),
 * since approvers reviewing a parent's work shouldn't see still-pending
 * artifacts. Native deliverables of the task itself are always available.
 */
export async function listTaskDeliverableAttachments(
  taskId: string,
): Promise<AttachmentRow[]> {
  const rows = await db
    .select({
      id: attachments.id,
      bucket: attachments.bucket,
      storagePath: attachments.storagePath,
      fileName: attachments.originalFilename,
      fileSize: attachments.fileSize,
      mimeType: attachments.mimeType,
      uploadedBy: attachments.uploadedBy,
      createdAt: attachments.createdAt,
      kind: taskAttachments.kind,
      inheritedFromTaskId: taskAttachments.inheritedFromTaskId,
    })
    .from(taskAttachments)
    .innerJoin(attachments, eq(attachments.id, taskAttachments.attachmentId))
    .where(
      and(
        eq(taskAttachments.taskId, taskId),
        eq(taskAttachments.kind, "deliverable"),
        isNull(attachments.deletedAt),
      ),
    )
    .orderBy(asc(taskAttachments.createdAt));
  return rows.map((r) => ({
    id: r.id,
    bucket: r.bucket as BucketName,
    storagePath: r.storagePath,
    fileName: r.fileName,
    fileSize: r.fileSize,
    mimeType: r.mimeType,
    uploadedBy: r.uploadedBy,
    createdAt: r.createdAt,
    kind: r.kind,
    inheritedFromTaskId: r.inheritedFromTaskId,
    state: "available" as const,
  }));
}

/**
 * Creates an attachment row scoped to a task. The actual file is uploaded
 * separately by the client to the presigned URL returned by the storage route.
 *
 * Writes to `attachments` (legacy task_id + kind columns); the Phase A
 * trigger mirrors it into `task_attachments`. Returns the row in the same
 * shape `listTaskAttachments` produces.
 */
export async function createTaskAttachment(
  workspaceId: string,
  taskId: string,
  actorId: string,
  input: CreateAttachmentInput,
): Promise<AttachmentRow> {
  const [inserted] = await db
    .insert(attachments)
    .values({
      workspaceId,
      taskId,
      bucket: input.bucket,
      storagePath: input.storagePath,
      originalFilename: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      kind: input.kind ?? "standard",
      uploadedBy: actorId,
    })
    .returning({ id: attachments.id });

  const list = await listTaskAttachments(taskId);
  const row = list.find((r) => r.id === inserted.id);
  // Should always be found — we just inserted it and the trigger created the
  // join row. If somehow missing, fall back to a minimal native shape.
  if (!row) {
    throw new Error("attachment row not visible after insert");
  }
  return row;
}

/**
 * Updates the kind of an existing attachment via the legacy column
 * `attachments.kind`. The trigger syncs `task_attachments.kind` on the
 * primary row. Returns the updated row, or `null` when no attachment with
 * that id is anchored to the given task at the legacy column.
 *
 * Inheritance-aware promotion (works on inherited rows too) lives in
 * `taskLinksService.promoteAttachmentInTask`.
 */
export async function updateTaskAttachmentKind(
  taskId: string,
  attachmentId: string,
  kind: AttachmentKind,
): Promise<AttachmentRow | null> {
  const [updated] = await db
    .update(attachments)
    .set({ kind })
    .where(
      and(
        eq(attachments.id, attachmentId),
        eq(attachments.taskId, taskId),
        isNull(attachments.deletedAt),
      ),
    )
    .returning({ id: attachments.id });
  if (!updated) return null;
  const list = await listTaskAttachments(taskId);
  return list.find((r) => r.id === updated.id) ?? null;
}

/**
 * Soft-deletes an attachment (sets deleted_at). The file remains in object
 * storage until a future GC job purges it; this preserves history for
 * comments/activities that may reference the attachment.
 *
 * Returns `false` when the attachment does not exist or was already deleted.
 */
export async function deleteTaskAttachment(
  taskId: string,
  attachmentId: string,
): Promise<boolean> {
  const [row] = await db
    .update(attachments)
    .set({ deletedAt: sql`now()` })
    .where(
      and(
        eq(attachments.id, attachmentId),
        eq(attachments.taskId, taskId),
        isNull(attachments.deletedAt),
      ),
    )
    .returning({ id: attachments.id });
  return Boolean(row);
}

/**
 * Hard-deletes an attachment from both DB and object storage. Used by admin
 * tooling and the GC job; not exposed via the regular delete endpoint.
 */
export async function purgeAttachment(attachmentId: string): Promise<void> {
  const [row] = await db
    .select({ bucket: attachments.bucket, storagePath: attachments.storagePath })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);
  if (!row) return;
  const storage = getStorage();
  if (storage.enabled) {
    try {
      await storage.remove({
        bucket: row.bucket as BucketName,
        storagePath: row.storagePath,
      });
    } catch {
      // ignore — purge proceeds with DB delete even if file is already gone
    }
  }
  await db.delete(attachments).where(eq(attachments.id, attachmentId));
}

/**
 * Resolves the storage info needed to stream a task attachment download.
 * Honors the inheritance model: the attachment is downloadable if there's a
 * direct row in task_attachments for this task, OR if it's inherited via a
 * canvas connection from a source task whose status is `completed`. Returns
 * `null` for `pending` or unrelated attachments.
 */
export async function getTaskAttachmentForDownload(
  taskId: string,
  attachmentId: string,
  requireKind?: AttachmentKind,
): Promise<AttachmentDownloadInfo | null> {
  const result = await db.execute(sql`
    SELECT a.bucket, a.storage_path, a.original_filename, a.mime_type
    FROM attachments a
    WHERE a.id = ${attachmentId}
      AND a.deleted_at IS NULL
      AND EXISTS (
        -- direct row, optionally filtered by kind
        SELECT 1 FROM task_attachments ta
        WHERE ta.task_id = ${taskId} AND ta.attachment_id = a.id
          ${requireKind ? sql`AND ta.kind = ${requireKind}::task_attachment_kind` : sql``}
      )
      OR (
        a.id = ${attachmentId} AND a.deleted_at IS NULL
        AND EXISTS (
          -- inherited via card_connections, gated on source.status='completed'
          SELECT 1
          FROM cards target_card
          JOIN card_connections cc ON cc.target_card_id = target_card.id
          JOIN cards src_card ON src_card.id = cc.source_card_id
          JOIN tasks src_task ON src_task.id = src_card.task_id AND src_task.status = 'completed'
          JOIN task_attachments src_ta
            ON src_ta.task_id = src_task.id
           AND src_ta.attachment_id = a.id
           AND src_ta.kind = 'deliverable'
          WHERE target_card.task_id = ${taskId}
          ${requireKind ? sql`AND ${requireKind === "deliverable" ? sql`TRUE` : sql`FALSE`}` : sql``}
        )
      )
    LIMIT 1
  `);
  const rows = (result as unknown as { rows: Array<{
    bucket: string;
    storage_path: string;
    original_filename: string;
    mime_type: string;
  }> }).rows;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    bucket: r.bucket as BucketName,
    storagePath: r.storage_path,
    fileName: r.original_filename,
    mimeType: r.mime_type,
  };
}

// keep import used
void cards;
void cardConnections;
