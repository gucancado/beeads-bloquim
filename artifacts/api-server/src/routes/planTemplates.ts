import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import {
  deletePlanTemplate,
  listPlanTemplates,
  renamePlanTemplate,
} from "../services/planTemplates/service";

// Montado em /api/plan-templates. Escopo: modelos do próprio usuário.
const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const renameSchema = z.object({ name: z.string().trim().min(1) });

router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const r = await listPlanTemplates(req.user!.userId);
  res.status(r.status).json(r.body);
});

router.patch("/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = renameSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }
  const r = await renamePlanTemplate(req.user!.userId, id, parsed.data.name);
  res.status(r.status).json(r.body);
});

router.delete("/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const r = await deletePlanTemplate(req.user!.userId, id);
  res.status(r.status).json(r.body);
});

export default router;
