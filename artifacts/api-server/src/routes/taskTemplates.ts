import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import {
  listTemplates,
  createTemplate,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  createTemplateSubtask,
  updateTemplateSubtask,
  deleteTemplateSubtask,
  reorderTemplateSubtasks,
  applyTemplateToTask,
} from "../services/taskTemplatesService";

const router: IRouter = Router();

const prioritySchema = z.enum(["low", "medium", "high", "critical"]);

const updateTemplateSchema = z.object({
  name: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  priority: prioritySchema.nullable().optional(),
});

const createSubtaskSchema = z.object({
  title: z.string().min(1),
  order: z.number().int().optional(),
});

const updateSubtaskSchema = z.object({
  title: z.string().min(1).optional(),
  order: z.number().int().optional(),
});

const reorderSchema = z.object({
  ids: z.array(z.string().uuid()),
});

const applySchema = z.object({
  taskId: z.string().uuid(),
});

router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const r = await listTemplates(req.user!.userId);
  res.status(r.status).json(r.body);
});

router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const r = await createTemplate(req.user!.userId);
  res.status(r.status).json(r.body);
});

router.get("/:templateId", requireAuth, async (req: AuthRequest, res) => {
  const r = await getTemplate(req.user!.userId, req.params.templateId);
  res.status(r.status).json(r.body);
});

router.patch("/:templateId", requireAuth, async (req: AuthRequest, res) => {
  const parsed = updateTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }
  const r = await updateTemplate(req.user!.userId, req.params.templateId, parsed.data);
  res.status(r.status).json(r.body);
});

router.delete("/:templateId", requireAuth, async (req: AuthRequest, res) => {
  const r = await deleteTemplate(req.user!.userId, req.params.templateId);
  res.status(r.status).json(r.body);
});

router.post("/:templateId/subtasks", requireAuth, async (req: AuthRequest, res) => {
  const parsed = createSubtaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }
  const r = await createTemplateSubtask(req.user!.userId, req.params.templateId, parsed.data);
  res.status(r.status).json(r.body);
});

router.patch("/:templateId/subtasks/:subtaskId", requireAuth, async (req: AuthRequest, res) => {
  const parsed = updateSubtaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }
  const r = await updateTemplateSubtask(
    req.user!.userId,
    req.params.templateId,
    req.params.subtaskId,
    parsed.data,
  );
  res.status(r.status).json(r.body);
});

router.delete("/:templateId/subtasks/:subtaskId", requireAuth, async (req: AuthRequest, res) => {
  const r = await deleteTemplateSubtask(
    req.user!.userId,
    req.params.templateId,
    req.params.subtaskId,
  );
  res.status(r.status).json(r.body);
});

router.put("/:templateId/subtasks/reorder", requireAuth, async (req: AuthRequest, res) => {
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }
  const r = await reorderTemplateSubtasks(req.user!.userId, req.params.templateId, parsed.data.ids);
  res.status(r.status).json(r.body);
});

router.post("/:templateId/apply", requireAuth, async (req: AuthRequest, res) => {
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }
  const r = await applyTemplateToTask(
    req.user!.userId,
    req.params.templateId,
    parsed.data.taskId,
  );
  res.status(r.status).json(r.body);
});

export default router;
