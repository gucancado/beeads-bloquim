import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { tasks, cards, maps, workspaceMembers, users } from "@workspace/db/schema";
import { eq, and, isNull, or, inArray, asc, sql } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requireWorkspaceRole } from "../middlewares/permissions";
import { z } from "zod";

const router: IRouter = Router({ mergeParams: true });

router.get("/", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId } = req.params;
  const { status } = req.query as { status?: string };
  const statuses = status ? status.split(",").filter(Boolean) : [];

  const taskList = await db
    .select({
      id: tasks.id,
      mapId: tasks.mapId,
      workspaceId: tasks.workspaceId,
      title: tasks.title,
      description: tasks.description,
      assignedTo: tasks.assignedTo,
      dueDate: tasks.dueDate,
      priority: tasks.priority,
      status: tasks.status,
      overdue: tasks.overdue,
      completedAt: tasks.completedAt,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      cardId: cards.id,
      cardTitle: cards.title,
      mapName: maps.name,
      assigneeName: users.name,
    })
    .from(tasks)
    .leftJoin(cards, eq(cards.taskId, tasks.id))
    .leftJoin(maps, eq(maps.id, tasks.mapId))
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        statuses.length > 0 ? inArray(tasks.status, statuses as any[]) : undefined,
      )
    )
    .orderBy(
      sql`${tasks.dueDate} ASC NULLS LAST`,
      asc(tasks.createdAt)
    );

  res.json(taskList);
});

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
});

const updateTaskSchema = createTaskSchema.partial();

router.post("/", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req: AuthRequest, res) => {
  const { workspaceId } = req.params;
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const { title, description, assignedTo, dueDate, priority } = parsed.data;

  const [task] = await db
    .insert(tasks)
    .values({
      workspaceId,
      title,
      description: description ?? null,
      assignedTo: assignedTo ?? null,
      dueDate: dueDate ? new Date(dueDate) : null,
      priority: priority ?? "medium",
      status: "pending",
    })
    .returning();

  const assignee = assignedTo
    ? await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, assignedTo)).limit(1)
    : [];

  res.status(201).json({
    ...task,
    mapName: null,
    cardId: null,
    cardTitle: task.title,
    workspaceName: null,
    assigneeName: assignee[0]?.name ?? null,
  });
});

router.get("/:taskId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  const [task] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
  if (!task) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const assignee = task.assignedTo
    ? await db.select({ name: users.name }).from(users).where(eq(users.id, task.assignedTo)).limit(1)
    : [];

  const members = await db
    .select({ userId: workspaceMembers.userId, name: users.name, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId));

  res.json({ ...task, assigneeName: assignee[0]?.name ?? null, members });
});

router.patch("/:taskId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if ("assignedTo" in parsed.data) updateData.assignedTo = parsed.data.assignedTo ?? null;
  if ("dueDate" in parsed.data) updateData.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate as string) : null;
  if (parsed.data.priority !== undefined) updateData.priority = parsed.data.priority;

  const [updated] = await db.update(tasks).set(updateData).where(eq(tasks.id, taskId)).returning();

  const assignee = updated.assignedTo
    ? await db.select({ name: users.name }).from(users).where(eq(users.id, updated.assignedTo)).limit(1)
    : [];

  res.json({ ...updated, assigneeName: assignee[0]?.name ?? null });
});

router.patch("/:taskId/status", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;
  const { status } = req.body as { status: string };

  const validStatuses = ["pending", "in_progress", "completed", "blocked"];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }

  const [existing] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const updateData: Record<string, any> = {
    status,
    previousStatus: existing.status,
    updatedAt: new Date(),
    completedAt: status === "completed" ? new Date() : null,
  };

  const [updated] = await db.update(tasks).set(updateData).where(eq(tasks.id, taskId)).returning();
  res.json(updated);
});

router.delete("/:taskId", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;
  await db.delete(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));
  res.json({ success: true });
});

export default router;
