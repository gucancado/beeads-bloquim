import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { tasks, cards, maps, workspaces, users } from "@workspace/db/schema";
import { eq, and, or, asc, sql, inArray, isNotNull } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { workspaceId, status } = req.query as { workspaceId?: string; status?: string };
  const statuses = status ? status.split(",").filter(Boolean) : [];
  const filterOverdue = statuses.includes("overdue");
  const otherStatuses = statuses.filter(s => s !== "overdue");

  const buildStatusFilter = () => {
    if (statuses.length === 0) return undefined;
    const parts = [];
    if (filterOverdue) parts.push(eq(tasks.overdue, true));
    if (otherStatuses.length > 0) parts.push(inArray(tasks.status, otherStatuses as any[]));
    return parts.length === 1 ? parts[0] : or(...parts);
  };

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
      overdue: tasks.overdue,
      cardId: cards.id,
      cardTitle: cards.title,
      mapName: maps.name,
      workspaceName: workspaces.name,
      assigneeName: users.name,
    })
    .from(tasks)
    .leftJoin(cards, eq(cards.taskId, tasks.id))
    .leftJoin(maps, eq(maps.id, tasks.mapId))
    .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .where(
      and(
        eq(tasks.assignedTo, userId),
        workspaceId ? eq(tasks.workspaceId, workspaceId) : undefined,
        buildStatusFilter()
      )
    )
    .orderBy(
      sql`${tasks.dueDate} ASC NULLS LAST`,
      asc(tasks.createdAt)
    );

  res.json(taskList);
});

export default router;
