import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { tasks, cards, maps, workspaces, users } from "@workspace/db/schema";
import { eq, and, asc, sql, inArray } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { workspaceId, status } = req.query as { workspaceId?: string; status?: string };
  const statuses = status ? status.split(",").filter(Boolean) : [];

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
      completedAt: tasks.completedAt,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      cardId: cards.id,
      cardTitle: cards.title,
      mapName: maps.name,
      workspaceName: workspaces.name,
      assigneeName: users.name,
    })
    .from(tasks)
    .innerJoin(cards, eq(cards.taskId, tasks.id))
    .innerJoin(maps, eq(maps.id, tasks.mapId))
    .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .where(
      and(
        eq(tasks.assignedTo, userId),
        workspaceId ? eq(tasks.workspaceId, workspaceId) : undefined,
        statuses.length > 0 ? inArray(tasks.status, statuses as any[]) : undefined
      )
    )
    .orderBy(
      sql`${tasks.dueDate} ASC NULLS LAST`,
      asc(tasks.createdAt)
    );

  res.json(taskList);
});

export default router;
