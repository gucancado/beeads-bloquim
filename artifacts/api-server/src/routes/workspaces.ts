import { Router, IRouter, Response } from "express";
import { db } from "@workspace/db";
import { workspaces, workspaceMembers, users, maps, cards, tasks } from "@workspace/db/schema";
import { eq, and, inArray, sql, ne } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requireWorkspaceRole } from "../middlewares/permissions";
import { invalidateRole, invalidateWorkspace } from "../lib/permissionsCache";
import { z } from "zod";

const router: IRouter = Router();

import { MAX_COLOR_INDEX } from "@workspace/db/colorPalette";

const workspaceNameSchema = z.object({ name: z.string().min(1) });
const workspaceColorSchema = z.object({ colorIndex: z.number().int().min(1).max(MAX_COLOR_INDEX).nullable() });
const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "editor", "executor"]),
});
const updateRoleSchema = z.object({ role: z.enum(["admin", "editor", "executor"]) });

router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const showHidden = req.query.showHidden === "true";

  const memberships = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));

  if (memberships.length === 0) {
    res.json([]);
    return;
  }

  const workspaceIds = memberships.map((m) => m.workspaceId);
  const workspaceList = await db
    .select()
    .from(workspaces)
    .where(inArray(workspaces.id, workspaceIds));

  const [taskCounts, allMembers] = await Promise.all([
    db
      .select({
        workspaceId: tasks.workspaceId,
        status: tasks.status,
        overdue: tasks.overdue,
        noDue: sql<boolean>`(${tasks.dueDate} IS NULL)`,
        count: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .where(inArray(tasks.workspaceId, workspaceIds))
      .groupBy(tasks.workspaceId, tasks.status, tasks.overdue, sql`(${tasks.dueDate} IS NULL)`),
    db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        name: users.name,
        avatarUrl: users.avatarUrl,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(inArray(workspaceMembers.workspaceId, workspaceIds)),
  ]);

  type StatusDetail = { total: number; overdue: number; noDue: number };
  type WorkspaceCounts = {
    total: number;
    completed: number;
    blocked: number;
    draft: StatusDetail;
    pending: StatusDetail;
    in_progress: StatusDetail;
  };
  const emptyDetail = (): StatusDetail => ({ total: 0, overdue: 0, noDue: 0 });
  const emptyEntry = (): WorkspaceCounts => ({
    total: 0, completed: 0, blocked: 0,
    draft: emptyDetail(), pending: emptyDetail(), in_progress: emptyDetail(),
  });

  const countsByWorkspace: Record<string, WorkspaceCounts> = {};
  for (const row of taskCounts) {
    if (!countsByWorkspace[row.workspaceId]) {
      countsByWorkspace[row.workspaceId] = emptyEntry();
    }
    const entry = countsByWorkspace[row.workspaceId];
    entry.total += row.count;
    const s = row.status as string;
    if (s === "completed") {
      entry.completed += row.count;
    } else if (s === "blocked") {
      entry.blocked += row.count;
    } else if (s === "draft" || s === "pending" || s === "in_progress") {
      const detail = entry[s];
      detail.total += row.count;
      if (row.overdue) detail.overdue += row.count;
      if (row.noDue) detail.noDue += row.count;
    }
  }

  const membersByWorkspace: Record<string, Array<{ id: string; userId: string; name: string; avatarUrl: string | null; role: string }>> = {};
  for (const m of allMembers) {
    if (!membersByWorkspace[m.workspaceId]) {
      membersByWorkspace[m.workspaceId] = [];
    }
    membersByWorkspace[m.workspaceId].push({
      id: m.userId,
      userId: m.userId,
      name: m.name,
      avatarUrl: m.avatarUrl,
      role: m.role,
    });
  }

  for (const wsId of Object.keys(membersByWorkspace)) {
    membersByWorkspace[wsId].sort((a, b) => {
      const roleOrder: Record<string, number> = { admin: 0, editor: 1, executor: 2 };
      const roleDiff = (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3);
      if (roleDiff !== 0) return roleDiff;
      return a.name.localeCompare(b.name);
    });
  }

  const result = workspaceList
    .filter((w) => {
      if (!w.hidden) return true;
      if (!showHidden) return false;
      const membership = memberships.find((m) => m.workspaceId === w.id);
      return membership?.role === "admin";
    })
    .map((w) => {
      const membership = memberships.find((m) => m.workspaceId === w.id)!;
      const counts = countsByWorkspace[w.id] ?? emptyEntry();
      const members = membersByWorkspace[w.id] ?? [];
      return { ...w, role: membership.role, taskCounts: counts, members };
    });

  res.json(result);
});

router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const parsed = workspaceNameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const userId = req.user!.userId;
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: parsed.data.name, createdBy: userId })
    .returning();

  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId,
    role: "admin",
  });
  invalidateRole(workspace.id, userId);

  res.status(201).json({ ...workspace, role: "admin" });
});

router.get("/:workspaceId", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req: AuthRequest, res) => {
  const { workspaceId } = req.params;

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const members = await db
    .select({
      id: workspaceMembers.id,
      workspaceId: workspaceMembers.workspaceId,
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
      user: {
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        createdAt: users.createdAt,
        classes: users.classes,
      },
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId));

  const mapList = await db.select().from(maps).where(eq(maps.workspaceId, workspaceId));

  const userMembership = members.find((m) => m.userId === req.user!.userId);

  res.json({ ...workspace, role: userMembership?.role ?? "executor", members, maps: mapList });
});

router.put("/:workspaceId", requireAuth, requireWorkspaceRole(["admin"]), async (req: AuthRequest, res) => {
  const parsed = workspaceNameSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error" });
    return;
  }

  const [updated] = await db
    .update(workspaces)
    .set({ name: parsed.data.name })
    .where(eq(workspaces.id, req.params.workspaceId))
    .returning();

  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, req.params.workspaceId), eq(workspaceMembers.userId, req.user!.userId)))
    .limit(1);

  res.json({ ...updated, role: membership?.role ?? "admin" });
});

router.patch("/:workspaceId/color", requireAuth, requireWorkspaceRole(["admin"]), async (req, res) => {
  const { workspaceId } = req.params;
  const parsed = workspaceColorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const [updated] = await db
    .update(workspaces)
    .set({ colorIndex: parsed.data.colorIndex })
    .where(eq(workspaces.id, workspaceId))
    .returning();

  res.json(updated);
});

router.patch("/:workspaceId/hidden", requireAuth, requireWorkspaceRole(["admin"]), async (req, res) => {
  const { workspaceId } = req.params;
  const { hidden } = req.body as { hidden: boolean };

  const [updated] = await db
    .update(workspaces)
    .set({ hidden: !!hidden })
    .where(eq(workspaces.id, workspaceId))
    .returning();

  res.json(updated);
});

router.delete("/:workspaceId", requireAuth, requireWorkspaceRole(["admin"]), async (req, res) => {
  await db.delete(workspaces).where(eq(workspaces.id, req.params.workspaceId));
  invalidateWorkspace(req.params.workspaceId);
  res.json({ success: true, message: "Workspace deleted" });
});

router.get("/:workspaceId/members", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req, res) => {
  const members = await db
    .select({
      id: workspaceMembers.id,
      workspaceId: workspaceMembers.workspaceId,
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
      user: {
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        createdAt: users.createdAt,
        classes: users.classes,
      },
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, req.params.workspaceId));

  res.json(members);
});

router.get("/:workspaceId/members/suggestions", requireAuth, requireWorkspaceRole(["admin"]), async (req: AuthRequest, res) => {
  const { workspaceId } = req.params;
  const userId = req.user!.userId;

  const myWorkspaces = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));

  const myWorkspaceIds = myWorkspaces.map((w) => w.workspaceId);
  if (myWorkspaceIds.length === 0) {
    res.json([]);
    return;
  }

  const currentMembers = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));

  const currentMemberIds = new Set(currentMembers.map((m) => m.userId));

  const candidates = await db
    .select({
      userId: workspaceMembers.userId,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(inArray(workspaceMembers.workspaceId, myWorkspaceIds))
    .groupBy(workspaceMembers.userId, users.name, users.email, users.avatarUrl);

  const suggestions = candidates.filter((c) => !currentMemberIds.has(c.userId));

  res.json(suggestions);
});

router.post("/:workspaceId/members", requireAuth, requireWorkspaceRole(["admin"]), async (req, res) => {
  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const [targetUser] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  if (!targetUser) {
    res.status(404).json({ error: "Not found", message: "User with this email not found" });
    return;
  }

  const [member] = await db
    .insert(workspaceMembers)
    .values({ workspaceId: req.params.workspaceId, userId: targetUser.id, role: parsed.data.role })
    .returning();
  invalidateRole(req.params.workspaceId, targetUser.id);

  res.status(201).json({
    ...member,
    user: { id: targetUser.id, name: targetUser.name, email: targetUser.email, createdAt: targetUser.createdAt },
  });
});

async function handleUpdateMemberRole(req: AuthRequest, res: Response) {
  const { workspaceId, memberId } = req.params;
  const parsed = updateRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const [targetMember] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.id, memberId), eq(workspaceMembers.workspaceId, workspaceId)))
    .limit(1);

  if (!targetMember) {
    res.status(404).json({ error: "Not found", message: "Member not found in this workspace" });
    return;
  }

  if (targetMember.userId === req.user!.userId) {
    res.status(403).json({ error: "Forbidden", message: "Admins cannot change their own role" });
    return;
  }

  const [updated] = await db
    .update(workspaceMembers)
    .set({ role: parsed.data.role })
    .where(and(eq(workspaceMembers.id, memberId), eq(workspaceMembers.workspaceId, workspaceId)))
    .returning();
  invalidateRole(workspaceId, updated.userId);

  const [user] = await db.select().from(users).where(eq(users.id, updated.userId)).limit(1);

  res.json({
    ...updated,
    user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
  });
}

router.patch("/:workspaceId/members/:memberId", requireAuth, requireWorkspaceRole(["admin"]), handleUpdateMemberRole);

router.put("/:workspaceId/members/:memberId", requireAuth, requireWorkspaceRole(["admin"]), handleUpdateMemberRole);

router.delete("/:workspaceId/members/:memberId", requireAuth, requireWorkspaceRole(["admin"]), async (req, res) => {
  const { workspaceId, memberId } = req.params;
  // Capture userId before delete so we can invalidate the right cache key.
  const [target] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.id, memberId), eq(workspaceMembers.workspaceId, workspaceId)))
    .limit(1);
  await db.delete(workspaceMembers).where(and(eq(workspaceMembers.id, memberId), eq(workspaceMembers.workspaceId, workspaceId)));
  if (target) invalidateRole(workspaceId, target.userId);
  res.json({ success: true, message: "Member removed" });
});

router.get("/:workspaceId/dashboard", requireAuth, requireWorkspaceRole(["admin", "editor", "executor"]), async (req, res) => {
  const { workspaceId } = req.params;

  const [totalMapsResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(maps)
    .where(eq(maps.workspaceId, workspaceId));

  const [totalCardsResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cards)
    .innerJoin(maps, eq(cards.mapId, maps.id))
    .where(eq(maps.workspaceId, workspaceId));

  const taskStats = await db
    .select({ status: tasks.status, priority: tasks.priority, count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(eq(tasks.workspaceId, workspaceId))
    .groupBy(tasks.status, tasks.priority);

  const tasksByStatus = { pending: 0, in_progress: 0, completed: 0, overdue: 0 };
  const tasksByPriority = { low: 0, medium: 0, high: 0, critical: 0 };
  let totalTasks = 0;

  for (const row of taskStats) {
    tasksByStatus[row.status as keyof typeof tasksByStatus] += row.count;
    tasksByPriority[row.priority as keyof typeof tasksByPriority] += row.count;
    totalTasks += row.count;
  }

  res.json({
    workspaceId,
    totalMaps: totalMapsResult?.count ?? 0,
    totalCards: totalCardsResult?.count ?? 0,
    totalTasks,
    tasksByStatus,
    tasksByPriority,
  });
});

export default router;
