import { randomUUID } from "node:crypto";
import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { tasks, cards, maps, workspaces, workspaceMembers, users, taskActivities, taskComments, subtasks, attachments } from "@workspace/db/schema";
import type { RecurrenceConfig } from "@workspace/db/schema";
import { eq, and, or, asc, sql, inArray, isNull, count, not, ne, gte, lt, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requireStorage } from "../lib/featureFlags";
import { sanitizeFilename, validateFileUpload } from "@workspace/storage";
import { logger } from "../lib/logger";
import { parseSinceParam, parseUntilParam } from "../lib/queryDates";
import { encodeCursor, decodeCursor } from "../lib/keysetCursor";

const log = logger.child({ module: "myTasks" });
import { computeOverdue } from "../lib/overdue";
import { resolveSchedule, type ScheduleMode } from "../lib/scheduleMode";
import { tryActivateTask } from "../services/taskActivation";
import { calculateNextDueDateInFuture } from "../lib/recurrence";
import { duplicateRecurringTask } from "../lib/duplicateRecurring";
import { z } from "zod";
import { getStorage } from "../lib/storage";
import { parseDateNoon } from "../services/taskVisualSyncService";
import {
  getTaskOwnership,
  listTaskAttachments,
  deleteTaskAttachment,
  getTaskAttachmentForDownload,
  createTaskAttachmentLink,
} from "../services/taskAttachmentsService";
import { recordTaskActivity } from "../services/taskActivitiesService";
import {
  createSubtasksPersonal,
  updateSubtaskPersonal,
  deleteSubtaskPersonal,
} from "../services/taskSubtasksService";
import { moveStandaloneTaskToWorkspace } from "../services/taskMoveService";

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
    .select({ userId: users.id, name: users.name, workspaceId: workspaceMembers.workspaceId, avatarUrl: users.avatarUrl })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(inArray(workspaceMembers.workspaceId, workspaceIds))
    .orderBy(users.name);

  return res.json(members);
});

router.get("/counts", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { assignedTo, dayStart, dayEnd } = req.query as {
    assignedTo?: string;
    dayStart?: string;
    dayEnd?: string;
  };

  const assignees = assignedTo !== undefined ? assignedTo.split(",").filter(Boolean) : ["me"];

  // dayStart/dayEnd vêm do cliente em ISO para que a janela "hoje" siga o
  // fuso do navegador, não o do servidor (Hetzner roda em UTC).
  // Fallback: meia-noite local do servidor.
  const parseBoundary = (raw: string | undefined, fallback: () => Date): Date => {
    if (!raw) return fallback();
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? fallback() : parsed;
  };
  const startOfToday = parseBoundary(dayStart, () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const startOfTomorrow = parseBoundary(dayEnd, () => {
    const d = new Date(startOfToday);
    d.setDate(d.getDate() + 1);
    return d;
  });

  const buildAssigneeFilter = () => {
    if (assignees.length === 0) return undefined;
    const hasMe = assignees.includes("me");
    const hasUnassigned = assignees.includes("unassigned");
    const uuids = assignees.filter(a => a !== "me" && a !== "unassigned");
    const scope = (field: typeof tasks.assignedTo | typeof tasks.ownerId) => {
      const parts = [];
      if (hasMe) parts.push(eq(field, userId));
      if (hasUnassigned) parts.push(isNull(field));
      if (uuids.length > 0) parts.push(inArray(field, uuids));
      return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : or(...parts);
    };
    const assigneeBranch = and(ne(tasks.status, "draft"), scope(tasks.assignedTo));
    const ownerBranch = and(eq(tasks.status, "draft"), scope(tasks.ownerId));
    return or(assigneeBranch, ownerBranch);
  };

  const memberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.hidden, false)));

  const memberWorkspaceIds = memberships.map(m => m.workspaceId);

  const ownershipFilter = memberWorkspaceIds.length > 0
    ? or(inArray(tasks.workspaceId, memberWorkspaceIds), and(isNull(tasks.workspaceId), eq(tasks.assignedTo, userId)))
    : and(isNull(tasks.workspaceId), eq(tasks.assignedTo, userId));

  const baseWhere = and(ownershipFilter, buildAssigneeFilter());

  // Tarefas que NÃO contam pra atrasada/devida-hoje: completed, blocked, draft.
  // Isso bate com o que o usuário vê como "carga ativa".
  const activeOnly = not(inArray(tasks.status, ["completed", "blocked", "draft"]));

  const [statusRows, [extra]] = await Promise.all([
    db
      .select({ status: tasks.status, cnt: count() })
      .from(tasks)
      .where(baseWhere)
      .groupBy(tasks.status),
    db
      .select({
        dueToday: sql<number>`count(*) filter (where ${tasks.dueDate} >= ${startOfToday} and ${tasks.dueDate} < ${startOfTomorrow})::int`,
        overdue: sql<number>`count(*) filter (where ${tasks.overdue} = true)::int`,
      })
      .from(tasks)
      .where(and(baseWhere, activeOnly)),
  ]);

  const result = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    blocked: 0,
    draft: 0,
    dueToday: extra?.dueToday ?? 0,
    overdue: extra?.overdue ?? 0,
  } as Record<string, number>;
  for (const row of statusRows) {
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

  // Pin "urgente" no topo APENAS quando o filtro ativo é um subconjunto de
  // {draft, pending, in_progress} (trabalho ativo). Em outros filtros
  // (completed/blocked/overdue) ou sem filtro, urgente não pina — o usuário
  // está em modo de revisão/histórico, não de execução.
  const ACTIVE_STATUSES = new Set(["draft", "pending", "in_progress"]);
  const pinUrgente =
    statuses.length > 0 && statuses.every(s => ACTIVE_STATUSES.has(s));

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
    const scope = (field: typeof tasks.assignedTo | typeof tasks.ownerId) => {
      const parts = [];
      if (hasMe) parts.push(eq(field, userId));
      if (hasUnassigned) parts.push(isNull(field));
      if (uuids.length > 0) parts.push(inArray(field, uuids));
      return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : or(...parts);
    };
    const assigneeBranch = and(ne(tasks.status, "draft"), scope(tasks.assignedTo));
    const ownerBranch = and(eq(tasks.status, "draft"), scope(tasks.ownerId));
    return or(assigneeBranch, ownerBranch);
  };

  const q = req.query as Record<string, string | undefined>;
  const VALID_PRIORITIES = ["low", "medium", "high", "critical"] as const;
  type ValidPriority = (typeof VALID_PRIORITIES)[number];
  const priorities = (q.priority ? q.priority.split(",").filter(Boolean) : []) as string[];
  if (priorities.some((p) => !VALID_PRIORITIES.includes(p as ValidPriority))) {
    return res.status(400).json({ error: "Validation error", message: `priority aceita: ${VALID_PRIORITIES.join(", ")}` });
  }
  const dateParams = {
    createdSince: parseSinceParam(q.createdSince),
    createdUntil: parseUntilParam(q.createdUntil),
    completedSince: parseSinceParam(q.completedSince),
    completedUntil: parseUntilParam(q.completedUntil),
    dueAfter: parseSinceParam(q.dueAfter),
    dueBefore: parseUntilParam(q.dueBefore),
  };
  const invalidDate = Object.entries(dateParams).find(([, v]) => v === "invalid");
  if (invalidDate) {
    return res.status(400).json({ error: "Validation error", message: `${invalidDate[0]} deve ser ISO 8601 ou YYYY-MM-DD` });
  }
  const dp = dateParams as Record<keyof typeof dateParams, Date | null>;
  const keysetMode = q.cursor !== undefined || q.limit !== undefined;
  const limit = Math.min(Math.max(parseInt(q.limit ?? "100", 10) || 100, 1), 200);
  const cursor = q.cursor ? decodeCursor(q.cursor) : null;
  if (q.cursor && !cursor) {
    return res.status(400).json({ error: "Validation error", message: "cursor inválido" });
  }

  // pg timestamp tem µs; o cursor viaja em ms — truncar no SQL para a
  // igualdade do desempate casar (bug-trap TIMESTAMPTZ µs × JS ms, ver
  // workspaceActivities.ts). tasks.created_at é `timestamp` SEM tz: um JS
  // Date interpolado cru dentro de `sql` cairia no serializador padrão do
  // node-postgres (fuso LOCAL do processo), desalinhando a comparação.
  // Serializar com `.toISOString()` ANTES de interpolar replica o
  // `mapToDriverValue` que os helpers (eq/lt/gte) usariam.
  const cursorCreatedAtIso = cursor?.createdAt.toISOString();
  const cursorCond = cursor
    ? or(
        sql`date_trunc('milliseconds', ${tasks.createdAt}) < ${cursorCreatedAtIso}::timestamp`,
        and(
          sql`date_trunc('milliseconds', ${tasks.createdAt}) = ${cursorCreatedAtIso}::timestamp`,
          lt(tasks.id, cursor.id),
        ),
      )
    : undefined;
  const filterConds = [
    priorities.length > 0 ? inArray(tasks.priority, priorities as ValidPriority[]) : undefined,
    dp.createdSince ? gte(tasks.createdAt, dp.createdSince) : undefined,
    dp.createdUntil ? lt(tasks.createdAt, dp.createdUntil) : undefined,
    dp.completedSince ? gte(tasks.completedAt, dp.completedSince) : undefined,
    dp.completedUntil ? lt(tasks.completedAt, dp.completedUntil) : undefined,
    dp.dueAfter ? gte(tasks.dueDate, dp.dueAfter) : undefined,
    dp.dueBefore ? lt(tasks.dueDate, dp.dueBefore) : undefined,
  ];

  const memberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.hidden, false)));

  const memberWorkspaceIds = memberships.map(m => m.workspaceId);

  const ownershipFilter = memberWorkspaceIds.length > 0
    ? or(
        inArray(tasks.workspaceId, memberWorkspaceIds),
        and(isNull(tasks.workspaceId), eq(tasks.assignedTo, userId))
      )
    : and(isNull(tasks.workspaceId), eq(tasks.assignedTo, userId));

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
      startAt: tasks.startAt,
      scheduleMode: tasks.scheduleMode,
      priority: tasks.priority,
      status: tasks.status,
      completedAt: tasks.completedAt,
      cancelledAt: tasks.cancelledAt,
      // "Bloqueada desde" vem do activity log (último status_changed→blocked),
      // NÃO de tasks.cancelled_at: o bloqueio via canvas (cards.ts) grava o
      // evento mas não a coluna, e a UI, lendo a coluna, mostrava data vazia.
      // NULL quando nunca houve bloqueio → a UI renderiza "—".
      blockedSince: sql<string | null>`(SELECT MAX(a.created_at) FROM task_activities a WHERE a.task_id = ${tasks.id} AND a.type = 'status_changed' AND a.metadata->>'newStatus' = 'blocked')`,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      overdue: tasks.overdue,
      isApprovalTask: tasks.isApprovalTask,
      isRecurring: tasks.isRecurring,
      recurrenceConfig: tasks.recurrenceConfig,
      parentTaskId: tasks.parentTaskId,
      parentTaskTitle: parentTasks.title,
      cardId: cards.id,
      cardTitle: cards.title,
      mapName: maps.name,
      workspaceName: workspaces.name,
      workspaceColorIndex: workspaces.colorIndex,
      assigneeName: users.name,
      assigneeAvatarUrl: users.avatarUrl,
      assigneeClasses: users.classes,
      attachmentCount: sql<number>`(SELECT COUNT(*) FROM task_attachments ta JOIN attachments a ON a.id = ta.attachment_id WHERE ta.task_id = ${tasks.id} AND a.deleted_at IS NULL)`,
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
        ownershipFilter,
        workspaceId ? eq(tasks.workspaceId, workspaceId) : undefined,
        buildStatusFilter(),
        buildAssigneeFilter(),
        not(and(eq(tasks.isApprovalTask, true), eq(tasks.status, "draft"))),
        ...filterConds,
        cursorCond,
      )
    )
    .orderBy(
      ...(keysetMode
        ? [
            // Modo keyset: ORDER BY precisa usar a MESMA chave truncada em ms
            // que o predicado do cursor acima (date_trunc('milliseconds', ...)).
            // O cursor só carrega precisão de ms, então ordenar pela coluna µs
            // crua poderia derrubar uma linha na borda da página quando duas
            // linhas caem no mesmo ms (ver workspaceActivities.ts).
            sql`date_trunc('milliseconds', ${tasks.createdAt}) DESC`,
            desc(tasks.id),
          ]
        : [
            // Modo legado (sem cursor/limit): ordenação rica intacta.
            // "urgente" pin (condicional — ver pinUrgente acima): aplicado só
            // quando o filtro de status é subset de {draft, pending, in_progress}.
            ...(pinUrgente
              ? [sql`CASE WHEN ${tasks.scheduleMode} = 'urgente' THEN 0 ELSE 1 END ASC`]
              : []),
            sql`${tasks.dueDate} ASC NULLS LAST`,
            sql`CASE ${tasks.priority} WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END ASC`,
            asc(tasks.createdAt),
          ]),
    )
    .limit(keysetMode ? limit + 1 : 500);

  if (keysetMode) {
    const hasMore = taskList.length > limit;
    const items = hasMore ? taskList.slice(0, limit) : taskList;
    const last = items[items.length - 1];
    return res.json({ items, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null });
  }
  return res.json(taskList);
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

const createStandaloneTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  startAt: z.string().nullable().optional(),
  scheduleMode: z.enum(["ate", "entre", "em", "sem_prazo", "urgente"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional().default("medium"),
  isRecurring: z.boolean().optional(),
  recurrenceConfig: recurrenceConfigSchema.nullable().optional(),
});

router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const parsed = createStandaloneTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });
  }

  const { title, description, priority, isRecurring, recurrenceConfig } = parsed.data;
  const sched = resolveSchedule(parsed.data, { scheduleMode: "sem_prazo", startAt: null, dueDate: null });
  if (!sched.ok) {
    return res.status(400).json({ message: sched.error });
  }
  const overdueValue = computeOverdue(sched.value.dueDate, "draft");

  const [newTask] = await db.insert(tasks).values({
    workspaceId: null,
    mapId: null,
    title,
    description: description ?? null,
    assignedTo: userId,
    dueDate: sched.value.dueDate,
    startAt: sched.value.startAt,
    scheduleMode: sched.value.scheduleMode,
    priority,
    status: "draft",
    overdue: overdueValue,
    isRecurring: isRecurring ?? false,
    recurrenceConfig: recurrenceConfig ?? null,
    createdBy: userId,
    ownerId: userId,
  }).returning();

  const [actorUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);

  await recordTaskActivity({
    taskId: newTask.id,
    actorId: userId,
    type: "task_created",
    metadata: { actorName: actorUser?.name ?? null },
    source: req.user?.source ?? null,
  });

  return res.status(201).json(newTask);
});

const updateStandaloneTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  startAt: z.string().nullable().optional(),
  scheduleMode: z.enum(["ate", "entre", "em", "sem_prazo", "urgente"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  isRecurring: z.boolean().optional(),
  recurrenceConfig: recurrenceConfigSchema.nullable().optional(),
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

  if (existing.isApprovalTask && parsed.data.title !== undefined) {
    return res.status(400).json({ message: "não é permitido alterar o título de tarefas de aprovação" });
  }

  const { dueDate: _dd, startAt: _sa, scheduleMode: _sm, ...rest } = parsed.data;
  const updateData: Record<string, any> = { ...rest, updatedAt: new Date() };
  const touchesSchedule = "dueDate" in parsed.data || "startAt" in parsed.data || "scheduleMode" in parsed.data;
  if (touchesSchedule) {
    const sched = resolveSchedule(parsed.data, {
      scheduleMode: (existing.scheduleMode ?? "ate") as ScheduleMode,
      startAt: existing.startAt,
      dueDate: existing.dueDate,
    });
    if (!sched.ok) {
      return res.status(400).json({ message: sched.error });
    }
    updateData.dueDate = sched.value.dueDate;
    updateData.startAt = sched.value.startAt;
    updateData.scheduleMode = sched.value.scheduleMode;
    updateData.overdue = computeOverdue(sched.value.dueDate, existing.status ?? "pending");
  }

  const [updated] = await db.update(tasks).set(updateData).where(eq(tasks.id, taskId)).returning();
  if (touchesSchedule) {
    await tryActivateTask(taskId);
  }
  return res.json(updated);
});

const statusSchema = z.object({
  status: z.enum(["pending", "in_progress", "blocked", "completed", "draft"]),
  isRecurring: z.boolean().optional(),
  recurrenceConfig: recurrenceConfigSchema.nullable().optional(),
});

router.patch("/:taskId/status", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Status inválido", errors: parsed.error.flatten() });
  }
  const { status: newStatus, isRecurring: bodyIsRecurring, recurrenceConfig: bodyRecurrenceConfig } = parsed.data;

  const [existing] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!existing) return res.status(404).json({ message: "Tarefa não encontrada" });

  if (existing.workspaceId !== null) {
    return res.status(403).json({ message: "Use a rota do workspace" });
  }
  if (existing.assignedTo !== userId) {
    return res.status(403).json({ message: "Sem permissão" });
  }

  const previousStatus = existing.status;

  const updateData: Record<string, any> = {
    previousStatus,
    status: newStatus,
    updatedAt: new Date(),
    overdue: computeOverdue(existing.dueDate, newStatus),
    completedAt: newStatus === "completed" ? new Date() : null,
    cancelledAt: newStatus === "blocked" ? new Date() : null,
  };
  // If client sends recurrence state alongside status, apply it atomically (prevents race condition)
  if (bodyIsRecurring !== undefined) updateData.isRecurring = bodyIsRecurring;
  if (bodyRecurrenceConfig !== undefined) updateData.recurrenceConfig = bodyRecurrenceConfig ?? null;

  const [updated] = await db.update(tasks).set(updateData).where(eq(tasks.id, taskId)).returning();

  if (previousStatus !== newStatus) {
    const [actorUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    await recordTaskActivity({
      taskId,
      actorId: userId,
      type: "status_changed",
      metadata: {
        actorName: actorUser?.name ?? null,
        oldStatus: previousStatus,
        newStatus,
      },
      source: req.user?.source ?? null,
    });
  }

  // Use the final effective recurrence state (from DB update or existing)
  const effectiveIsRecurring = updated.isRecurring;
  const effectiveRecurrenceConfig = updated.recurrenceConfig;

  // Handle recurrence: when a recurring standalone task transitions INTO completed, duplicate it with the next due date
  if (newStatus === "completed" && previousStatus !== "completed" && effectiveIsRecurring && effectiveRecurrenceConfig && !existing.mapId) {
    const completedAt = updated.completedAt ?? new Date();
    const nextDueDate = calculateNextDueDateInFuture(existing.dueDate, effectiveRecurrenceConfig as RecurrenceConfig, completedAt);
    await duplicateRecurringTask(updated, nextDueDate, userId, existing.workspaceId ?? undefined);
  }

  return res.json(updated);
});

router.get("/:taskId/activities", requireAuth, async (req: AuthRequest, res) => {
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

  const activities = await db
    .select({
      id: taskActivities.id,
      taskId: taskActivities.taskId,
      actorId: taskActivities.actorId,
      actorName: users.name,
      actorAvatarUrl: users.avatarUrl,
      actorClasses: users.classes,
      type: taskActivities.type,
      metadata: taskActivities.metadata,
      createdAt: taskActivities.createdAt,
    })
    .from(taskActivities)
    .leftJoin(users, eq(taskActivities.actorId, users.id))
    .where(eq(taskActivities.taskId, taskId))
    .orderBy(asc(taskActivities.createdAt))
    .limit(200);

  return res.json(activities);
});

const associationSchema = z.object({
  workspaceId: z.string().uuid().nullable().optional(),
  mapId: z.string().uuid().nullable().optional(),
});

router.patch("/:taskId/association", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const parsed = associationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });
  }

  const [existing] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!existing) return res.status(404).json({ message: "Tarefa não encontrada" });

  if (existing.workspaceId !== null) {
    const [membership] = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, existing.workspaceId), eq(workspaceMembers.userId, userId)));
    if (!membership) return res.status(403).json({ message: "Sem permissão" });
  } else {
    if (existing.assignedTo !== userId) return res.status(403).json({ message: "Sem permissão" });
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (parsed.data.workspaceId !== undefined) {
    const newWorkspaceId = parsed.data.workspaceId;
    if (newWorkspaceId !== null) {
      const [membership] = await db
        .select()
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, newWorkspaceId), eq(workspaceMembers.userId, userId)));
      if (!membership) return res.status(403).json({ message: "Você não é membro deste workspace" });
    }
    updateData.workspaceId = newWorkspaceId;
    if (newWorkspaceId === null) {
      updateData.assignedTo = userId;
      updateData.mapId = null;
    }
  }

  if (parsed.data.mapId !== undefined) {
    const targetWorkspaceId = (updateData.workspaceId !== undefined ? updateData.workspaceId : existing.workspaceId) as string | null;
    if (parsed.data.mapId !== null) {
      if (!targetWorkspaceId) {
        return res.status(400).json({ message: "Selecione um workspace antes de associar a um plano" });
      }
      const [map] = await db.select().from(maps).where(and(eq(maps.id, parsed.data.mapId), eq(maps.workspaceId, targetWorkspaceId)));
      if (!map) return res.status(400).json({ message: "Plano não encontrado neste workspace" });
      // Remove recurrence when associating a task with a map
      updateData.isRecurring = false;
      updateData.recurrenceConfig = null;
    }
    updateData.mapId = parsed.data.mapId;
  }

  // Wrap the mutating sequence (UPDATE task + DELETE old card + INSERT new card)
  // in a transaction. Without this, a crash between the DELETE and the INSERT
  // leaves the task pointing at a workspace it has no card in.
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx.update(tasks).set(updateData).where(eq(tasks.id, taskId)).returning();

    const effectiveNewMapId = updateData.mapId !== undefined ? (updateData.mapId as string | null) : existing.mapId;
    const previousMapId = existing.mapId;
    const mapChanged = effectiveNewMapId !== previousMapId;

    if (mapChanged) {
      if (previousMapId) {
        await tx.delete(cards).where(and(eq(cards.mapId, previousMapId), eq(cards.taskId, taskId)));
      }

      if (effectiveNewMapId !== null) {
        const [existingCard] = await tx
          .select({ id: cards.id })
          .from(cards)
          .where(and(eq(cards.mapId, effectiveNewMapId), eq(cards.taskId, taskId)));

        if (!existingCard) {
          const overdue = computeOverdue(existing.dueDate, existing.status ?? "pending");
          const statusVisual = overdue && existing.status !== "completed" && existing.status !== "blocked" && existing.status !== "draft"
            ? "overdue"
            : (existing.status as "pending" | "in_progress" | "completed" | "blocked" | "draft") ?? "pending";

          await tx.insert(cards).values({
            mapId: effectiveNewMapId,
            taskId,
            title: existing.title,
            statusVisual,
            positionX: 0,
            positionY: 0,
          });
        }
      }
    }
    return u;
  });

  return res.json(updated);
});

// ---------------------------------------------------------------------------
// POST /my-tasks/:taskId/move-to-workspace
//
// Dedicated, one-way (standalone → workspace) move that emits a task_moved
// activity and allows reassignment to any member of the destination. The
// generic PATCH /:taskId/association also lets you flip workspaceId, but its
// semantics are tied to mind-map cards (it manages cards/maps as a side
// effect) and doesn't audit the move — this endpoint is the canonical
// move-task surface for agents and external integrations.
// ---------------------------------------------------------------------------

const moveToWorkspaceSchema = z.object({
  targetWorkspaceId: z.string().uuid(),
  assignee: z
    .union([
      z.object({ userId: z.string().uuid() }),
      z.object({ email: z.string().email() }),
      z.null(),
    ])
    .optional(),
});

router.post("/:taskId/move-to-workspace", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const parsed = moveToWorkspaceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Validation error", message: parsed.error.message });
  }

  const result = await moveStandaloneTaskToWorkspace({
    taskId,
    callerId: userId,
    callerSource: req.user?.source ?? null,
    targetWorkspaceId: parsed.data.targetWorkspaceId,
    assignee: parsed.data.assignee,
  });
  return res.status(result.status).json(result.body);
});

router.delete("/:taskId", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const [existing] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!existing) return res.status(404).json({ message: "Tarefa não encontrada" });

  if (existing.workspaceId !== null) {
    return res.status(403).json({ message: "Use a rota do workspace" });
  }

  // Permission rules (standalone tasks):
  //  - Prefer createdBy when present. For tasks created after the createdBy
  //    column was introduced, this is always the assignee (POST /my-tasks sets
  //    createdBy = userId).
  //  - Fall back to assignedTo for pre-migration rows where createdBy was
  //    backfilled to assignedTo, but only as a defence in depth — both fields
  //    point to the same user for standalone tasks.
  const creator = existing.createdBy ?? existing.assignedTo;
  if (creator !== userId) {
    return res.status(403).json({ message: "Sem permissão" });
  }

  await db.delete(tasks).where(eq(tasks.id, taskId));
  return res.json({ ok: true });
});

router.get("/:taskId/meta", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const [task] = await db
    .select({ id: tasks.id, workspaceId: tasks.workspaceId, assignedTo: tasks.assignedTo })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (!task) return res.status(404).json({ message: "Tarefa não encontrada" });

  if (task.workspaceId !== null) {
    const [membership] = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, task.workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1);
    if (!membership) return res.status(403).json({ message: "Sem permissão" });
  } else {
    if (task.assignedTo !== userId) return res.status(403).json({ message: "Sem permissão" });
  }

  return res.json({ id: task.id, workspaceId: task.workspaceId });
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

router.get("/:taskId/comments", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const [task] = await db.select({ id: tasks.id, assignedTo: tasks.assignedTo }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return res.status(404).json({ message: "Tarefa não encontrada" });
  if (task.assignedTo !== userId) return res.status(403).json({ message: "Sem permissão" });

  const rows = await db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      authorId: taskComments.authorId,
      authorName: sql<string>`coalesce(${users.name}, 'Usuário removido')`,
      authorAvatar: users.avatarUrl,
      authorClasses: users.classes,
      content: taskComments.content,
      hidden: taskComments.hidden,
      source: taskComments.source,
      createdAt: taskComments.createdAt,
      updatedAt: taskComments.updatedAt,
    })
    .from(taskComments)
    .leftJoin(users, eq(taskComments.authorId, users.id))
    .where(eq(taskComments.taskId, taskId))
    .orderBy(asc(taskComments.createdAt));

  return res.json(rows);
});

router.post("/:taskId/comments", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;
  const { content } = req.body;

  if (!content || typeof content !== "string" || !content.trim()) {
    return res.status(400).json({ message: "Conteúdo obrigatório" });
  }

  const [task] = await db.select({ id: tasks.id, assignedTo: tasks.assignedTo }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return res.status(404).json({ message: "Tarefa não encontrada" });
  if (task.assignedTo !== userId) return res.status(403).json({ message: "Sem permissão" });

  const [comment] = await db.insert(taskComments).values({ taskId, authorId: userId, content, source: req.user?.source ?? null }).returning();
  const [author] = await db.select({ name: users.name, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, userId)).limit(1);

  return res.status(201).json({ ...comment, authorName: author?.name ?? null, authorAvatar: author?.avatarUrl ?? null });
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

router.get("/:taskId/subtasks", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const [task] = await db.select({ id: tasks.id, assignedTo: tasks.assignedTo, workspaceId: tasks.workspaceId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return res.status(404).json({ error: "Not found" });
  if (task.assignedTo !== userId) return res.status(403).json({ error: "Forbidden" });
  if (task.workspaceId) return res.status(400).json({ error: "Use workspace subtask endpoint for workspace tasks" });

  const items = await db.select().from(subtasks).where(eq(subtasks.taskId, taskId)).orderBy(asc(subtasks.order), asc(subtasks.createdAt));
  return res.json(items);
});

router.put("/:taskId/subtasks", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const [task] = await db.select({ id: tasks.id, assignedTo: tasks.assignedTo, workspaceId: tasks.workspaceId }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return res.status(404).json({ error: "Not found" });
  if (task.assignedTo !== userId) return res.status(403).json({ error: "Forbidden" });
  if (task.workspaceId) return res.status(400).json({ error: "Use workspace subtask endpoint for workspace tasks" });

  const parsed = bulkSubtasksSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", message: parsed.error.message });
  }

  const incoming = parsed.data.subtasks.filter(s => s.text.trim() !== "");

  // Atomic delete-then-insert: a partial failure between the two would
  // leave the task with zero subtasks, even though the client expected its
  // payload to land.
  await db.transaction(async (tx) => {
    await tx.delete(subtasks).where(eq(subtasks.taskId, taskId));

    if (incoming.length > 0) {
      await tx.insert(subtasks).values(
        incoming.map((s, idx) => ({
          id: s.id,
          taskId,
          text: s.text.trim(),
          completed: s.completed ?? false,
          order: s.order ?? idx,
        }))
      );
    }
  });

  const result = await db.select().from(subtasks).where(eq(subtasks.taskId, taskId)).orderBy(asc(subtasks.order), asc(subtasks.createdAt));
  return res.json(result);
});

// ---------------------------------------------------------------------------
// Per-item checklist mutations on standalone tasks.
//
// The taskSubtasksService runs the same ownership guard
// (workspaceId IS NULL AND assignedTo = caller) so we don't need to repeat
// the check in the route layer. The service mirrors the workspace endpoints
// at /api/workspaces/:wId/tasks/:tId/subtasks/* — see add_checklist_items,
// update_checklist_item, delete_checklist_item in the MCP.
// ---------------------------------------------------------------------------

const checklistItemSchemaPersonal = z.object({
  text: z.string().min(1),
  completed: z.boolean().optional().default(false),
  order: z.number().int().optional(),
});

const createSubtasksSchemaPersonal = z.object({
  items: z.array(checklistItemSchemaPersonal).min(1).max(50),
});

const updateSubtaskSchemaPersonal = checklistItemSchemaPersonal.partial();

router.post("/:taskId/subtasks", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const parsed = createSubtasksSchemaPersonal.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", message: parsed.error.message });
  }

  const result = await createSubtasksPersonal(taskId, userId, parsed.data.items, {
    userId,
    source: req.user?.source ?? null,
  });
  return res.status(result.status).json(result.body);
});

router.patch("/:taskId/subtasks/:subtaskId", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId, subtaskId } = req.params;

  const parsed = updateSubtaskSchemaPersonal.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation error", message: parsed.error.message });
  }

  const result = await updateSubtaskPersonal(taskId, userId, subtaskId, parsed.data);
  return res.status(result.status).json(result.body);
});

router.delete("/:taskId/subtasks/:subtaskId", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId, subtaskId } = req.params;

  const result = await deleteSubtaskPersonal(taskId, userId, subtaskId);
  return res.status(result.status).json(result.body);
});

/**
 * Authorize a personal-task attachment request. Returns the HTTP error
 * payload to send (and the route should `return` immediately), or `null`
 * when the caller may proceed. Centralised so all attachment routes apply
 * the same 404 / 403 / 400 contract.
 */
async function authorizePersonalTaskAccess(
  taskId: string,
  userId: string,
): Promise<{ status: number; body: { error: string } } | null> {
  const owner = await getTaskOwnership(taskId);
  if (!owner) return { status: 404, body: { error: "Not found" } };
  if (owner.assignedTo !== userId) return { status: 403, body: { error: "Forbidden" } };
  if (owner.workspaceId) {
    return { status: 400, body: { error: "Use workspace attachment endpoint for workspace tasks" } };
  }
  return null;
}

router.get("/:taskId/attachments", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId } = req.params;

  const denied = await authorizePersonalTaskAccess(taskId, userId);
  if (denied) return res.status(denied.status).json(denied.body);

  return res.json(await listTaskAttachments(taskId));
});

// Note: POST /:taskId/attachments is removed in the new storage flow. The
// client now calls POST /api/storage/uploads/request-url which both creates
// the attachment row AND returns a presigned URL in a single call.

const standaloneRequestUrlSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  kind: z.enum(["standard", "deliverable"]).optional(),
});

/**
 * Standalone counterpart of POST /storage/uploads/request-url. Issues a
 * presigned upload URL for a workspace-less task and pre-creates the paired
 * attachments + task_attachments rows (workspace_id NULL) via the shared
 * `createTaskAttachmentLink` helper. Same response shape as the storage route.
 *
 * bucket is always "attachments"; entityKind is always "task". The storage key
 * uses a workspace-free scheme since standalone tasks have no workspace id.
 */
router.post(
  "/:taskId/attachments/request-url",
  requireAuth,
  requireStorage,
  async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    const { taskId } = req.params;

    const denied = await authorizePersonalTaskAccess(taskId, userId);
    if (denied) return res.status(denied.status).json(denied.body);

    const parsed = standaloneRequestUrlSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_failed",
        message: "Invalid upload request payload",
        details: parsed.error.issues,
      });
    }

    const { filename, contentType, sizeBytes, kind } = parsed.data;

    const validation = validateFileUpload({
      filename,
      mimeType: contentType,
      sizeBytes,
    });
    if (validation) {
      return res.status(400).json({ error: validation.code, message: validation.message });
    }

    const bucket = "attachments" as const;
    const attachmentId = randomUUID();
    const safeName = sanitizeFilename(filename);
    // Workspace-free storage key: standalone tasks have no workspace id.
    const storagePath = `standalone/task/${taskId}/${attachmentId}-${safeName}`;

    const storage = getStorage();
    let signed;
    try {
      signed = await storage.createUploadUrl({ bucket, storagePath, contentType });
    } catch (err) {
      log.error({ err, storagePath, bucket }, "createUploadUrl failed");
      return res.status(502).json({ error: "storage_error", message: "Failed to create upload URL" });
    }

    try {
      await createTaskAttachmentLink({
        attachmentId,
        workspaceId: null,
        bucket,
        storagePath,
        fileName: safeName,
        mimeType: contentType,
        fileSize: sizeBytes,
        uploadedBy: userId,
        taskId,
        kind,
      });
    } catch (err) {
      log.error({ err, attachmentId }, "failed to insert attachment row");
      return res.status(500).json({ error: "db_error", message: "Failed to register attachment" });
    }

    await recordTaskActivity({
      taskId,
      actorId: userId,
      type: "attachment_added",
      metadata: { attachmentId, filename: safeName },
    });

    return res.status(201).json({
      attachmentId,
      bucket,
      storagePath,
      uploadUrl: signed.uploadUrl,
      method: signed.method,
      headers: signed.headers,
      expiresAt: signed.expiresAt.toISOString(),
    });
  },
);

router.delete("/:taskId/attachments/:attachmentId", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId, attachmentId } = req.params;

  const denied = await authorizePersonalTaskAccess(taskId, userId);
  if (denied) return res.status(denied.status).json(denied.body);

  // Capture the filename before the soft-delete so the activity event can
  // record it (the row is still readable since soft-delete only sets deletedAt).
  const [meta] = await db
    .select({ filename: attachments.originalFilename })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);

  const deleted = await deleteTaskAttachment(taskId, attachmentId);
  if (!deleted) return res.status(404).json({ error: "Attachment not found" });

  await recordTaskActivity({
    taskId,
    actorId: userId,
    type: "attachment_removed",
    metadata: { attachmentId, filename: meta?.filename ?? null },
  });

  return res.json({ success: true });
});

router.get("/:taskId/attachments/:attachmentId/download", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { taskId, attachmentId } = req.params;

  const denied = await authorizePersonalTaskAccess(taskId, userId);
  if (denied) return res.status(denied.status).json(denied.body);

  const attachment = await getTaskAttachmentForDownload(taskId, attachmentId);
  if (!attachment) return res.status(404).json({ error: "Attachment not found" });

  const storage = getStorage();
  if (!storage.enabled) {
    return res.status(503).json({ error: "storage_disabled" });
  }

  try {
    const stream = await storage.getReadStream({
      bucket: attachment.bucket,
      storagePath: attachment.storagePath,
    });
    res.setHeader("Content-Type", attachment.mimeType || stream.contentType);
    if (stream.contentLength !== undefined) {
      res.setHeader("Content-Length", String(stream.contentLength));
    }
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
    );
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    return stream.stream.pipe(res);
  } catch (error) {
    log.error({ err: error }, "Error downloading attachment");
    return res.status(500).json({ error: "Failed to download attachment" });
  }
});

export default router;
