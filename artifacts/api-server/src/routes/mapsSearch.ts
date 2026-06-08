import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { maps, workspaces, workspaceMembers } from "@workspace/db/schema";
import { and, eq, ilike, desc, sql } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { actionMapsScope } from "../services/mapsScope";

const router: IRouter = Router();

// Busca cross-workspace de planos por nome. Restringe automaticamente aos
// workspaces dos quais o caller é membro. Inclui o nome/cor do workspace
// no resultado para o cliente exibir a procedência sem chamadas extras.
//
// Hidden maps só aparecem se o caller for admin do workspace correspondente.
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length === 0) {
    res.status(400).json({ error: "Bad Request", message: "query 'q' is required" });
    return;
  }

  const rows = await db
    .select({
      id: maps.id,
      name: maps.name,
      hidden: maps.hidden,
      updatedAt: maps.updatedAt,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      workspaceColorIndex: workspaces.colorIndex,
      memberRole: workspaceMembers.role,
    })
    .from(maps)
    .innerJoin(workspaces, eq(workspaces.id, maps.workspaceId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, maps.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(
      and(
        ilike(maps.name, `%${q}%`),
        actionMapsScope,
        // hidden=true só para admins do workspace correspondente
        sql`(${maps.hidden} = false OR ${workspaceMembers.role} = 'admin')`,
      ),
    )
    .orderBy(desc(maps.updatedAt))
    .limit(50);

  res.json(rows);
});

export default router;
