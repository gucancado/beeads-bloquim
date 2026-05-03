import { Router, IRouter } from "express";
import { Readable } from "stream";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  mapShapes,
  maps,
  fileUploads,
  attachmentLinks,
  insertMapShapeSchema,
  updateMapShapeSchema,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requireWorkspaceRole } from "../middlewares/permissions";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";

const log = logger.child({ module: "shapes" });
const router: IRouter = Router({ mergeParams: true });
const objectStorageService = new ObjectStorageService();

async function verifyMapBelongsToWorkspace(mapId: string, workspaceId: string): Promise<boolean> {
  const [map] = await db
    .select({ id: maps.id })
    .from(maps)
    .where(and(eq(maps.id, mapId), eq(maps.workspaceId, workspaceId)))
    .limit(1);
  return !!map;
}

async function listShapesWithFiles(mapId: string) {
  const rows = await db
    .select({
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
      fileUploadId: mapShapes.fileUploadId,
      fileName: fileUploads.fileName,
      mimeType: fileUploads.mimeType,
      fileSize: fileUploads.fileSize,
      createdAt: mapShapes.createdAt,
      updatedAt: mapShapes.updatedAt,
    })
    .from(mapShapes)
    .leftJoin(fileUploads, eq(fileUploads.id, mapShapes.fileUploadId))
    .where(eq(mapShapes.mapId, mapId));
  return rows;
}

async function getShapeWithFile(shapeId: string, mapId: string) {
  const [row] = await db
    .select({
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
      fileUploadId: mapShapes.fileUploadId,
      fileName: fileUploads.fileName,
      mimeType: fileUploads.mimeType,
      fileSize: fileUploads.fileSize,
      objectPath: fileUploads.objectPath,
      createdAt: mapShapes.createdAt,
      updatedAt: mapShapes.updatedAt,
    })
    .from(mapShapes)
    .leftJoin(fileUploads, eq(fileUploads.id, mapShapes.fileUploadId))
    .where(and(eq(mapShapes.id, shapeId), eq(mapShapes.mapId, mapId)))
    .limit(1);
  return row;
}

export { listShapesWithFiles };

const createImageUploadSchema = z.object({
  objectPath: z.string().min(1),
  fileName: z.string().min(1),
  fileSize: z.number().int().positive(),
  mimeType: z.string().min(1).regex(/^image\//, "mimeType must be an image"),
});

router.post("/uploads", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req: AuthRequest, res) => {
  const { mapId, workspaceId } = req.params;

  const mapExists = await verifyMapBelongsToWorkspace(mapId, workspaceId);
  if (!mapExists) {
    res.status(404).json({ error: "Not found", message: "Map not found in workspace" });
    return;
  }

  const parsed = createImageUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const [created] = await db
    .insert(fileUploads)
    .values({
      objectPath: parsed.data.objectPath,
      fileName: parsed.data.fileName,
      fileSize: parsed.data.fileSize,
      mimeType: parsed.data.mimeType,
      uploadedBy: req.user!.userId,
    })
    .returning({ id: fileUploads.id });

  res.status(201).json({ fileUploadId: created.id });
});

router.get("/", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req, res) => {
  const { mapId, workspaceId } = req.params;

  const mapExists = await verifyMapBelongsToWorkspace(mapId, workspaceId);
  if (!mapExists) {
    res.status(404).json({ error: "Not found", message: "Map not found in workspace" });
    return;
  }

  const shapes = await listShapesWithFiles(mapId);
  res.json(shapes);
});

router.post("/", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req: AuthRequest, res) => {
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

  if (data.type === "image" && data.fileUploadId) {
    const [up] = await db
      .select({ id: fileUploads.id })
      .from(fileUploads)
      .where(eq(fileUploads.id, data.fileUploadId))
      .limit(1);
    if (!up) {
      res.status(400).json({ error: "Validation error", message: "fileUpload not found" });
      return;
    }
  }

  const [shape] = await db
    .insert(mapShapes)
    .values({ mapId, ...data })
    .returning();

  if (shape.type === "image" && shape.fileUploadId) {
    await db.insert(attachmentLinks).values({
      fileUploadId: shape.fileUploadId,
      entityType: "map",
      entityId: mapId,
      kind: "standard",
    });
  }

  const full = await getShapeWithFile(shape.id, mapId);
  res.status(201).json(full ?? shape);
});

router.put("/:shapeId", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req, res) => {
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
  res.json(full ?? updated);
});

router.delete("/:shapeId", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req, res) => {
  const { shapeId, mapId, workspaceId } = req.params;

  const mapExists = await verifyMapBelongsToWorkspace(mapId, workspaceId);
  if (!mapExists) {
    res.status(404).json({ error: "Not found", message: "Map not found in workspace" });
    return;
  }

  const [existing] = await db
    .select({ id: mapShapes.id, fileUploadId: mapShapes.fileUploadId })
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

  if (existing.fileUploadId) {
    await db
      .delete(attachmentLinks)
      .where(
        and(
          eq(attachmentLinks.entityType, "map"),
          eq(attachmentLinks.entityId, mapId),
          eq(attachmentLinks.fileUploadId, existing.fileUploadId),
        ),
      );

    const [otherLinks] = await db
      .select({ id: attachmentLinks.id })
      .from(attachmentLinks)
      .where(eq(attachmentLinks.fileUploadId, existing.fileUploadId))
      .limit(1);

    if (!otherLinks) {
      await db.delete(fileUploads).where(eq(fileUploads.id, existing.fileUploadId));
    }
  }

  res.json({ success: true, message: "Shape deleted" });
});

router.get("/:shapeId/download", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req, res) => {
  const { shapeId, mapId, workspaceId } = req.params;

  const mapExists = await verifyMapBelongsToWorkspace(mapId, workspaceId);
  if (!mapExists) {
    res.status(404).json({ error: "Not found", message: "Map not found in workspace" });
    return;
  }

  const shape = await getShapeWithFile(shapeId, mapId);
  if (!shape || !shape.fileUploadId || !shape.objectPath) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  try {
    const objectFile = await objectStorageService.getObjectEntityFile(shape.objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    const fileName = shape.fileName ?? "image";
    const encoded = encodeURIComponent(fileName).replace(/'/g, "%27");
    res.setHeader("Content-Disposition", `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`);
    res.setHeader("Content-Type", shape.mimeType || "application/octet-stream");
    response.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (k !== "content-disposition" && k !== "content-type") {
        res.setHeader(key, value);
      }
    });
    res.status(200);

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    log.error({ err: error }, "Error downloading shape image");
    res.status(500).json({ error: "Failed to download image" });
  }
});

export default router;
