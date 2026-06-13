import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  attachments,
  cards,
  maps,
  taskAttachments,
  taskComments,
  tasks,
  workspaceMembers,
} from "@workspace/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  buildStoragePath,
  type BucketName,
  sanitizeFilename,
  validateFileUpload,
  type AttachmentEntityKind,
} from "@workspace/storage";

import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { requireStorage } from "../lib/featureFlags";
import { getStorage } from "../lib/storage";
import { logger } from "../lib/logger";
import {
  createTaskAttachmentLink,
  getTaskOwnership,
} from "../services/taskAttachmentsService";
import { recordTaskActivity } from "../services/taskActivitiesService";

const log = logger.child({ module: "storage" });

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// POST /storage/uploads/request-url
//
// Returns a presigned PUT URL for direct client upload, AND pre-creates an
// attachment row in the DB so the file is tracked from the moment the URL is
// issued. The client uploads the file with PUT to `uploadUrl` and immediately
// gets back a usable `attachmentId` — no separate "commit" call required.
//
// If the client never PUTs the file, the row is orphaned and a future GC job
// will clean both the row and any uploaded bytes.
// ---------------------------------------------------------------------------

const requestUrlSchema = z.object({
  bucket: z.enum(["attachments", "avatars"]),
  entityKind: z.enum(["task", "card", "comment", "map", "plan"]),
  entityId: z.uuid(),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  /** Only meaningful for `entityKind: "task"`. */
  kind: z.enum(["standard", "deliverable"]).optional(),
});

router.post(
  "/storage/uploads/request-url",
  requireAuth,
  requireStorage,
  async (req: AuthRequest, res: Response) => {
    const parsed = requestUrlSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "validation_failed",
        message: "Invalid upload request payload",
        details: parsed.error.issues,
      });
      return;
    }

    const { bucket, entityKind, entityId, filename, contentType, sizeBytes, kind } =
      parsed.data;
    const userId = req.user!.userId;

    const validation = validateFileUpload({
      filename,
      mimeType: contentType,
      sizeBytes,
    });
    if (validation) {
      res.status(400).json({
        error: validation.code,
        message: validation.message,
      });
      return;
    }

    const ownership = await resolveEntityWorkspace(entityKind, entityId);
    if (!ownership) {
      res.status(404).json({
        error: "entity_not_found",
        message: `${entityKind} ${entityId} not found`,
      });
      return;
    }

    const isMember = await userIsWorkspaceMember(ownership.workspaceId, userId);
    if (!isMember) {
      res.status(403).json({
        error: "forbidden",
        message: "Not a member of the entity's workspace",
      });
      return;
    }

    const attachmentId = randomUUID();
    const safeName = sanitizeFilename(filename);
    const storagePath = buildStoragePath({
      workspaceId: ownership.workspaceId,
      entityKind,
      entityId,
      attachmentId,
      filename: safeName,
    });

    const storage = getStorage();
    let signed;
    try {
      signed = await storage.createUploadUrl({
        bucket,
        storagePath,
        contentType,
      });
    } catch (err) {
      log.error({ err, storagePath, bucket }, "createUploadUrl failed");
      res.status(502).json({
        error: "storage_error",
        message: "Failed to create upload URL",
      });
      return;
    }

    // Pre-create the attachment row. Entity anchoring lives in dedicated join
    // tables now — for task uploads, we insert a paired row in
    // `task_attachments` so listings find it (via the shared
    // `createTaskAttachmentLink` helper). card/comment/map/plan continue to use
    // the per-entity columns on `attachments` itself.
    const insertValues = {
      id: attachmentId,
      workspaceId: ownership.workspaceId,
      bucket,
      storagePath,
      originalFilename: safeName,
      mimeType: contentType,
      fileSize: sizeBytes,
      uploadedBy: userId,
      cardId: entityKind === "card" ? entityId : null,
      commentId: entityKind === "comment" ? entityId : null,
      mapId: entityKind === "map" ? entityId : null,
      planId: entityKind === "plan" ? entityId : null,
    } as const;

    try {
      if (entityKind === "task") {
        await createTaskAttachmentLink({
          attachmentId,
          workspaceId: ownership.workspaceId,
          bucket,
          storagePath,
          fileName: safeName,
          mimeType: contentType,
          fileSize: sizeBytes,
          uploadedBy: userId,
          taskId: entityId,
          kind,
        });
      } else {
        await db.insert(attachments).values(insertValues);
      }
    } catch (err) {
      log.error({ err, attachmentId }, "failed to insert attachment row");
      res.status(500).json({
        error: "db_error",
        message: "Failed to register attachment",
      });
      return;
    }

    res.status(201).json({
      attachmentId,
      bucket,
      storagePath,
      uploadUrl: signed.uploadUrl,
      method: signed.method,
      headers: signed.headers,
      expiresAt: signed.expiresAt.toISOString(),
    });
  },
);

// ---------------------------------------------------------------------------
// GET /storage/attachments/:attachmentId/download
//
// Backend-proxied download with a permission check. We stream the object via
// the API server (rather than redirect to a signed URL) so we can enforce the
// workspace membership at request time and audit downloads later if needed.
// ---------------------------------------------------------------------------

router.get(
  "/storage/attachments/:attachmentId/download",
  requireAuth,
  requireStorage,
  async (req: AuthRequest, res: Response) => {
    const { attachmentId } = req.params;
    const userId = req.user!.userId;

    if (!isUuid(attachmentId)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }

    const [row] = await db
      .select({
        bucket: attachments.bucket,
        storagePath: attachments.storagePath,
        fileName: attachments.originalFilename,
        mimeType: attachments.mimeType,
        workspaceId: attachments.workspaceId,
      })
      .from(attachments)
      .where(and(eq(attachments.id, attachmentId), isNull(attachments.deletedAt)))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    if (row.workspaceId !== null) {
      // Workspace-owned attachment → membership gates the download.
      const isMember = await userIsWorkspaceMember(row.workspaceId, userId);
      if (!isMember) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
    } else {
      // Standalone (workspace-less) attachment → resolve the linked task via
      // task_attachments and authorize the standalone task owner. 403 when the
      // attachment isn't linked to a task or the caller isn't its owner.
      const authorized = await standaloneAttachmentOwner(attachmentId, userId);
      if (!authorized) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
    }

    const storage = getStorage();
    let stream;
    try {
      stream = await storage.getReadStream({
        bucket: row.bucket as BucketName,
        storagePath: row.storagePath,
      });
    } catch (err) {
      log.error(
        { err, attachmentId, storagePath: row.storagePath },
        "getReadStream failed",
      );
      res.status(404).json({ error: "object_not_found" });
      return;
    }

    res.setHeader("Content-Type", row.mimeType ?? stream.contentType);
    if (stream.contentLength !== undefined) {
      res.setHeader("Content-Length", String(stream.contentLength));
    }
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
    );
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");

    stream.stream.pipe(res);
  },
);

export default router;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function resolveEntityWorkspace(
  entityKind: AttachmentEntityKind,
  entityId: string,
): Promise<{ workspaceId: string } | null> {
  switch (entityKind) {
    case "task": {
      const [row] = await db
        .select({ workspaceId: tasks.workspaceId })
        .from(tasks)
        .where(eq(tasks.id, entityId))
        .limit(1);
      if (!row?.workspaceId) return null;
      return { workspaceId: row.workspaceId };
    }
    case "card": {
      const [row] = await db
        .select({ workspaceId: maps.workspaceId })
        .from(cards)
        .innerJoin(maps, eq(maps.id, cards.mapId))
        .where(eq(cards.id, entityId))
        .limit(1);
      if (!row?.workspaceId) return null;
      return { workspaceId: row.workspaceId };
    }
    case "comment": {
      const [row] = await db
        .select({ workspaceId: tasks.workspaceId })
        .from(taskComments)
        .innerJoin(tasks, eq(tasks.id, taskComments.taskId))
        .where(eq(taskComments.id, entityId))
        .limit(1);
      if (!row?.workspaceId) return null;
      return { workspaceId: row.workspaceId };
    }
    case "map": {
      const [row] = await db
        .select({ workspaceId: maps.workspaceId })
        .from(maps)
        .where(eq(maps.id, entityId))
        .limit(1);
      if (!row?.workspaceId) return null;
      return { workspaceId: row.workspaceId };
    }
    case "plan": {
      // No `plans` entity yet. Reject until the schema gains one — keeps the
      // contract honest instead of silently accepting orphan attachments.
      return null;
    }
  }
}

/**
 * Authorizes a standalone (workspace-less) attachment download. Resolves the
 * task linked via `task_attachments`, then checks the caller owns that
 * standalone task (assignee + workspaceId IS NULL). Returns false when the
 * attachment has no task link or the caller isn't the owner.
 */
async function standaloneAttachmentOwner(
  attachmentId: string,
  userId: string,
): Promise<boolean> {
  const [link] = await db
    .select({ taskId: taskAttachments.taskId })
    .from(taskAttachments)
    .where(eq(taskAttachments.attachmentId, attachmentId))
    .limit(1);
  if (!link) return false;
  const owner = await getTaskOwnership(link.taskId);
  if (!owner) return false;
  if (owner.workspaceId !== null) return false;
  return owner.assignedTo === userId;
}

async function userIsWorkspaceMember(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const [member] = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(member);
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: string | undefined): value is string {
  return Boolean(value && UUID_REGEX.test(value));
}
