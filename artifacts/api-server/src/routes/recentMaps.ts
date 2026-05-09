import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { maps, workspaces, workspaceMembers, userMapAccess } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;

  const rows = await db
    .select({
      mapId: maps.id,
      workspaceId: maps.workspaceId,
      mapName: maps.name,
      workspaceName: workspaces.name,
      lastAccessedAt: userMapAccess.lastAccessedAt,
    })
    .from(userMapAccess)
    .innerJoin(maps, and(eq(maps.id, userMapAccess.mapId), eq(maps.hidden, false)))
    .innerJoin(workspaces, eq(workspaces.id, maps.workspaceId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, maps.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(eq(userMapAccess.userId, userId))
    .orderBy(desc(userMapAccess.lastAccessedAt))
    .limit(50);

  res.json(rows);
});

export default router;
