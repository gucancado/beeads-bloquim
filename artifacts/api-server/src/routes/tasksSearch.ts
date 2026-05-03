import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { tasks, maps, workspaces, workspaceMembers, users } from "@workspace/db/schema";
import { eq, and, or, ilike, inArray, isNull, desc, not } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

const MAX_RESULTS = 20;
const MIN_QUERY_LENGTH = 2;
const VALID_STATUSES = new Set([
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "draft",
]);

router.get("/search", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const rawQ = typeof req.query.q === "string" ? req.query.q : "";
  const q = rawQ.trim();
  if (q.length < MIN_QUERY_LENGTH) {
    return res.json([]);
  }

  const rawStatus = typeof req.query.status === "string" ? req.query.status : "";
  const statusFilter = rawStatus
    .split(",")
    .map((s) => s.trim())
    .filter((s) => VALID_STATUSES.has(s));

  const rawWorkspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId.trim() : "";
  const workspaceIdFilter = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawWorkspaceId)
    ? rawWorkspaceId
    : null;

  const memberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  const memberWorkspaceIds = memberships.map((m) => m.workspaceId);

  let ownershipFilter;
  if (workspaceIdFilter) {
    if (!memberWorkspaceIds.includes(workspaceIdFilter)) {
      return res.json([]);
    }
    ownershipFilter = eq(tasks.workspaceId, workspaceIdFilter);
  } else {
    ownershipFilter =
      memberWorkspaceIds.length > 0
        ? or(
            inArray(tasks.workspaceId, memberWorkspaceIds),
            and(isNull(tasks.workspaceId), eq(tasks.assignedTo, userId)),
          )
        : and(isNull(tasks.workspaceId), eq(tasks.assignedTo, userId));
  }

  const pattern = `%${q.replace(/[\\%_]/g, (ch) => "\\" + ch)}%`;

  const results = await db
    .select({
      id: tasks.id,
      mapId: tasks.mapId,
      workspaceId: tasks.workspaceId,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      startAt: tasks.startAt,
      scheduleMode: tasks.scheduleMode,
      overdue: tasks.overdue,
      assignedTo: tasks.assignedTo,
      assigneeName: users.name,
      assigneeAvatarUrl: users.avatarUrl,
      workspaceName: workspaces.name,
      workspaceColorIndex: workspaces.colorIndex,
      mapName: maps.name,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .leftJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .leftJoin(maps, eq(maps.id, tasks.mapId))
    .where(
      and(
        ownershipFilter,
        or(ilike(tasks.title, pattern), ilike(tasks.description, pattern)),
        not(and(eq(tasks.isApprovalTask, true), eq(tasks.status, "draft"))),
        statusFilter.length > 0
          ? inArray(tasks.status, statusFilter as ("pending" | "in_progress" | "completed" | "blocked" | "draft")[])
          : undefined,
      ),
    )
    .orderBy(desc(tasks.updatedAt))
    .limit(MAX_RESULTS);

  return res.json(results);
});

export default router;
