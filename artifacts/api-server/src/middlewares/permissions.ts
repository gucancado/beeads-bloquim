import { Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { workspaceMembers } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { AuthRequest } from "./auth";

type WorkspaceRole = "admin" | "editor" | "executor";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    const [member] = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId)
        )
      )
      .limit(1);

    if (!member) {
      res.status(403).json({ error: "Forbidden", message: "Not a member of this workspace" });
      return;
    }

    if (!allowedRoles.includes(member.role as WorkspaceRole)) {
      res.status(403).json({ error: "Forbidden", message: "Insufficient permissions" });
      return;
    }

    (req as any).memberRole = member.role;
    next();
  };
}

export async function getMemberRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    )
    .limit(1);

  return (member?.role as WorkspaceRole) ?? null;
}
