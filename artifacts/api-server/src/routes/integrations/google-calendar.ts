import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { userGoogleCalendarAccounts, userCalendarPreferences } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, AuthRequest } from "../../middlewares/auth";
import { requireGoogleCalendar } from "../../lib/featureFlags";
import { logger } from "../../lib/logger";
import { encrypt, decrypt } from "../../lib/encryption";
import {
  buildAuthUrl,
  verifyState,
  exchangeCodeForTokens,
  revokeToken,
  listCalendars,
  listEvents,
  getValidAccessToken,
  GoogleAuthError,
  type GoogleCalendarEvent,
} from "../../services/googleCalendarService";

const log = logger.child({ module: "google-calendar" });
const router: IRouter = Router();

// All Google Calendar endpoints require the integration to be enabled via env vars.
router.use(requireGoogleCalendar);

interface CachedEvents {
  events: TodayEvent[];
  expiresAt: number;
}
const eventsCache = new Map<string, CachedEvents>();
const EVENTS_CACHE_TTL_MS = 10 * 60 * 1000;

function eventsCacheKey(userId: string, tz: string) {
  return `${userId}::${tz}`;
}

function invalidateEventsCache(userId: string) {
  for (const key of Array.from(eventsCache.keys())) {
    if (key.startsWith(`${userId}::`)) eventsCache.delete(key);
  }
}

const consumedNonces = new Map<string, number>();
const NONCE_TTL_MS = 15 * 60 * 1000;
function markNonceConsumed(nonce: string) {
  const now = Date.now();
  for (const [k, exp] of consumedNonces) {
    if (exp < now) consumedNonces.delete(k);
  }
  consumedNonces.set(nonce, now + NONCE_TTL_MS);
}
function isNonceConsumed(nonce: string): boolean {
  const exp = consumedNonces.get(nonce);
  if (!exp) return false;
  if (exp < Date.now()) {
    consumedNonces.delete(nonce);
    return false;
  }
  return true;
}

interface TodayEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  calendarColor: string | null;
  title: string;
  location: string | null;
  htmlLink: string | null;
  allDay: boolean;
  start: string;
  end: string;
}

router.get("/auth-url", requireAuth, (req: AuthRequest, res) => {
  try {
    const url = buildAuthUrl(req.user!.userId);
    res.json({ url });
  } catch (err) {
    log.error({ err }, "auth-url failed");
    res.status(500).json({ error: "Configuration error", message: "Google OAuth não está configurado." });
  }
});

router.get("/callback", requireAuth, async (req: AuthRequest, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const errParam = typeof req.query.error === "string" ? req.query.error : null;

  const buildRedirect = (status: "connected" | "error", message?: string) => {
    const params = new URLSearchParams({ google_calendar: status });
    if (message) params.set("message", message);
    return `/settings/integrations?${params.toString()}`;
  };

  if (errParam) {
    return res.redirect(buildRedirect("error", errParam));
  }
  if (!code || !state) {
    return res.redirect(buildRedirect("error", "missing_params"));
  }
  const verified = verifyState(state);
  if (!verified) {
    return res.redirect(buildRedirect("error", "invalid_state"));
  }
  if (verified.userId !== req.user!.userId) {
    log.warn({ stateUser: verified.userId, sessionUser: req.user!.userId }, "callback userId mismatch");
    return res.redirect(buildRedirect("error", "user_mismatch"));
  }
  if (isNonceConsumed(verified.nonce)) {
    return res.redirect(buildRedirect("error", "state_replay"));
  }
  markNonceConsumed(verified.nonce);

  try {
    const tokens = await exchangeCodeForTokens(code);
    const calendars = await listCalendars(tokens.accessToken);
    const primary = calendars.find(c => c.primary);
    const email = primary?.id ?? "conta google";

    const accessTokenEncrypted = encrypt(tokens.accessToken);
    const refreshTokenEncrypted = encrypt(tokens.refreshToken);

    const [existing] = await db.select().from(userGoogleCalendarAccounts).where(eq(userGoogleCalendarAccounts.userId, verified.userId)).limit(1);
    if (existing) {
      await db.update(userGoogleCalendarAccounts).set({
        googleAccountEmail: email,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        expiresAt: tokens.expiresAt,
        updatedAt: new Date(),
      }).where(eq(userGoogleCalendarAccounts.userId, verified.userId));
    } else {
      await db.insert(userGoogleCalendarAccounts).values({
        userId: verified.userId,
        googleAccountEmail: email,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        expiresAt: tokens.expiresAt,
      });
    }

    for (const cal of calendars) {
      const [pref] = await db
        .select()
        .from(userCalendarPreferences)
        .where(and(
          eq(userCalendarPreferences.userId, verified.userId),
          eq(userCalendarPreferences.googleCalendarId, cal.id),
        ))
        .limit(1);

      const name = cal.summaryOverride || cal.summary || cal.id;
      const color = cal.backgroundColor ?? null;
      const isPrimary = !!cal.primary;

      if (pref) {
        await db.update(userCalendarPreferences).set({
          calendarName: name,
          calendarColor: color,
          updatedAt: new Date(),
        }).where(eq(userCalendarPreferences.id, pref.id));
      } else {
        await db.insert(userCalendarPreferences).values({
          userId: verified.userId,
          googleCalendarId: cal.id,
          calendarName: name,
          calendarColor: color,
          enabled: isPrimary,
        });
      }
    }

    invalidateEventsCache(verified.userId);
    return res.redirect(buildRedirect("connected"));
  } catch (err) {
    log.error({ err }, "google calendar callback failed");
    return res.redirect(buildRedirect("error", "callback_failed"));
  }
});

router.get("/status", requireAuth, async (req: AuthRequest, res) => {
  const [account] = await db
    .select({ googleAccountEmail: userGoogleCalendarAccounts.googleAccountEmail })
    .from(userGoogleCalendarAccounts)
    .where(eq(userGoogleCalendarAccounts.userId, req.user!.userId))
    .limit(1);
  res.json({ connected: !!account, googleAccountEmail: account?.googleAccountEmail ?? null });
});

router.post("/disconnect", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const [account] = await db.select().from(userGoogleCalendarAccounts).where(eq(userGoogleCalendarAccounts.userId, userId)).limit(1);
  if (account) {
    try {
      const refreshToken = decrypt(account.refreshTokenEncrypted);
      await revokeToken(refreshToken);
    } catch (err) {
      log.warn({ err }, "failed to revoke token (best-effort)");
    }
    await db.delete(userGoogleCalendarAccounts).where(eq(userGoogleCalendarAccounts.userId, userId));
    await db.delete(userCalendarPreferences).where(eq(userCalendarPreferences.userId, userId));
    invalidateEventsCache(userId);
  }
  res.json({ ok: true });
});

router.get("/calendars", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  try {
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) return res.status(404).json({ error: "Not connected", message: "Conecte sua conta Google primeiro." });

    const remoteCalendars = await listCalendars(accessToken);
    const prefs = await db.select().from(userCalendarPreferences).where(eq(userCalendarPreferences.userId, userId));
    const prefsByCalendarId = new Map(prefs.map(p => [p.googleCalendarId, p]));

    const merged: { id: string; name: string; color: string | null; primary: boolean; enabled: boolean }[] = [];
    for (const cal of remoteCalendars) {
      const name = cal.summaryOverride || cal.summary || cal.id;
      const color = cal.backgroundColor ?? null;
      const pref = prefsByCalendarId.get(cal.id);

      if (pref) {
        if (pref.calendarName !== name || pref.calendarColor !== color) {
          await db.update(userCalendarPreferences).set({ calendarName: name, calendarColor: color, updatedAt: new Date() }).where(eq(userCalendarPreferences.id, pref.id));
        }
        merged.push({ id: cal.id, name, color, primary: !!cal.primary, enabled: pref.enabled });
      } else {
        await db.insert(userCalendarPreferences).values({
          userId,
          googleCalendarId: cal.id,
          calendarName: name,
          calendarColor: color,
          enabled: false,
        });
        merged.push({ id: cal.id, name, color, primary: !!cal.primary, enabled: false });
      }
    }

    const remoteIds = new Set(remoteCalendars.map(c => c.id));
    for (const pref of prefs) {
      if (!remoteIds.has(pref.googleCalendarId)) {
        await db.delete(userCalendarPreferences).where(eq(userCalendarPreferences.id, pref.id));
      }
    }

    res.json(merged);
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      return res.status(401).json({ error: "Reauth required", message: "Sessão do Google expirou. Reconecte sua conta." });
    }
    log.error({ err }, "calendars list failed");
    res.status(500).json({ error: "Internal", message: "Erro ao listar agendas." });
  }
});

const updatePrefSchema = z.object({ enabled: z.boolean() });

router.patch("/calendars/:calendarId", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const calendarId = req.params.calendarId;
  const parsed = updatePrefSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation", message: "enabled é obrigatório" });

  const [pref] = await db
    .select()
    .from(userCalendarPreferences)
    .where(and(
      eq(userCalendarPreferences.userId, userId),
      eq(userCalendarPreferences.googleCalendarId, calendarId),
    ))
    .limit(1);
  if (!pref) return res.status(404).json({ error: "Not found", message: "Agenda não encontrada" });

  await db.update(userCalendarPreferences).set({
    enabled: parsed.data.enabled,
    updatedAt: new Date(),
  }).where(eq(userCalendarPreferences.id, pref.id));

  invalidateEventsCache(userId);
  res.json({ ok: true });
});

const todayQuerySchema = z.object({ tz: z.string().min(1).max(64).optional() });

router.get("/today-events", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const parsed = todayQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Validation", message: "tz inválido" });
  const tz = parsed.data.tz || "UTC";

  const cacheKey = eventsCacheKey(userId, tz);
  const cached = eventsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({ events: cached.events, cached: true, noCalendarsSelected: false });
  }

  try {
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return res.status(404).json({ error: "Not connected", message: "Conecte sua conta Google primeiro." });
    }

    const enabledPrefs = await db
      .select()
      .from(userCalendarPreferences)
      .where(and(eq(userCalendarPreferences.userId, userId), eq(userCalendarPreferences.enabled, true)));

    if (enabledPrefs.length === 0) {
      return res.json({ events: [], cached: false, noCalendarsSelected: true });
    }

    const { startISO, endISO } = computeDayWindow(tz);

    const allEvents: TodayEvent[] = [];
    for (const pref of enabledPrefs) {
      try {
        const events = await listEvents(accessToken, pref.googleCalendarId, startISO, endISO, tz);
        for (const ev of events) {
          allEvents.push(toTodayEvent(ev, pref));
        }
      } catch (innerErr) {
        if (innerErr instanceof GoogleAuthError) throw innerErr;
        log.warn({ err: innerErr, calendarId: pref.googleCalendarId }, "skipping calendar due to error");
      }
    }

    allEvents.sort(compareEvents);

    eventsCache.set(cacheKey, { events: allEvents, expiresAt: Date.now() + EVENTS_CACHE_TTL_MS });
    res.json({ events: allEvents, cached: false, noCalendarsSelected: false });
  } catch (err) {
    if (err instanceof GoogleAuthError) {
      return res.status(401).json({ error: "Reauth required", message: "Sessão do Google expirou. Reconecte sua conta." });
    }
    log.error({ err }, "today-events failed");
    res.status(500).json({ error: "Internal", message: "Erro ao buscar eventos." });
  }
});

function toTodayEvent(ev: GoogleCalendarEvent, pref: typeof userCalendarPreferences.$inferSelect): TodayEvent {
  const allDay = !!ev.start.date && !ev.start.dateTime;
  return {
    id: ev.id,
    calendarId: pref.googleCalendarId,
    calendarName: pref.calendarName,
    calendarColor: pref.calendarColor,
    title: ev.summary || "(sem título)",
    location: ev.location ?? null,
    htmlLink: ev.htmlLink ?? null,
    allDay,
    start: (ev.start.dateTime || ev.start.date) ?? "",
    end: (ev.end.dateTime || ev.end.date) ?? "",
  };
}

function compareEvents(a: TodayEvent, b: TodayEvent): number {
  if (a.allDay && !b.allDay) return -1;
  if (!a.allDay && b.allDay) return 1;
  return a.start.localeCompare(b.start);
}

function computeDayWindow(tz: string): { startISO: string; endISO: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const offsetMin = getTimeZoneOffsetMinutes(tz, now);
  const sign = offsetMin >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMin);
  const oh = String(Math.floor(absMin / 60)).padStart(2, "0");
  const om = String(absMin % 60).padStart(2, "0");
  const offset = `${sign}${oh}:${om}`;
  const startISO = `${y}-${m}-${d}T00:00:00${offset}`;
  const endDate = new Date(`${y}-${m}-${d}T00:00:00${offset}`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const endISO = endDate.toISOString();
  return { startISO, endISO };
}

function getTimeZoneOffsetMinutes(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(m.year),
    Number(m.month) - 1,
    Number(m.day),
    Number(m.hour),
    Number(m.minute),
    Number(m.second),
  );
  return Math.round((asUTC - date.getTime()) / 60000);
}

export default router;
