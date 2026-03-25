import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { tasks, cards, maps, workspaces, workspaceMembers, users } from "@workspace/db/schema";
import { eq, and, or, asc, sql, inArray, isNull, count } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { computeOverdue } from "../lib/overdue";
import { z } from "zod";

const router: IRouter = Router();

router.get("/members", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;

  const memberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));

  if (memberships.length === 0) {
    return res.json([]);
  }

  const workspaceIds = memberships.map(m => m.workspaceId);

  const members = await db
    .select({ userId: users.id, name: users.name, workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(inArray(workspaceMembers.workspaceId, workspaceIds))
    .orderBy(users.name);

  return res.json(members);
});

router.get("/counts", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { assignedTo } = req.query as { assignedTo?: string };

  const assignees = assignedTo !== undefined ? assignedTo.split(",").filter(Boolean) : ["me"];

  const buildAssigneeFilter = () => {
    if (assignees.length === 0) return undefined;
    const hasMe = assignees.includes("me");
    const hasUnassigned = assignees.includes("unassigned");
    const uuids = assignees.filter(a => a !== "me" && a !== "unassigned");

    const parts = [];
    if (hasMe) parts.push(eq(tasks.assignedTo, userId));
    if (hasUnassigned) parts.push(isNull(tasks.assignedTo));
    if (uuids.length > 0) parts.push(inArray(tasks.assignedTo, uuids));
    return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : or(...parts);
  };

  const memberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));

  const memberWorkspaceIds = memberships.map(m => m.workspaceId);

  const ownershipFilter = memberWorkspaceIds.length > 0
    ? or(inArray(tasks.workspaceId, memberWorkspaceIds), and(isNull(tasks.workspaceId), eq(tasks.assignedTo, userId)))
    : and(isNull(tasks.workspaceId), eq(tasks.assignedTo, userId));

  const rows = await db
    .select({ status: tasks.status, cnt: count() })
    .from(tasks)
    .where(
      and(
        ownershipFilter,
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

  return res.json(result);
});

router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { workspaceId, status, assignedTo } = req.query as {
    workspaceId?: string;
    status?: string;
    assignedTo?: string;
  };

  const statuses = status ? status.split(",").filter(Boolean) : [];
  const filterOverdue = statuses.includes("overdue");
  const otherStatuses = statuses.filter(s => s !== "overdue");

  const assignees = assignedTo !== undefined ? assignedTo.split(",").filter(Boolean) : ["me"];

  const buildStatusFilter = () => {
    if (statuses.length === 0) return undefined;
    const parts = [];
    if (filterOverdue) parts.push(eq(tasks.overdue, true));
    if (otherStatuses.length > 0) parts.push(inArray(tasks.status, otherStatuses as any[]));
    return parts.length === 1 ? parts[0] : or(...parts);
  };

  const buildAssigneeFilter = () => {
    if (assignees.length === 0) return undefined;
    const hasMe = assignees.includes("me");
    const hasUnassigned = assignees.includes("unassigned");
    const uuids = assignees.filter(a => a !== "me" && a !== "unassigned");

    const parts = [];
    if (hasMe) parts.push(eq(tasks.assignedTo, userId));
    if (hasUnassigned) parts.push(isNull(tasks.assignedTo));
    if (uuids.length > 0) parts.push(inArray(tasks.assignedTo, uuids));
    return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : or(...parts);
  };

  const memberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));

  const memberWorkspaceIds = memberships.map(m => m.workspaceId);

  const ownershipFilter = memberWorkspaceIds.length > 0
    ? or(
        inArray(tasks.workspaceId, memberWorkspaceIds),
        and(isNull(tasks.workspaceId), eq(tasks.assignedTo, userId))
      )
    : and(isNull(tasks.workspaceId), eq(tasks.assignedTo, userId));

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
      completedAt: tasks.completedAt,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      overdue: tasks.overdue,
      cardId: cards.id,
      cardTitle: cards.title,
      mapName: maps.name,
      workspaceName: workspaces.name,
      assigneeName: users.name,
      assigneeAvatarUrl: users.avatarUrl,
    })
    .from(tasks)
    .leftJoin(cards, eq(cards.taskId, tasks.id))
    .leftJoin(maps, eq(maps.id, tasks.mapId))
    .leftJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .where(
      and(
        ownershipFilter,
        workspaceId ? eq(tasks.workspaceId, workspaceId) : undefined,
        buildStatusFilter(),
        buildAssigneeFilter(),
      )
    )
    .orderBy(
      sql`${tasks.dueDate} ASC NULLS LAST`,
      sql`CASE ${tasks.priority} WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END ASC`,
      asc(tasks.createdAt)
    );

  return res.json(taskList);
});

function parseDateNoon(value: string | null | undefined): Date | null {
  if (!value) return null;
  const dateOnly = value.slice(0, 10);
  return new Date(dateOnly + "T12:00:00.000Z");
}

const createStandaloneTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional().default("medium"),
});

router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const parsed = createStandaloneTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });
  }

  const { title, description, dueDate, priority } = parsed.data;
  const dueDateValue = parseDateNoon(dueDate);
  const overdueValue = computeOverdue(dueDateValue, "pending");

  const [newTask] = await db.insert(tasks).values({
    workspaceId: null,
    mapId: null,
    title,
    description: description ?? null,
    assignedTo: userId,
    dueDate: dueDateValue,
    priority,
    status: "pending",
    overdue: overdueValue,
  }).returning();

  return res.status(201).json(newTask);
});

const updateStandaloneTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
});

router.patch("/:taskId", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const [existing] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!existing) return res.status(404).json({ message: "Tarefa não encontrada" });

  if (existing.workspaceId !== null) {
    return res.status(403).json({ message: "Use a rota do workspace para editar esta tarefa" });
  }
  if (existing.assignedTo !== userId) {
    return res.status(403).json({ message: "Sem permissão" });
  }

  const parsed = updateStandaloneTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });
  }

  const updateData: Record<string, any> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.dueDate !== undefined) {
    updateData.dueDate = parseDateNoon(parsed.data.dueDate);
    updateData.overdue = computeOverdue(updateData.dueDate, existing.status ?? "pending");
  }

  const [updated] = await db.update(tasks).set(updateData).where(eq(tasks.id, taskId)).returning();
  return res.json(updated);
});

const statusSchema = z.object({
  status: z.enum(["pending", "in_progress", "blocked", "completed"]),
});

router.patch("/:taskId/status", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Status inválido", errors: parsed.error.flatten() });
  }
  const { status: newStatus } = parsed.data;

  const [existing] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!existing) return res.status(404).json({ message: "Tarefa não encontrada" });

  if (existing.workspaceId !== null) {
    return res.status(403).json({ message: "Use a rota do workspace" });
  }
  if (existing.assignedTo !== userId) {
    return res.status(403).json({ message: "Sem permissão" });
  }

  const updateData: Record<string, any> = {
    previousStatus: existing.status,
    status: newStatus,
    updatedAt: new Date(),
    overdue: computeOverdue(existing.dueDate, newStatus),
  };
  if (newStatus === "completed") updateData.completedAt = new Date();

  const [updated] = await db.update(tasks).set(updateData).where(eq(tasks.id, taskId)).returning();
  return res.json(updated);
});

router.delete("/:taskId", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const [existing] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!existing) return res.status(404).json({ message: "Tarefa não encontrada" });

  if (existing.workspaceId !== null) {
    return res.status(403).json({ message: "Use a rota do workspace" });
  }
  if (existing.assignedTo !== userId) {
    return res.status(403).json({ message: "Sem permissão" });
  }

  await db.delete(tasks).where(eq(tasks.id, taskId));
  return res.json({ ok: true });
});

router.get("/:taskId", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) return res.status(404).json({ message: "Tarefa não encontrada" });

  if (task.workspaceId !== null) {
    return res.status(403).json({ message: "Use a rota do workspace" });
  }
  if (task.assignedTo !== userId) {
    return res.status(403).json({ message: "Sem permissão" });
  }

  return res.json(task);
});

export default router;
