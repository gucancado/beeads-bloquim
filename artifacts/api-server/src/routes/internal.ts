import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { users, workspaces, workspaceMembers } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Rotas INTERNAS (service-to-service), gated por segredo compartilhado
 * `INTERNAL_API_SECRET` no header `X-Internal-Secret`. NÃO usa cookie/JWT de
 * usuário — é pro worker da plataforma de agentes resolver identidade/permissão.
 * Montado em /api/internal.
 */
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET;

function requireInternal(req: Request, res: Response, next: NextFunction): void {
  if (!INTERNAL_SECRET) {
    res.status(503).json({ error: "internal API not configured" });
    return;
  }
  const got = req.headers["x-internal-secret"];
  if (typeof got !== "string" || got.length === 0 || got !== INTERNAL_SECRET) {
    res.status(401).json({ error: "invalid internal secret" });
    return;
  }
  next();
}

export const internalRouter: IRouter = Router();
internalRouter.use(requireInternal);

/**
 * GET /api/internal/resolve-by-whatsapp?phone=5531999594121
 * Resolve um número WhatsApp → usuário Bloquim + workspaces/roles.
 * Compara apenas DÍGITOS dos dois lados (users.whatsapp pode ter espaços/'+',
 * ex.: "+55 31999594121"). 404 se não houver usuário com esse número.
 */
internalRouter.get("/resolve-by-whatsapp", async (req, res) => {
  const raw = String(req.query.phone ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) {
    res.status(400).json({ error: "phone inválido" });
    return;
  }

  const found = await db
    .select({ id: users.id, name: users.name, email: users.email, whatsapp: users.whatsapp })
    .from(users)
    .where(sql`regexp_replace(coalesce(${users.whatsapp}, ''), '[^0-9]', '', 'g') = ${digits}`)
    .limit(1);

  if (found.length === 0) {
    res.status(404).json({ error: "usuário não encontrado" });
    return;
  }

  const u = found[0];
  const ws = await db
    .select({ id: workspaces.id, name: workspaces.name, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, u.id));

  res.json({ userId: u.id, name: u.name, email: u.email, whatsapp: u.whatsapp, workspaces: ws });
});
