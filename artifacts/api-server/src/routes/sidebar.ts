import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { workspaces, workspaceMembers, maps, userWorkspaceOrder } from "@workspace/db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { z } from "zod";

const router: IRouter = Router();

router.get("/workspaces", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;

  const memberships = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));

  if (memberships.length === 0) {
    res.json([]);
    return;
  }

  const workspaceIds = memberships.map((m) => m.workspaceId);

  const [workspaceList, savedOrders, mapList] = await Promise.all([
    db
      .select()
      .from(workspaces)
      .where(and(inArray(workspaces.id, workspaceIds), eq(workspaces.hidden, false)))
      .orderBy(desc(workspaces.createdAt)),
    db
      .select()
      .from(userWorkspaceOrder)
      .where(eq(userWorkspaceOrder.userId, userId)),
    db
      .select()
      .from(maps)
      .where(and(inArray(maps.workspaceId, workspaceIds), eq(maps.hidden, false))),
  ]);

  const orderMap = new Map(savedOrders.map((o) => [o.workspaceId, o.sortOrder]));
  const expandedMap = new Map(savedOrders.map((o) => [o.workspaceId, o.expanded]));

  const mapsByWorkspace: Record<string, Array<{ id: string; name: string }>> = {};
  for (const map of mapList) {
    if (!mapsByWorkspace[map.workspaceId]) {
      mapsByWorkspace[map.workspaceId] = [];
    }
    mapsByWorkspace[map.workspaceId].push({ id: map.id, name: map.name });
  }

  const result = workspaceList.map((ws) => ({
    id: ws.id,
    name: ws.name,
    createdAt: ws.createdAt,
    sortOrder: orderMap.has(ws.id) ? orderMap.get(ws.id)! : null,
    expanded: expandedMap.has(ws.id) ? expandedMap.get(ws.id)! : true,
    maps: mapsByWorkspace[ws.id] ?? [],
  }));

  result.sort((a, b) => {
    const aHasOrder = a.sortOrder !== null;
    const bHasOrder = b.sortOrder !== null;

    if (aHasOrder && bHasOrder) {
      return a.sortOrder! - b.sortOrder!;
    }
    if (aHasOrder) return 1;
    if (bHasOrder) return -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  res.json(result);
});

const orderSchema = z.object({
  workspaceIds: z.array(z.string().uuid()).refine(
    (ids) => ids.length === new Set(ids).size,
    { message: "workspaceIds must not contain duplicate values" }
  ),
});

router.put("/order", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const { workspaceIds } = parsed.data;

  if (workspaceIds.length === 0) {
    res.json({ success: true });
    return;
  }

  const memberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), inArray(workspaceMembers.workspaceId, workspaceIds)));

  const validIds = new Set(memberships.map((m) => m.workspaceId));
  const invalidIds = workspaceIds.filter((id) => !validIds.has(id));

  if (invalidIds.length > 0) {
    res.status(403).json({
      error: "Forbidden",
      message: "One or more workspace IDs do not belong to the current user",
    });
    return;
  }

  const values = workspaceIds.map((id, idx) => ({
    userId,
    workspaceId: id,
    sortOrder: idx,
  }));

  if (values.length > 0) {
    await db
      .insert(userWorkspaceOrder)
      .values(values)
      .onConflictDoUpdate({
        target: [userWorkspaceOrder.userId, userWorkspaceOrder.workspaceId],
        set: { sortOrder: sql`excluded.sort_order` },
      });
  }

  res.json({ success: true });
});

const expandedSchema = z.object({
  expanded: z.boolean(),
});

router.patch("/workspaces/:workspaceId/expanded", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const { workspaceId } = req.params;
  const parsed = expandedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }

  const [membership] = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)))
    .limit(1);

  if (!membership) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [existing] = await db
    .select()
    .from(userWorkspaceOrder)
    .where(and(eq(userWorkspaceOrder.userId, userId), eq(userWorkspaceOrder.workspaceId, workspaceId)))
    .limit(1);

  if (existing) {
    await db
      .update(userWorkspaceOrder)
      .set({ expanded: parsed.data.expanded })
      .where(and(eq(userWorkspaceOrder.userId, userId), eq(userWorkspaceOrder.workspaceId, workspaceId)));
  } else {
    const maxOrderResult = await db
      .select({ maxOrder: sql<number>`coalesce(max(sort_order), -1)` })
      .from(userWorkspaceOrder)
      .where(eq(userWorkspaceOrder.userId, userId));
    const nextOrder = (maxOrderResult[0]?.maxOrder ?? -1) + 1;

    await db
      .insert(userWorkspaceOrder)
      .values({ userId, workspaceId, sortOrder: nextOrder, expanded: parsed.data.expanded });
  }

  res.json({ success: true, expanded: parsed.data.expanded });
});

export default router;
