import { Router, IRouter } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  attachments,
  insertMapShapeSchema,
  mapShapes,
  maps,
  updateMapShapeSchema,
} from "@workspace/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { BucketName } from "@workspace/storage";

import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requireWorkspaceRole } from "../middlewares/permissions";
import { requireStorage } from "../lib/featureFlags";
import { getStorage } from "../lib/storage";
import { logger } from "../lib/logger";

const log = logger.child({ module: "shapes" });
const router: IRouter = Router({ mergeParams: true });

async function verifyMapBelongsToWorkspace(
  mapId: string,
  workspaceId: string,
): Promise<boolean> {
  const [map] = await db
    .select({ id: maps.id })
    .from(maps)
    .where(and(eq(maps.id, mapId), eq(maps.workspaceId, workspaceId)))
    .limit(1);
  return !!map;
}

const SHAPE_WITH_FILE_FIELDS = {
  id: mapShapes.id,
  mapId: mapShapes.mapId,
  type: mapShapes.type,
  positionX: mapShapes.positionX,
  positionY: mapShapes.positionY,
  width: mapShapes.width,
  height: mapShapes.height,
  rotation: mapShapes.rotation,
  color: mapShapes.color,
  filled: mapShapes.filled,
  strokeStyle: mapShapes.strokeStyle,
  x1: mapShapes.x1,
  y1: mapShapes.y1,
  x2: mapShapes.x2,
  y2: mapShapes.y2,
  attachmentId: mapShapes.attachmentId,
  fileName: attachments.originalFilename,
  mimeType: attachments.mimeType,
  fileSize: attachments.fileSize,
  bucket: attachments.bucket,
  storagePath: attachments.storagePath,
  createdAt: mapShapes.createdAt,
  updatedAt: mapShapes.updatedAt,
} as const;

async function listShapesWithFiles(mapId: string) {
  const rows = await db
    .select(SHAPE_WITH_FILE_FIELDS)
    .from(mapShapes)
    .leftJoin(attachments, eq(attachments.id, mapShapes.attachmentId))
    .where(eq(mapShapes.mapId, mapId));
  return rows.map(stripInternalFields);
}

async function getShapeWithFile(shapeId: string, mapId: string) {
  const [row] = await db
    .select(SHAPE_WITH_FILE_FIELDS)
    .from(mapShapes)
    .leftJoin(attachments, eq(attachments.id, mapShapes.attachmentId))
    .where(and(eq(mapShapes.id, shapeId), eq(mapShapes.mapId, mapId)))
    .limit(1);
  return row ? { row, public: stripInternalFields(row) } : null;
}

/** Strip the `bucket` / `storagePath` internals before sending to the client. */
function stripInternalFields(row: Record<string, unknown>) {
  const { bucket: _bucket, storagePath: _storagePath, ...rest } = row;
  return rest;
}

export { listShapesWithFiles };

// ---------------------------------------------------------------------------
// Note: POST /uploads is removed. Frontend now calls
// POST /api/storage/uploads/request-url with bucket="attachments" and
// entityKind="map" to get both an attachment row + presigned URL in one call.
// ---------------------------------------------------------------------------

router.get(
  "/",
  requireAuth,
  requireWorkspaceRole(["admin", "editor", "executor"]),
  async (req, res) => {
    const { mapId, workspaceId } = req.params;

    const mapExists = await verifyMapBelongsToWorkspace(mapId, workspaceId);
    if (!mapExists) {
      res.status(404).json({ error: "Not found", message: "Map not found in workspace" });
      return;
    }

    res.json(await listShapesWithFiles(mapId));
  },
);

router.post(
  "/",
  requireAuth,
  requireWorkspaceRole(["admin", "editor"]),
  async (req: AuthRequest, res) => {
    const parsed = insertMapShapeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", message: parsed.error.message });
      return;
    }

    const { mapId, workspaceId } = req.params;

    const mapExists = await verifyMapBelongsToWorkspace(mapId, workspaceId);
    if (!mapExists) {
      res.status(404).json({ error: "Not found", message: "Map not found in workspace" });
      return;
    }

    const data = parsed.data;

    if (data.type === "image" && data.attachmentId) {
      // Verify the attachment exists, is alive, and is anchored to this same map.
      const [att] = await db
        .select({ id: attachments.id })
        .from(attachments)
        .where(
          and(
            eq(attachments.id, data.attachmentId),
            eq(attachments.mapId, mapId),
            isNull(attachments.deletedAt),
          ),
        )
        .limit(1);
      if (!att) {
        res.status(400).json({
          error: "Validation error",
          message: "attachment not found for this map",
        });
        return;
      }
    }

    const [shape] = await db
      .insert(mapShapes)
      .values({ mapId, ...data })
      .returning();

    const full = await getShapeWithFile(shape.id, mapId);
    res.status(201).json(full?.public ?? shape);
  },
);

router.put(
  "/:shapeId",
  requireAuth,
  requireWorkspaceRole(["admin", "editor"]),
  async (req, res) => {
    const parsed = updateMapShapeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", message: parsed.error.message });
      return;
    }

    const { shapeId, mapId, workspaceId } = req.params;

    const mapExists = await verifyMapBelongsToWorkspace(mapId, workspaceId);
    if (!mapExists) {
      res.status(404).json({ error: "Not found", message: "Map not found in workspace" });
      return;
    }

    const [updated] = await db
      .update(mapShapes)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(mapShapes.id, shapeId), eq(mapShapes.mapId, mapId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const full = await getShapeWithFile(updated.id, mapId);
    res.json(full?.public ?? updated);
  },
);

router.delete(
  "/:shapeId",
  requireAuth,
  requireWorkspaceRole(["admin", "editor"]),
  async (req, res) => {
    const { shapeId, mapId, workspaceId } = req.params;

    const mapExists = await verifyMapBelongsToWorkspace(mapId, workspaceId);
    if (!mapExists) {
      res.status(404).json({ error: "Not found", message: "Map not found in workspace" });
      return;
    }

    const [existing] = await db
      .select({ id: mapShapes.id, attachmentId: mapShapes.attachmentId })
      .from(mapShapes)
      .where(and(eq(mapShapes.id, shapeId), eq(mapShapes.mapId, mapId)))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    await db
      .delete(mapShapes)
      .where(and(eq(mapShapes.id, shapeId), eq(mapShapes.mapId, mapId)));

    // Soft-delete the underlying attachment if no other shape references it.
    if (existing.attachmentId) {
      const [stillReferenced] = await db
        .select({ id: mapShapes.id })
        .from(mapShapes)
        .where(eq(mapShapes.attachmentId, existing.attachmentId))
        .limit(1);
      if (!stillReferenced) {
        await db
          .update(attachments)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(attachments.id, existing.attachmentId),
              isNull(attachments.deletedAt),
            ),
          );
      }
    }

    res.json({ success: true, message: "Shape deleted" });
  },
);

router.get(
  "/:shapeId/download",
  requireAuth,
  requireWorkspaceRole(["admin", "editor", "executor"]),
  requireStorage,
  async (req, res) => {
    const { shapeId, mapId, workspaceId } = req.params;

    const mapExists = await verifyMapBelongsToWorkspace(mapId, workspaceId);
    if (!mapExists) {
      res.status(404).json({ error: "Not found", message: "Map not found in workspace" });
      return;
    }

    const result = await getShapeWithFile(shapeId, mapId);
    if (!result || !result.row.attachmentId || !result.row.bucket || !result.row.storagePath) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const storage = getStorage();
    try {
      const stream = await storage.getReadStream({
        bucket: result.row.bucket as BucketName,
        storagePath: result.row.storagePath,
      });
      res.setHeader(
        "Content-Type",
        result.row.mimeType || stream.contentType || "application/octet-stream",
      );
      if (stream.contentLength !== undefined) {
        res.setHeader("Content-Length", String(stream.contentLength));
      }
      const fileName = result.row.fileName ?? "image";
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
      stream.stream.pipe(res);
    } catch (error) {
      log.error({ err: error }, "Error downloading shape image");
      res.status(500).json({ error: "Failed to download image" });
    }
  },
);

export default router;
