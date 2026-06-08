import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { cardConnections, cards } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import {
  requireWorkspaceRole,
  requireMapInWorkspace,
  requireActionMap,
  requireConnectionInMap,
} from "../middlewares/permissions";
import { z } from "zod";

const router: IRouter = Router({ mergeParams: true });

const createConnectionSchema = z.object({
  sourceCardId: z.string().uuid(),
  targetCardId: z.string().uuid(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});

router.post(
  "/",
  requireAuth,
  requireWorkspaceRole(["admin", "editor"]),
  requireMapInWorkspace,
  requireActionMap,
  async (req, res) => {
    const parsed = createConnectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error" });
      return;
    }

    // Both source and target must live in the same :mapId — otherwise an
    // editor could splice cards from a different workspace's map into their map.
    const found = await db
      .select({ id: cards.id })
      .from(cards)
      .where(
        and(
          eq(cards.mapId, req.params.mapId),
          inArray(cards.id, [parsed.data.sourceCardId, parsed.data.targetCardId]),
        ),
      );
    if (found.length !== 2) {
      res.status(404).json({ error: "Not found", message: "Source or target card not in this map" });
      return;
    }

    try {
      const [connection] = await db
        .insert(cardConnections)
        .values({ mapId: req.params.mapId, ...parsed.data })
        .returning();

      res.status(201).json(connection);
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "23505") {
        res.status(409).json({ error: "Conexão já existe entre esses nós." });
        return;
      }
      throw err;
    }
  },
);

router.delete(
  "/:connectionId",
  requireAuth,
  requireWorkspaceRole(["admin", "editor"]),
  requireConnectionInMap,
  async (req, res) => {
    await db.delete(cardConnections).where(eq(cardConnections.id, req.params.connectionId));
    res.json({ success: true, message: "Connection deleted" });
  },
);

export default router;
