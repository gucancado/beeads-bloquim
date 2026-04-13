import { Router, IRouter } from "express";
import { Readable } from "stream";
import { db } from "@workspace/db";
import { tasks, cards, maps, workspaces, workspaceMembers, users, subtasks, taskActivities, cardConnections, fileUploads, attachmentLinks } from "@workspace/db/schema";
import type { RecurrenceConfig } from "@workspace/db/schema";
import { eq, and, isNull, or, inArray, asc, sql, count, desc, isNotNull, not, ne } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requireWorkspaceRole } from "../middlewares/permissions";
import { z } from "zod";
import { computeOverdue } from "../lib/overdue";
import { calculateNextDueDate } from "../lib/recurrence";
import { duplicateRecurringTask } from "../lib/duplicateRecurring";
import { ObjectStorageService } from "../lib/objectStorage";

type TaskStatus = "pending" | "in_progress" | "completed" | "overdue" | "blocked" | "draft";

function parseDateNoon(value: string | null | undefined): Date | null {
  if (!value) return null;
  const dateOnly = value.slice(0, 10);
  return new Date(dateOnly + "T12:00:00.000Z");
}

function toVisualStatus(status: string, overdue: boolean): "pending" | "in_progress" | "completed" | "overdue" | "blocked" | "draft" | "no_task" {
  if (overdue && status !== "completed" && status !== "blocked" && status !== "draft") return "overdue";
  const validStatuses = ["pending", "in_progress", "completed", "overdue", "blocked", "draft"] as const;
  type ValidStatus = typeof validStatuses[number];
  return validStatuses.includes(status as ValidStatus) ? (status as ValidStatus) : "pending";
}

async function syncCardVisual(taskId: string, status: string, overdue: boolean) {
  const visual = toVisualStatus(status, overdue);
  await db.update(cards)
    .set({ statusVisual: visual, updatedAt: new Date() })
    .where(eq(cards.taskId, taskId));
}

interface ApprovalChainInfo {
  parentCardId: string;
  approvalTasksSorted: { id: string; approvalOrder: number }[];
  approvalCardByTaskId: Map<string, string>;
  chainCardIds: Set<string>;
}

async function getApprovalChainInfo(taskId: string): Promise<ApprovalChainInfo | null> {
  const [parentCard] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.taskId, taskId))
    .limit(1);
  if (!parentCard) return null;

  const approvalTasksSorted = await db
    .select({ id: tasks.id, approvalOrder: tasks.approvalOrder })
    .from(tasks)
    .where(and(eq(tasks.parentTaskId, taskId), eq(tasks.isApprovalTask, true)))
    .orderBy(asc(tasks.approvalOrder));

  const approvalCardByTaskId = new Map<string, string>();
  if (approvalTasksSorted.length > 0) {
    const approvalCards = await db
      .select({ id: cards.id, taskId: cards.taskId })
      .from(cards)
      .where(inArray(cards.taskId, approvalTasksSorted.map(t => t.id)));
    for (const c of approvalCards) {
      if (c.taskId) approvalCardByTaskId.set(c.taskId, c.id);
    }
  }

  const chainCardIds = new Set<string>([parentCard.id, ...approvalCardByTaskId.values()]);
  return { parentCardId: parentCard.id, approvalTasksSorted, approvalCardByTaskId, chainCardIds };
}

function computeTerminalCardId(
  approvalTasksSorted: { id: string; approvalOrder: number }[],
  approvalCardByTaskId: Map<string, string>,
  parentCardId: string,
  mode: string,
): string {
  if (approvalTasksSorted.length === 0) return parentCardId;
  if (approvalTasksSorted.length === 1) {
    return approvalCardByTaskId.get(approvalTasksSorted[0].id) ?? parentCardId;
  }
  if (mode === 'sequential') {
    const last = approvalTasksSorted[approvalTasksSorted.length - 1];
    return approvalCardByTaskId.get(last.id) ?? parentCardId;
  }
  return parentCardId;
}

async function rerouteDownstreamConnections(
  oldTerminalCardId: string,
  newTerminalCardId: string,
  chainCardIds: Set<string>,
): Promise<void> {
  if (oldTerminalCardId === newTerminalCardId) return;
  const conns = await db
    .select({ id: cardConnections.id, targetCardId: cardConnections.targetCardId, sourceHandle: cardConnections.sourceHandle, targetHandle: cardConnections.targetHandle })
    .from(cardConnections)
    .where(eq(cardConnections.sourceCardId, oldTerminalCardId));
  const downstream = conns.filter(c => !chainCardIds.has(c.targetCardId));
  if (downstream.length === 0) return;

  for (const conn of downstream) {
    const [existing] = await db
      .select({ id: cardConnections.id })
      .from(cardConnections)
      .where(and(
        eq(cardConnections.sourceCardId, newTerminalCardId),
        eq(cardConnections.targetCardId, conn.targetCardId),
      ))
      .limit(1);
    if (existing) {
      await db.delete(cardConnections).where(eq(cardConnections.id, conn.id));
    } else {
      await db.update(cardConnections)
        .set({ sourceCardId: newTerminalCardId })
        .where(eq(cardConnections.id, conn.id));
    }
  }
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
        not(and(eq(tasks.isApprovalTask, true), eq(tasks.status, "draft"))),
      )
    )
    .groupBy(tasks.status);

  const result = { pending: 0, in_progress: 0, completed: 0, blocked: 0, draft: 0 } as Record<string, number>;
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
  const VALID_STATUSES = ["pending", "in_progress", "completed", "overdue", "blocked", "draft"] as const;
  type ValidStatus = typeof VALID_STATUSES[number];
  const statuses: ValidStatus[] = (status ? status.split(",").filter(Boolean) : []).filter(
    (s): s is ValidStatus => VALID_STATUSES.includes(s as ValidStatus)
  );
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
      isApprovalTask: tasks.isApprovalTask,
      isRecurring: tasks.isRecurring,
      recurrenceConfig: tasks.recurrenceConfig,
      parentTaskId: tasks.parentTaskId,
      parentApprovalStatus: tasks.parentApprovalStatus,
      cardId: cards.id,
      cardTitle: cards.title,
      mapName: maps.name,
      workspaceColorIndex: workspaces.colorIndex,
      assigneeName: users.name,
      assigneeAvatarUrl: users.avatarUrl,
      attachmentCount: sql<number>`(SELECT COUNT(*) FROM attachment_links WHERE entity_type = 'task' AND entity_id = ${tasks.id})`,
    })
    .from(tasks)
    .leftJoin(cards, eq(cards.taskId, tasks.id))
    .leftJoin(maps, eq(maps.id, tasks.mapId))
    .leftJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        statuses.length > 0 ? inArray(tasks.status, statuses) : undefined,
        buildAssigneeFilter(),
        not(and(eq(tasks.isApprovalTask, true), eq(tasks.status, "draft"))),
      )
    )
    .orderBy(
      sql`${tasks.dueDate} ASC NULLS LAST`,
      sql`CASE ${tasks.priority} WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END ASC`,
      asc(tasks.createdAt)
    );

  res.json(taskList);
});

const recurrenceConfigSchema = z.object({
  type: z.enum(["daily", "weekly", "monthly", "yearly", "periodic", "custom"]),
  weekDays: z.array(z.number().int().min(0).max(6)).optional(),
  monthlyMode: z.enum(["ordinal", "day"]).optional(),
  ordinalWeek: z.number().int().min(1).max(5).optional(),
  ordinalDay: z.number().int().min(0).max(6).optional(),
  monthDay: z.number().int().min(1).max(31).optional(),
  intervalDays: z.number().int().min(1).optional(),
  customInterval: z.number().int().min(1).optional(),
  customUnit: z.enum(["day", "week", "month", "year"]).optional(),
  customWeekDays: z.array(z.number().int().min(0).max(6)).optional(),
});

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  isRecurring: z.boolean().optional(),
  recurrenceConfig: recurrenceConfigSchema.nullable().optional(),
});

const updateTaskSchema = createTaskSchema.partial();

router.post("/", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId } = req.params;
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const { title, description, assignedTo, dueDate, priority, isRecurring, recurrenceConfig } = parsed.data;

  const dueDateValue = parseDateNoon(dueDate);
  const overdueValue = computeOverdue(dueDateValue, "draft");

  const actorId = req.user!.userId;

  const [task] = await db
    .insert(tasks)
    .values({
      workspaceId,
      title,
      description: description ?? null,
      assignedTo: assignedTo ?? null,
      dueDate: dueDateValue,
      priority: priority ?? "medium",
      status: "draft",
      overdue: overdueValue,
      isRecurring: isRecurring ?? false,
      recurrenceConfig: recurrenceConfig ?? null,
    })
    .returning();

  const [actorUser, assignee] = await Promise.all([
    db.select({ name: users.name }).from(users).where(eq(users.id, actorId)).limit(1),
    assignedTo
      ? db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, assignedTo)).limit(1)
      : Promise.resolve([]),
  ]);

  await db.insert(taskActivities).values({
    taskId: task.id,
    actorId,
    type: "task_created",
    metadata: { actorName: actorUser[0]?.name ?? null },
  });

  res.status(201).json({
    ...task,
    mapName: null,
    cardId: null,
    cardTitle: task.title,
    workspaceName: null,
    assigneeName: (assignee as { name: string }[])[0]?.name ?? null,
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
      ? db.select({ name: users.name, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, task.assignedTo)).limit(1)
      : Promise.resolve([]),
    db
      .select({ userId: workspaceMembers.userId, name: users.name, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, workspaceId)),
    db.select().from(subtasks).where(eq(subtasks.taskId, taskId)).orderBy(asc(subtasks.order), asc(subtasks.createdAt)),
  ]);

  let parentTask: { id: string; title: string; status: string; completedAt: Date | null } | null = null;
  if (task.isApprovalTask && task.parentTaskId) {
    const [pt] = await db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status, completedAt: tasks.completedAt })
      .from(tasks)
      .where(eq(tasks.id, task.parentTaskId))
      .limit(1);
    parentTask = pt ?? null;
  }

  res.json({
    ...task,
    assigneeName: assignee[0]?.name ?? null,
    assigneeAvatarUrl: assignee[0]?.avatarUrl ?? null,
    members,
    subtasks: taskSubtasks,
    parentTask,
  });
});

router.patch("/:taskId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;
  const actorId = req.user!.userId;
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

  const assigneeChanging = "assignedTo" in parsed.data && parsed.data.assignedTo !== existing.assignedTo;
  const newAssigneeId = assigneeChanging ? (parsed.data.assignedTo ?? null) : null;
  const priorityChanging = parsed.data.priority !== undefined && parsed.data.priority !== existing.priority;
  const dueDateChanging = "dueDate" in parsed.data && (parsed.data.dueDate ?? null) !== (existing.dueDate ? existing.dueDate.toISOString().slice(0, 10) : null);

  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if ("assignedTo" in parsed.data) updateData.assignedTo = parsed.data.assignedTo ?? null;
  if ("dueDate" in parsed.data) updateData.dueDate = parseDateNoon(parsed.data.dueDate as string);
  if (parsed.data.priority !== undefined) updateData.priority = parsed.data.priority;
  // Invariant: tasks linked to a plan (mapId) cannot be recurring
  const effectiveMapId = existing.mapId;
  if (effectiveMapId) {
    updateData.isRecurring = false;
    updateData.recurrenceConfig = null;
  } else {
    if ("isRecurring" in parsed.data) updateData.isRecurring = parsed.data.isRecurring ?? false;
    if ("recurrenceConfig" in parsed.data) updateData.recurrenceConfig = parsed.data.recurrenceConfig ?? null;
  }

  const effectiveDueDate = "dueDate" in updateData ? updateData.dueDate : existing.dueDate;
  const effectiveStatus = existing.status;
  updateData.overdue = computeOverdue(effectiveDueDate, effectiveStatus);

  const [updated] = await db.update(tasks).set(updateData).where(eq(tasks.id, taskId)).returning();

  await syncCardVisual(taskId, updated.status, !!updated.overdue);

  const [assignee, actorUser] = await Promise.all([
    updated.assignedTo
      ? db.select({ name: users.name }).from(users).where(eq(users.id, updated.assignedTo)).limit(1)
      : Promise.resolve([]),
    db.select({ name: users.name }).from(users).where(eq(users.id, actorId)).limit(1),
  ]);

  if (assigneeChanging) {
    const [oldAssignee, newAssignee] = await Promise.all([
      existing.assignedTo
        ? db.select({ name: users.name }).from(users).where(eq(users.id, existing.assignedTo)).limit(1)
        : Promise.resolve([]),
      newAssigneeId
        ? db.select({ name: users.name }).from(users).where(eq(users.id, newAssigneeId)).limit(1)
        : Promise.resolve([]),
    ]);

    await db.insert(taskActivities).values({
      taskId,
      actorId,
      type: "assignee_changed",
      metadata: {
        actorName: actorUser[0]?.name ?? null,
        actorId,
        newAssigneeId,
        oldAssigneeName: (oldAssignee as { name: string }[])[0]?.name ?? null,
        newAssigneeName: (newAssignee as { name: string }[])[0]?.name ?? null,
      },
    });
  }

  if (priorityChanging) {
    await db.insert(taskActivities).values({
      taskId,
      actorId,
      type: "priority_changed",
      metadata: {
        actorName: actorUser[0]?.name ?? null,
        oldPriority: existing.priority ?? null,
        newPriority: parsed.data.priority ?? null,
      },
    });
  }

  if (dueDateChanging) {
    await db.insert(taskActivities).values({
      taskId,
      actorId,
      type: "due_date_changed",
      metadata: {
        actorName: actorUser[0]?.name ?? null,
        oldDueDate: existing.dueDate ? existing.dueDate.toISOString().slice(0, 10) : null,
        newDueDate: parsed.data.dueDate ?? null,
      },
    });
  }

  res.json({ ...updated, assigneeName: (assignee as { name: string }[])[0]?.name ?? null });
});

const patchStatusSchema = z.object({
  status: z.enum(["pending", "in_progress", "completed", "blocked", "draft"]),
  isRecurring: z.boolean().optional(),
  recurrenceConfig: recurrenceConfigSchema.nullable().optional(),
});

router.patch("/:taskId/status", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;
  const actorId = req.user!.userId;

  const parsed = patchStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }
  const { status, isRecurring: bodyIsRecurring, recurrenceConfig: bodyRecurrenceConfig } = parsed.data;

  const [existing] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const previousStatus = existing.status;

  const updateData: Record<string, any> = {
    status,
    previousStatus,
    updatedAt: new Date(),
    completedAt: status === "completed" ? new Date() : null,
  };

  updateData.overdue = computeOverdue(existing.dueDate, status);
  // If client sends recurrence state alongside status, apply it atomically (prevents race condition)
  if (bodyIsRecurring !== undefined && !existing.mapId) updateData.isRecurring = bodyIsRecurring;
  if (bodyRecurrenceConfig !== undefined && !existing.mapId) updateData.recurrenceConfig = bodyRecurrenceConfig ?? null;

  // Reset parentApprovalStatus when task goes back to in_progress/draft/pending from approved
  if (["in_progress", "draft", "pending"].includes(status) && existing.parentApprovalStatus === "approved") {
    updateData.parentApprovalStatus = null;
  }

  const [updated] = await db.update(tasks).set(updateData).where(eq(tasks.id, taskId)).returning();

  await syncCardVisual(taskId, updated.status, !!updated.overdue);

  if (previousStatus !== status) {
    const [actorUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, actorId)).limit(1);
    await db.insert(taskActivities).values({
      taskId,
      actorId,
      type: "status_changed",
      metadata: {
        actorName: actorUser?.name ?? null,
        oldStatus: previousStatus,
        newStatus: status,
      },
    });
  }

  if (previousStatus !== status) {
    const approvalChildTasks = await db
      .select({ id: tasks.id, dueDate: tasks.dueDate, status: tasks.status, approvalOrder: tasks.approvalOrder })
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, taskId), eq(tasks.isApprovalTask, true)))
      .orderBy(asc(tasks.approvalOrder));

    const actorUserForCascade = (await db.select({ name: users.name }).from(users).where(eq(users.id, actorId)).limit(1))[0];

    // When resetting parent to a non-completed state, clear approval decisions so children
    // start fresh in the next cycle.
    const clearApprovalDecisions = ["in_progress", "draft", "pending", "blocked"].includes(status);

    // In sequential mode, when parent completes, only the first approval task activates;
    // the rest stay pending until each predecessor approves.
    const isSequential = (existing.approvalMode ?? "sequential") === "sequential";

    for (let i = 0; i < approvalChildTasks.length; i++) {
      const child = approvalChildTasks[i];
      const approvalTaskNewStatus =
        status === "completed" && isSequential && i > 0
          ? "pending"
          : getApprovalTaskStatus(status);
      const childOverdue = computeOverdue(child.dueDate, approvalTaskNewStatus);
      const childVisual = toVisualStatus(approvalTaskNewStatus, childOverdue);
      const childUpdateSet: Record<string, any> = { status: approvalTaskNewStatus, overdue: childOverdue, updatedAt: new Date() };
      if (clearApprovalDecisions) {
        childUpdateSet.approvalStatus = null;
        childUpdateSet.approvalComment = null;
      }
      await db.update(tasks)
        .set(childUpdateSet)
        .where(eq(tasks.id, child.id));
      await db.update(cards)
        .set({ statusVisual: childVisual, updatedAt: new Date() })
        .where(eq(cards.taskId, child.id));
      if (child.status !== approvalTaskNewStatus) {
        await db.insert(taskActivities).values({
          taskId: child.id,
          actorId,
          type: "status_changed",
          metadata: {
            actorName: actorUserForCascade?.name ?? null,
            oldStatus: child.status,
            newStatus: approvalTaskNewStatus,
          },
        });
      }
    }

    // When completing with any approval children, set parentApprovalStatus to in_approval.
    // Children are transitioned to in_progress regardless of their prior state,
    // so any completion with approval children enters the approval cycle.
    if (status === "completed" && approvalChildTasks.length > 0) {
      await db.update(tasks)
        .set({ parentApprovalStatus: "in_approval", updatedAt: new Date() })
        .where(eq(tasks.id, taskId));
      updated.parentApprovalStatus = "in_approval";
    }
  }

  // Handle recurrence: when a recurring task without mapId transitions INTO completed, duplicate it with the next due date
  // Use updated.isRecurring/recurrenceConfig so that recurrence state sent atomically with status is respected
  if (status === "completed" && previousStatus !== "completed" && updated.isRecurring && updated.recurrenceConfig && !existing.mapId) {
    const completedAt = updated.completedAt ?? new Date();
    const nextDueDate = calculateNextDueDate(existing.dueDate, updated.recurrenceConfig as RecurrenceConfig, completedAt);
    await duplicateRecurringTask(updated, nextDueDate, actorId, workspaceId);
  }

  res.json(updated);
});

router.get("/:taskId/activities", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  const [task] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
  if (!task) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const activities = await db
    .select({
      id: taskActivities.id,
      taskId: taskActivities.taskId,
      actorId: taskActivities.actorId,
      actorName: users.name,
      actorAvatarUrl: users.avatarUrl,
      type: taskActivities.type,
      metadata: taskActivities.metadata,
      createdAt: taskActivities.createdAt,
    })
    .from(taskActivities)
    .leftJoin(users, eq(taskActivities.actorId, users.id))
    .where(eq(taskActivities.taskId, taskId))
    .orderBy(asc(taskActivities.createdAt));

  res.json(activities);
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

const MAX_APPROVERS = 3;

function getApprovalTaskStatus(parentStatus: string): TaskStatus {
  switch (parentStatus) {
    case "draft":
      return "draft";
    case "pending":
      return "pending";
    case "blocked":
      return "blocked";
    case "in_progress":
      return "pending";
    case "completed":
      return "in_progress";
    default:
      return "pending";
  }
}

router.get("/:taskId/approvals", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  const [parentTask] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
  if (!parentTask) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const approvalTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      approvalOrder: tasks.approvalOrder,
      approvalStatus: tasks.approvalStatus,
      dueDate: tasks.dueDate,
      assignedTo: tasks.assignedTo,
      approverName: users.name,
      approverAvatarUrl: users.avatarUrl,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .where(and(eq(tasks.parentTaskId, taskId), eq(tasks.isApprovalTask, true)))
    .orderBy(asc(tasks.approvalOrder));

  res.json({
    approvalMode: parentTask.approvalMode ?? "sequential",
    approvals: approvalTasks,
  });
});

const addApproverSchema = z.object({
  approverId: z.string().uuid(),
  dueDate: z.string().nullable().optional(),
});

router.post("/:taskId/approvals", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  const [parentTask] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
  if (!parentTask) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (parentTask.isApprovalTask) {
    res.status(400).json({ error: "Cannot add approvers to an approval task" });
    return;
  }

  const parsed = addApproverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const { approverId, dueDate } = parsed.data;

  const existing = await db
    .select({ id: tasks.id, assignedTo: tasks.assignedTo })
    .from(tasks)
    .where(and(eq(tasks.parentTaskId, taskId), eq(tasks.isApprovalTask, true)));
  if (existing.length >= MAX_APPROVERS) {
    res.status(400).json({ error: `Maximum of ${MAX_APPROVERS} approvers allowed` });
    return;
  }

  const alreadyApprover = existing.some(t => t.assignedTo === approverId);
  if (alreadyApprover) {
    res.status(400).json({ error: "This member is already an approver for this task" });
    return;
  }

  const [approverMember] = await db
    .select({ name: users.name, avatarUrl: users.avatarUrl })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, approverId)))
    .limit(1);
  if (!approverMember) {
    res.status(400).json({ error: "Approver must be a member of this workspace" });
    return;
  }

  const nextOrder = existing.length;

  // Capture chain state before inserting so we know the old terminal
  const oldChainInfoAdd = await getApprovalChainInfo(taskId);
  const oldTerminalCardIdAdd = oldChainInfoAdd
    ? computeTerminalCardId(oldChainInfoAdd.approvalTasksSorted, oldChainInfoAdd.approvalCardByTaskId, oldChainInfoAdd.parentCardId, parentTask.approvalMode ?? 'sequential')
    : null;

  const approvalStatus = getApprovalTaskStatus(parentTask.status);
  const dueDateValue = dueDate !== undefined
    ? parseDateNoon(dueDate)
    : (parentTask.dueDate ?? null);

  const [approvalTask] = await db.insert(tasks).values({
    workspaceId,
    mapId: parentTask.mapId,
    title: `aprovação: ${parentTask.title}`,
    assignedTo: approverId,
    dueDate: dueDateValue,
    priority: "medium",
    status: approvalStatus,
    isApprovalTask: true,
    parentTaskId: taskId,
    approvalOrder: nextOrder,
    overdue: computeOverdue(dueDateValue, approvalStatus),
  }).returning();

  let newApprovalCardId: string | undefined;
  if (parentTask.mapId) {
    const [parentCard] = await db
      .select({ positionX: cards.positionX, positionY: cards.positionY })
      .from(cards)
      .where(eq(cards.taskId, taskId))
      .limit(1);

    const offsetX = 350 + nextOrder * 50;
    const offsetY = 150 + nextOrder * 120;
    const approvalX = parentCard ? parentCard.positionX + offsetX : offsetX;
    const approvalY = parentCard ? parentCard.positionY + offsetY : offsetY;

    const [insertedApprovalCard] = await db.insert(cards).values({
      mapId: parentTask.mapId,
      title: `aprovação: ${parentTask.title}`,
      positionX: approvalX,
      positionY: approvalY,
      taskId: approvalTask.id,
      statusVisual: toVisualStatus(approvalStatus, computeOverdue(dueDateValue, approvalStatus)),
    }).returning({ id: cards.id });
    newApprovalCardId = insertedApprovalCard?.id;
  }

  // Reroute downstream connections to the new terminal
  if (oldChainInfoAdd && oldTerminalCardIdAdd && newApprovalCardId) {
    const newApprovalTasks = [...oldChainInfoAdd.approvalTasksSorted, { id: approvalTask.id, approvalOrder: nextOrder }];
    const newApprovalCardByTaskId = new Map(oldChainInfoAdd.approvalCardByTaskId);
    newApprovalCardByTaskId.set(approvalTask.id, newApprovalCardId);
    const newChainCardIds = new Set<string>([oldChainInfoAdd.parentCardId, ...newApprovalCardByTaskId.values()]);
    const newTerminalCardId = computeTerminalCardId(newApprovalTasks, newApprovalCardByTaskId, oldChainInfoAdd.parentCardId, parentTask.approvalMode ?? 'sequential');
    await rerouteDownstreamConnections(oldTerminalCardIdAdd, newTerminalCardId, newChainCardIds);
  }

  res.status(201).json({
    id: approvalTask.id,
    title: approvalTask.title,
    status: approvalTask.status,
    approvalOrder: approvalTask.approvalOrder,
    approvalStatus: approvalTask.approvalStatus,
    dueDate: approvalTask.dueDate,
    assignedTo: approvalTask.assignedTo,
    approverName: approverMember.name,
    approverAvatarUrl: approverMember.avatarUrl,
  });
});

router.delete("/:taskId/approvals/:approvalTaskId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId, approvalTaskId } = req.params;

  const [parentTask] = await db.select({ id: tasks.id, approvalMode: tasks.approvalMode }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
  if (!parentTask) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [approvalTask] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(
      eq(tasks.id, approvalTaskId),
      eq(tasks.parentTaskId, taskId),
      eq(tasks.isApprovalTask, true),
      eq(tasks.workspaceId, workspaceId),
    ))
    .limit(1);
  if (!approvalTask) {
    res.status(404).json({ error: "Approval task not found" });
    return;
  }

  // Capture chain state and identify downstream connections before deleting
  const chainInfoDel = await getApprovalChainInfo(taskId);
  const oldTerminalCardIdDel = chainInfoDel
    ? computeTerminalCardId(chainInfoDel.approvalTasksSorted, chainInfoDel.approvalCardByTaskId, chainInfoDel.parentCardId, parentTask.approvalMode ?? 'sequential')
    : null;
  const deletedCardId = chainInfoDel?.approvalCardByTaskId.get(approvalTask.id);
  const isTerminalBeingDeleted = deletedCardId && deletedCardId === oldTerminalCardIdDel;

  // Save downstream targets from the deleted (terminal) card before CASCADE removes them
  let downstreamTargets: Array<{ targetCardId: string; sourceHandle: string | null; targetHandle: string | null }> = [];
  if (isTerminalBeingDeleted && deletedCardId && chainInfoDel) {
    const conns = await db
      .select({ targetCardId: cardConnections.targetCardId, sourceHandle: cardConnections.sourceHandle, targetHandle: cardConnections.targetHandle })
      .from(cardConnections)
      .where(eq(cardConnections.sourceCardId, deletedCardId));
    downstreamTargets = conns.filter(c => !chainInfoDel.chainCardIds.has(c.targetCardId));
  }

  await db.delete(cards).where(eq(cards.taskId, approvalTask.id));
  await db.delete(tasks).where(eq(tasks.id, approvalTask.id));

  const remaining = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.parentTaskId, taskId), eq(tasks.isApprovalTask, true)))
    .orderBy(asc(tasks.approvalOrder));

  for (let i = 0; i < remaining.length; i++) {
    await db.update(tasks).set({ approvalOrder: i }).where(eq(tasks.id, remaining[i].id));
  }

  // Reconnect downstream targets from new terminal (if deleted card was terminal)
  if (isTerminalBeingDeleted && downstreamTargets.length > 0 && chainInfoDel) {
    const remainingApprovalTasks = chainInfoDel.approvalTasksSorted.filter(t => t.id !== approvalTask.id);
    const remainingApprovalCardByTaskId = new Map(chainInfoDel.approvalCardByTaskId);
    remainingApprovalCardByTaskId.delete(approvalTask.id);
    const newTerminalCardId = computeTerminalCardId(remainingApprovalTasks, remainingApprovalCardByTaskId, chainInfoDel.parentCardId, parentTask.approvalMode ?? 'sequential');
    const [terminalCardRow] = await db.select({ mapId: cards.mapId }).from(cards).where(eq(cards.id, newTerminalCardId)).limit(1);
    if (terminalCardRow) {
      for (const t of downstreamTargets) {
        const [existing] = await db
          .select({ id: cardConnections.id })
          .from(cardConnections)
          .where(and(eq(cardConnections.sourceCardId, newTerminalCardId), eq(cardConnections.targetCardId, t.targetCardId)))
          .limit(1);
        if (!existing) {
          await db.insert(cardConnections).values({
            mapId: terminalCardRow.mapId,
            sourceCardId: newTerminalCardId,
            targetCardId: t.targetCardId,
            sourceHandle: t.sourceHandle,
            targetHandle: t.targetHandle,
          });
        }
      }
    }
  }

  res.json({ success: true });
});

const reorderApprovalsSchema = z.object({
  orderedIds: z.array(z.string().uuid()),
});

router.put("/:taskId/approvals/reorder", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  const [parentTask] = await db.select({ id: tasks.id, approvalMode: tasks.approvalMode }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
  if (!parentTask) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const parsed = reorderApprovalsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error" });
    return;
  }

  const existingApprovals = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.parentTaskId, taskId), eq(tasks.isApprovalTask, true)));

  const existingIds = new Set(existingApprovals.map(t => t.id));
  const orderedIds = parsed.data.orderedIds;

  const hasDuplicates = new Set(orderedIds).size !== orderedIds.length;
  const sameSet = orderedIds.length === existingIds.size && orderedIds.every(id => existingIds.has(id));
  if (hasDuplicates || !sameSet) {
    res.status(400).json({ error: "orderedIds must contain exactly the approval task IDs for this task, without duplicates" });
    return;
  }

  // Capture chain state before reordering to know the old terminal
  const chainInfoReorder = await getApprovalChainInfo(taskId);
  const mode = parentTask.approvalMode ?? 'sequential';
  const oldTerminalCardIdReorder = chainInfoReorder
    ? computeTerminalCardId(chainInfoReorder.approvalTasksSorted, chainInfoReorder.approvalCardByTaskId, chainInfoReorder.parentCardId, mode)
    : null;

  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(tasks)
      .set({ approvalOrder: i })
      .where(and(eq(tasks.id, orderedIds[i]), eq(tasks.parentTaskId, taskId)));
  }

  // Compute new terminal after reorder and reroute downstream connections
  if (chainInfoReorder && oldTerminalCardIdReorder) {
    const newOrderedApprovalTasks = orderedIds.map((id, i) => ({ id, approvalOrder: i }));
    const newTerminalCardId = computeTerminalCardId(newOrderedApprovalTasks, chainInfoReorder.approvalCardByTaskId, chainInfoReorder.parentCardId, mode);
    await rerouteDownstreamConnections(oldTerminalCardIdReorder, newTerminalCardId, chainInfoReorder.chainCardIds);
  }

  res.json({ success: true });
});

const approvalDecisionSchema = z.object({
  comment: z.string().nullable().optional(),
});

router.post("/:taskId/approve", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  const parsed = approvalDecisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error" });
    return;
  }

  const [approvalTask] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId), eq(tasks.isApprovalTask, true)))
    .limit(1);

  if (!approvalTask) {
    res.status(404).json({ error: "Approval task not found" });
    return;
  }

  const comment = parsed.data.comment ?? null;

  const [updated] = await db
    .update(tasks)
    .set({
      status: "completed",
      approvalStatus: "approved",
      approvalComment: comment,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId))
    .returning();

  await syncCardVisual(taskId, updated.status, !!updated.overdue);

  const [actorUserApprove] = await db.select({ name: users.name }).from(users).where(eq(users.id, req.user!.userId)).limit(1);

  await db.insert(taskActivities).values({
    taskId,
    actorId: req.user!.userId,
    type: "task_approved",
    metadata: {
      actorName: actorUserApprove?.name ?? null,
      comment: comment,
    },
  });

  if (approvalTask.parentTaskId) {
    await db.insert(taskActivities).values({
      taskId: approvalTask.parentTaskId,
      actorId: req.user!.userId,
      type: "approval_comment",
      metadata: {
        actorName: actorUserApprove?.name ?? null,
        decision: "approved",
        comment: comment,
        approvalTaskTitle: approvalTask.title,
      },
    });

    // Check if all sibling approval tasks are now approved.
    // Use both status=completed AND approvalStatus=approved to be cycle-safe:
    // a sibling may have approvalStatus="approved" from a previous cycle if the parent was reset.
    const allSiblings = await db
      .select({ id: tasks.id, status: tasks.status, approvalStatus: tasks.approvalStatus, approvalOrder: tasks.approvalOrder, dueDate: tasks.dueDate })
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, approvalTask.parentTaskId), eq(tasks.isApprovalTask, true)))
      .orderBy(asc(tasks.approvalOrder));

    const [parentTaskForMode] = await db
      .select({ approvalMode: tasks.approvalMode })
      .from(tasks)
      .where(eq(tasks.id, approvalTask.parentTaskId))
      .limit(1);
    const parentApprovalMode = parentTaskForMode?.approvalMode ?? "sequential";

    const allApproved = allSiblings.every(
      (t) => t.id === taskId
        ? true
        : (t.status === "completed" && t.approvalStatus === "approved")
    );

    if (!allApproved && parentApprovalMode === "sequential") {
      // In sequential mode, after one approver completes, activate the next pending task in order.
      const nextPending = allSiblings.find(
        (t) => t.id !== taskId && t.status === "pending" && (t.approvalOrder ?? 0) > (approvalTask.approvalOrder ?? -1)
      );
      if (nextPending) {
        const nextOverdue = computeOverdue(nextPending.dueDate, "in_progress");
        await db.update(tasks)
          .set({ status: "in_progress", overdue: nextOverdue, updatedAt: new Date() })
          .where(eq(tasks.id, nextPending.id));
        await syncCardVisual(nextPending.id, "in_progress", nextOverdue);
      }
    }

    if (allApproved) {
      // Set parentApprovalStatus to "approved" on the parent task
      await db.update(tasks)
        .set({ parentApprovalStatus: "approved", updatedAt: new Date() })
        .where(eq(tasks.id, approvalTask.parentTaskId));

      // Trigger downstream activation from the terminal card of the approval chain.
      // Downstream connections are re-routed to the terminal approval card when approvers
      // are added/reordered, so we must activate from there (not the parent card).
      const chainInfo = await getApprovalChainInfo(approvalTask.parentTaskId);
      const terminalCardId = chainInfo
        ? computeTerminalCardId(chainInfo.approvalTasksSorted, chainInfo.approvalCardByTaskId, chainInfo.parentCardId, parentApprovalMode)
        : null;

      if (terminalCardId) {
        // Find all outgoing connections from right handle of the terminal card
        const outgoingConnections = await db
          .select()
          .from(cardConnections)
          .where(and(
            eq(cardConnections.sourceCardId, terminalCardId),
            eq(cardConnections.sourceHandle, "source-right"),
          ));

        for (const conn of outgoingConnections) {
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

          if (!targetTask || targetTask.status !== "pending") continue;

          const prerequisites = await db
            .select()
            .from(cardConnections)
            .where(and(
              eq(cardConnections.targetCardId, conn.targetCardId),
              eq(cardConnections.targetHandle, "target-left"),
            ));

          let allPrerequisitesDone = true;
          for (const prereq of prerequisites) {
            const [prereqCard] = await db
              .select()
              .from(cards)
              .where(eq(cards.id, prereq.sourceCardId))
              .limit(1);

            if (!prereqCard?.taskId) {
              allPrerequisitesDone = false;
              break;
            }

            const [prereqTask] = await db
              .select()
              .from(tasks)
              .where(eq(tasks.id, prereqCard.taskId))
              .limit(1);

            if (!prereqTask || (prereqTask.status !== "completed" && prereqTask.status !== "blocked")) {
              allPrerequisitesDone = false;
              break;
            }
          }

          if (!allPrerequisitesDone) continue;

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
    }
  }

  res.json(updated);
});

router.post("/:taskId/reject", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  const parsed = approvalDecisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error" });
    return;
  }

  const [approvalTask] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId), eq(tasks.isApprovalTask, true)))
    .limit(1);

  if (!approvalTask) {
    res.status(404).json({ error: "Approval task not found" });
    return;
  }

  const comment = parsed.data.comment ?? null;

  const [updated] = await db
    .update(tasks)
    .set({
      status: "pending",
      approvalStatus: "rejected",
      approvalComment: comment,
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId))
    .returning();

  await syncCardVisual(taskId, updated.status, !!updated.overdue);

  const [actorUserReject] = await db.select({ name: users.name }).from(users).where(eq(users.id, req.user!.userId)).limit(1);

  await db.insert(taskActivities).values({
    taskId,
    actorId: req.user!.userId,
    type: "task_rejected",
    metadata: {
      actorName: actorUserReject?.name ?? null,
      comment: comment,
    },
  });

  if (approvalTask.parentTaskId) {
    const [parentTask] = await db
      .select({ id: tasks.id, status: tasks.status, dueDate: tasks.dueDate })
      .from(tasks)
      .where(eq(tasks.id, approvalTask.parentTaskId))
      .limit(1);

    // Set parentApprovalStatus to "rejected" and return parent to "in_progress"
    const parentOverdue = computeOverdue(parentTask?.dueDate ?? null, "in_progress");
    const parentUpdateData: Record<string, any> = {
      parentApprovalStatus: "rejected",
      updatedAt: new Date(),
    };
    if (parentTask && parentTask.status !== "in_progress") {
      parentUpdateData.status = "in_progress";
      parentUpdateData.overdue = parentOverdue;
    }
    await db.update(tasks)
      .set(parentUpdateData)
      .where(eq(tasks.id, approvalTask.parentTaskId));

    if (parentUpdateData.status === "in_progress") {
      await syncCardVisual(approvalTask.parentTaskId, "in_progress", parentOverdue);
    }

    // Reset all sibling approval task decisions (except the rejected one which keeps its decision)
    // so that in the next cycle all approvers must re-approve from a clean state.
    const siblingApprovalTasks = await db
      .select({ id: tasks.id, overdue: tasks.overdue })
      .from(tasks)
      .where(and(
        eq(tasks.parentTaskId, approvalTask.parentTaskId),
        eq(tasks.isApprovalTask, true),
        ne(tasks.id, taskId),
      ));
    const siblingIds = siblingApprovalTasks.map(s => s.id);
    if (siblingIds.length > 0) {
      await db.update(tasks)
        .set({ approvalStatus: null, approvalComment: null, status: "pending", completedAt: null, updatedAt: new Date() })
        .where(inArray(tasks.id, siblingIds));
      for (const sibling of siblingApprovalTasks) {
        await syncCardVisual(sibling.id, "pending", !!sibling.overdue);
      }
    }

    await db.insert(taskActivities).values({
      taskId: approvalTask.parentTaskId,
      actorId: req.user!.userId,
      type: "approval_comment",
      metadata: {
        actorName: actorUserReject?.name ?? null,
        decision: "rejected",
        comment: comment,
        approvalTaskTitle: approvalTask.title,
      },
    });
  }

  res.json(updated);
});

const patchApprovalModeSchema = z.object({
  approvalMode: z.enum(["sequential", "parallel"]),
});

router.patch("/:taskId/approval-mode", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  const parsed = patchApprovalModeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error" });
    return;
  }

  const newMode = parsed.data.approvalMode;

  // Capture chain state and old terminal before changing mode
  const [currentTask] = await db.select({ approvalMode: tasks.approvalMode }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
  const chainInfoMode = currentTask ? await getApprovalChainInfo(taskId) : null;
  const oldTerminalCardIdMode = chainInfoMode
    ? computeTerminalCardId(chainInfoMode.approvalTasksSorted, chainInfoMode.approvalCardByTaskId, chainInfoMode.parentCardId, currentTask!.approvalMode ?? 'sequential')
    : null;

  const [updated] = await db.update(tasks)
    .set({ approvalMode: newMode, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .returning({ id: tasks.id, approvalMode: tasks.approvalMode });

  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Reroute downstream connections if the terminal changed due to mode switch
  if (chainInfoMode && oldTerminalCardIdMode) {
    const newTerminalCardId = computeTerminalCardId(chainInfoMode.approvalTasksSorted, chainInfoMode.approvalCardByTaskId, chainInfoMode.parentCardId, newMode);
    await rerouteDownstreamConnections(oldTerminalCardIdMode, newTerminalCardId, chainInfoMode.chainCardIds);
  }

  res.json(updated);
});

const CARD_WIDTH = 240;
const CARD_GAP = 50;

function findFreeX(idealX: number, occupiedXs: number[]): number {
  let candidateX = idealX;
  const step = CARD_WIDTH + CARD_GAP;
  let attempts = 0;
  while (attempts < 50) {
    const collides = occupiedXs.some((ox) => Math.abs(ox - candidateX) < CARD_WIDTH);
    if (!collides) return candidateX;
    candidateX += step;
    attempts++;
  }
  return candidateX;
}

router.post("/:taskId/duplicate", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  const [original] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);

  if (!original) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [originalSubtasks, originalApprovalTasks, originalCardRow] = await Promise.all([
    db.select().from(subtasks).where(eq(subtasks.taskId, taskId)).orderBy(asc(subtasks.order), asc(subtasks.createdAt)),
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, taskId), eq(tasks.isApprovalTask, true)))
      .orderBy(asc(tasks.approvalOrder)),
    original.mapId
      ? db.select({ description: cards.description }).from(cards).where(eq(cards.taskId, taskId)).limit(1)
      : Promise.resolve([]),
  ]);

  const effectiveDescription = originalCardRow[0]?.description ?? original.description;

  const result = await db.transaction(async (tx) => {
    const [newTask] = await tx.insert(tasks).values({
      workspaceId: original.workspaceId,
      mapId: original.mapId,
      title: original.title,
      description: effectiveDescription,
      assignedTo: original.assignedTo,
      priority: original.priority ?? "medium",
      status: "draft",
      approvalMode: original.approvalMode,
      overdue: false,
    }).returning();

    if (originalSubtasks.length > 0) {
      await tx.insert(subtasks).values(
        originalSubtasks.map((s) => ({
          taskId: newTask.id,
          text: s.text,
          completed: s.completed,
          order: s.order,
        }))
      );
    }

    let newTaskCardId: string | undefined;
    let originalCardPositionX = 0;
    let originalCardPositionY = 0;

    if (original.mapId) {
      const [originalCard, allMapCards] = await Promise.all([
        tx
          .select({ positionX: cards.positionX, positionY: cards.positionY })
          .from(cards)
          .where(eq(cards.taskId, taskId))
          .limit(1),
        tx
          .select({ positionX: cards.positionX })
          .from(cards)
          .where(eq(cards.mapId, original.mapId)),
      ]);

      if (originalCard[0]) {
        originalCardPositionX = originalCard[0].positionX;
        originalCardPositionY = originalCard[0].positionY;
      }

      const occupiedXs = allMapCards.map((c) => c.positionX);
      const idealX = originalCardPositionX + CARD_WIDTH + CARD_GAP;
      const newCardX = findFreeX(idealX, occupiedXs);
      const newCardY = originalCardPositionY;

      const [newCard] = await tx.insert(cards).values({
        mapId: original.mapId,
        title: newTask.title,
        description: newTask.description,
        positionX: newCardX,
        positionY: newCardY,
        taskId: newTask.id,
        statusVisual: "draft",
      }).returning({ id: cards.id });

      newTaskCardId = newCard?.id;
      occupiedXs.push(newCardX);
    }

    for (const approvalTask of originalApprovalTasks) {
      const [newApprovalTask] = await tx.insert(tasks).values({
        workspaceId: original.workspaceId,
        mapId: original.mapId,
        title: approvalTask.title,
        assignedTo: approvalTask.assignedTo,
        priority: "medium",
        status: "draft",
        isApprovalTask: true,
        parentTaskId: newTask.id,
        approvalOrder: approvalTask.approvalOrder,
        overdue: false,
      }).returning();

      if (original.mapId && newTaskCardId) {
        const [originalApprovalCard, allMapCards] = await Promise.all([
          tx
            .select({ positionX: cards.positionX, positionY: cards.positionY })
            .from(cards)
            .where(eq(cards.taskId, approvalTask.id))
            .limit(1),
          tx
            .select({ positionX: cards.positionX })
            .from(cards)
            .where(eq(cards.mapId, original.mapId)),
        ]);

        const occupiedXs = allMapCards.map((c) => c.positionX);

        let approvalCardY: number;
        let idealApprovalX: number;

        if (originalApprovalCard[0]) {
          idealApprovalX = originalApprovalCard[0].positionX + CARD_WIDTH + CARD_GAP;
          approvalCardY = originalApprovalCard[0].positionY;
        } else {
          const offsetX = 350 + (approvalTask.approvalOrder ?? 0) * 50;
          const offsetY = 150 + (approvalTask.approvalOrder ?? 0) * 120;
          idealApprovalX = originalCardPositionX + CARD_WIDTH + CARD_GAP + offsetX;
          approvalCardY = originalCardPositionY + offsetY;
        }

        const approvalCardX = findFreeX(idealApprovalX, occupiedXs);

        await tx.insert(cards).values({
          mapId: original.mapId,
          title: newApprovalTask.title,
          positionX: approvalCardX,
          positionY: approvalCardY,
          taskId: newApprovalTask.id,
          statusVisual: "draft",
        });
      }
    }

    await tx.insert(taskActivities).values({
      taskId: newTask.id,
      actorId: req.user!.userId,
      type: "task_duplicated",
      metadata: { originalTaskId: taskId, workspaceId },
    });

    return { newTask, newTaskCardId };
  });

  res.status(201).json({
    id: result.newTask.id,
    cardId: result.newTaskCardId ?? null,
    title: result.newTask.title,
    description: result.newTask.description,
    status: result.newTask.status,
    priority: result.newTask.priority,
    assignedTo: result.newTask.assignedTo,
    workspaceId: result.newTask.workspaceId,
    mapId: result.newTask.mapId,
    approvalMode: result.newTask.approvalMode,
    createdAt: result.newTask.createdAt,
  });
});

const createAttachmentSchema = z.object({
  objectPath: z.string().min(1),
  fileName: z.string().min(1),
  fileSize: z.number().int().positive(),
  mimeType: z.string().min(1),
});

router.get("/:taskId/attachments", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  const [taskExists] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
  if (!taskExists) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const attachments = await db
    .select({
      id: attachmentLinks.id,
      fileUploadId: fileUploads.id,
      objectPath: fileUploads.objectPath,
      fileName: fileUploads.fileName,
      fileSize: fileUploads.fileSize,
      mimeType: fileUploads.mimeType,
      uploadedBy: fileUploads.uploadedBy,
      createdAt: attachmentLinks.createdAt,
    })
    .from(attachmentLinks)
    .innerJoin(fileUploads, eq(fileUploads.id, attachmentLinks.fileUploadId))
    .where(and(eq(attachmentLinks.entityType, "task"), eq(attachmentLinks.entityId, taskId)))
    .orderBy(asc(attachmentLinks.createdAt));

  res.json(attachments);
});

router.post("/:taskId/attachments", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;
  const actorId = req.user!.userId;

  const parsed = createAttachmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const [taskExists] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
  if (!taskExists) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const { objectPath, fileName, fileSize, mimeType } = parsed.data;

  const [fileUpload] = await db.insert(fileUploads).values({
    objectPath,
    fileName,
    fileSize,
    mimeType,
    uploadedBy: actorId,
  }).returning();

  const [link] = await db.insert(attachmentLinks).values({
    fileUploadId: fileUpload.id,
    entityType: "task",
    entityId: taskId,
  }).returning();

  res.status(201).json({
    id: link.id,
    fileUploadId: fileUpload.id,
    objectPath: fileUpload.objectPath,
    fileName: fileUpload.fileName,
    fileSize: fileUpload.fileSize,
    mimeType: fileUpload.mimeType,
    uploadedBy: fileUpload.uploadedBy,
    createdAt: link.createdAt,
  });
});

router.delete("/:taskId/attachments/:attachmentId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId, attachmentId } = req.params;

  const [taskExists] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
  if (!taskExists) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [link] = await db
    .select({ id: attachmentLinks.id, fileUploadId: attachmentLinks.fileUploadId })
    .from(attachmentLinks)
    .where(and(eq(attachmentLinks.id, attachmentId), eq(attachmentLinks.entityType, "task"), eq(attachmentLinks.entityId, taskId)))
    .limit(1);

  if (!link) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }

  await db.delete(attachmentLinks).where(eq(attachmentLinks.id, link.id));

  const [otherLinks] = await db
    .select({ id: attachmentLinks.id })
    .from(attachmentLinks)
    .where(eq(attachmentLinks.fileUploadId, link.fileUploadId))
    .limit(1);

  if (!otherLinks) {
    await db.delete(fileUploads).where(eq(fileUploads.id, link.fileUploadId));
  }

  res.json({ success: true });
});

const objectStorageService = new ObjectStorageService();

router.get("/:taskId/attachments/:attachmentId/download", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId, attachmentId } = req.params;

  const [taskExists] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
  if (!taskExists) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [attachment] = await db
    .select({
      id: attachmentLinks.id,
      objectPath: fileUploads.objectPath,
      fileName: fileUploads.fileName,
      mimeType: fileUploads.mimeType,
    })
    .from(attachmentLinks)
    .innerJoin(fileUploads, eq(fileUploads.id, attachmentLinks.fileUploadId))
    .where(and(eq(attachmentLinks.id, attachmentId), eq(attachmentLinks.entityType, "task"), eq(attachmentLinks.entityId, taskId)))
    .limit(1);

  if (!attachment) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }

  try {
    const objectFile = await objectStorageService.getObjectEntityFile(attachment.objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    const encoded = encodeURIComponent(attachment.fileName).replace(/'/g, "%27");
    res.setHeader("Content-Disposition", `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`);
    res.setHeader("Content-Type", attachment.mimeType || "application/octet-stream");
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "content-disposition" && key.toLowerCase() !== "content-type") {
        res.setHeader(key, value);
      }
    });
    res.status(200);

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error("Error downloading attachment:", error);
    res.status(500).json({ error: "Failed to download attachment" });
  }
});

export default router;
