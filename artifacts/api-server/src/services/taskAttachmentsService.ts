import { db } from "@workspace/db";
import { tasks, attachments } from "@workspace/db/schema";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { BucketName } from "@workspace/storage";

import { getStorage } from "../lib/storage";

export type AttachmentKind = "standard" | "deliverable";

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

const SELECT_FIELDS = {
  id: attachments.id,
  bucket: attachments.bucket,
  storagePath: attachments.storagePath,
  fileName: attachments.originalFilename,
  fileSize: attachments.fileSize,
  mimeType: attachments.mimeType,
  uploadedBy: attachments.uploadedBy,
  createdAt: attachments.createdAt,
  kind: attachments.kind,
} as const;

type SelectedRow = {
  id: string;
  bucket: string;
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string | null;
  createdAt: Date;
  kind: AttachmentKind;
};

function rowToAttachment(row: SelectedRow): AttachmentRow {
  return {
    id: row.id,
    bucket: row.bucket as BucketName,
    storagePath: row.storagePath,
    fileName: row.fileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
    kind: row.kind,
  };
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

/**
 * Returns ownership info for a task, or `null` if the task does not exist.
 */
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

/**
 * Returns `(isApprovalTask, parentTaskId)` for a task, or `null` when the
 * task does not exist.
 */
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

/** Lists non-deleted attachments for a task in upload order (oldest first). */
export async function listTaskAttachments(
  taskId: string,
): Promise<AttachmentRow[]> {
  const rows = await db
    .select(SELECT_FIELDS)
    .from(attachments)
    .where(and(eq(attachments.taskId, taskId), isNull(attachments.deletedAt)))
    .orderBy(asc(attachments.createdAt));
  return rows.map(rowToAttachment);
}

/**
 * Lists only the `deliverable`-kind attachments of a task. Used to expose
 * deliverables of the parent task on each approval task's attachment listing.
 */
export async function listTaskDeliverableAttachments(
  taskId: string,
): Promise<AttachmentRow[]> {
  const rows = await db
    .select(SELECT_FIELDS)
    .from(attachments)
    .where(
      and(
        eq(attachments.taskId, taskId),
        eq(attachments.kind, "deliverable"),
        isNull(attachments.deletedAt),
      ),
    )
    .orderBy(asc(attachments.createdAt));
  return rows.map(rowToAttachment);
}

/**
 * Creates an attachment row scoped to a task. The actual file is uploaded
 * separately by the client to the presigned URL returned by the storage route.
 */
export async function createTaskAttachment(
  workspaceId: string,
  taskId: string,
  actorId: string,
  input: CreateAttachmentInput,
): Promise<AttachmentRow> {
  const [row] = await db
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
    .returning(SELECT_FIELDS);
  return rowToAttachment(row);
}

/**
 * Updates the kind of an existing attachment (standard <-> deliverable).
 * Returns the updated row, or `null` when no attachment with that id is
 * linked to the given task.
 */
export async function updateTaskAttachmentKind(
  taskId: string,
  attachmentId: string,
  kind: AttachmentKind,
): Promise<AttachmentRow | null> {
  const [row] = await db
    .update(attachments)
    .set({ kind })
    .where(
      and(
        eq(attachments.id, attachmentId),
        eq(attachments.taskId, taskId),
        isNull(attachments.deletedAt),
      ),
    )
    .returning(SELECT_FIELDS);
  return row ? rowToAttachment(row) : null;
}

/**
 * Soft-deletes an attachment (sets deleted_at). The underlying file remains in
 * object storage until a future GC job purges it; this preserves history for
 * comments/activities that may reference the attachment.
 *
 * Returns `false` when the attachment does not exist or already deleted.
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
 * tooling and by the GC job; not exposed via the regular delete endpoint.
 */
export async function purgeAttachment(
  attachmentId: string,
): Promise<void> {
  const [row] = await db
    .select({
      bucket: attachments.bucket,
      storagePath: attachments.storagePath,
    })
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
 * Returns `null` if the attachment does not belong to the given task, or
 * (when `requireKind` is provided) when the attachment exists but its
 * `kind` doesn't match.
 */
export async function getTaskAttachmentForDownload(
  taskId: string,
  attachmentId: string,
  requireKind?: AttachmentKind,
): Promise<AttachmentDownloadInfo | null> {
  const conditions = [
    eq(attachments.id, attachmentId),
    eq(attachments.taskId, taskId),
    isNull(attachments.deletedAt),
  ];
  if (requireKind) {
    conditions.push(eq(attachments.kind, requireKind));
  }

  const [row] = await db
    .select({
      bucket: attachments.bucket,
      storagePath: attachments.storagePath,
      fileName: attachments.originalFilename,
      mimeType: attachments.mimeType,
    })
    .from(attachments)
    .where(and(...conditions))
    .limit(1);

  if (!row) return null;
  return {
    bucket: row.bucket as BucketName,
    storagePath: row.storagePath,
    fileName: row.fileName,
    mimeType: row.mimeType,
  };
}
