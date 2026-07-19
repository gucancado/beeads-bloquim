import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { users, workspaces, workspaceMembers } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { getMemberRoleFresh } from "../middlewares/permissions";

/**
 * Rotas INTERNAS (service-to-service), gated por segredo compartilhado
 * `INTERNAL_API_SECRET` no header `X-Internal-Secret`. NÃO usa cookie/JWT de
 * usuário — é pro worker da plataforma de agentes resolver identidade/permissão.
 * Montado em /api/internal.
 */
function requireInternal(req: Request, res: Response, next: NextFunction): void {
  // Lido lazy (por request), não capturado no load do módulo: permite rotação
  // do secret sem restart e torna o gate testável. Em prod o valor não muda em
  // runtime, então o comportamento é idêntico ao anterior.
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    res.status(503).json({ error: "internal API not configured" });
    return;
  }
  const got = req.headers["x-internal-secret"];
  if (typeof got !== "string" || got.length === 0 || got !== secret) {
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

const workspaceRoleBodySchema = z.object({
  userId: z.string().uuid(),
  workspaceId: z.string().uuid(),
});

/**
 * POST /api/internal/authz/workspace-role
 *
 * Server-to-server: resolve o papel que um usuário tem num workspace. Gated
 * pelo mesmo `requireInternal` (X-Internal-Secret == INTERNAL_API_SECRET).
 *
 * Usa `getMemberRoleFresh` (UNCACHED, ground-truth) — nunca o cache de 30s do
 * permissionsCache — pra que um ator rebaixado/removido não consiga agir na
 * janela do TTL. Toda política de cache deste contrato vive no worker.
 *
 * Body: { userId: string (uuid), workspaceId: string (uuid) }
 * 200: { role: 'admin'|'editor'|'executor'|null }  (null = não-membro)
 * 400: erro de validação do body
 */
internalRouter.post("/authz/workspace-role", async (req, res) => {
  const parsed = workspaceRoleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Bad Request", issues: parsed.error.issues });
    return;
  }
  const { userId, workspaceId } = parsed.data;
  const role = await getMemberRoleFresh(workspaceId, userId);
  res.status(200).json({ role });
});
