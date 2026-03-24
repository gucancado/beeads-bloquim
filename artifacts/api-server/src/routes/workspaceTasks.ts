import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { tasks, cards, maps, workspaceMembers, users, subtasks } from "@workspace/db/schema";
import { eq, and, isNull, or, inArray, asc, sql, count } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requireWorkspaceRole } from "../middlewares/permissions";
import { z } from "zod";
import { computeOverdue } from "../lib/overdue";

function parseDateNoon(value: string | null | undefined): Date | null {
  if (!value) return null;
  const dateOnly = value.slice(0, 10);
  return new Date(dateOnly + "T12:00:00.000Z");
}

function toVisualStatus(status: string, overdue: boolean): "pending" | "in_progress" | "completed" | "overdue" | "blocked" | "no_task" {
  if (overdue && status !== "completed" && status !== "blocked") return "overdue";
  return status as any;
}

async function syncCardVisual(taskId: string, status: string, overdue: boolean) {
  const visual = toVisualStatus(status, overdue);
  await db.update(cards)
    .set({ statusVisual: visual, updatedAt: new Date() })
    .where(eq(cards.taskId, taskId));
}

const router: IRouter = Router({ mergeParams: true });

router.get("/counts", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId } = req.params;
  const { assignedTo } = req.query as { assignedTo?: string };
  const assignees = assignedTo ? assignedTo.split(",").filter(Boolean) : [];

  const buildAssigneeFilter = () => {
    if (assignees.length === 0) return undefined;
    const hasUnassigned = assignees.includes("unassigned");
    const uuids = assignees.filter(a => a !== "unassigned");
    const parts = [];
    if (hasUnassigned) parts.push(isNull(tasks.assignedTo));
    if (uuids.length > 0) parts.push(inArray(tasks.assignedTo, uuids));
    return parts.length === 1 ? parts[0] : or(...parts);
  };

  const rows = await db
    .select({ status: tasks.status, cnt: count() })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        buildAssigneeFilter(),
      )
    )
    .groupBy(tasks.status);

  const result = { pending: 0, in_progress: 0, completed: 0, blocked: 0 } as Record<string, number>;
  for (const row of rows) {
    if (row.status && row.status in result) {
      result[row.status] = Number(row.cnt);
    }
  }

  res.json(result);
});

router.get("/", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId } = req.params;
  const { status, assignedTo } = req.query as { status?: string; assignedTo?: string };
  const statuses = status ? status.split(",").filter(Boolean) : [];
  const assignees = assignedTo ? assignedTo.split(",").filter(Boolean) : [];

  const buildAssigneeFilter = () => {
    if (assignees.length === 0) return undefined;
    const hasUnassigned = assignees.includes("unassigned");
    const uuids = assignees.filter(a => a !== "unassigned");
    const parts = [];
    if (hasUnassigned) parts.push(isNull(tasks.assignedTo));
    if (uuids.length > 0) parts.push(inArray(tasks.assignedTo, uuids));
    return parts.length === 1 ? parts[0] : or(...parts);
  };

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
      assigneeAvatarUrl: users.avatarUrl,
    })
    .from(tasks)
    .leftJoin(cards, eq(cards.taskId, tasks.id))
    .leftJoin(maps, eq(maps.id, tasks.mapId))
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        statuses.length > 0 ? inArray(tasks.status, statuses as any[]) : undefined,
        buildAssigneeFilter(),
      )
    )
    .orderBy(
      sql`${tasks.dueDate} ASC NULLS LAST`,
      sql`CASE ${tasks.priority} WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END ASC`,
      asc(tasks.createdAt)
    );

  res.json(taskList);
});

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
});

const updateTaskSchema = createTaskSchema.partial();

router.post("/", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId } = req.params;
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const { title, description, assignedTo, dueDate, priority } = parsed.data;

  const dueDateValue = parseDateNoon(dueDate);
  const overdueValue = computeOverdue(dueDateValue, "pending");

  const [task] = await db
    .insert(tasks)
    .values({
      workspaceId,
      title,
      description: description ?? null,
      assignedTo: assignedTo ?? null,
      dueDate: dueDateValue,
      priority: priority ?? "medium",
      status: "pending",
      overdue: overdueValue,
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

  const [assignee, members, taskSubtasks] = await Promise.all([
    task.assignedTo
      ? db.select({ name: users.name }).from(users).where(eq(users.id, task.assignedTo)).limit(1)
      : Promise.resolve([]),
    db
      .select({ userId: workspaceMembers.userId, name: users.name, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, workspaceId)),
    db.select().from(subtasks).where(eq(subtasks.taskId, taskId)).orderBy(asc(subtasks.order), asc(subtasks.createdAt)),
  ]);

  res.json({ ...task, assigneeName: assignee[0]?.name ?? null, members, subtasks: taskSubtasks });
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
  if ("dueDate" in parsed.data) updateData.dueDate = parseDateNoon(parsed.data.dueDate as string);
  if (parsed.data.priority !== undefined) updateData.priority = parsed.data.priority;

  const effectiveDueDate = "dueDate" in updateData ? updateData.dueDate : existing.dueDate;
  const effectiveStatus = existing.status;
  updateData.overdue = computeOverdue(effectiveDueDate, effectiveStatus);

  const [updated] = await db.update(tasks).set(updateData).where(eq(tasks.id, taskId)).returning();

  await syncCardVisual(taskId, updated.status, !!updated.overdue);

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

  updateData.overdue = computeOverdue(existing.dueDate, status);

  const [updated] = await db.update(tasks).set(updateData).where(eq(tasks.id, taskId)).returning();

  await syncCardVisual(taskId, updated.status, !!updated.overdue);

  res.json(updated);
});

router.delete("/:taskId", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;
  await db.delete(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));
  res.json({ success: true });
});

const subtaskItemSchema = z.object({
  id: z.string().uuid().optional(),
  text: z.string(),
  completed: z.boolean().optional().default(false),
  order: z.number().int().optional().default(0),
});

const bulkSubtasksSchema = z.object({
  subtasks: z.array(subtaskItemSchema),
});

const createSubtaskSchema = z.object({
  text: z.string().min(1),
  completed: z.boolean().optional().default(false),
  order: z.number().int().optional(),
});

const updateSubtaskSchema = createSubtaskSchema.partial();

router.get("/:taskId/subtasks", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  const [task] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
  if (!task) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const items = await db.select().from(subtasks).where(eq(subtasks.taskId, taskId)).orderBy(asc(subtasks.order), asc(subtasks.createdAt));
  res.json(items);
});

router.put("/:taskId/subtasks", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  const [task] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
  if (!task) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const parsed = bulkSubtasksSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const incoming = parsed.data.subtasks.filter(s => s.text.trim() !== "");

  await db.delete(subtasks).where(eq(subtasks.taskId, taskId));

  if (incoming.length > 0) {
    await db.insert(subtasks).values(
      incoming.map((s, idx) => ({
        id: s.id,
        taskId,
        text: s.text.trim(),
        completed: s.completed ?? false,
        order: s.order ?? idx,
      }))
    );
  }

  const result = await db.select().from(subtasks).where(eq(subtasks.taskId, taskId)).orderBy(asc(subtasks.order), asc(subtasks.createdAt));
  res.json(result);
});

const ensureTaskInWorkspace = async (workspaceId: string, taskId: string) => {
  const [task] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
  return !!task;
};

router.post("/:taskId/subtasks", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  if (!(await ensureTaskInWorkspace(workspaceId, taskId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const parsed = createSubtaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const existing = await db.select({ order: subtasks.order }).from(subtasks).where(eq(subtasks.taskId, taskId)).orderBy(asc(subtasks.order));
  const nextOrder = parsed.data.order ?? (existing.length > 0 ? (existing[existing.length - 1].order + 1) : 0);

  const [created] = await db.insert(subtasks).values({
    taskId,
    text: parsed.data.text,
    completed: parsed.data.completed ?? false,
    order: nextOrder,
  }).returning();

  res.status(201).json(created);
});

router.patch("/:taskId/subtasks/:subtaskId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId, subtaskId } = req.params;

  if (!(await ensureTaskInWorkspace(workspaceId, taskId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const parsed = updateSubtaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(subtasks).where(and(eq(subtasks.id, subtaskId), eq(subtasks.taskId, taskId))).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Subtask not found" });
    return;
  }

  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (parsed.data.text !== undefined) updateData.text = parsed.data.text;
  if (parsed.data.completed !== undefined) updateData.completed = parsed.data.completed;
  if (parsed.data.order !== undefined) updateData.order = parsed.data.order;

  const [updated] = await db.update(subtasks).set(updateData).where(eq(subtasks.id, subtaskId)).returning();
  res.json(updated);
});

router.delete("/:taskId/subtasks/:subtaskId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId, subtaskId } = req.params;

  if (!(await ensureTaskInWorkspace(workspaceId, taskId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await db.delete(subtasks).where(and(eq(subtasks.id, subtaskId), eq(subtasks.taskId, taskId)));
  res.json({ success: true });
});

export default router;
