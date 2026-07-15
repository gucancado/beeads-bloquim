import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { tasks, cards, maps, workspaces, workspaceMembers, users, subtasks, taskActivities, cardConnections, taskComments, attachments } from "@workspace/db/schema";
import type { RecurrenceConfig } from "@workspace/db/schema";
import { eq, and, isNull, or, inArray, asc, sql, count, desc, isNotNull, not, ne, gte, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { logger } from "../lib/logger";

const log = logger.child({ module: "workspaceTasks" });
import { requireWorkspaceRole } from "../middlewares/permissions";
import { z } from "zod";
import { computeOverdue } from "../lib/overdue";
import { resolveSchedule, type ScheduleMode } from "../lib/scheduleMode";
import { tryActivateTask } from "../services/taskActivation";
import { calculateNextDueDate } from "../lib/recurrence";
import { duplicateRecurringTask } from "../lib/duplicateRecurring";
import { getStorage } from "../lib/storage";
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
  listTaskDeliverableAttachments,
  deleteTaskAttachment,
  getTaskAttachmentForDownload,
  updateTaskAttachmentKind,
  getApprovalTaskParent,
} from "../services/taskAttachmentsService";
import {
  approveApprovalTask,
  rejectApprovalTask,
} from "../services/approvalActionService";
import { recordTaskActivity } from "../services/taskActivitiesService";
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
  createSubtasks,
  updateSubtask,
  deleteSubtask,
} from "../services/taskSubtasksService";
import { duplicateTask } from "../services/taskDuplicateService";
import { patchTaskStatus } from "../services/taskStatusService";
import { parseSinceParam, parseUntilParam } from "../lib/queryDates";
import { encodeCursor, decodeCursor } from "../lib/keysetCursor";
import { computeHealth } from "../lib/workspaceHealth";

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
    const scope = (field: typeof tasks.assignedTo | typeof tasks.ownerId) => {
      const parts = [];
      if (hasUnassigned) parts.push(isNull(field));
      if (uuids.length > 0) parts.push(inArray(field, uuids));
      return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : or(...parts);
    };
    const assigneeBranch = and(ne(tasks.status, "draft"), scope(tasks.assignedTo));
    const ownerBranch = and(eq(tasks.status, "draft"), scope(tasks.ownerId));
    return or(assigneeBranch, ownerBranch);
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

router.get("/stats", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId } = req.params;
  const { since: sinceRaw, until: untilRaw } = req.query as { since?: string; until?: string };
  const since = parseSinceParam(sinceRaw);
  const until = parseUntilParam(untilRaw);
  if (since === "invalid" || until === "invalid") {
    res.status(400).json({ error: "Validation error", message: "since/until devem ser ISO 8601 ou YYYY-MM-DD" });
    return;
  }
  if (since && until && since > until) {
    res.status(400).json({ error: "Validation error", message: "since deve ser <= until" });
    return;
  }

  const notApprovalDraft = not(and(eq(tasks.isApprovalTask, true), eq(tasks.status, "draft")));
  const baseWhere = and(eq(tasks.workspaceId, workspaceId), notApprovalDraft);
  const openOnly = inArray(tasks.status, ["pending", "in_progress", "blocked"]);
  const activeOnly = not(inArray(tasks.status, ["completed", "blocked", "draft"]));
  // Drafts contam pelo owner, o resto pelo assignee — mesma regra do buildAssigneeFilter.
  const assigneeBucket = sql<string | null>`CASE WHEN ${tasks.status} = 'draft' THEN ${tasks.ownerId} ELSE ${tasks.assignedTo} END`;

  const [statusRows, priorityRows, [overdueRow], assigneeRows, planRows, [agingRow]] = await Promise.all([
    db.select({ status: tasks.status, cnt: count() }).from(tasks).where(baseWhere).groupBy(tasks.status),
    db.select({ priority: tasks.priority, cnt: count() }).from(tasks).where(baseWhere).groupBy(tasks.priority),
    db.select({ cnt: sql<number>`count(*)::int` }).from(tasks).where(and(baseWhere, eq(tasks.overdue, true), activeOnly)),
    db
      .select({
        userId: assigneeBucket,
        total: sql<number>`count(*)::int`,
        open: sql<number>`count(*) filter (where ${tasks.status} in ('pending','in_progress','blocked'))::int`,
        overdue: sql<number>`count(*) filter (where ${tasks.overdue} = true and ${tasks.status} not in ('completed','blocked','draft'))::int`,
      })
      .from(tasks)
      .where(baseWhere)
      .groupBy(assigneeBucket),
    db
      .select({
        mapId: tasks.mapId,
        mapName: maps.name,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${tasks.status} = 'completed')::int`,
      })
      .from(tasks)
      .leftJoin(maps, eq(maps.id, tasks.mapId))
      .where(and(baseWhere, isNotNull(tasks.mapId)))
      .groupBy(tasks.mapId, maps.name),
    db
      .select({
        d0_7: sql<number>`count(*) filter (where ${tasks.createdAt} >= now() - interval '7 days')::int`,
        d8_30: sql<number>`count(*) filter (where ${tasks.createdAt} < now() - interval '7 days' and ${tasks.createdAt} >= now() - interval '30 days')::int`,
        d31_90: sql<number>`count(*) filter (where ${tasks.createdAt} < now() - interval '30 days' and ${tasks.createdAt} >= now() - interval '90 days')::int`,
        d90_plus: sql<number>`count(*) filter (where ${tasks.createdAt} < now() - interval '90 days')::int`,
      })
      .from(tasks)
      .where(and(baseWhere, openOnly)),
  ]);

  // Nomes/classes dos assignees em query separada (groupBy é por expressão).
  const assigneeIds = assigneeRows.map((r) => r.userId).filter((v): v is string => !!v);
  const userRows = assigneeIds.length > 0
    ? await db.select({ id: users.id, name: users.name, classes: users.classes }).from(users).where(inArray(users.id, assigneeIds))
    : [];
  const userById = new Map(userRows.map((u) => [u.id, u]));

  // window: created por tasks.created_at; completed por activity log
  // (status_changed → newStatus=completed), DISTINCT por task — imune ao
  // reset de completedAt e a re-conclusões.
  let window: { since: string | null; until: string | null; created: number; completed: number } | null = null;
  if (since || until) {
    const [[createdRow], [completedRow]] = await Promise.all([
      db.select({ cnt: sql<number>`count(*)::int` }).from(tasks).where(and(
        baseWhere,
        since ? gte(tasks.createdAt, since) : undefined,
        until ? lt(tasks.createdAt, until) : undefined,
      )),
      db
        .select({ cnt: sql<number>`count(distinct ${taskActivities.taskId})::int` })
        .from(taskActivities)
        .innerJoin(tasks, eq(tasks.id, taskActivities.taskId))
        .where(and(
          eq(tasks.workspaceId, workspaceId),
          notApprovalDraft,
          eq(taskActivities.type, "status_changed"),
          sql`${taskActivities.metadata}->>'newStatus' = 'completed'`,
          since ? gte(taskActivities.createdAt, since) : undefined,
          until ? lt(taskActivities.createdAt, until) : undefined,
        )),
    ]);
    window = {
      since: since ? since.toISOString() : null,
      until: until ? until.toISOString() : null,
      created: createdRow?.cnt ?? 0,
      completed: completedRow?.cnt ?? 0,
    };
  }

  const byStatus = { pending: 0, in_progress: 0, completed: 0, blocked: 0, draft: 0 } as Record<string, number>;
  let total = 0;
  for (const row of statusRows) {
    total += Number(row.cnt);
    if (row.status && row.status in byStatus) byStatus[row.status] = Number(row.cnt);
  }
  const byPriority = { low: 0, medium: 0, high: 0, critical: 0 } as Record<string, number>;
  for (const row of priorityRows) {
    if (row.priority && row.priority in byPriority) byPriority[row.priority] = Number(row.cnt);
  }

  res.json({
    workspaceId,
    total,
    byStatus,
    overdue: overdueRow?.cnt ?? 0,
    byPriority,
    byAssignee: assigneeRows.map((r) => ({
      userId: r.userId,
      name: r.userId ? (userById.get(r.userId)?.name ?? null) : null,
      classes: r.userId ? (userById.get(r.userId)?.classes ?? []) : [],
      total: r.total,
      open: r.open,
      overdue: r.overdue,
    })),
    byPlan: planRows,
    aging: agingRow ?? { d0_7: 0, d8_30: 0, d31_90: 0, d90_plus: 0 },
    window,
  });
});

router.get("/health", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId } = req.params;
  const health = await computeHealth(db, workspaceId);
  res.json({ workspaceId, ...health });
});

router.get("/", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId } = req.params;
  const { status, assignedTo } = req.query as { status?: string; assignedTo?: string };
  const VALID_STATUSES = ["pending", "in_progress", "completed", "overdue", "blocked", "draft"] as const;
  type ValidStatus = typeof VALID_STATUSES[number];
  const statuses: ValidStatus[] = (status ? status.split(",").filter(Boolean) : []).filter(
    (s): s is ValidStatus => VALID_STATUSES.includes(s as ValidStatus)
  );
  // Pin "urgente" no topo APENAS quando o filtro ativo é um subconjunto de
  // {draft, pending, in_progress} (trabalho ativo). Em filtros de
  // completed/blocked/overdue, ou sem filtro, urgente não pina — o usuário
  // está em modo de revisão/histórico, não de execução.
  const ACTIVE_STATUSES = new Set(["draft", "pending", "in_progress"]);
  const pinUrgente =
    statuses.length > 0 && statuses.every(s => ACTIVE_STATUSES.has(s));
  const assignees = assignedTo ? assignedTo.split(",").filter(Boolean) : [];

  const buildAssigneeFilter = () => {
    if (assignees.length === 0) return undefined;
    const hasUnassigned = assignees.includes("unassigned");
    const uuids = assignees.filter(a => a !== "unassigned");
    const scope = (field: typeof tasks.assignedTo | typeof tasks.ownerId) => {
      const parts = [];
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
    res.status(400).json({ error: "Validation error", message: `priority aceita: ${VALID_PRIORITIES.join(", ")}` });
    return;
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
    res.status(400).json({ error: "Validation error", message: `${invalidDate[0]} deve ser ISO 8601 ou YYYY-MM-DD` });
    return;
  }
  const dp = dateParams as Record<keyof typeof dateParams, Date | null>;
  if (q.mapId && !/^[0-9a-f-]{36}$/i.test(q.mapId)) {
    res.status(400).json({ error: "Validation error", message: "mapId inválido" });
    return;
  }
  const keysetMode = q.cursor !== undefined || q.limit !== undefined;
  const limit = Math.min(Math.max(parseInt(q.limit ?? "100", 10) || 100, 1), 200);
  const cursor = q.cursor ? decodeCursor(q.cursor) : null;
  if (q.cursor && !cursor) {
    res.status(400).json({ error: "Validation error", message: "cursor inválido" });
    return;
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
    q.mapId ? eq(tasks.mapId, q.mapId) : undefined,
    dp.createdSince ? gte(tasks.createdAt, dp.createdSince) : undefined,
    dp.createdUntil ? lt(tasks.createdAt, dp.createdUntil) : undefined,
    dp.completedSince ? gte(tasks.completedAt, dp.completedSince) : undefined,
    dp.completedUntil ? lt(tasks.completedAt, dp.completedUntil) : undefined,
    dp.dueAfter ? gte(tasks.dueDate, dp.dueAfter) : undefined,
    dp.dueBefore ? lt(tasks.dueDate, dp.dueBefore) : undefined,
  ];

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
      overdue: tasks.overdue,
      completedAt: tasks.completedAt,
      cancelledAt: tasks.cancelledAt,
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
        eq(tasks.workspaceId, workspaceId),
        statuses.length > 0 ? inArray(tasks.status, statuses) : undefined,
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
    res.json({ items, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null });
    return;
  }
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
  startAt: z.string().nullable().optional(),
  scheduleMode: z.enum(["ate", "entre", "em", "sem_prazo", "urgente"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  isRecurring: z.boolean().optional(),
  recurrenceConfig: recurrenceConfigSchema.nullable().optional(),
});

const updateTaskSchema = createTaskSchema.partial().extend({
  ownerId: z.string().uuid().nullable().optional(),
});

router.post("/", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId } = req.params;
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const { title, description, priority, isRecurring, recurrenceConfig } = parsed.data;

  const sched = resolveSchedule(parsed.data, { scheduleMode: "sem_prazo", startAt: null, dueDate: null });
  if (!sched.ok) {
    res.status(400).json({ error: "Validation error", message: sched.error });
    return;
  }
  const overdueValue = computeOverdue(sched.value.dueDate, "draft");

  const actorId = req.user!.userId;
  const assignedTo = parsed.data.assignedTo === undefined ? actorId : parsed.data.assignedTo;

  const [task] = await db
    .insert(tasks)
    .values({
      workspaceId,
      title,
      description: description ?? null,
      assignedTo,
      dueDate: sched.value.dueDate,
      startAt: sched.value.startAt,
      scheduleMode: sched.value.scheduleMode,
      priority: priority ?? "medium",
      status: "draft",
      overdue: overdueValue,
      isRecurring: isRecurring ?? false,
      recurrenceConfig: recurrenceConfig ?? null,
      createdBy: actorId,
      ownerId: actorId,
    })
    .returning();

  const [actorUser, assignee] = await Promise.all([
    db.select({ name: users.name }).from(users).where(eq(users.id, actorId)).limit(1),
    assignedTo
      ? db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, assignedTo)).limit(1)
      : Promise.resolve([]),
  ]);

  await recordTaskActivity({
    taskId: task.id,
    actorId,
    type: "task_created",
    metadata: { actorName: actorUser[0]?.name ?? null },
    source: req.user?.source ?? null,
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

  const [assignee, owner, members, taskSubtasks] = await Promise.all([
    task.assignedTo
      ? db.select({ name: users.name, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, task.assignedTo)).limit(1)
      : Promise.resolve([]),
    task.ownerId
      ? db.select({ name: users.name, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, task.ownerId)).limit(1)
      : Promise.resolve([]),
    db
      .select({ userId: workspaceMembers.userId, name: users.name, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, workspaceId)),
    db.select().from(subtasks).where(eq(subtasks.taskId, taskId)).orderBy(asc(subtasks.order), asc(subtasks.createdAt)),
  ]);

  let parentTask:
    | {
        id: string;
        title: string;
        description: string | null;
        status: string;
        priority: string;
        scheduleMode: string | null;
        startAt: Date | null;
        dueDate: Date | null;
        completedAt: Date | null;
        assignedTo: string | null;
        assigneeName: string | null;
        assigneeAvatarUrl: string | null;
        completedById: string | null;
        completedByName: string | null;
        completedByAvatarUrl: string | null;
      }
    | null = null;
  if (task.isApprovalTask && task.parentTaskId) {
    const assigneeAlias = alias(users, "parent_assignee");
    const [pt] = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        priority: tasks.priority,
        scheduleMode: tasks.scheduleMode,
        startAt: tasks.startAt,
        dueDate: tasks.dueDate,
        completedAt: tasks.completedAt,
        assignedTo: tasks.assignedTo,
        assigneeName: assigneeAlias.name,
        assigneeAvatarUrl: assigneeAlias.avatarUrl,
      })
      .from(tasks)
      .leftJoin(assigneeAlias, eq(assigneeAlias.id, tasks.assignedTo))
      .where(eq(tasks.id, task.parentTaskId))
      .limit(1);
    if (pt) {
      // The "completed by" is captured on the most recent status_changed
      // activity that landed in `completed`. We avoid adding a dedicated
      // column by deriving it from the activity log.
      const [completedByAct] = await db
        .select({
          actorId: taskActivities.actorId,
          actorName: users.name,
          actorAvatarUrl: users.avatarUrl,
          actorClasses: users.classes,
          metadata: taskActivities.metadata,
          createdAt: taskActivities.createdAt,
        })
        .from(taskActivities)
        .leftJoin(users, eq(users.id, taskActivities.actorId))
        .where(
          and(
            eq(taskActivities.taskId, task.parentTaskId),
            eq(taskActivities.type, "status_changed"),
            sql`${taskActivities.metadata}->>'newStatus' = 'completed'`,
          ),
        )
        .orderBy(desc(taskActivities.createdAt))
        .limit(1);
      parentTask = {
        ...pt,
        // Prefer the activity timestamp (canonical "when did the executor
        // mark this complete?") and fall back to `tasks.completedAt` for
        // legacy rows that may predate the activity log.
        completedAt: completedByAct?.createdAt ?? pt.completedAt,
        completedById: completedByAct?.actorId ?? null,
        completedByName:
          completedByAct?.actorName ??
          (completedByAct?.metadata?.actorName ?? null),
        completedByAvatarUrl: completedByAct?.actorAvatarUrl ?? null,
      };
    }
  }

  res.json({
    ...task,
    assigneeName: assignee[0]?.name ?? null,
    assigneeAvatarUrl: assignee[0]?.avatarUrl ?? null,
    ownerName: (owner as { name: string; avatarUrl: string | null }[])[0]?.name ?? null,
    ownerAvatarUrl: (owner as { name: string; avatarUrl: string | null }[])[0]?.avatarUrl ?? null,
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
  const ownerChanging = "ownerId" in parsed.data && (parsed.data.ownerId ?? null) !== existing.ownerId;
  const newOwnerId = ownerChanging ? (parsed.data.ownerId ?? null) : null;
  const priorityChanging = parsed.data.priority !== undefined && parsed.data.priority !== existing.priority;
  const safeExistingDueDate = existing.dueDate && !isNaN(existing.dueDate.getTime()) ? existing.dueDate : null;
  const dueDateChanging = "dueDate" in parsed.data && (parsed.data.dueDate ?? null) !== (safeExistingDueDate ? safeExistingDueDate.toISOString().slice(0, 10) : null);

  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if ("assignedTo" in parsed.data) updateData.assignedTo = parsed.data.assignedTo ?? null;
  if ("ownerId" in parsed.data) updateData.ownerId = parsed.data.ownerId ?? null;
  const touchesSchedule = "dueDate" in parsed.data || "startAt" in parsed.data || "scheduleMode" in parsed.data;
  if (touchesSchedule) {
    const sched = resolveSchedule(parsed.data, {
      scheduleMode: (existing.scheduleMode ?? "ate") as ScheduleMode,
      startAt: existing.startAt,
      dueDate: existing.dueDate,
    });
    if (!sched.ok) {
      res.status(400).json({ error: "Validation error", message: sched.error });
      return;
    }
    updateData.dueDate = sched.value.dueDate;
    updateData.startAt = sched.value.startAt;
    updateData.scheduleMode = sched.value.scheduleMode;
  }
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

  if (touchesSchedule) {
    await tryActivateTask(taskId);
  }

  const [assignee, actorUser] = await Promise.all([
    updated.assignedTo
      ? db.select({ name: users.name }).from(users).where(eq(users.id, updated.assignedTo)).limit(1)
      : Promise.resolve([]),
    db.select({ name: users.name }).from(users).where(eq(users.id, actorId)).limit(1),
  ]);

  // Activity logging is a best-effort audit side-effect. The task update above
  // has already committed; a failure here (e.g. an FK violation because the
  // task row was deleted concurrently) must NOT turn a successful mutation into
  // a 500. Log the real cause and carry on. See bug task 7903bc06-….
  try {
    if (assigneeChanging) {
      const [oldAssignee, newAssignee] = await Promise.all([
        existing.assignedTo
          ? db.select({ name: users.name }).from(users).where(eq(users.id, existing.assignedTo)).limit(1)
          : Promise.resolve([]),
        newAssigneeId
          ? db.select({ name: users.name }).from(users).where(eq(users.id, newAssigneeId)).limit(1)
          : Promise.resolve([]),
      ]);

      await recordTaskActivity({
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
        source: req.user?.source ?? null,
      });
    }

    if (ownerChanging) {
      const [oldOwner, newOwner] = await Promise.all([
        existing.ownerId
          ? db.select({ name: users.name }).from(users).where(eq(users.id, existing.ownerId)).limit(1)
          : Promise.resolve([]),
        newOwnerId
          ? db.select({ name: users.name }).from(users).where(eq(users.id, newOwnerId)).limit(1)
          : Promise.resolve([]),
      ]);

      await recordTaskActivity({
        taskId,
        actorId,
        type: "owner_changed",
        metadata: {
          actorName: actorUser[0]?.name ?? null,
          actorId,
          oldOwnerId: existing.ownerId ?? null,
          newOwnerId,
          oldOwnerName: (oldOwner as { name: string }[])[0]?.name ?? null,
          newOwnerName: (newOwner as { name: string }[])[0]?.name ?? null,
        },
        source: req.user?.source ?? null,
      });
    }

    if (priorityChanging) {
      await recordTaskActivity({
        taskId,
        actorId,
        type: "priority_changed",
        metadata: {
          actorName: actorUser[0]?.name ?? null,
          oldPriority: existing.priority ?? null,
          newPriority: parsed.data.priority ?? null,
        },
        source: req.user?.source ?? null,
      });
    }

    if (dueDateChanging) {
      await recordTaskActivity({
        taskId,
        actorId,
        type: "due_date_changed",
        metadata: {
          actorName: actorUser[0]?.name ?? null,
          oldDueDate: safeExistingDueDate ? safeExistingDueDate.toISOString().slice(0, 10) : null,
          newDueDate: parsed.data.dueDate ?? null,
        },
        source: req.user?.source ?? null,
      });
    }
  } catch (activityErr) {
    const cause =
      activityErr instanceof Error && activityErr.cause !== undefined
        ? activityErr.cause
        : undefined;
    log.error(
      {
        taskId,
        workspaceId,
        err:
          activityErr instanceof Error
            ? { message: activityErr.message, stack: activityErr.stack, cause }
            : { message: String(activityErr) },
      },
      "task PATCH succeeded but activity logging failed (best-effort, swallowed)",
    );
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

  const result = await patchTaskStatus(workspaceId, taskId, actorId, parsed.data, req.user?.source ?? null);
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
      actorClasses: users.classes,
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

/**
 * Consolidated activity history for an approval task: returns the activities
 * of the parent task plus those of every sibling approval task (other
 * approvers in the same chain). Each item carries a `source` block with the
 * originating task so the UI can render the "origem" chip.
 */
router.get("/:approvalTaskId/consolidated-activities", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, approvalTaskId } = req.params;
  const viewerId = req.user!.userId;
  const viewerRole = (req as { memberRole?: string }).memberRole;
  const viewerIsAdmin = viewerRole === "admin";

  const [approvalTask] = await db
    .select({
      id: tasks.id,
      isApprovalTask: tasks.isApprovalTask,
      parentTaskId: tasks.parentTaskId,
    })
    .from(tasks)
    .where(and(eq(tasks.id, approvalTaskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);

  if (!approvalTask) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!approvalTask.isApprovalTask || !approvalTask.parentTaskId) {
    res.status(400).json({ error: "Task is not an approval task" });
    return;
  }

  const parentTaskId = approvalTask.parentTaskId;

  // Fetch parent + every sibling approval task (including the one we're
  // looking at) so the timeline shows the full picture, with each row
  // tagged by its origin task.
  const siblings = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      isApprovalTask: tasks.isApprovalTask,
      assignedTo: tasks.assignedTo,
      assigneeName: users.name,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        or(
          eq(tasks.id, parentTaskId),
          eq(tasks.parentTaskId, parentTaskId),
        ),
      ),
    );

  const sourceMap = new Map(siblings.map(s => [s.id, s]));
  const taskIds = siblings.map(s => s.id);

  if (taskIds.length === 0) {
    res.json([]);
    return;
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
    .where(inArray(taskActivities.taskId, taskIds))
    .orderBy(asc(taskActivities.createdAt));

  // Comments live in a separate table — pull them too so the consolidated
  // timeline is the single source of truth (otherwise approvers wouldn't
  // see what the executor or other approvers wrote).
  const commentRows = await db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      authorId: taskComments.authorId,
      authorName: sql<string>`coalesce(${users.name}, 'Usuário removido')`,
      authorAvatarUrl: users.avatarUrl,
      content: taskComments.content,
      hidden: taskComments.hidden,
      createdAt: taskComments.createdAt,
      updatedAt: taskComments.updatedAt,
    })
    .from(taskComments)
    .leftJoin(users, eq(taskComments.authorId, users.id))
    .where(inArray(taskComments.taskId, taskIds))
    .orderBy(asc(taskComments.createdAt));

  const buildSource = (taskId: string) => {
    const src = sourceMap.get(taskId);
    return src
      ? {
          taskId: src.id,
          taskTitle: src.title,
          isApprovalTask: src.isApprovalTask,
          approverName: src.isApprovalTask ? src.assigneeName : null,
        }
      : null;
  };

  type TimelineRow =
    | { kind: "activity"; createdAt: Date; payload: Record<string, unknown> }
    | { kind: "comment"; createdAt: Date; payload: Record<string, unknown> };

  const enrichedActivities: TimelineRow[] = activities.map((a) => ({
    kind: "activity" as const,
    createdAt: a.createdAt,
    payload: { ...a, source: buildSource(a.taskId) },
  }));

  // Hidden comments still ship in the timeline so the UI can render the
  // "Comentário oculto." placeholder, but we scrub the body server-side
  // for viewers who are neither the author nor a workspace admin —
  // otherwise approvers could read moderated content via DevTools even
  // though the UI masks it.
  const enrichedComments: TimelineRow[] = commentRows.map((c) => {
    const canSeeContent = !c.hidden || c.authorId === viewerId || viewerIsAdmin;
    return {
      kind: "comment" as const,
      createdAt: c.createdAt,
      payload: {
        ...c,
        content: canSeeContent ? c.content : "",
        source: buildSource(c.taskId),
      },
    };
  });

  const merged = [...enrichedActivities, ...enrichedComments]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((row) => ({ kind: row.kind, ...row.payload }));

  res.json(merged);
});

router.delete("/:taskId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;
  const userId = req.user!.userId;
  const memberRole = (req as { memberRole?: string }).memberRole;

  const [task] = await db
    .select({ id: tasks.id, createdBy: tasks.createdBy })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);
  if (!task) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Permission rules (workspace tasks):
  //  - The task's creator can always delete it.
  //  - Workspace admins bypass — needed to clean up tasks of ex-members.
  //  - Tasks pre-dating the createdBy column (created_by IS NULL) cannot be
  //    deleted via this route: there is no recorded author to authorize the
  //    operation against. Admins can still delete via the UI / direct DB.
  const isCreator = task.createdBy !== null && task.createdBy === userId;
  const isAdmin = memberRole === "admin";

  if (!isCreator && !isAdmin) {
    if (task.createdBy === null) {
      res.status(403).json({
        error: "Forbidden",
        message:
          "Tarefa sem autoria registrada — apague via UI como admin do workspace.",
      });
      return;
    }
    res.status(403).json({
      error: "Forbidden",
      message: "Apenas o criador da tarefa ou um admin do workspace pode apagá-la.",
    });
    return;
  }

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

// Body for POST /:taskId/subtasks.
//
// Always batch-shaped: the canonical body is `{ items: [...] }`. Single-item
// callers must still wrap their entry in an array. Cap of 50 mirrors the
// limit we apply on other bulk operations; the MCP's add_checklist_items
// tool surfaces it as its primary contract.
const checklistItemSchema = z.object({
  text: z.string().min(1),
  completed: z.boolean().optional().default(false),
  order: z.number().int().optional(),
});

const createSubtasksSchema = z.object({
  items: z.array(checklistItemSchema).min(1).max(50),
});

const updateSubtaskSchema = checklistItemSchema.partial();

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

  const parsed = createSubtasksSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const result = await createSubtasks(workspaceId, taskId, parsed.data.items, {
    userId: req.user!.userId,
    source: req.user?.source ?? null,
  });
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
    req.user?.source ?? null,
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
    req.user?.source ?? null,
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

const attachmentKindSchema = z.enum(["standard", "deliverable"]);

const updateAttachmentKindSchema = z.object({
  kind: attachmentKindSchema,
});

router.get("/:taskId/attachments", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId } = req.params;

  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Approval tasks proxy the *deliverable* attachments of their parent task
  // so approvers see (read-only) the artifacts they need to evaluate.
  const meta = await getApprovalTaskParent(taskId);
  if (meta?.isApprovalTask && meta.parentTaskId) {
    res.json(await listTaskDeliverableAttachments(meta.parentTaskId));
    return;
  }

  res.json(await listTaskAttachments(taskId));
});

// POST /:taskId/attachments removed — clients now call POST /api/storage/uploads/request-url
// which both creates the attachment row AND returns a presigned URL in one call.

router.patch("/:taskId/attachments/:attachmentId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId, attachmentId } = req.params;

  const parsed = updateAttachmentKindSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const updated = await updateTaskAttachmentKind(taskId, attachmentId, parsed.data.kind);
  if (!updated) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }

  res.json(updated);
});

router.delete("/:taskId/attachments/:attachmentId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId, attachmentId } = req.params;

  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Capture the filename before the soft-delete so the activity event can
  // record it (soft-delete only sets deletedAt, so the row stays readable).
  const [meta] = await db
    .select({ filename: attachments.originalFilename })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);

  const deleted = await deleteTaskAttachment(taskId, attachmentId);
  if (!deleted) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }

  await recordTaskActivity({
    taskId,
    actorId: req.user!.userId,
    type: "attachment_removed",
    metadata: { attachmentId, filename: meta?.filename ?? null },
  });

  res.json({ success: true });
});

router.get("/:taskId/attachments/:attachmentId/download", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId, taskId, attachmentId } = req.params;

  if (!(await taskBelongsToWorkspace(workspaceId, taskId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Approval tasks proxy the parent task's deliverables in their listing
  // (see GET /:taskId/attachments). The attachment row belongs to the parent
  // task, so we look it up against the parent id; otherwise the approver
  // always 404s. We constrain to kind=deliverable so an approver can't use
  // an approval task ID to download non-deliverable attachments of the
  // parent (info disclosure).
  const meta = await getApprovalTaskParent(taskId);
  const isApproval = !!(meta?.isApprovalTask && meta.parentTaskId);
  const lookupTaskId = isApproval ? meta!.parentTaskId! : taskId;

  const attachment = await getTaskAttachmentForDownload(
    lookupTaskId,
    attachmentId,
    isApproval ? "deliverable" : undefined,
  );
  if (!attachment) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }

  const storage = getStorage();
  if (!storage.enabled) {
    res.status(503).json({ error: "storage_disabled" });
    return;
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
    stream.stream.pipe(res);
  } catch (error) {
    log.error({ err: error }, "Error downloading attachment");
    res.status(500).json({ error: "Failed to download attachment" });
  }
});

export default router;
