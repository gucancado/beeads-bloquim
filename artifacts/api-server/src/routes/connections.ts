import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { cardConnections } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { requireWorkspaceRole } from "../middlewares/permissions";
import { z } from "zod";

const router: IRouter = Router({ mergeParams: true });

const createConnectionSchema = z.object({
  sourceCardId: z.string().uuid(),
  targetCardId: z.string().uuid(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});

router.post("/", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req, res) => {
  const parsed = createConnectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error" });
    return;
  }

  const [connection] = await db
    .insert(cardConnections)
    .values({ mapId: req.params.mapId, ...parsed.data })
    .returning();

  res.status(201).json(connection);
});

router.delete("/:connectionId", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req, res) => {
  await db.delete(cardConnections).where(eq(cardConnections.id, req.params.connectionId));
  res.json({ success: true, message: "Connection deleted" });
});

export default router;
