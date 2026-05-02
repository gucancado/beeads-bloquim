import { db } from "@workspace/db";
import { tasks, fileUploads, attachmentLinks } from "@workspace/db/schema";
import { eq, and, asc } from "drizzle-orm";

export type AttachmentKind = "standard" | "deliverable";

export interface AttachmentRow {
  id: string;
  fileUploadId: string;
  objectPath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  createdAt: Date;
  kind: AttachmentKind;
}

export interface AttachmentDownloadInfo {
  objectPath: string;
  fileName: string;
  mimeType: string | null;
}

export interface CreateAttachmentInput {
  objectPath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  kind?: AttachmentKind;
}

/**
 * Returns `true` when the given task exists inside the given workspace.
 * Used by the attachment routes to enforce workspace scoping before any
 * downstream DB or storage work runs.
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
 * Used by the personal-task attachment routes (`/api/my-tasks`) to decide
 * between 404 (no task), 403 (task belongs to someone else) and 400 (task
 * is a workspace task and must use the workspace endpoint).
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
 * task does not exist. Used by attachment routes to redirect approval-task
 * attachment listings to the parent task's deliverables.
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

/** Lists attachments for a task in upload order (oldest first). */
export async function listTaskAttachments(
  taskId: string,
): Promise<AttachmentRow[]> {
  return db
    .select({
      id: attachmentLinks.id,
      fileUploadId: fileUploads.id,
      objectPath: fileUploads.objectPath,
      fileName: fileUploads.fileName,
      fileSize: fileUploads.fileSize,
      mimeType: fileUploads.mimeType,
      uploadedBy: fileUploads.uploadedBy,
      createdAt: attachmentLinks.createdAt,
      kind: attachmentLinks.kind,
    })
    .from(attachmentLinks)
    .innerJoin(fileUploads, eq(fileUploads.id, attachmentLinks.fileUploadId))
    .where(
      and(
        eq(attachmentLinks.entityType, "task"),
        eq(attachmentLinks.entityId, taskId),
      ),
    )
    .orderBy(asc(attachmentLinks.createdAt));
}

/**
 * Lists only the `deliverable`-kind attachments of a task. Used to expose
 * deliverables of the parent task on each approval task's attachment listing
 * (read-only view inside the approval modal).
 */
export async function listTaskDeliverableAttachments(
  taskId: string,
): Promise<AttachmentRow[]> {
  return db
    .select({
      id: attachmentLinks.id,
      fileUploadId: fileUploads.id,
      objectPath: fileUploads.objectPath,
      fileName: fileUploads.fileName,
      fileSize: fileUploads.fileSize,
      mimeType: fileUploads.mimeType,
      uploadedBy: fileUploads.uploadedBy,
      createdAt: attachmentLinks.createdAt,
      kind: attachmentLinks.kind,
    })
    .from(attachmentLinks)
    .innerJoin(fileUploads, eq(fileUploads.id, attachmentLinks.fileUploadId))
    .where(
      and(
        eq(attachmentLinks.entityType, "task"),
        eq(attachmentLinks.entityId, taskId),
        eq(attachmentLinks.kind, "deliverable"),
      ),
    )
    .orderBy(asc(attachmentLinks.createdAt));
}

/**
 * Creates a `file_uploads` row + `attachment_links` row binding the upload to
 * the task. Returns the joined view used by the HTTP response.
 */
export async function createTaskAttachment(
  taskId: string,
  actorId: string,
  input: CreateAttachmentInput,
): Promise<AttachmentRow> {
  const [fileUpload] = await db
    .insert(fileUploads)
    .values({
      objectPath: input.objectPath,
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      uploadedBy: actorId,
    })
    .returning();

  const [link] = await db
    .insert(attachmentLinks)
    .values({
      fileUploadId: fileUpload.id,
      entityType: "task",
      entityId: taskId,
      kind: input.kind ?? "standard",
    })
    .returning();

  return {
    id: link.id,
    fileUploadId: fileUpload.id,
    objectPath: fileUpload.objectPath,
    fileName: fileUpload.fileName,
    fileSize: fileUpload.fileSize,
    mimeType: fileUpload.mimeType,
    uploadedBy: fileUpload.uploadedBy,
    createdAt: link.createdAt,
    kind: link.kind,
  };
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
  const [link] = await db
    .select({ id: attachmentLinks.id })
    .from(attachmentLinks)
    .where(
      and(
        eq(attachmentLinks.id, attachmentId),
        eq(attachmentLinks.entityType, "task"),
        eq(attachmentLinks.entityId, taskId),
      ),
    )
    .limit(1);
  if (!link) return null;

  await db
    .update(attachmentLinks)
    .set({ kind })
    .where(eq(attachmentLinks.id, attachmentId));

  const [row] = await db
    .select({
      id: attachmentLinks.id,
      fileUploadId: fileUploads.id,
      objectPath: fileUploads.objectPath,
      fileName: fileUploads.fileName,
      fileSize: fileUploads.fileSize,
      mimeType: fileUploads.mimeType,
      uploadedBy: fileUploads.uploadedBy,
      createdAt: attachmentLinks.createdAt,
      kind: attachmentLinks.kind,
    })
    .from(attachmentLinks)
    .innerJoin(fileUploads, eq(fileUploads.id, attachmentLinks.fileUploadId))
    .where(eq(attachmentLinks.id, attachmentId))
    .limit(1);

  return row ?? null;
}

/**
 * Deletes the attachment link, then garbage-collects the underlying upload if
 * no other links reference it. Returns `false` when the attachment did not
 * exist for the given task (so the route can return 404).
 */
export async function deleteTaskAttachment(
  taskId: string,
  attachmentId: string,
): Promise<boolean> {
  const [link] = await db
    .select({
      id: attachmentLinks.id,
      fileUploadId: attachmentLinks.fileUploadId,
    })
    .from(attachmentLinks)
    .where(
      and(
        eq(attachmentLinks.id, attachmentId),
        eq(attachmentLinks.entityType, "task"),
        eq(attachmentLinks.entityId, taskId),
      ),
    )
    .limit(1);

  if (!link) return false;

  await db.delete(attachmentLinks).where(eq(attachmentLinks.id, link.id));

  const [otherLinks] = await db
    .select({ id: attachmentLinks.id })
    .from(attachmentLinks)
    .where(eq(attachmentLinks.fileUploadId, link.fileUploadId))
    .limit(1);

  if (!otherLinks) {
    await db.delete(fileUploads).where(eq(fileUploads.id, link.fileUploadId));
  }

  return true;
}

/**
 * Resolves the storage info needed to stream a task attachment download.
 * Returns `null` if the attachment does not belong to the given task, or
 * (when `requireKind` is provided) when the attachment exists but its
 * `kind` doesn't match. Used to scope approval-task downloads strictly to
 * the parent task's `deliverable` attachments — otherwise an approver who
 * guessed an attachment id could download arbitrary parent files.
 */
export async function getTaskAttachmentForDownload(
  taskId: string,
  attachmentId: string,
  requireKind?: AttachmentKind,
): Promise<AttachmentDownloadInfo | null> {
  const conditions = [
    eq(attachmentLinks.id, attachmentId),
    eq(attachmentLinks.entityType, "task"),
    eq(attachmentLinks.entityId, taskId),
  ];
  if (requireKind) {
    conditions.push(eq(attachmentLinks.kind, requireKind));
  }

  const [attachment] = await db
    .select({
      id: attachmentLinks.id,
      objectPath: fileUploads.objectPath,
      fileName: fileUploads.fileName,
      mimeType: fileUploads.mimeType,
    })
    .from(attachmentLinks)
    .innerJoin(fileUploads, eq(fileUploads.id, attachmentLinks.fileUploadId))
    .where(and(...conditions))
    .limit(1);

  if (!attachment) return null;
  return {
    objectPath: attachment.objectPath,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
  };
}
