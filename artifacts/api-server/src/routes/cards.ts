import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { cards, tasks, cardConnections } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requireWorkspaceRole, getMemberRole } from "../middlewares/permissions";
import { z } from "zod";

const router: IRouter = Router({ mergeParams: true });

const createCardSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  positionX: z.number().optional().default(0),
  positionY: z.number().optional().default(0),
});

const updateCardSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
});

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional().default("medium"),
});

const updateTaskStatusSchema = z.object({
  status: z.enum(["pending", "in_progress", "completed"]),
});

const updateTaskDetailsSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
});

function computeOverdue(dueDate: Date | null | undefined, status: string): boolean {
  if (status === "completed") return false;
  return !!dueDate && dueDate < new Date();
}

function toVisualStatus(status: string, overdue: boolean): "pending" | "in_progress" | "completed" | "overdue" | "no_task" {
  if (overdue && status !== "completed") return "overdue";
  return status as any;
}

router.post("/", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req: AuthRequest, res) => {
  const parsed = createCardSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const { workspaceId, mapId } = req.params;

  const [card] = await db
    .insert(cards)
    .values({ mapId, ...parsed.data })
    .returning();

  const [task] = await db
    .insert(tasks)
    .values({ title: parsed.data.title, mapId, workspaceId, priority: "medium", status: "in_progress" })
    .returning();

  const [updated] = await db
    .update(cards)
    .set({ taskId: task.id, statusVisual: "in_progress", updatedAt: new Date() })
    .where(eq(cards.id, card.id))
    .returning();

  res.status(201).json(updated);
});

router.get("/:cardId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req, res) => {
  const { cardId } = req.params;

  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!card) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  let task = null;
  if (card.taskId) {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, card.taskId)).limit(1);
    task = t ?? null;
  }

  res.json({ ...card, task });
});

router.put("/:cardId", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req, res) => {
  const parsed = updateCardSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error" });
    return;
  }

  const [updated] = await db
    .update(cards)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(cards.id, req.params.cardId))
    .returning();

  res.json(updated);
});

router.delete("/:cardId", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req, res) => {
  await db.delete(cards).where(eq(cards.id, req.params.cardId));
  res.json({ success: true, message: "Card deleted" });
});

router.post("/:cardId/task", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req: AuthRequest, res) => {
  const { cardId, workspaceId, mapId } = req.params;

  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!card) {
    res.status(404).json({ error: "Not found", message: "Card not found" });
    return;
  }

  if (card.taskId) {
    res.status(409).json({ error: "Conflict", message: "Card already has a task" });
    return;
  }

  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : undefined;
  const overdue = computeOverdue(dueDate ?? null, "in_progress");
  const visual = toVisualStatus("in_progress", overdue);

  const [task] = await db
    .insert(tasks)
    .values({ ...parsed.data, mapId, workspaceId, dueDate, status: "in_progress", overdue })
    .returning();

  await db
    .update(cards)
    .set({ taskId: task.id, statusVisual: visual, updatedAt: new Date() })
    .where(eq(cards.id, cardId));

  res.status(201).json(task);
});

router.delete("/:cardId/task", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req, res) => {
  const { cardId } = req.params;

  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!card || !card.taskId) {
    res.status(404).json({ error: "Not found", message: "Card has no task" });
    return;
  }

  await db.delete(tasks).where(eq(tasks.id, card.taskId));
  await db
    .update(cards)
    .set({ taskId: null, statusVisual: "no_task", updatedAt: new Date() })
    .where(eq(cards.id, cardId));

  res.json({ success: true, message: "Task unlinked and deleted" });
});

router.patch("/:cardId/task/status", requireAuth, async (req: AuthRequest, res) => {
  const { cardId, workspaceId } = req.params;
  const userId = req.user!.userId;

  const role = await getMemberRole(workspaceId, userId);
  if (!role) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!card || !card.taskId) {
    res.status(404).json({ error: "Not found", message: "Card has no task" });
    return;
  }

  const [task] = await db.select().from(tasks).where(eq(tasks.id, card.taskId)).limit(1);
  if (!task) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (role === "executor" && task.assignedTo !== userId) {
    res.status(403).json({ error: "Forbidden", message: "Executors can only update their own tasks" });
    return;
  }

  const parsed = updateTaskStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error" });
    return;
  }

  const { status } = parsed.data;
  const completedAt = status === "completed" ? new Date() : null;
  const overdue = computeOverdue(task.dueDate, status);
  const visual = toVisualStatus(status, overdue);

  const [updatedTask] = await db
    .update(tasks)
    .set({ status, overdue, completedAt, updatedAt: new Date() })
    .where(eq(tasks.id, card.taskId))
    .returning();

  await db
    .update(cards)
    .set({ statusVisual: visual, updatedAt: new Date() })
    .where(eq(cards.id, cardId));

  // Cascade: when completed, activate all directly connected downstream cards
  if (status === "completed") {
    const connections = await db
      .select()
      .from(cardConnections)
      .where(eq(cardConnections.sourceCardId, cardId));

    for (const conn of connections) {
      const [targetCard] = await db
        .select()
        .from(cards)
        .where(eq(cards.id, conn.targetCardId))
        .limit(1);

      if (!targetCard?.taskId) continue;

      const [targetTask] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, targetCard.taskId))
        .limit(1);

      if (!targetTask || targetTask.status === "completed") continue;

      const childOverdue = computeOverdue(targetTask.dueDate, "in_progress");
      const childVisual = toVisualStatus("in_progress", childOverdue);

      await db
        .update(tasks)
        .set({ status: "in_progress", overdue: childOverdue, updatedAt: new Date() })
        .where(eq(tasks.id, targetCard.taskId));

      await db
        .update(cards)
        .set({ statusVisual: childVisual, updatedAt: new Date() })
        .where(eq(cards.id, conn.targetCardId));
    }
  }

  res.json(updatedTask);
});

router.patch("/:cardId/task/details", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req, res) => {
  const { cardId } = req.params;

  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!card || !card.taskId) {
    res.status(404).json({ error: "Not found", message: "Card has no task" });
    return;
  }

  const parsed = updateTaskDetailsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error" });
    return;
  }

  const [currentTask] = await db.select().from(tasks).where(eq(tasks.id, card.taskId)).limit(1);

  const updateData: any = { ...parsed.data, updatedAt: new Date() };
  let resolvedDueDate: Date | null = currentTask?.dueDate ?? null;

  if (parsed.data.dueDate !== undefined) {
    resolvedDueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
    updateData.dueDate = resolvedDueDate;
  }

  // Recompute overdue whenever dueDate or any save happens
  const currentStatus = currentTask?.status ?? "in_progress";
  const overdue = computeOverdue(resolvedDueDate, currentStatus);
  updateData.overdue = overdue;

  const [updatedTask] = await db
    .update(tasks)
    .set(updateData)
    .where(eq(tasks.id, card.taskId))
    .returning();

  const visual = toVisualStatus(currentStatus, overdue);
  await db
    .update(cards)
    .set({ statusVisual: visual, updatedAt: new Date() })
    .where(eq(cards.id, cardId));

  res.json(updatedTask);
});

export default router;
