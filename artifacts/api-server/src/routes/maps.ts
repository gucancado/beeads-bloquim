import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { maps, cards, cardConnections, tasks, users, userMapAccess, mapTextElements, attachmentLinks } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requireWorkspaceRole } from "../middlewares/permissions";
import { z } from "zod";

const router: IRouter = Router({ mergeParams: true });

const mapNameSchema = z.object({ name: z.string().min(1) });

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
      taskAssigneeName: users.name,
      taskAssigneeId: tasks.assignedTo,
      taskOverdue: tasks.overdue,
      taskAssigneeAvatarUrl: users.avatarUrl,
      taskCompletedAt: tasks.completedAt,
      taskIsApprovalTask: tasks.isApprovalTask,
      taskParentTaskId: tasks.parentTaskId,
      taskApprovalMode: tasks.approvalMode,
      taskApprovalDecision: tasks.approvalStatus,
      taskApprovalOrder: tasks.approvalOrder,
      taskParentApprovalStatus: tasks.parentApprovalStatus,
      taskAttachmentCount: sql<number>`(SELECT COUNT(*) FROM attachment_links WHERE entity_type = 'task' AND entity_id = ${tasks.id})`,
    })
    .from(cards)
    .leftJoin(tasks, eq(tasks.id, cards.taskId))
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .where(eq(cards.mapId, mapId));

  const cardList = rawCards.map(({ taskDueDate, taskAssigneeName, taskAssigneeId, taskOverdue, taskAssigneeAvatarUrl, taskCompletedAt, taskIsApprovalTask, taskParentTaskId, taskApprovalMode, taskApprovalDecision, taskApprovalOrder, taskParentApprovalStatus, taskAttachmentCount, ...c }) => ({
    ...c,
    taskDueDate: taskDueDate ?? null,
    taskAssigneeName: taskAssigneeName ?? null,
    taskAssigneeId: taskAssigneeId ?? null,
    taskOverdue: taskOverdue ?? false,
    taskAssigneeAvatarUrl: taskAssigneeAvatarUrl ?? null,
    taskCompletedAt: taskCompletedAt ? taskCompletedAt.toISOString() : null,
    taskIsApprovalTask: taskIsApprovalTask ?? false,
    taskParentTaskId: taskParentTaskId ?? null,
    taskApprovalMode: taskApprovalMode ?? null,
    taskApprovalDecision: taskApprovalDecision ?? null,
    taskApprovalOrder: taskApprovalOrder ?? null,
    taskParentApprovalStatus: taskParentApprovalStatus ?? null,
    taskAttachmentCount: Number(taskAttachmentCount ?? 0),
  }));

  const connectionList = await db.select().from(cardConnections).where(eq(cardConnections.mapId, mapId));
  const textElementList = await db.select().from(mapTextElements).where(eq(mapTextElements.mapId, mapId));

  res.json({ ...map, cards: cardList, connections: connectionList, textElements: textElementList });
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

export default router;
