import { Response, NextFunction } from "express";
import { db } from "@workspace/db";
import {
  workspaceMembers,
  cards,
  cardConnections,
  maps,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { AuthRequest } from "./auth";
import { getCachedRole, setCachedRole } from "../lib/permissionsCache";

type WorkspaceRole = "admin" | "editor" | "executor";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Single source of truth for the membership role query.
 *
 * Both `loadRole` (which caches the result) and `getMemberRoleFresh` (which
 * never caches) call this, so any future change to the SELECT — e.g. adding a
 * `deletedAt IS NULL` filter — applies identically to the cached and the
 * uncached ground-truth path. Keep this the ONLY place the query lives.
 */
async function queryRoleFromDb(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const [member] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);

  return (member?.role as WorkspaceRole) ?? null;
}

async function loadRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  const cached = getCachedRole(workspaceId, userId);
  if (cached !== undefined) return cached;

  const role = await queryRoleFromDb(workspaceId, userId);
  setCachedRole(workspaceId, userId, role);
  return role;
}

export function requireWorkspaceRole(allowedRoles: WorkspaceRole[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const { workspaceId } = req.params;
    const userId = req.user!.userId;

    if (!workspaceId) {
      res.status(400).json({ error: "Bad Request", message: "workspaceId required" });
      return;
    }

    if (!UUID_REGEX.test(workspaceId)) {
      res.status(400).json({ error: "Bad Request", message: "Invalid workspace ID" });
      return;
    }

    const role = await loadRole(workspaceId, userId);

    if (!role) {
      res.status(403).json({ error: "Forbidden", message: "Not a member of this workspace" });
      return;
    }

    if (!allowedRoles.includes(role)) {
      res.status(403).json({ error: "Forbidden", message: "Insufficient permissions" });
      return;
    }

    (req as any).memberRole = role;
    next();
  };
}

/**
 * Validates that :cardId belongs to :mapId and :mapId belongs to :workspaceId.
 * Without this, a user with a valid membership in workspace A can pass a
 * cardId from workspace B in the URL and have requireWorkspaceRole pass —
 * because requireWorkspaceRole only checks membership in :workspaceId, not
 * that the rest of the URL refers to that workspace's resources.
 *
 * Run AFTER requireWorkspaceRole.
 */
export async function requireCardInMap(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { workspaceId, mapId, cardId } = req.params;
  if (!cardId || !mapId || !workspaceId) {
    res.status(400).json({ error: "Bad Request", message: "missing path params" });
    return;
  }
  if (!UUID_REGEX.test(cardId) || !UUID_REGEX.test(mapId)) {
    res.status(400).json({ error: "Bad Request", message: "invalid id" });
    return;
  }

  const [row] = await db
    .select({ id: cards.id })
    .from(cards)
    .innerJoin(maps, eq(maps.id, cards.mapId))
    .where(
      and(
        eq(cards.id, cardId),
        eq(cards.mapId, mapId),
        eq(maps.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

/**
 * Validates that :mapId belongs to :workspaceId. Run AFTER requireWorkspaceRole.
 */
export async function requireMapInWorkspace(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { workspaceId, mapId } = req.params;
  if (!mapId || !workspaceId) {
    res.status(400).json({ error: "Bad Request", message: "missing path params" });
    return;
  }
  if (!UUID_REGEX.test(mapId)) {
    res.status(400).json({ error: "Bad Request", message: "invalid id" });
    return;
  }

  const [row] = await db
    .select({ id: maps.id })
    .from(maps)
    .where(and(eq(maps.id, mapId), eq(maps.workspaceId, workspaceId)))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

/**
 * Validates that :connectionId belongs to :mapId, and :mapId belongs to
 * :workspaceId. Run AFTER requireWorkspaceRole.
 */
export async function requireConnectionInMap(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { workspaceId, mapId, connectionId } = req.params;
  if (!connectionId || !mapId || !workspaceId) {
    res.status(400).json({ error: "Bad Request", message: "missing path params" });
    return;
  }
  if (!UUID_REGEX.test(connectionId) || !UUID_REGEX.test(mapId)) {
    res.status(400).json({ error: "Bad Request", message: "invalid id" });
    return;
  }

  const [row] = await db
    .select({ id: cardConnections.id })
    .from(cardConnections)
    .innerJoin(maps, eq(maps.id, cardConnections.mapId))
    .where(
      and(
        eq(cardConnections.id, connectionId),
        eq(cardConnections.mapId, mapId),
        eq(maps.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

export async function getMemberRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  return loadRole(workspaceId, userId);
}

/**
 * Ground-truth, UNCACHED role resolution.
 *
 * Runs the same parameterized membership SELECT as `loadRole`, but never
 * reads from or writes to `permissionsCache`. Use this for service-to-service
 * authz (e.g. the internal /authz/workspace-role endpoint) where a stale role
 * within the cache TTL would be a security hole — e.g. an ex-admin must not be
 * able to act in the TTL window after demotion/removal.
 *
 * The user-facing routes keep using `getMemberRole`/`loadRole` (30s cache) to
 * absorb their per-request poll storm; do NOT route those through this fn.
 */
export async function getMemberRoleFresh(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  return queryRoleFromDb(workspaceId, userId);
}
