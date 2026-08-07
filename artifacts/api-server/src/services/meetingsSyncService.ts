import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  meetings,
  userCalendarPreferences,
  userGoogleCalendarAccounts,
  type Meeting,
  type MeetingAttendee,
} from "@workspace/db/schema";
import { logger } from "../lib/logger";
import {
  getValidAccessToken,
  listEvents as gcalListEvents,
  type GoogleCalendarAttendee,
  type GoogleCalendarEvent,
} from "./googleCalendarService";
import { extractMeetCode, getWorkerClient } from "./meetingCollectorService";

const log = logger.child({ module: "meetingsSyncService" });

const TZ = "America/Sao_Paulo";
const ACTING_USER = "system:agenda-sync";

/** Resultado do `/attribution/resolve` do worker (contrato attribution_v1). */
export type AttrResult = {
  workspace_id: string | null;
  project_slug: string | null;
  method: string; // 'domain' | 'title' | 'internal' | 'none'
  unresolved_domains: string[];
};

export type SyncDeps = {
  listAccounts: () => Promise<Array<{ id: string; userId: string }>>;
  listEnabledCalendars: (userId: string) => Promise<string[]>;
  getAccessToken: (userId: string) => Promise<string | null>;
  listEvents: (
    token: string,
    calendarId: string,
    timeMin: string,
    timeMax: string,
    tz: string,
  ) => Promise<GoogleCalendarEvent[]>;
  resolveAttribution: (a: {
    title: string | null;
    attendees: Array<{ email: string; name?: string }>;
  }) => Promise<AttrResult>;
  now: () => Date;
  windowDays: number;
};

export type SyncReport = {
  accounts: number;
  seen: number;
  created: number;
  triaged: number;
  updated: number;
  canceled: number;
  skippedInternal: number;
  skippedNone: number;
};

// Defaults de produção: DB (drizzle) + googleCalendarService + worker client.
// getWorkerClient() só é chamado quando a atribuição roda de fato (lazy), então
// construir estes defaults nunca exige WORKER_URL/TOKEN.
function defaultDeps(): SyncDeps {
  return {
    listAccounts: async () => {
      const rows = await db
        .select({ id: userGoogleCalendarAccounts.id, userId: userGoogleCalendarAccounts.userId })
        .from(userGoogleCalendarAccounts);
      return rows;
    },
    listEnabledCalendars: async (userId) => {
      const rows = await db
        .select({ calendarId: userCalendarPreferences.googleCalendarId })
        .from(userCalendarPreferences)
        .where(and(eq(userCalendarPreferences.userId, userId), eq(userCalendarPreferences.enabled, true)));
      return rows.map((r) => r.calendarId);
    },
    getAccessToken: (userId) => getValidAccessToken(userId),
    listEvents: (token, calendarId, timeMin, timeMax, tz) => gcalListEvents(token, calendarId, timeMin, timeMax, tz),
    resolveAttribution: (a) => getWorkerClient().resolveAttribution(ACTING_USER, a),
    now: () => new Date(),
    windowDays: 14,
  };
}

// Identidade da ocorrência: (iCalUID, originalStartTime ?? startDateTime). O
// instante é normalizado por getTime() (drizzle mapeia timestamp como UTC, então
// o round-trip DB↔JS preserva o epoch — validado antes de escolher esta chave).
function occKey(iCalUid: string, start: Date): string {
  return `${iCalUid}\u0000${start.getTime()}`;
}

function toStoredAttendees(list: GoogleCalendarAttendee[]): MeetingAttendee[] {
  return list.map((a) => (a.displayName ? { email: a.email, displayName: a.displayName } : { email: a.email }));
}

function toAttrAttendees(list: GoogleCalendarAttendee[]): Array<{ email: string; name?: string }> {
  return list.map((a) => (a.displayName ? { email: a.email, name: a.displayName } : { email: a.email }));
}

// Remarcar uma ocorrência no Google Calendar NÃO muda o originalStartTime — só o
// start. A chave (iCalUID, originalStart) continua achando a row da data antiga;
// se ela já estiver num status terminal, sem reabrir aqui a reunião nova nunca
// entra na fila do dispatch e some em silêncio.
//
// Só estes dois status reabrem:
//   - failed  → a coleta daquele dia falhou; a nova data merece nova tentativa.
//   - missed  → a janela passou sem disparo; idem.
// Ficam de fora, de propósito:
//   - collecting  → coleta em andamento; o poller é dono do estado.
//   - transcribed → já tem episódio; reabrir duplicaria a transcrição.
//   - canceled    → os dois escritores do status são indistinguíveis na row: o
//     reconcileAccount (evento sumiu da agenda) e o POST /meetings/:id/discard
//     (descarte manual na triagem). Ressuscitar um descarte humano é o erro mais
//     caro dos dois, e o /discard depende explicitamente de terminal ser terminal
//     ("o sync não ressuscita row terminal → sai da fila"). Custo aceito: se um
//     canceled do reconcile reaparecer com o MESMO originalStart, ele não volta.
const REOPENABLE_STATUSES = new Set<Meeting["status"]>(["failed", "missed"]);

function canReopenOccurrence(existing: Pick<Meeting, "status" | "episodeId">, startAt: Date, now: Date): boolean {
  if (!REOPENABLE_STATUSES.has(existing.status)) return false;
  // episode_id preso numa row failed = o worker chegou a criar episódio; recoletar
  // geraria um segundo. Mesma razão do transcribed, checada pelo dado e não pelo status.
  if (existing.episodeId != null) return false;
  // Só ocorrência FUTURA reabre: data passada não ressuscita (o dispatch só a
  // marcaria missed de novo, e a UI voltaria a mostrá-la como agendada).
  return startAt.getTime() > now.getTime();
}

type Occurrence = {
  event: GoogleCalendarEvent;
  meetCode: string;
  calendarId: string;
  originalStart: Date;
  startAt: Date;
  endAt: Date | null;
};

export async function runMeetingsSync(partial?: Partial<SyncDeps>): Promise<SyncReport> {
  const deps: SyncDeps = { ...defaultDeps(), ...partial };
  const report: SyncReport = {
    accounts: 0,
    seen: 0,
    created: 0,
    triaged: 0,
    updated: 0,
    canceled: 0,
    skippedInternal: 0,
    skippedNone: 0,
  };

  const now = deps.now();
  const windowStart = now;
  const windowEnd = new Date(now.getTime() + deps.windowDays * 24 * 60 * 60 * 1000);
  const timeMin = windowStart.toISOString();
  const timeMax = windowEnd.toISOString();

  const accounts = await deps.listAccounts();
  report.accounts = accounts.length;

  for (const account of accounts) {
    // Boundary por conta: token revogado / erro numa conta não derruba as demais
    // nem dispara reconcile (que cancelaria rows sem termos conseguido buscar).
    try {
      await syncAccount(account, deps, { timeMin, timeMax, windowStart, windowEnd }, report);
    } catch (err) {
      log.error({ err, accountId: account.id, userId: account.userId }, "meetings sync: conta falhou; segue");
    }
  }

  return report;
}

async function syncAccount(
  account: { id: string; userId: string },
  deps: SyncDeps,
  window: { timeMin: string; timeMax: string; windowStart: Date; windowEnd: Date },
  report: SyncReport,
): Promise<void> {
  const token = await deps.getAccessToken(account.userId);
  if (!token) {
    log.warn({ accountId: account.id, userId: account.userId }, "sem access token; pulando conta");
    return;
  }

  const calendars = await deps.listEnabledCalendars(account.userId);
  const seenKeys = new Set<string>();

  for (const calendarId of calendars) {
    const events = await deps.listEvents(token, calendarId, window.timeMin, window.timeMax, TZ);
    for (const event of events) {
      // 1. Sem hangoutLink OU all-day (sem startDateTime) → ignora.
      if (!event.hangoutLink || !event.startDateTime) continue;
      const meetCode = extractMeetCode(event.hangoutLink);
      if (!meetCode) continue;
      // 2. Sem iCalUID → sem chave de ocorrência estável → ignora (warn).
      if (!event.iCalUID) {
        log.warn({ accountId: account.id, calendarId, eventId: event.id }, "evento sem iCalUID; ignorado");
        continue;
      }
      const originalStart = new Date(event.originalStartTime ?? event.startDateTime);
      const startAt = new Date(event.startDateTime);
      const endAt = event.endDateTime ? new Date(event.endDateTime) : null;
      seenKeys.add(occKey(event.iCalUID, originalStart));
      report.seen++;
      await upsertOccurrence({ event, meetCode, calendarId, originalStart, startAt, endAt }, account, deps, report);
    }
  }

  await reconcileAccount(account, window, seenKeys, report);
}

async function upsertOccurrence(
  occ: Occurrence,
  account: { id: string; userId: string },
  deps: SyncDeps,
  report: SyncReport,
): Promise<void> {
  const { event, meetCode, calendarId, originalStart, startAt, endAt } = occ;
  const iCalUid = event.iCalUID as string;
  const storedAttendees = toStoredAttendees(event.attendees);

  const [existing] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.gcalIcalUid, iCalUid), eq(meetings.gcalOriginalStartAt, originalStart)))
    .limit(1);

  if (existing) {
    // 3. Só mexe em rows ainda "abertas" pela agenda...
    const isOpen = existing.status === "scheduled" || existing.status === "needs_triage";
    // ...ou numa terminal cuja ocorrência foi remarcada pra frente (ver REOPENABLE_STATUSES).
    const reopening = !isOpen && canReopenOccurrence(existing, startAt, deps.now());
    if (!isOpen && !reopening) return;

    const patch: Record<string, unknown> = {
      scheduledStartAt: startAt,
      scheduledEndAt: endAt,
      title: event.summary,
      attendees: storedAttendees,
      meetCode,
      meetUrl: event.hangoutLink,
      updatedAt: new Date(),
    };
    if (reopening) {
      patch.status = "scheduled";
      // A row passa a representar a ocorrência na data nova. occurredAt vai junto
      // porque a UI mostra occurredAt em status terminal (MeetingItem) — mantê-lo
      // na data velha exibiria o dia errado se a nova tentativa também falhar.
      patch.occurredAt = startAt;
      // Obrigatório: a fase 1 do dispatch exige isNull(workerMeetingId). Sem isso a
      // row volta a scheduled e segue invisível — o mesmo bug com outra cara.
      patch.workerMeetingId = null;
      // failureReason era da tentativa antiga; some da row → fica no log abaixo.
      patch.failureReason = null;
      log.warn(
        {
          meetingId: existing.id,
          previousStatus: existing.status,
          previousFailureReason: existing.failureReason,
          previousWorkerMeetingId: existing.workerMeetingId,
          gcalIcalUid: iCalUid,
          originalStartAt: originalStart.toISOString(),
          fromScheduledStartAt: existing.scheduledStartAt?.toISOString() ?? null,
          toScheduledStartAt: startAt.toISOString(),
        },
        "ocorrência remarcada: row terminal reaberta como scheduled",
      );
    }
    // needs_triage: re-resolve (o título pode ter passado a casar uma regra).
    // NÃO sobrescreve sourceAccountId (a row pode ser de outra conta — dedup).
    if (existing.status === "needs_triage") {
      const attr = await deps.resolveAttribution({ title: event.summary, attendees: toAttrAttendees(event.attendees) });
      if ((attr.method === "domain" || attr.method === "title") && attr.workspace_id) {
        patch.status = "scheduled";
        patch.workspaceId = attr.workspace_id;
        patch.attributionMethod = attr.method;
      }
    }
    await db.update(meetings).set(patch).where(eq(meetings.id, existing.id));
    report.updated++;
    return;
  }

  // 4. Row nova: decide pelo método de atribuição.
  const attr = await deps.resolveAttribution({ title: event.summary, attendees: toAttrAttendees(event.attendees) });
  // Exige workspace_id p/ resolver (alinha com o caminho de update). Se method for
  // domain/title mas workspace_id vier null (violação de contrato), cai no não-resolvido:
  // needs_triage se houver unresolved_domains, senão skip.
  const resolved = (attr.method === "domain" || attr.method === "title") && !!attr.workspace_id;
  const triage = !resolved && attr.unresolved_domains.length > 0;

  if (attr.method === "internal") {
    report.skippedInternal++;
    return;
  }
  if (!resolved && !triage) {
    // method 'none' sem domínios pendentes (tudo interno/ignorável).
    report.skippedNone++;
    return;
  }

  await db.insert(meetings).values({
    workspaceId: resolved ? attr.workspace_id : null,
    status: resolved ? "scheduled" : "needs_triage",
    attributionMethod: resolved ? attr.method : null,
    collectEnabled: true,
    title: event.summary,
    meetCode,
    meetUrl: event.hangoutLink,
    occurredAt: startAt,
    gcalIcalUid: iCalUid,
    gcalEventId: event.id,
    gcalCalendarId: calendarId,
    sourceAccountId: account.id,
    gcalRecurringEventId: event.recurringEventId,
    gcalOriginalStartAt: originalStart,
    scheduledStartAt: startAt,
    scheduledEndAt: endAt,
    attendees: storedAttendees,
    createdBy: null,
  });

  if (resolved) report.created++;
  else report.triaged++;
}

async function reconcileAccount(
  account: { id: string; userId: string },
  window: { windowStart: Date; windowEnd: Date },
  seenKeys: Set<string>,
  report: SyncReport,
): Promise<void> {
  // 5. Rows desta conta (scheduled/needs_triage) na janela cuja ocorrência não
  // apareceu no fetch → o evento sumiu da agenda → canceled.
  const candidates = await db
    .select({ id: meetings.id, gcalIcalUid: meetings.gcalIcalUid, gcalOriginalStartAt: meetings.gcalOriginalStartAt })
    .from(meetings)
    .where(
      and(
        eq(meetings.sourceAccountId, account.id),
        inArray(meetings.status, ["scheduled", "needs_triage"]),
        gte(meetings.scheduledStartAt, window.windowStart),
        lte(meetings.scheduledStartAt, window.windowEnd),
      ),
    );

  for (const c of candidates) {
    if (!c.gcalIcalUid || !c.gcalOriginalStartAt) continue;
    if (seenKeys.has(occKey(c.gcalIcalUid, c.gcalOriginalStartAt))) continue;
    await db.update(meetings).set({ status: "canceled", updatedAt: new Date() }).where(eq(meetings.id, c.id));
    report.canceled++;
  }
}
