import { Router, IRouter } from "express";
import { db } from "@workspace/db";
import { workspaces, workspaceMembers, workspaceAgents } from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { getColorByIndex } from "@workspace/db/colorPalette";

export const meRouter: IRouter = Router();
export const publicRouter: IRouter = Router();

// GET /api/auth/me/workspaces — workspaces the authenticated user is a member of (non-hidden)
meRouter.get("/workspaces", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;

  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      role: workspaceMembers.role,
      hidden: workspaces.hidden,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.hidden, false)));

  res.json(rows);
});

// GET /api/auth/me/agents — agents accessible to the authenticated user (via workspace membership, non-hidden workspaces)
meRouter.get("/agents", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;

  const rows = await db
    .select({
      agentName: workspaceAgents.agentName,
      projectSlug: workspaceAgents.projectSlug,
      workspaceId: workspaceAgents.workspaceId,
      workspaceName: workspaces.name,
    })
    .from(workspaceAgents)
    .innerJoin(workspaces, eq(workspaces.id, workspaceAgents.workspaceId))
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.hidden, false)));

  res.json(rows);
});

// GET /api/public/workspaces?ids=uuid1,uuid2,... — resolve workspace names by UUIDs (non-hidden), requires auth
publicRouter.get("/workspaces", requireAuth, async (req: AuthRequest, res) => {
  const idsParam = req.query.ids as string | undefined;
  if (!idsParam) {
    res.json([]);
    return;
  }

  const ids = idsParam.split(",").filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  if (ids.length === 0) {
    res.json([]);
    return;
  }

  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      hidden: workspaces.hidden,
      colorIndex: workspaces.colorIndex,
    })
    .from(workspaces)
    .where(and(inArray(workspaces.id, ids), eq(workspaces.hidden, false)));

  // Resolve o índice pra hex aqui: mantém a paleta de 16 cores como fonte
  // única no Bloquim — consumidores (painel) não duplicam a tabela de cores.
  res.json(
    rows.map(({ colorIndex, ...workspace }) => ({
      ...workspace,
      color: getColorByIndex(colorIndex),
    })),
  );
});
