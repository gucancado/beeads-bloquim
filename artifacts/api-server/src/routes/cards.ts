import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { cards, tasks, cardConnections, users } from "@workspace/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requireWorkspaceRole, requireCardInMap, requireMapInWorkspace, getMemberRole } from "../middlewares/permissions";
import { z } from "zod";
import { computeOverdue } from "../lib/overdue";
import { toVisualStatus } from "../services/taskVisualSyncService";
import { resolveSchedule, isWithinScheduleWindow, type ScheduleMode } from "../lib/scheduleMode";
import { tryActivateTask } from "../services/taskActivation";
import { recordTaskActivity } from "../services/taskActivitiesService";

type TaskStatus = "pending" | "in_progress" | "completed" | "overdue" | "blocked" | "draft";

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
  startAt: z.string().datetime().nullable().optional(),
  scheduleMode: z.enum(["ate", "entre", "em", "sem_prazo"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional().default("medium"),
});

const updateTaskStatusSchema = z.object({
  status: z.enum(["pending", "in_progress", "completed", "blocked", "draft"]),
});

const updateTaskDetailsSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  startAt: z.string().datetime().nullable().optional(),
  scheduleMode: z.enum(["ate", "entre", "em", "sem_prazo"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
});

function getApprovalTaskStatusForCards(parentStatus: string): TaskStatus {
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

router.post("/", requireAuth, requireWorkspaceRole(["admin", "editor"]), requireMapInWorkspace, async (req: AuthRequest, res) => {
  const parsed = createCardSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const { workspaceId, mapId } = req.params;
  const userId = (req as AuthRequest).user!.userId;

  const [card] = await db
    .insert(cards)
    .values({ mapId, ...parsed.data })
    .returning();

  const [task] = await db
    .insert(tasks)
    .values({ title: parsed.data.title, mapId, workspaceId, priority: "medium", status: "draft", assignedTo: userId })
    .returning();

  const [updated] = await db
    .update(cards)
    .set({ taskId: task.id, statusVisual: "draft", updatedAt: new Date() })
    .where(eq(cards.id, card.id))
    .returning();

  const [actorUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  await recordTaskActivity({
    taskId: task.id,
    actorId: userId,
    type: "task_created",
    metadata: { actorName: actorUser?.name ?? null },
    source: req.user?.source ?? null,
  });

  res.status(201).json(updated);
});

router.get("/:cardId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), requireCardInMap, async (req, res) => {
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

router.put("/:cardId", requireAuth, requireWorkspaceRole(["admin", "editor"]), requireCardInMap, async (req, res) => {
  const parsed = updateCardSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error" });
    return;
  }

  if (parsed.data.title !== undefined) {
    const [existingCard] = await db.select().from(cards).where(eq(cards.id, req.params.cardId)).limit(1);
    if (existingCard?.taskId) {
      const [linkedTask] = await db.select({ isApprovalTask: tasks.isApprovalTask }).from(tasks).where(eq(tasks.id, existingCard.taskId)).limit(1);
      if (linkedTask?.isApprovalTask) {
        res.status(400).json({ error: "Approval task title is read-only", message: "não é permitido alterar o título de tarefas de aprovação" });
        return;
      }
    }
  }

  const [updated] = await db
    .update(cards)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(cards.id, req.params.cardId))
    .returning();

  if (updated.taskId && (parsed.data.title || parsed.data.description !== undefined)) {
    const taskUpdate: { title?: string; description?: string | null; updatedAt: Date } = { updatedAt: new Date() };
    if (parsed.data.title) taskUpdate.title = parsed.data.title;
    if (parsed.data.description !== undefined) taskUpdate.description = parsed.data.description;
    await db
      .update(tasks)
      .set(taskUpdate)
      .where(eq(tasks.id, updated.taskId));
  }

  res.json(updated);
});

router.delete("/:cardId", requireAuth, requireWorkspaceRole(["admin", "editor"]), requireCardInMap, async (req, res) => {
  const { cardId } = req.params;

  await db.transaction(async (tx) => {
    const [card] = await tx.select().from(cards).where(eq(cards.id, cardId)).limit(1);
    if (card?.taskId) {
      const approvalTasks = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.parentTaskId, card.taskId), eq(tasks.isApprovalTask, true)));
      if (approvalTasks.length > 0) {
        const approvalTaskIds = approvalTasks.map((t) => t.id);
        await tx.delete(cards).where(inArray(cards.taskId, approvalTaskIds));
      }
      await tx.delete(tasks).where(eq(tasks.id, card.taskId));
    }
    await tx.delete(cards).where(eq(cards.id, cardId));
  });

  res.json({ success: true, message: "Card deleted" });
});

router.post("/:cardId/task", requireAuth, requireWorkspaceRole(["admin", "editor"]), requireCardInMap, async (req: AuthRequest, res) => {
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

  const sched = resolveSchedule(parsed.data, { scheduleMode: "ate", startAt: null, dueDate: null });
  if (!sched.ok) {
    res.status(400).json({ error: "Validation error", message: sched.error });
    return;
  }
  const overdue = computeOverdue(sched.value.dueDate, "draft");
  const visual = toVisualStatus("draft", overdue);

  const userId = req.user!.userId;
  const assignedTo = parsed.data.assignedTo === undefined ? userId : parsed.data.assignedTo;

  const { dueDate: _dd, startAt: _sa, scheduleMode: _sm, ...rest } = parsed.data;
  const [task] = await db
    .insert(tasks)
    .values({
      ...rest,
      assignedTo,
      mapId,
      workspaceId,
      dueDate: sched.value.dueDate,
      startAt: sched.value.startAt,
      scheduleMode: sched.value.scheduleMode,
      status: "draft",
      overdue,
    })
    .returning();

  await db
    .update(cards)
    .set({ taskId: task.id, statusVisual: visual, updatedAt: new Date() })
    .where(eq(cards.id, cardId));

  const [actorUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  await recordTaskActivity({
    taskId: task.id,
    actorId: userId,
    type: "task_created",
    metadata: { actorName: actorUser?.name ?? null },
    source: req.user?.source ?? null,
  });

  res.status(201).json(task);
});

router.delete("/:cardId/task", requireAuth, requireWorkspaceRole(["admin", "editor"]), requireCardInMap, async (req, res) => {
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

router.patch("/:cardId/task/status", requireAuth, requireCardInMap, async (req: AuthRequest, res) => {
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

  // Only update previousStatus when the status actually changes
  const previousStatus = task.status !== status ? task.status : task.previousStatus;

  const taskUpdateSet: Record<string, any> = { status, previousStatus, overdue, completedAt, updatedAt: new Date() };

  // Reset parentApprovalStatus when task goes back to in_progress/draft/pending from approved
  if (["in_progress", "draft", "pending"].includes(status) && task.parentApprovalStatus === "approved") {
    taskUpdateSet.parentApprovalStatus = null;
  }

  const [updatedTask] = await db
    .update(tasks)
    .set(taskUpdateSet)
    .where(eq(tasks.id, card.taskId))
    .returning();

  await db
    .update(cards)
    .set({ statusVisual: visual, updatedAt: new Date() })
    .where(eq(cards.id, cardId));

  if (task.status !== status) {
    const [actorUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    await recordTaskActivity({
      taskId: card.taskId,
      actorId: userId,
      type: "status_changed",
      metadata: {
        actorName: actorUser?.name ?? null,
        oldStatus: task.status,
        newStatus: status,
      },
      source: req.user?.source ?? null,
    });

    // Sync approval tasks and their cards if this task has any
    const approvalChildTasks = await db
      .select({ id: tasks.id, dueDate: tasks.dueDate, status: tasks.status, approvalOrder: tasks.approvalOrder })
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, card.taskId!), eq(tasks.isApprovalTask, true)))
      .orderBy(asc(tasks.approvalOrder));

    // When resetting parent to a non-completed state, clear approval decisions so children
    // start fresh in the next cycle.
    const clearApprovalDecisions = ["in_progress", "draft", "pending", "blocked"].includes(status);

    // In sequential mode, when parent completes, only the first approval task activates;
    // the rest stay pending until each predecessor approves.
    const isSequential = (task.approvalMode ?? "sequential") === "sequential";

    for (let i = 0; i < approvalChildTasks.length; i++) {
      const child = approvalChildTasks[i];
      const approvalNewStatus: string =
        status === "completed" && isSequential && i > 0
          ? "pending"
          : getApprovalTaskStatusForCards(status);
      const childOverdue = computeOverdue(child.dueDate, approvalNewStatus);
      const childVisual = toVisualStatus(approvalNewStatus, childOverdue);
      const childUpdateSet: Record<string, any> = { status: approvalNewStatus, overdue: childOverdue, updatedAt: new Date() };
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
      if (child.status !== approvalNewStatus) {
        await recordTaskActivity({
          taskId: child.id,
          actorId: userId,
          type: "status_changed",
          metadata: {
            actorName: actorUser[0]?.name ?? null,
            oldStatus: child.status,
            newStatus: approvalNewStatus,
          },
          source: req.user?.source ?? null,
        });
      }
    }

    // When completing with any approval children, set parentApprovalStatus to in_approval.
    // Children are transitioned to in_progress regardless of their prior state,
    // so any completion with approval children enters the approval cycle.
    if (status === "completed" && approvalChildTasks.length > 0) {
      await db.update(tasks)
        .set({ parentApprovalStatus: "in_approval", updatedAt: new Date() })
        .where(eq(tasks.id, card.taskId!));
      updatedTask.parentApprovalStatus = "in_approval";
    }
  }

  // Cascade: when completed, activate downstream cards connected via right handle
  // A downstream card only advances to "in_progress" if:
  //   1. Its task is currently "pending"
  //   2. ALL cards connected to its left handle (prerequisites) are "completed" or "blocked"
  // Skip cascade if this task is pending approval (parentApprovalStatus='in_approval'):
  // downstream activation will happen once all approvals are resolved via the approve endpoint.
  if (status === "completed" && updatedTask.parentApprovalStatus !== "in_approval") {
    // Find all connections leaving from this card's right handle
    const outgoingConnections = await db
      .select()
      .from(cardConnections)
      .where(
        and(
          eq(cardConnections.sourceCardId, cardId),
          eq(cardConnections.sourceHandle, "source-right")
        )
      );

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

      // Only process tasks that are still "pending"
      if (!targetTask || targetTask.status !== "pending") continue;

      // Find all connections arriving at this target card's left handle (prerequisites)
      const prerequisites = await db
        .select()
        .from(cardConnections)
        .where(
          and(
            eq(cardConnections.targetCardId, conn.targetCardId),
            eq(cardConnections.targetHandle, "target-left")
          )
        );

      // Gather all prerequisite source tasks and check their statuses
      let allPrerequisitesDone = true;
      for (const prereq of prerequisites) {
        const [prereqCard] = await db
          .select()
          .from(cards)
          .where(eq(cards.id, prereq.sourceCardId))
          .limit(1);

        if (!prereqCard?.taskId) {
          // Prerequisite card has no task — treat as not done
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

      // Respect "fazer" schedule modes: "ate" tasks keep the legacy behavior
      // (auto-advance regardless of due date — even if overdue), while
      // "entre"/"em" tasks only advance when today is inside [startAt, dueDate].
      if (!isWithinScheduleWindow(targetTask.scheduleMode, targetTask.startAt, targetTask.dueDate)) continue;

      // All prerequisites are done — advance the target task to "in_progress"
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

router.patch("/:cardId/task/details", requireAuth, requireWorkspaceRole(["admin", "editor"]), requireCardInMap, async (req: AuthRequest, res) => {
  const { cardId } = req.params;
  const userId = req.user!.userId;

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

  if (currentTask?.isApprovalTask && parsed.data.title !== undefined) {
    res.status(400).json({ error: "Approval task title is read-only", message: "não é permitido alterar o título de tarefas de aprovação" });
    return;
  }

  const { dueDate: _dd, startAt: _sa, scheduleMode: _sm, ...rest } = parsed.data;
  const updateData: any = { ...rest, updatedAt: new Date() };
  let resolvedDueDate: Date | null = currentTask?.dueDate ?? null;

  const touchesSchedule = "dueDate" in parsed.data || "startAt" in parsed.data || "scheduleMode" in parsed.data;
  if (touchesSchedule) {
    const sched = resolveSchedule(parsed.data, {
      scheduleMode: (currentTask?.scheduleMode ?? "ate") as ScheduleMode,
      startAt: currentTask?.startAt ?? null,
      dueDate: currentTask?.dueDate ?? null,
    });
    if (!sched.ok) {
      res.status(400).json({ error: "Validation error", message: sched.error });
      return;
    }
    resolvedDueDate = sched.value.dueDate;
    updateData.dueDate = sched.value.dueDate;
    updateData.startAt = sched.value.startAt;
    updateData.scheduleMode = sched.value.scheduleMode;
  }

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

  // If the schedule mode/dates were just touched, re-evaluate eligibility
  // immediately so a pending task whose window opened jumps to in_progress.
  if (touchesSchedule) {
    await tryActivateTask(card.taskId!);
  }

  const [actorUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);

  if (parsed.data.assignedTo !== undefined && currentTask && currentTask.assignedTo !== parsed.data.assignedTo) {
    const newAssigneeId = parsed.data.assignedTo ?? null;
    let newAssigneeName: string | null = null;
    if (newAssigneeId) {
      const [newUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, newAssigneeId)).limit(1);
      newAssigneeName = newUser?.name ?? null;
    }
    let oldAssigneeName: string | null = null;
    if (currentTask.assignedTo) {
      const [oldUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, currentTask.assignedTo)).limit(1);
      oldAssigneeName = oldUser?.name ?? null;
    }
    await recordTaskActivity({
      taskId: card.taskId,
      actorId: userId,
      type: "assignee_changed",
      metadata: {
        actorName: actorUser?.name ?? null,
        actorId: userId,
        newAssigneeId,
        oldAssigneeName,
        newAssigneeName,
      },
      source: req.user?.source ?? null,
    });
  }

  if (parsed.data.priority !== undefined && currentTask && parsed.data.priority !== currentTask.priority) {
    await recordTaskActivity({
      taskId: card.taskId,
      actorId: userId,
      type: "priority_changed",
      metadata: {
        actorName: actorUser?.name ?? null,
        oldPriority: currentTask.priority ?? null,
        newPriority: parsed.data.priority ?? null,
      },
      source: req.user?.source ?? null,
    });
  }

  if (parsed.data.dueDate !== undefined && currentTask) {
    const oldDateStr = currentTask.dueDate ? currentTask.dueDate.toISOString().slice(0, 10) : null;
    const newDateStr = parsed.data.dueDate ? parsed.data.dueDate.slice(0, 10) : null;
    if (oldDateStr !== newDateStr) {
      await recordTaskActivity({
        taskId: card.taskId,
        actorId: userId,
        type: "due_date_changed",
        metadata: {
          actorName: actorUser?.name ?? null,
          oldDueDate: oldDateStr,
          newDueDate: newDateStr,
        },
        source: req.user?.source ?? null,
      });
    }
  }

  res.json(updatedTask);
});

export default router;
