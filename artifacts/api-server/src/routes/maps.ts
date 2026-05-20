import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { maps, cards, cardConnections, tasks, users, userMapAccess, mapTextElements, attachments, mapShapes } from "@workspace/db/schema";
import { eq, and, sql, isNull, ilike, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requireWorkspaceRole, requireMapInWorkspace } from "../middlewares/permissions";
import { toVisualStatus } from "../services/taskVisualSyncService";
import { recordTaskActivity } from "../services/taskActivitiesService";
import { z } from "zod";

const router: IRouter = Router({ mergeParams: true });

const mapNameSchema = z.object({ name: z.string().min(1) });
const attachTaskSchema = z.object({ taskId: z.string().uuid() });

router.get("/", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId } = req.params;
  const showHidden = req.query.showHidden === "true";
  const userRole = (req as any).memberRole as string | undefined;

  const mapList = await db.select().from(maps).where(eq(maps.workspaceId, workspaceId));

  const filtered = mapList.filter((m) => {
    if (!m.hidden) return true;
    if (!showHidden) return false;
    return userRole === "admin";
  });

  res.json(filtered);
});

router.post("/", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req: AuthRequest, res) => {
  const parsed = mapNameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const [map] = await db
    .insert(maps)
    .values({ workspaceId: req.params.workspaceId, name: parsed.data.name, createdBy: req.user!.userId })
    .returning();

  res.status(201).json(map);
});

// Busca planos por nome dentro do workspace. Declarada ANTES de `GET /:mapId`
// para que o segmento literal "search" não seja capturado como UUID inválido.
router.get(
  "/search",
  requireAuth,
  requireWorkspaceRole(["admin", "editor", "executor"]),
  async (req: AuthRequest, res) => {
    const { workspaceId } = req.params;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length === 0) {
      res.status(400).json({ error: "Bad Request", message: "query 'q' is required" });
      return;
    }

    const userRole = (req as any).memberRole as string | undefined;

    const rows = await db
      .select()
      .from(maps)
      .where(and(eq(maps.workspaceId, workspaceId), ilike(maps.name, `%${q}%`)))
      .orderBy(desc(maps.updatedAt))
      .limit(50);

    // Admins veem hidden; demais roles não.
    const filtered = userRole === "admin" ? rows : rows.filter((m) => !m.hidden);
    res.json(filtered);
  },
);

router.get("/:mapId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req, res) => {
  const { workspaceId, mapId } = req.params;

  const [map] = await db
    .select()
    .from(maps)
    .where(and(eq(maps.id, mapId), eq(maps.workspaceId, workspaceId)))
    .limit(1);

  if (!map) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const parentTasks = alias(tasks, "parent_tasks");
  const rawCards = await db
    .select({
      id: cards.id,
      mapId: cards.mapId,
      title: cards.title,
      description: cards.description,
      positionX: cards.positionX,
      positionY: cards.positionY,
      statusVisual: cards.statusVisual,
      taskId: cards.taskId,
      createdAt: cards.createdAt,
      updatedAt: cards.updatedAt,
      taskDueDate: tasks.dueDate,
      taskStartAt: tasks.startAt,
      taskScheduleMode: tasks.scheduleMode,
      taskAssigneeName: users.name,
      taskAssigneeId: tasks.assignedTo,
      taskOverdue: tasks.overdue,
      taskAssigneeAvatarUrl: users.avatarUrl,
      taskAssigneeClasses: users.classes,
      taskCompletedAt: tasks.completedAt,
      taskIsApprovalTask: tasks.isApprovalTask,
      taskParentTaskId: tasks.parentTaskId,
      parentTaskTitle: parentTasks.title,
      taskApprovalMode: tasks.approvalMode,
      taskApprovalDecision: tasks.approvalStatus,
      taskApprovalOrder: tasks.approvalOrder,
      taskParentApprovalStatus: tasks.parentApprovalStatus,
      taskAttachmentCount: sql<number>`(SELECT COUNT(*) FROM task_attachments ta JOIN attachments a ON a.id = ta.attachment_id WHERE ta.task_id = ${tasks.id} AND a.deleted_at IS NULL)`,
      taskSubtaskCount: sql<number>`(SELECT COUNT(*) FROM subtasks WHERE task_id = ${tasks.id})`,
      taskSubtaskCompletedCount: sql<number>`(SELECT COUNT(*) FROM subtasks WHERE task_id = ${tasks.id} AND completed = true)`,
      taskCommentCount: sql<number>`((SELECT COUNT(*) FROM task_comments WHERE task_id = ${tasks.id}) + (SELECT COUNT(*) FROM task_comments tc JOIN tasks ct ON ct.id = tc.task_id WHERE ct.parent_task_id = ${tasks.id} AND ct.is_approval_task = true))`,
    })
    .from(cards)
    .leftJoin(tasks, eq(tasks.id, cards.taskId))
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .leftJoin(parentTasks, eq(parentTasks.id, tasks.parentTaskId))
    .where(eq(cards.mapId, mapId));

  const cardList = rawCards.map(({ taskDueDate, taskStartAt, taskScheduleMode, taskAssigneeName, taskAssigneeId, taskOverdue, taskAssigneeAvatarUrl, taskAssigneeClasses, taskCompletedAt, taskIsApprovalTask, taskParentTaskId, parentTaskTitle, taskApprovalMode, taskApprovalDecision, taskApprovalOrder, taskParentApprovalStatus, taskAttachmentCount, taskSubtaskCount, taskSubtaskCompletedCount, taskCommentCount, ...c }) => ({
    ...c,
    taskDueDate: taskDueDate ?? null,
    taskStartAt: taskStartAt ?? null,
    taskScheduleMode: taskScheduleMode ?? null,
    taskAssigneeName: taskAssigneeName ?? null,
    taskAssigneeId: taskAssigneeId ?? null,
    taskOverdue: taskOverdue ?? false,
    taskAssigneeAvatarUrl: taskAssigneeAvatarUrl ?? null,
    taskAssigneeClasses: taskAssigneeClasses ?? [],
    taskCompletedAt: taskCompletedAt ? taskCompletedAt.toISOString() : null,
    taskIsApprovalTask: taskIsApprovalTask ?? false,
    taskParentTaskId: taskParentTaskId ?? null,
    parentTaskTitle: parentTaskTitle ?? null,
    taskApprovalMode: taskApprovalMode ?? null,
    taskApprovalDecision: taskApprovalDecision ?? null,
    taskApprovalOrder: taskApprovalOrder ?? null,
    taskParentApprovalStatus: taskParentApprovalStatus ?? null,
    taskAttachmentCount: Number(taskAttachmentCount ?? 0),
    taskSubtaskCount: Number(taskSubtaskCount ?? 0),
    taskSubtaskCompletedCount: Number(taskSubtaskCompletedCount ?? 0),
    taskCommentCount: Number(taskCommentCount ?? 0),
  }));

  const connectionList = await db.select().from(cardConnections).where(eq(cardConnections.mapId, mapId));
  const textElementList = await db.select().from(mapTextElements).where(eq(mapTextElements.mapId, mapId));
  const shapeList = await db
    .select({
      id: mapShapes.id,
      mapId: mapShapes.mapId,
      type: mapShapes.type,
      positionX: mapShapes.positionX,
      positionY: mapShapes.positionY,
      width: mapShapes.width,
      height: mapShapes.height,
      rotation: mapShapes.rotation,
      color: mapShapes.color,
      filled: mapShapes.filled,
      strokeStyle: mapShapes.strokeStyle,
      x1: mapShapes.x1,
      y1: mapShapes.y1,
      x2: mapShapes.x2,
      y2: mapShapes.y2,
      attachmentId: mapShapes.attachmentId,
      fileName: attachments.originalFilename,
      mimeType: attachments.mimeType,
      fileSize: attachments.fileSize,
      createdAt: mapShapes.createdAt,
      updatedAt: mapShapes.updatedAt,
    })
    .from(mapShapes)
    .leftJoin(attachments, eq(attachments.id, mapShapes.attachmentId))
    .where(eq(mapShapes.mapId, mapId));

  res.json({ ...map, cards: cardList, connections: connectionList, textElements: textElementList, shapes: shapeList });
});

router.put("/:mapId", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req, res) => {
  const parsed = mapNameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error" });
    return;
  }

  const [updated] = await db
    .update(maps)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(and(eq(maps.id, req.params.mapId), eq(maps.workspaceId, req.params.workspaceId)))
    .returning();

  res.json(updated);
});

router.patch("/:mapId/hidden", requireAuth, requireWorkspaceRole(["admin"]), async (req, res) => {
  const { mapId, workspaceId } = req.params;
  const { hidden } = req.body as { hidden: boolean };

  const [updated] = await db
    .update(maps)
    .set({ hidden: !!hidden, updatedAt: new Date() })
    .where(and(eq(maps.id, mapId), eq(maps.workspaceId, workspaceId)))
    .returning();

  res.json(updated);
});

router.delete("/:mapId", requireAuth, requireWorkspaceRole(["admin", "editor"]), async (req, res) => {
  await db
    .delete(maps)
    .where(and(eq(maps.id, req.params.mapId), eq(maps.workspaceId, req.params.workspaceId)));
  res.json({ success: true, message: "Map deleted" });
});

router.post("/:mapId/access", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { mapId, workspaceId } = req.params;
  const userId = req.user!.userId;

  const [map] = await db
    .select({ id: maps.id })
    .from(maps)
    .where(and(eq(maps.id, mapId), eq(maps.workspaceId, workspaceId)))
    .limit(1);

  if (!map) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await db
    .insert(userMapAccess)
    .values({ userId, mapId, lastAccessedAt: new Date() })
    .onConflictDoUpdate({
      target: [userMapAccess.userId, userMapAccess.mapId],
      set: { lastAccessedAt: new Date() },
    });

  res.status(204).end();
});

// Anexa uma task standalone-no-workspace (mapId = null) ao plano. Não cria
// task nova — apenas vincula uma existente. O agente MCP não lida com cards;
// aqui o backend cria o card no canvas em uma posição vazia e seta tasks.mapId.
//
// Invariantes:
//  - task.workspaceId === :workspaceId
//  - task.mapId IS NULL (task ainda não pertence a nenhum plano)
//  - task.isRecurring === false  (planos não suportam recorrência — mesma
//    regra de PUT /workspaces/:wsId/tasks/:taskId)
//  - task.isApprovalTask === false e task.parentTaskId IS NULL
//    (filhas só vivem dentro do mesmo plano da mãe)
router.post(
  "/:mapId/attach-task",
  requireAuth,
  requireWorkspaceRole(["admin", "editor"]),
  requireMapInWorkspace,
  async (req: AuthRequest, res) => {
    const parsed = attachTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", message: parsed.error.message });
      return;
    }

    const { workspaceId, mapId } = req.params;
    const { taskId } = parsed.data;
    const userId = req.user!.userId;

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) {
      res.status(404).json({ error: "Not found", message: "Task not found" });
      return;
    }
    if (task.workspaceId !== workspaceId) {
      res.status(400).json({
        error: "Invalid scope",
        message: "A tarefa pertence a outro workspace. Anexar entre workspaces não é suportado.",
      });
      return;
    }
    if (task.mapId !== null) {
      res.status(409).json({
        error: "Conflict",
        message: "Esta tarefa já está anexada a um plano. Use detach-task antes de mover.",
      });
      return;
    }
    if (task.isRecurring) {
      res.status(400).json({
        error: "Invalid task",
        message: "Tarefas recorrentes não podem ser anexadas a planos.",
      });
      return;
    }
    if (task.isApprovalTask || task.parentTaskId !== null) {
      res.status(400).json({
        error: "Invalid task",
        message: "Tarefas filhas (subtask/aprovação) não podem ser anexadas individualmente.",
      });
      return;
    }

    // Calcula uma posição livre no canvas: abaixo do card mais ao sul.
    const [{ maxY } = { maxY: null }] = await db
      .select({ maxY: sql<number | null>`MAX(${cards.positionY})` })
      .from(cards)
      .where(eq(cards.mapId, mapId));
    const positionY = (maxY ?? -150) + 150;

    const visual = toVisualStatus(task.status ?? "draft", !!task.overdue);

    // Transação garante card + tasks.mapId mudando juntos. Atualizamos a task
    // PRIMEIRO com WHERE mapId IS NULL — se a guarda perder a corrida, lançamos
    // pra fazer rollback de tudo (não há card órfão).
    let result: { card: typeof cards.$inferSelect; task: typeof tasks.$inferSelect };
    try {
      result = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(tasks)
          .set({ mapId, updatedAt: new Date() })
          .where(and(eq(tasks.id, taskId), isNull(tasks.mapId)))
          .returning();
        if (!updated) {
          throw new Error("CONCURRENT_ATTACH");
        }
        const [card] = await tx
          .insert(cards)
          .values({
            mapId,
            title: task.title,
            description: task.description,
            positionX: 0,
            positionY,
            statusVisual: visual,
            taskId: task.id,
          })
          .returning();
        return { card, task: updated };
      });
    } catch (err) {
      if (err instanceof Error && err.message === "CONCURRENT_ATTACH") {
        res.status(409).json({
          error: "Conflict",
          message: "Tarefa foi anexada a outro plano simultaneamente.",
        });
        return;
      }
      throw err;
    }

    const [mapRow] = await db.select({ name: maps.name }).from(maps).where(eq(maps.id, mapId)).limit(1);
    await recordTaskActivity({
      taskId,
      actorId: userId,
      type: "task_moved",
      metadata: {
        kind: "attached_to_plan",
        toMapId: mapId,
        toMapName: mapRow?.name ?? null,
      },
      source: req.user?.source ?? null,
    });

    res.status(200).json({ task: result.task, card: result.card });
  },
);

// Desanexa uma task de um plano. Remove o card vinculado (cascade limpa
// connections) e zera tasks.mapId — a task volta a ser standalone-no-workspace.
//
// Invariantes:
//  - task.workspaceId === :workspaceId
//  - task.mapId === :mapId
//  - task.isApprovalTask === false  (approval tasks são gerenciadas pela
//    task pai e não devem ser desanexadas isoladamente)
router.post(
  "/:mapId/detach-task",
  requireAuth,
  requireWorkspaceRole(["admin", "editor"]),
  requireMapInWorkspace,
  async (req: AuthRequest, res) => {
    const parsed = attachTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", message: parsed.error.message });
      return;
    }

    const { workspaceId, mapId } = req.params;
    const { taskId } = parsed.data;
    const userId = req.user!.userId;

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) {
      res.status(404).json({ error: "Not found", message: "Task not found" });
      return;
    }
    if (task.workspaceId !== workspaceId) {
      res.status(400).json({
        error: "Invalid scope",
        message: "A tarefa pertence a outro workspace.",
      });
      return;
    }
    if (task.mapId !== mapId) {
      res.status(400).json({
        error: "Invalid state",
        message: "A tarefa não está anexada a este plano.",
      });
      return;
    }
    if (task.isApprovalTask) {
      res.status(400).json({
        error: "Invalid task",
        message: "Tarefas de aprovação não podem ser desanexadas individualmente.",
      });
      return;
    }

    const result = await db.transaction(async (tx) => {
      // FK em cardConnections é cascade no card, então deletar o card já limpa
      // as conexões que entram/saem dele.
      await tx.delete(cards).where(eq(cards.taskId, taskId));
      const [updated] = await tx
        .update(tasks)
        .set({ mapId: null, updatedAt: new Date() })
        .where(and(eq(tasks.id, taskId), eq(tasks.mapId, mapId)))
        .returning();
      return updated;
    });

    if (!result) {
      res.status(409).json({
        error: "Conflict",
        message: "Estado do plano mudou durante a operação.",
      });
      return;
    }

    const [mapRow] = await db.select({ name: maps.name }).from(maps).where(eq(maps.id, mapId)).limit(1);
    await recordTaskActivity({
      taskId,
      actorId: userId,
      type: "task_moved",
      metadata: {
        kind: "detached_from_plan",
        fromMapId: mapId,
        fromMapName: mapRow?.name ?? null,
      },
      source: req.user?.source ?? null,
    });

    res.status(200).json({ task: result });
  },
);

export default router;
