import { createHmac } from "node:crypto";
import { logger } from "../lib/logger";

const log = logger.child({ module: "googleCalendarService" });

const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export class GoogleApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "GoogleApiError";
  }
}

function getConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth env vars not configured");
  }
  return { clientId, clientSecret, redirectUri };
}

function stateSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET || process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (!secret) throw new Error("Missing secret for OAuth state signing");
  return secret;
}

export function signState(payload: { userId: string; nonce: string; ts: number }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string): { userId: string; nonce: string; ts: number } | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.userId !== "string" || typeof payload.ts !== "number") return null;
    if (Date.now() - payload.ts > 10 * 60 * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildAuthUrl(userId: string): string {
  const cfg = getConfig();
  const state = signState({ userId, nonce: Math.random().toString(36).slice(2), ts: Date.now() });
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const cfg = getConfig();
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    log.error({ status: res.status, text }, "exchangeCodeForTokens failed");
    throw new GoogleAuthError("Failed to exchange code for tokens");
  }
  const data = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };
  if (!data.refresh_token) {
    throw new GoogleAuthError("No refresh token returned. Revoke previous access at https://myaccount.google.com/permissions and try again.");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + (data.expires_in - 60) * 1000),
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const cfg = getConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    log.warn({ status: res.status, text }, "refreshAccessToken failed");
    throw new GoogleAuthError("Failed to refresh access token");
  }
  const data = await res.json() as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + (data.expires_in - 60) * 1000),
  };
}

export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  } catch (err) {
    log.warn({ err }, "revokeToken failed (best-effort)");
  }
}

export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  summaryOverride?: string;
  primary?: boolean;
  backgroundColor?: string;
  foregroundColor?: string;
  accessRole?: string;
}

export async function listCalendars(accessToken: string): Promise<GoogleCalendarListItem[]> {
  const res = await fetch(`${CALENDAR_API}/users/me/calendarList?minAccessRole=reader`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new GoogleAuthError("Access token invalid");
  if (!res.ok) {
    throw new GoogleApiError(`calendarList failed: ${res.status}`, res.status);
  }
  const data = await res.json() as { items: GoogleCalendarListItem[] };
  return data.items ?? [];
}

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  htmlLink?: string;
  status?: string;
}

export async function listEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
  timeZone: string,
): Promise<GoogleCalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    timeZone,
    maxResults: "100",
  });
  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 401) throw new GoogleAuthError("Access token invalid");
  if (res.status === 404 || res.status === 410) return [];
  if (!res.ok) {
    throw new GoogleApiError(`events failed: ${res.status}`, res.status);
  }
  const data = await res.json() as { items: GoogleCalendarEvent[] };
  return (data.items ?? []).filter(e => e.status !== "cancelled");
}
