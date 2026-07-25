import { Router, IRouter } from "express";
import { z } from "zod/v4";
import { and, eq, or, isNull, inArray, desc, asc } from "drizzle-orm";
import { db } from "@workspace/db";
import { meetings, workspaceMembers, maps, userGoogleCalendarAccounts, type Meeting } from "@workspace/db/schema";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import { requireMeetings } from "../lib/featureFlags";
import {
  getWorkerClient, WorkerConflictError, AttributionFrozenError,
  extractMeetCode, syncMeetingFromWorker,
} from "../services/meetingCollectorService";

// Re-export para compat com imports existentes (extractMeetCode mora no service agora).
export { extractMeetCode };

const router: IRouter = Router();
router.use(requireMeetings);

const createSchema = z.object({
  meetUrlOrCode: z.string().min(1),
  workspaceId: z.string().uuid().nullable().optional(),
  mapId: z.string().uuid().nullable().optional(),
  title: z.string().nullable().optional(),
});

async function assertMembership(userId: string, workspaceId: string): Promise<boolean> {
  const [m] = await db.select().from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  return !!m;
}

/**
 * Autorização unificada pra agir sobre uma reunião. Rows de agenda têm
 * createdBy null (não foram criadas por um user), então a visibilidade vem do
 * workspace (quando atribuída) ou do dono da agenda conectada que a originou
 * (needs_triage, ainda sem workspace).
 */
export async function canActOnMeeting(userId: string, row: Meeting): Promise<boolean> {
  if (row.workspaceId) return assertMembership(userId, row.workspaceId);
  if (row.createdBy === userId) return true;
  if (row.sourceAccountId) {
    const [acc] = await db.select({ id: userGoogleCalendarAccounts.id })
      .from(userGoogleCalendarAccounts)
      .where(and(eq(userGoogleCalendarAccounts.id, row.sourceAccountId), eq(userGoogleCalendarAccounts.userId, userId)));
    return !!acc;
  }
  return false;
}

// POST /api/meetings
router.post("/", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });

  const meetCode = extractMeetCode(parsed.data.meetUrlOrCode);
  if (!meetCode) return res.status(400).json({ message: "Código de reunião inválido (formato xxx-xxxx-xxx)." });

  const workspaceId = parsed.data.workspaceId ?? null;
  const mapId = parsed.data.mapId ?? null;
  if (workspaceId) {
    if (!(await assertMembership(userId, workspaceId))) return res.status(403).json({ message: "Você não é membro deste workspace" });
    if (mapId) {
      const [map] = await db.select().from(maps).where(and(eq(maps.id, mapId), eq(maps.workspaceId, workspaceId)));
      if (!map) return res.status(400).json({ message: "Plano não encontrado neste workspace" });
    }
  } else if (mapId) {
    return res.status(400).json({ message: "Selecione um workspace antes de associar a um plano" });
  }

  const meetUrl = `https://meet.google.com/${meetCode}`;
  const [row] = await db.insert(meetings).values({
    workspaceId, mapId, createdBy: userId, title: parsed.data.title ?? null,
    meetCode, meetUrl, status: "collecting",
  }).returning();

  try {
    const worker = await getWorkerClient().create(userId, { meetCode, workspaceId, title: row.title });
    const [updated] = await db.update(meetings)
      .set({ workerMeetingId: worker.id, updatedAt: new Date() })
      .where(eq(meetings.id, row.id)).returning();
    return res.status(201).json(updated);
  } catch (err) {
    if (err instanceof WorkerConflictError) {
      await db.delete(meetings).where(eq(meetings.id, row.id));
      return res.status(409).json({ error: "collection_active", message: "Já existe uma reunião sendo coletada — encerre a atual primeiro." });
    }
    const [failed] = await db.update(meetings)
      .set({ status: "failed", failureReason: (err as Error).message.slice(0, 300), updatedAt: new Date() })
      .where(eq(meetings.id, row.id)).returning();
    return res.status(502).json(failed);
  }
});

// GET /api/meetings?workspaceId=
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  if (workspaceId) {
    if (!(await assertMembership(userId, workspaceId))) return res.status(403).json({ message: "Sem permissão" });
    const rows = await db.select().from(meetings).where(eq(meetings.workspaceId, workspaceId)).orderBy(desc(meetings.createdAt));
    return res.json(rows);
  }
  // sem workspace: tudo que o usuário legitimamente vê — standalone criadas por
  // ele + reuniões dos workspaces onde é membro. A agenda (my-tasks) é uma visão
  // cross-workspace e chama sem parâmetro; filtrar só standalone aqui esconderia
  // da UI toda reunião com workspace (e travaria o poll-through do syncMeetingFromWorker).
  const myWorkspaces = db.select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers).where(eq(workspaceMembers.userId, userId));
  const rows = await db.select().from(meetings)
    .where(or(
      and(eq(meetings.createdBy, userId), isNull(meetings.workspaceId)),
      inArray(meetings.workspaceId, myWorkspaces),
    ))
    .orderBy(desc(meetings.createdAt));
  return res.json(rows);
});

// GET /api/meetings/upcoming — próximas da janela sincronizada (seção "próximas" da agenda).
// Cross-workspace: standalone do user + reuniões dos workspaces dele + needs_triage
// da agenda conectada dele. Dedup de recorrência = só a próxima ocorrência por série.
router.get("/upcoming", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const now = new Date();
  const myWorkspaces = db.select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers).where(eq(workspaceMembers.userId, userId));
  const myGcalAccounts = db.select({ id: userGoogleCalendarAccounts.id })
    .from(userGoogleCalendarAccounts).where(eq(userGoogleCalendarAccounts.userId, userId));

  const rows = await db.select().from(meetings).where(and(
    inArray(meetings.status, ["scheduled", "needs_triage", "collecting"]),
    or(
      and(eq(meetings.createdBy, userId), isNull(meetings.workspaceId)),
      inArray(meetings.workspaceId, myWorkspaces),
      and(eq(meetings.status, "needs_triage"), inArray(meetings.sourceAccountId, myGcalAccounts)),
    ),
  )).orderBy(asc(meetings.scheduledStartAt));

  // Janela: scheduled/needs_triage só se ainda não terminaram; collecting sempre (pinada).
  const live = rows.filter(r =>
    r.status === "collecting" || (r.scheduledEndAt != null && r.scheduledEndAt >= now)
  );

  // Dedup de série: só a ocorrência de menor scheduledStartAt por gcalRecurringEventId.
  // collecting e avulsas (sem recurringEventId) passam sempre.
  const bySeries = new Map<string, Meeting>();
  const out: Meeting[] = [];
  for (const r of live) {
    if (r.status === "collecting" || !r.gcalRecurringEventId) { out.push(r); continue; }
    const prev = bySeries.get(r.gcalRecurringEventId);
    const rStart = r.scheduledStartAt?.getTime() ?? Infinity;
    const pStart = prev?.scheduledStartAt?.getTime() ?? Infinity;
    if (!prev || rStart < pStart) bySeries.set(r.gcalRecurringEventId, r);
  }
  out.push(...bySeries.values());

  // Ordenação final: collecting primeiro, depois por início.
  out.sort((a, b) => {
    if (a.status === "collecting" && b.status !== "collecting") return -1;
    if (b.status === "collecting" && a.status !== "collecting") return 1;
    return (a.scheduledStartAt?.getTime() ?? 0) - (b.scheduledStartAt?.getTime() ?? 0);
  });
  return res.json(out);
});

// GET /api/meetings/:id (poll-through)
router.get("/:id", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const [row] = await db.select().from(meetings).where(eq(meetings.id, req.params.id));
  if (!row) return res.status(404).json({ message: "Reunião não encontrada" });
  if (row.workspaceId) {
    if (!(await assertMembership(userId, row.workspaceId))) return res.status(403).json({ message: "Sem permissão" });
  } else if (row.createdBy !== userId) {
    return res.status(403).json({ message: "Sem permissão" });
  }
  const synced = await syncMeetingFromWorker(row);
  return res.json(synced);
});

// PATCH /api/meetings/:id/association
const assocSchema = z.object({
  workspaceId: z.string().uuid().nullable().optional(),
  mapId: z.string().uuid().nullable().optional(),
});
router.patch("/:id/association", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const parsed = assocSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });
  const [row] = await db.select().from(meetings).where(eq(meetings.id, req.params.id));
  if (!row) return res.status(404).json({ message: "Reunião não encontrada" });
  // permissão: membership do workspace atual ou criador (standalone)
  if (row.workspaceId) {
    if (!(await assertMembership(userId, row.workspaceId))) return res.status(403).json({ message: "Sem permissão" });
  } else if (row.createdBy !== userId) {
    return res.status(403).json({ message: "Sem permissão" });
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const workspaceChanged = parsed.data.workspaceId !== undefined && parsed.data.workspaceId !== row.workspaceId;

  if (parsed.data.workspaceId !== undefined) {
    const newWs = parsed.data.workspaceId;
    if (newWs) {
      if (!(await assertMembership(userId, newWs))) return res.status(403).json({ message: "Você não é membro deste workspace" });
    }
    patch.workspaceId = newWs;
    if (newWs === null) patch.mapId = null; // sem workspace → sem plano
  }
  if (parsed.data.mapId !== undefined) {
    const targetWs = (patch.workspaceId !== undefined ? patch.workspaceId : row.workspaceId) as string | null;
    if (parsed.data.mapId !== null) {
      if (!targetWs) return res.status(400).json({ message: "Selecione um workspace antes de associar a um plano" });
      const [map] = await db.select().from(maps).where(and(eq(maps.id, parsed.data.mapId), eq(maps.workspaceId, targetWs)));
      if (!map) return res.status(400).json({ message: "Plano não encontrado neste workspace" });
    }
    patch.mapId = parsed.data.mapId;
  }

  // Só propaga pro worker se o WORKSPACE mudou e já há episódio importado.
  if (workspaceChanged && row.episodeId != null && row.workerMeetingId) {
    try {
      await getWorkerClient().patchAttribution(userId, row.workerMeetingId, { workspaceId: (patch.workspaceId ?? null) as string | null });
    } catch (err) {
      if (err instanceof AttributionFrozenError) {
        return res.status(409).json({ error: "attribution_frozen", message: "Reunião já destilada — atribuição congelada." });
      }
      return res.status(502).json({ message: "Falha ao propagar atribuição para o worker" });
    }
  }

  const [updated] = await db.update(meetings).set(patch).where(eq(meetings.id, row.id)).returning();
  return res.json(updated);
});

// PATCH /api/meetings/:id/collect — opt-out por reunião (liga/desliga a gravação).
const collectSchema = z.object({ collectEnabled: z.boolean() });
router.patch("/:id/collect", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const parsed = collectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });
  // req.params.id é inferido como string | string[] (dívida do mergeParams); cast como nas outras rotas (cards.ts).
  const [row] = await db.select().from(meetings).where(eq(meetings.id, req.params.id as string));
  if (!row) return res.status(404).json({ message: "Reunião não encontrada" });
  if (!(await canActOnMeeting(userId, row))) return res.status(403).json({ message: "Sem permissão" });
  if (row.status !== "scheduled" && row.status !== "needs_triage") {
    return res.status(400).json({ error: "collect_toggle_not_allowed", message: "Só dá pra alterar a coleta de reuniões agendadas." });
  }
  const [updated] = await db.update(meetings)
    .set({ collectEnabled: parsed.data.collectEnabled, updatedAt: new Date() })
    .where(eq(meetings.id, row.id)).returning();
  return res.json(updated);
});

// POST /api/meetings/:id/triage — atribui o workspace de uma needs_triage (vira
// scheduled/manual) e, best-effort, cria a title rule no worker pra a próxima
// reunião do cliente resolver sozinha. A atribuição local nunca é desfeita por
// falha do worker (a regra é otimização, a atribuição é o efeito garantido).
const triageSchema = z.object({
  workspaceId: z.string().uuid(),
  titleRulePattern: z.string().optional(),
});
router.post("/:id/triage", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const parsed = triageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Dados inválidos", errors: parsed.error.flatten() });
  const [row] = await db.select().from(meetings).where(eq(meetings.id, req.params.id as string));
  if (!row) return res.status(404).json({ message: "Reunião não encontrada" });
  if (row.status !== "needs_triage") return res.status(409).json({ error: "not_triageable", message: "Só reuniões em triagem podem ser atribuídas." });
  if (!(await canActOnMeeting(userId, row))) return res.status(403).json({ message: "Sem permissão" });
  if (!(await assertMembership(userId, parsed.data.workspaceId))) return res.status(403).json({ message: "Você não é membro deste workspace" });

  const [updated] = await db.update(meetings).set({
    workspaceId: parsed.data.workspaceId, status: "scheduled", attributionMethod: "manual", updatedAt: new Date(),
  }).where(eq(meetings.id, row.id)).returning();

  let titleRuleCreated = false;
  const pattern = parsed.data.titleRulePattern?.trim() ?? "";
  if (pattern.length >= 3) {
    try {
      await getWorkerClient().upsertTitleRule(userId, { pattern, workspaceId: parsed.data.workspaceId });
      titleRuleCreated = true;
    } catch {
      titleRuleCreated = false; // best-effort: a atribuição já está gravada
    }
  }
  return res.json({ meeting: updated, titleRuleCreated });
});

// POST /api/meetings/:id/discard — opção secundária da triagem: descarta a
// reunião (terminal canceled). O sync não ressuscita row terminal → sai da fila.
router.post("/:id/discard", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const [row] = await db.select().from(meetings).where(eq(meetings.id, req.params.id as string));
  if (!row) return res.status(404).json({ message: "Reunião não encontrada" });
  if (row.status !== "needs_triage") return res.status(409).json({ error: "not_triageable", message: "Só reuniões em triagem podem ser descartadas." });
  if (!(await canActOnMeeting(userId, row))) return res.status(403).json({ message: "Sem permissão" });
  const [updated] = await db.update(meetings)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(eq(meetings.id, row.id)).returning();
  return res.json(updated);
});

// POST /api/meetings/:id/stop
router.post("/:id/stop", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const [row] = await db.select().from(meetings).where(eq(meetings.id, req.params.id));
  if (!row) return res.status(404).json({ message: "Reunião não encontrada" });
  if (row.workspaceId) {
    if (!(await assertMembership(userId, row.workspaceId))) return res.status(403).json({ message: "Sem permissão" });
  } else if (row.createdBy !== userId) {
    return res.status(403).json({ message: "Sem permissão" });
  }
  if (!row.workerMeetingId) return res.status(400).json({ message: "Reunião sem coleta ativa" });
  try {
    // stop() dispara stopBot + import inline no worker. A resposta do /stop é magra (só
    // status + episode_id), então re-sincronizamos via syncMeetingFromWorker (worker.get()) para
    // preencher participants/occurredAt/durationSeconds. Sem isso, a reunião encerrada pelo
    // botão perderia esses campos: o GET/:id posterior pula o sync quando status != "collecting".
    // `row` ainda está "collecting" aqui (buscado antes do stop), então syncMeetingFromWorker prossegue.
    await getWorkerClient().stop(userId, row.workerMeetingId);
    const synced = await syncMeetingFromWorker(row);
    return res.json(synced);
  } catch {
    return res.status(502).json({ message: "Falha ao encerrar a coleta" });
  }
});

export default router;
