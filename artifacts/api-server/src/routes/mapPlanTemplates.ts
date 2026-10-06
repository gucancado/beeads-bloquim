import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { requireMapInWorkspace, requireWorkspaceRole } from "../middlewares/permissions";
import { applyToMap, captureFromMap } from "../services/planTemplates/service";

// Montado em /api/workspaces/:workspaceId/maps/:mapId/plan-templates.
const router: IRouter = Router({ mergeParams: true });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const captureSchema = z.object({
  cardIds: z.array(z.string().uuid()).optional(),
  textElementIds: z.array(z.string().uuid()).optional(),
  shapeIds: z.array(z.string().uuid()).optional(),
});

router.post(
  "/capture",
  requireAuth,
  requireWorkspaceRole(["admin", "editor", "executor"]),
  requireMapInWorkspace,
  async (req: AuthRequest, res) => {
    // Express 5 deixa req.body undefined sem corpo: equivale a {} (mapa inteiro).
    const parsed = captureSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", message: parsed.error.message });
      return;
    }
    const r = await captureFromMap({
      userId: req.user!.userId,
      mapId: req.params.mapId as string,
      selection: parsed.data,
    });
    res.status(r.status).json(r.body);
  },
);

router.post(
  "/:templateId/apply",
  requireAuth,
  requireWorkspaceRole(["admin", "editor"]),
  requireMapInWorkspace,
  async (req: AuthRequest, res) => {
    const templateId = req.params.templateId as string;
    if (!UUID_RE.test(templateId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const userId = req.user!.userId;
    const [actor] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    const r = await applyToMap({
      userId,
      actorName: actor?.name ?? null,
      source: req.user?.source ?? null,
      templateId,
      mapId: req.params.mapId as string,
      workspaceId: req.params.workspaceId as string,
    });
    res.status(r.status).json(r.body);
  },
);

export default router;
