import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { mapShapes, maps, insertMapShapeSchema, updateMapShapeSchema } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireWorkspaceRole } from "../middlewares/permissions";

const router: IRouter = Router({ mergeParams: true });

async function verifyMapBelongsToWorkspace(mapId: string, workspaceId: string): Promise<boolean> {
  const [map] = await db
    .select({ id: maps.id })
    .from(maps)
    .where(and(eq(maps.id, mapId), eq(maps.workspaceId, workspaceId)))
    .limit(1);
  return !!map;
}

router.get("/", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req, res) => {
  const { mapId, workspaceId } = req.params;

  const mapExists = await verifyMapBelongsToWorkspace(mapId, workspaceId);
  if (!mapExists) {
    res.status(404).json({ error: "Not found", message: "Map not found in workspace" });
    return;
  }

  const shapes = await db
    .select()
    .from(mapShapes)
    .where(eq(mapShapes.mapId, mapId));

  res.json(shapes);
});

router.post("/", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req, res) => {
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

  const [shape] = await db
    .insert(mapShapes)
    .values({ mapId, ...parsed.data })
    .returning();

  res.status(201).json(shape);
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

  res.json(updated);
});

router.delete("/:shapeId", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req, res) => {
  const { shapeId, mapId, workspaceId } = req.params;

  const mapExists = await verifyMapBelongsToWorkspace(mapId, workspaceId);
  if (!mapExists) {
    res.status(404).json({ error: "Not found", message: "Map not found in workspace" });
    return;
  }

  await db
    .delete(mapShapes)
    .where(and(eq(mapShapes.id, shapeId), eq(mapShapes.mapId, mapId)));

  res.json({ success: true, message: "Shape deleted" });
});

export default router;
