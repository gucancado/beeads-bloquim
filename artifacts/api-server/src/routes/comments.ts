import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { taskComments, cards, tasks, users, workspaceMembers } from "@workspace/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requireWorkspaceRole, requireCardInMap } from "../middlewares/permissions";
import { z } from "zod";

const router: IRouter = Router({ mergeParams: true });

const createCommentSchema = z.object({
  content: z.string().min(1),
});

router.get(
  "/:cardId/comments",
  requireAuth,
  requireWorkspaceRole(["admin", "editor", "executor"]),
  requireCardInMap,
  async (req: AuthRequest, res) => {
    const { cardId } = req.params;

    const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
    if (!card || !card.taskId) {
      res.status(404).json({ error: "Not found", message: "Card or task not found" });
      return;
    }

    const rows = await db
      .select({
        id: taskComments.id,
        taskId: taskComments.taskId,
        authorId: taskComments.authorId,
        authorName: sql<string>`coalesce(${users.name}, 'Usuário removido')`,
        authorAvatar: users.avatarUrl,
        content: taskComments.content,
        hidden: taskComments.hidden,
        createdAt: taskComments.createdAt,
        updatedAt: taskComments.updatedAt,
      })
      .from(taskComments)
      .leftJoin(users, eq(taskComments.authorId, users.id))
      .where(eq(taskComments.taskId, card.taskId))
      .orderBy(asc(taskComments.createdAt));

    res.json(rows);
  }
);

router.post(
  "/:cardId/comments",
  requireAuth,
  requireWorkspaceRole(["admin", "editor", "executor"]),
  requireCardInMap,
  async (req: AuthRequest, res) => {
    const { cardId } = req.params;
    const userId = req.user!.userId;

    const parsed = createCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", message: parsed.error.message });
      return;
    }

    const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
    if (!card || !card.taskId) {
      res.status(404).json({ error: "Not found", message: "Card or task not found" });
      return;
    }

    const [comment] = await db
      .insert(taskComments)
      .values({ taskId: card.taskId, authorId: userId, content: parsed.data.content })
      .returning();

    const [author] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);

    res.status(201).json({ ...comment, authorName: author?.name ?? "Desconhecido" });
  }
);

router.patch(
  "/:cardId/comments/:commentId",
  requireAuth,
  requireWorkspaceRole(["admin", "editor", "executor"]),
  requireCardInMap,
  async (req: AuthRequest, res) => {
    const { workspaceId, cardId, commentId } = req.params;
    const userId = req.user!.userId;

    // requireCardInMap already verified card is in this workspace's map.
    // Now verify the comment is on the task this card points at — without
    // this, an admin/author could flip the `hidden` flag on any comment
    // in any workspace just by passing a real cardId from their workspace.
    const [card] = await db
      .select({ taskId: cards.taskId })
      .from(cards)
      .where(eq(cards.id, cardId))
      .limit(1);
    if (!card?.taskId) {
      res.status(404).json({ error: "Not found", message: "Card has no task" });
      return;
    }

    const [comment] = await db
      .select()
      .from(taskComments)
      .where(and(eq(taskComments.id, commentId), eq(taskComments.taskId, card.taskId)))
      .limit(1);

    if (!comment) {
      res.status(404).json({ error: "Not found", message: "Comment not found" });
      return;
    }

    const [member] = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1);

    const isAdmin = member?.role === "admin";
    const isAuthor = comment.authorId === userId;

    if (!isAdmin && !isAuthor) {
      res.status(403).json({ error: "Forbidden", message: "Apenas o autor ou um admin pode ocultar este comentário" });
      return;
    }

    const [updated] = await db
      .update(taskComments)
      .set({ hidden: !comment.hidden, updatedAt: new Date() })
      .where(and(eq(taskComments.id, commentId), eq(taskComments.taskId, card.taskId)))
      .returning();

    res.json(updated);
  }
);

const taskRouter: IRouter = Router({ mergeParams: true });

taskRouter.get(
  "/comments",
  requireAuth,
  requireWorkspaceRole(["admin", "editor", "executor"]),
  async (req: AuthRequest, res) => {
    const { workspaceId, taskId } = req.params;

    const [task] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
    if (!task) {
      res.status(404).json({ error: "Not found", message: "Task not found" });
      return;
    }

    const rows = await db
      .select({
        id: taskComments.id,
        taskId: taskComments.taskId,
        authorId: taskComments.authorId,
        authorName: sql<string>`coalesce(${users.name}, 'Usuário removido')`,
        authorAvatar: users.avatarUrl,
        content: taskComments.content,
        hidden: taskComments.hidden,
        createdAt: taskComments.createdAt,
        updatedAt: taskComments.updatedAt,
      })
      .from(taskComments)
      .leftJoin(users, eq(taskComments.authorId, users.id))
      .where(eq(taskComments.taskId, taskId))
      .orderBy(asc(taskComments.createdAt));

    res.json(rows);
  }
);

taskRouter.post(
  "/comments",
  requireAuth,
  requireWorkspaceRole(["admin", "editor", "executor"]),
  async (req: AuthRequest, res) => {
    const { workspaceId, taskId } = req.params;
    const userId = req.user!.userId;

    const parsed = createCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", message: parsed.error.message });
      return;
    }

    const [task] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
    if (!task) {
      res.status(404).json({ error: "Not found", message: "Task not found" });
      return;
    }

    const [comment] = await db
      .insert(taskComments)
      .values({ taskId, authorId: userId, content: parsed.data.content })
      .returning();

    const [author] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);

    res.status(201).json({ ...comment, authorName: author?.name ?? "Desconhecido" });
  }
);

taskRouter.patch(
  "/comments/:commentId",
  requireAuth,
  requireWorkspaceRole(["admin", "editor", "executor"]),
  async (req: AuthRequest, res) => {
    const { workspaceId, taskId, commentId } = req.params;
    const userId = req.user!.userId;

    const [task] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId))).limit(1);
    if (!task) {
      res.status(404).json({ error: "Not found", message: "Task not found" });
      return;
    }

    const [comment] = await db
      .select()
      .from(taskComments)
      .where(and(eq(taskComments.id, commentId), eq(taskComments.taskId, taskId)))
      .limit(1);

    if (!comment) {
      res.status(404).json({ error: "Not found", message: "Comment not found" });
      return;
    }

    const [member] = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1);

    const isAdmin = member?.role === "admin";
    const isAuthor = comment.authorId === userId;

    if (!isAdmin && !isAuthor) {
      res.status(403).json({ error: "Forbidden", message: "Apenas o autor ou um admin pode ocultar este comentário" });
      return;
    }

    const [updated] = await db
      .update(taskComments)
      .set({ hidden: !comment.hidden, updatedAt: new Date() })
      .where(and(eq(taskComments.id, commentId), eq(taskComments.taskId, taskId)))
      .returning();

    res.json(updated);
  }
);

export { taskRouter };
export default router;
