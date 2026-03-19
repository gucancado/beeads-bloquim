import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { taskComments, cards, tasks, users, workspaceMembers } from "@workspace/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requireWorkspaceRole } from "../middlewares/permissions";
import { z } from "zod";

const router: IRouter = Router({ mergeParams: true });

const createCommentSchema = z.object({
  content: z.string().min(1),
});

router.get(
  "/:cardId/comments",
  requireAuth,
  requireWorkspaceRole(["admin", "editor", "executor"]),
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
        authorName: users.name,
        content: taskComments.content,
        hidden: taskComments.hidden,
        createdAt: taskComments.createdAt,
        updatedAt: taskComments.updatedAt,
      })
      .from(taskComments)
      .innerJoin(users, eq(taskComments.authorId, users.id))
      .where(eq(taskComments.taskId, card.taskId))
      .orderBy(asc(taskComments.createdAt));

    res.json(rows);
  }
);

router.post(
  "/:cardId/comments",
  requireAuth,
  requireWorkspaceRole(["admin", "editor", "executor"]),
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
  async (req: AuthRequest, res) => {
    const { workspaceId, commentId } = req.params;
    const userId = req.user!.userId;

    const [comment] = await db
      .select()
      .from(taskComments)
      .where(eq(taskComments.id, commentId))
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
      .where(eq(taskComments.id, commentId))
      .returning();

    res.json(updated);
  }
);

export default router;
