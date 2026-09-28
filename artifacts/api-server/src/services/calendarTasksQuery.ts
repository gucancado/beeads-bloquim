import { db } from "@workspace/db";
import { tasks, cards, maps, workspaces, workspaceMembers, users } from "@workspace/db/schema";
import { and, eq, gte, inArray, isNull, lt, ne, not, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export const ACTIVE_STATUSES = ["draft", "pending", "in_progress"] as const;
export const CALENDAR_STATUSES = ["draft", "pending", "in_progress", "completed", "blocked"] as const;
export type CalendarStatus = (typeof CALENDAR_STATUSES)[number];
/** Filtro "todos" = tudo menos cancelada. */
export const TODOS_STATUSES: CalendarStatus[] = ["draft", "pending", "in_progress", "completed"];

export interface CalendarTasksParams {
  userId: string;
  /** null = escopo "minhas tarefas" (workspaces visíveis + standalone do usuário). */
  workspaceId: string | null;
  statuses: CalendarStatus[];
  /** "me" | "unassigned" | uuid. Vazio = sem filtro de pessoas. */
  assignees: string[];
  from: Date;
  to: Date;
}

const blockedSinceExpr = sql<string | null>`(SELECT MAX(a.created_at) FROM task_activities a WHERE a.task_id = ${tasks.id} AND a.type = 'status_changed' AND a.metadata->>'newStatus' = 'blocked')`;

function assigneeFilter(userId: string, assignees: string[]): SQL | undefined {
  if (assignees.length === 0) return undefined;
  const hasMe = assignees.includes("me");
  const hasUnassigned = assignees.includes("unassigned");
  const uuids = assignees.filter(a => a !== "me" && a !== "unassigned");
  const scope = (field: typeof tasks.assignedTo | typeof tasks.ownerId) => {
    const parts: SQL[] = [];
    if (hasMe) parts.push(eq(field, userId));
    if (hasUnassigned) parts.push(isNull(field));
    if (uuids.length > 0) parts.push(inArray(field, uuids));
    return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : or(...parts);
  };
  // Rascunho filtra pelo dono, como as listas (workspaceTasks.ts / myTasks.ts).
  return or(
    and(ne(tasks.status, "draft"), scope(tasks.assignedTo)),
    and(eq(tasks.status, "draft"), scope(tasks.ownerId)),
  );
}

async function scopeFilter(userId: string, workspaceId: string | null): Promise<SQL | undefined> {
  if (workspaceId) return eq(tasks.workspaceId, workspaceId);
  const memberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.hidden, false)));
  const ids = memberships.map(m => m.workspaceId);
  const standalone = and(isNull(tasks.workspaceId), eq(tasks.assignedTo, userId));
  return ids.length > 0 ? or(inArray(tasks.workspaceId, ids), standalone) : standalone;
}

function statusWindowFilter(statuses: CalendarStatus[], from: Date, to: Date): SQL | undefined {
  const active = statuses.filter(s => (ACTIVE_STATUSES as readonly string[]).includes(s));
  const parts: SQL[] = [];
  if (active.length > 0) parts.push(inArray(tasks.status, active));
  if (statuses.includes("completed")) {
    parts.push(and(eq(tasks.status, "completed"), gte(tasks.completedAt, from), lt(tasks.completedAt, to))!);
  }
  if (statuses.includes("blocked")) {
    // timestamp SEM tz: serializar com toISOString antes de interpolar (ver myTasks.ts, cursor).
    const cancelledExpr = sql`COALESCE(${tasks.cancelledAt}, ${blockedSinceExpr})`;
    parts.push(and(
      eq(tasks.status, "blocked"),
      sql`${cancelledExpr} >= ${from.toISOString()}::timestamp`,
      sql`${cancelledExpr} < ${to.toISOString()}::timestamp`,
    )!);
  }
  if (parts.length === 0) return sql`false`;
  return parts.length === 1 ? parts[0] : or(...parts);
}

export async function listCalendarTasks(p: CalendarTasksParams) {
  const parentTasks = alias(tasks, "parent_tasks");
  return db
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
      blockedSince: blockedSinceExpr,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      plannedDate: tasks.plannedDate,
      plannedOrder: tasks.plannedOrder,
      isApprovalTask: tasks.isApprovalTask,
      approvalStatus: tasks.approvalStatus,
      parentApprovalStatus: tasks.parentApprovalStatus,
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
    .where(and(
      await scopeFilter(p.userId, p.workspaceId),
      assigneeFilter(p.userId, p.assignees),
      not(and(eq(tasks.isApprovalTask, true), eq(tasks.status, "draft"))!),
      statusWindowFilter(p.statuses, p.from, p.to),
    ))
    .limit(1000);
}
