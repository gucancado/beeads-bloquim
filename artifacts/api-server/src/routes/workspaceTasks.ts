import { Router, IRouter } from "express";
import { Readable } from "stream";
import { db } from "@workspace/db";
import { tasks, cards, maps, workspaces, workspaceMembers, users, subtasks, taskActivities, cardConnections, fileUploads, attachmentLinks } from "@workspace/db/schema";
import type { RecurrenceConfig } from "@workspace/db/schema";
import { eq, and, isNull, or, inArray, asc, sql, count, desc, isNotNull, not, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { logger } from "../lib/logger";

const log = logger.child({ module: "workspaceTasks" });
import { requireWorkspaceRole } from "../middlewares/permissions";
import { z } from "zod";
import { computeOverdue } from "../lib/overdue";
import { calculateNextDueDate } from "../lib/recurrence";
import { duplicateRecurringTask } from "../lib/duplicateRecurring";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  getApprovalChainInfo,
  computeTerminalCardId,
  rerouteDownstreamConnections,
} from "../services/approvalChainService";
import {
  parseDateNoon,
  toVisualStatus,
  syncCardVisual,
} from "../services/taskVisualSyncService";
import {
  taskBelongsToWorkspace,
  listTaskAttachments,
  createTaskAttachment,
  deleteTaskAttachment,
  getTaskAttachmentForDownload,
} from "../services/taskAttachmentsService";
import {
  approveApprovalTask,
  rejectApprovalTask,
} from "../services/approvalActionService";
import {
  MAX_APPROVERS,
  getApprovalTaskStatus,
  addApprover,
  deleteApprover,
  reorderApprovals,
  setApprovalMode,
} from "../services/approvalCrudService";
import {
  listSubtasks,
  replaceSubtasks,
  createSubtask,
  updateSubtask,
  deleteSubtask,
} from "../services/taskSubtasksService";
import { duplicateTask } from "../services/taskDuplicateService";
import { patchTaskStatus } from "../services/taskStatusService";

type TaskStatus = "pending" | "in_progress" | "completed" | "overdue" | "blocked" | "draft";

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

  const parentTasks = alias(tasks, "parent_tasks");
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
      parentTaskTitle: parentTasks.title,
      parentApprovalStatus: tasks.parentApprovalStatus,
      cardId: cards.id,
      cardTitle: cards.title,
      mapName: maps.name,
      workspaceColorIndex: workspaces.colorIndex,
      assigneeName: users.name,
      assigneeAvatarUrl: users.avatarUrl,
      attachmentCount: sql<number>`(SELECT COUNT(*) FROM attachment_links WHERE entity_type = 'task' AND entity_id = ${tasks.id})`,
      subtaskCount: sql<number>`(SELECT COUNT(*) FROM subtasks WHERE task_id = ${tasks.id})`,
      subtaskCompletedCount: sql<number>`(SELECT COUNT(*) FROM subtasks WHERE task_id = ${tasks.id} AND completed = true)`,
      commentCount: sql<number>`((SELECT COUNT(*) FROM task_comments WHERE task_id = ${tasks.id}) + (SELECT COUNT(*) FROM task_comments tc JOIN tasks ct ON ct.id = tc.task_id WHERE ct.parent_task_id = ${tasks.id} AND ct.is_approval_task = true))`,
    })
    .from(tasks)
    .leftJoin(cards, eq(cards.taskId, tasks.id))
    .leftJoin(maps, eq(maps.id, tasks.mapId))
    .leftJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .leftJoin(parentTasks, eq(parentTasks.id, tasks.parentTaskId))
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

  const { title, description, dueDate, priority, isRecurring, recurrenceConfig } = parsed.data;

  const dueDateValue = parseDateNoon(dueDate);
  const overdueValue = computeOverdue(dueDateValue, "draft");

  const actorId = req.user!.userId;
  const assignedTo = parsed.data.assignedTo === undefined ? actorId : parsed.data.assignedTo;

  const [task] = await db
    .insert(tasks)
    .values({
      workspaceId,
      title,
      description: description ?? null,
      assignedTo,
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

  if (existing.isApprovalTask && parsed.data.title !== undefined) {
    res.status(400).json({ error: "Approval task title is read-only", message: "não é permitido alterar o título de tarefas de aprovação" });
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

  const result = await patchTaskStatus(workspaceId, taskId, actorId, parsed.data);
  res.status(result.status).json(result.body);
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
  const result = await listSubtasks(workspaceId, taskId);
  res.status(result.status).json(result.body);
});

router.put("/:taskId/subtasks", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  const parsed = bulkSubtasksSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const result = await replaceSubtasks(workspaceId, taskId, parsed.data.subtasks);
  res.status(result.status).json(result.body);
});

router.post("/:taskId/subtasks", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  const parsed = createSubtaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const result = await createSubtask(workspaceId, taskId, parsed.data);
  res.status(result.status).json(result.body);
});

router.patch("/:taskId/subtasks/:subtaskId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId, subtaskId } = req.params;

  const parsed = updateSubtaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const result = await updateSubtask(workspaceId, taskId, subtaskId, parsed.data);
  res.status(result.status).json(result.body);
});

router.delete("/:taskId/subtasks/:subtaskId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId, subtaskId } = req.params;
  const result = await deleteSubtask(workspaceId, taskId, subtaskId);
  res.status(result.status).json(result.body);
});

// MAX_APPROVERS and getApprovalTaskStatus are now imported from
// services/approvalCrudService (see top of file).

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

  const parsed = addApproverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const result = await addApprover(workspaceId, taskId, parsed.data);
  res.status(result.status).json(result.body);
});

router.delete("/:taskId/approvals/:approvalTaskId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId, approvalTaskId } = req.params;
  const result = await deleteApprover(workspaceId, taskId, approvalTaskId);
  res.status(result.status).json(result.body);
});

const reorderApprovalsSchema = z.object({
  orderedIds: z.array(z.string().uuid()),
});

router.put("/:taskId/approvals/reorder", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  const parsed = reorderApprovalsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error" });
    return;
  }

  const result = await reorderApprovals(workspaceId, taskId, parsed.data.orderedIds);
  res.status(result.status).json(result.body);
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

  const result = await approveApprovalTask(
    workspaceId,
    taskId,
    req.user!.userId,
    parsed.data.comment ?? null,
  );
  if (!result) {
    res.status(404).json({ error: "Approval task not found" });
    return;
  }
  res.json(result.updated);
});

// (legacy inline approve body kept below by mistake — replaced by service call above)
router.post("/:taskId/reject", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  const parsed = approvalDecisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error" });
    return;
  }

  const result = await rejectApprovalTask(
    workspaceId,
    taskId,
    req.user!.userId,
    parsed.data.comment ?? null,
  );
  if (!result) {
    res.status(404).json({ error: "Approval task not found" });
    return;
  }
  res.json(result.updated);
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

  const result = await setApprovalMode(workspaceId, taskId, parsed.data.approvalMode);
  res.status(result.status).json(result.body);
});

router.post("/:taskId/duplicate", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;
  const result = await duplicateTask(workspaceId, taskId, req.user!.userId);
  res.status(result.status).json(result.body);
});

const createAttachmentSchema = z.object({
  objectPath: z.string().min(1),
  fileName: z.string().min(1),
  fileSize: z.number().int().positive(),
  mimeType: z.string().min(1),
});

router.get("/:taskId/attachments", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json(await listTaskAttachments(taskId));
});

router.post("/:taskId/attachments", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;
  const actorId = req.user!.userId;

  const parsed = createAttachmentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const created = await createTaskAttachment(taskId, actorId, parsed.data);
  res.status(201).json(created);
});

router.delete("/:taskId/attachments/:attachmentId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId, attachmentId } = req.params;

  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const deleted = await deleteTaskAttachment(taskId, attachmentId);
  if (!deleted) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }

  res.json({ success: true });
});

const objectStorageService = new ObjectStorageService();

router.get("/:taskId/attachments/:attachmentId/download", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId, attachmentId } = req.params;

  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const attachment = await getTaskAttachmentForDownload(taskId, attachmentId);
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
    log.error({ err: error }, "Error downloading attachment");
    res.status(500).json({ error: "Failed to download attachment" });
  }
});

export default router;
