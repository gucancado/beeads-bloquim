import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { mapTextElements, maps, insertMapTextElementSchema, updateMapTextElementSchema } from "@workspace/db/schema";
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

router.post("/", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req, res) => {
  const parsed = insertMapTextElementSchema.safeParse(req.body);
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

  const [element] = await db
    .insert(mapTextElements)
    .values({ mapId, ...parsed.data })
    .returning();

  res.status(201).json(element);
});

router.put("/:elementId", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req, res) => {
  const parsed = updateMapTextElementSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const { elementId, mapId, workspaceId } = req.params;

  const mapExists = await verifyMapBelongsToWorkspace(mapId, workspaceId);
  if (!mapExists) {
    res.status(404).json({ error: "Not found", message: "Map not found in workspace" });
    return;
  }

  const [updated] = await db
    .update(mapTextElements)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(mapTextElements.id, elementId), eq(mapTextElements.mapId, mapId)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json(updated);
});

router.delete("/:elementId", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req, res) => {
  const { elementId, mapId, workspaceId } = req.params;

  const mapExists = await verifyMapBelongsToWorkspace(mapId, workspaceId);
  if (!mapExists) {
    res.status(404).json({ error: "Not found", message: "Map not found in workspace" });
    return;
  }

  await db
    .delete(mapTextElements)
    .where(and(eq(mapTextElements.id, elementId), eq(mapTextElements.mapId, mapId)));

  res.json({ success: true, message: "Text element deleted" });
});

export default router;
