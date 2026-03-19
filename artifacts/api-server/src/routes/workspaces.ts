import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { workspaces, workspaceMembers, users, maps, cards, tasks } from "@workspace/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requireWorkspaceRole } from "../middlewares/permissions";
import { z } from "zod";

const router: IRouter = Router();

const workspaceNameSchema = z.object({ name: z.string().min(1) });
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

  const result = workspaceList
    .filter((w) => {
      if (!w.hidden) return true;
      if (!showHidden) return false;
      const membership = memberships.find((m) => m.workspaceId === w.id);
      return membership?.role === "admin";
    })
    .map((w) => {
      const membership = memberships.find((m) => m.workspaceId === w.id)!;
      return { ...w, role: membership.role };
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
        createdAt: users.createdAt,
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
        createdAt: users.createdAt,
      },
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, req.params.workspaceId));

  res.json(members);
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

  res.status(201).json({
    ...member,
    user: { id: targetUser.id, name: targetUser.name, email: targetUser.email, createdAt: targetUser.createdAt },
  });
});

router.put("/:workspaceId/members/:memberId", requireAuth, requireWorkspaceRole(["admin"]), async (req, res) => {
  const parsed = updateRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error" });
    return;
  }

  const [updated] = await db
    .update(workspaceMembers)
    .set({ role: parsed.data.role })
    .where(eq(workspaceMembers.id, req.params.memberId))
    .returning();

  const [user] = await db.select().from(users).where(eq(users.id, updated.userId)).limit(1);

  res.json({
    ...updated,
    user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
  });
});

router.delete("/:workspaceId/members/:memberId", requireAuth, requireWorkspaceRole(["admin"]), async (req, res) => {
  await db.delete(workspaceMembers).where(eq(workspaceMembers.id, req.params.memberId));
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
