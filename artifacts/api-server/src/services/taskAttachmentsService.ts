import { db } from "@workspace/db";
import { tasks, attachments, taskAttachments } from "@workspace/db/schema";
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
  /** When non-null, this attachment surfaces on the task via the task-links
   * inheritance cascade — `inheritedFromTaskId` is the upstream task that
   * exposed it. UI can show "Herdado de X" badge. NULL = native upload. */
  inheritedFromTaskId: string | null;
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
 * Listings/reads JOIN via `task_attachments` (the per-task link), so:
 *   - `kind` reflects the per-link kind (an attachment can be deliverable in A
 *     and standard in B after inheritance — they're different rows here).
 *   - inherited rows (created by createTaskLink / promote cascades) surface.
 *
 * Writes still target the legacy `attachments` columns (task_id + kind); the
 * Phase A trigger `trg_attachments_sync_task_links` mirrors them into
 * `task_attachments`. Pure-write services therefore don't need refactoring.
 */
const SELECT_FIELDS = {
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
  inheritedFromTaskId: string | null;
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
    inheritedFromTaskId: row.inheritedFromTaskId,
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
    .from(taskAttachments)
    .innerJoin(attachments, eq(attachments.id, taskAttachments.attachmentId))
    .where(
      and(eq(taskAttachments.taskId, taskId), isNull(attachments.deletedAt)),
    )
    .orderBy(asc(taskAttachments.createdAt));
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
  return rows.map(rowToAttachment);
}

/**
 * Creates an attachment row scoped to a task. The actual file is uploaded
 * separately by the client to the presigned URL returned by the storage route.
 *
 * Writes to `attachments` (with the legacy task_id + kind columns set); the
 * Phase A trigger mirrors the row into `task_attachments` automatically.
 * We re-read through the join so the response matches the listing shape
 * (including the inheritedFromTaskId field, which is always null here since
 * native uploads aren't inherited).
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

  const [row] = await db
    .select(SELECT_FIELDS)
    .from(taskAttachments)
    .innerJoin(attachments, eq(attachments.id, taskAttachments.attachmentId))
    .where(
      and(
        eq(taskAttachments.taskId, taskId),
        eq(taskAttachments.attachmentId, inserted.id),
      ),
    )
    .limit(1);
  return rowToAttachment(row);
}

/**
 * Updates the kind of an existing attachment (standard <-> deliverable).
 * Returns the updated row, or `null` when no attachment with that id is
 * linked to the given task.
 *
 * Updates the legacy `attachments.kind` column (the trigger syncs the
 * primary `task_attachments` row when task_id is the legacy anchor). For
 * promotion that needs to propagate to inheritance downstream, prefer the
 * dedicated `promoteAttachmentInTask` / `demoteAttachmentInTask` in
 * `taskLinksService` — those rewrite `task_attachments` directly and run the
 * cascade.
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

  const [row] = await db
    .select(SELECT_FIELDS)
    .from(taskAttachments)
    .innerJoin(attachments, eq(attachments.id, taskAttachments.attachmentId))
    .where(
      and(
        eq(taskAttachments.taskId, taskId),
        eq(taskAttachments.attachmentId, updated.id),
      ),
    )
    .limit(1);
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
 * Returns `null` if the attachment is not linked to the given task (either
 * natively or via inheritance), or when `requireKind` is provided and the
 * per-task kind doesn't match. Uses the `task_attachments` join so download
 * works for inherited attachments too.
 */
export async function getTaskAttachmentForDownload(
  taskId: string,
  attachmentId: string,
  requireKind?: AttachmentKind,
): Promise<AttachmentDownloadInfo | null> {
  const conditions = [
    eq(taskAttachments.taskId, taskId),
    eq(taskAttachments.attachmentId, attachmentId),
    isNull(attachments.deletedAt),
  ];
  if (requireKind) {
    conditions.push(eq(taskAttachments.kind, requireKind));
  }

  const [row] = await db
    .select({
      bucket: attachments.bucket,
      storagePath: attachments.storagePath,
      fileName: attachments.originalFilename,
      mimeType: attachments.mimeType,
    })
    .from(taskAttachments)
    .innerJoin(attachments, eq(attachments.id, taskAttachments.attachmentId))
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
