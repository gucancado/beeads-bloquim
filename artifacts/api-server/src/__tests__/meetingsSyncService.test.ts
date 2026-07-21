import { randomUUID } from "node:crypto";
import { describe, it, expect, afterEach } from "vitest";
import { db } from "@workspace/db";
import { meetings, users, workspaces, userGoogleCalendarAccounts } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import type { GoogleCalendarEvent } from "../services/googleCalendarService";
import { runMeetingsSync, type SyncDeps } from "../services/meetingsSyncService";

// Clock fixo — a janela [NOW, NOW+14d] cobre 2026-07-21..23.
const NOW = new Date("2026-07-20T12:00:00Z");
const T1 = "2026-07-21T14:00:00-03:00";
const T1END = "2026-07-21T15:00:00-03:00";
const T2 = "2026-07-22T14:00:00-03:00";
const T3 = "2026-07-23T14:00:00-03:00";

// bloquim_test é compartilhado: limpamos tudo que cada caso semeou.
const reg = { userIds: [] as string[], wsIds: [] as string[], accountIds: [] as string[] };

async function seed(name = "Sync") {
  const email = `sync_${randomUUID()}@test.local`;
  const [user] = await db.insert(users).values({ name, email, passwordHash: "x" }).returning();
  const [ws] = await db.insert(workspaces).values({ name: `WS ${name}`, createdBy: user.id }).returning();
  const [account] = await db
    .insert(userGoogleCalendarAccounts)
    .values({
      userId: user.id,
      googleAccountEmail: email,
      accessTokenEncrypted: "enc",
      refreshTokenEncrypted: "enc",
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning();
  reg.userIds.push(user.id);
  reg.wsIds.push(ws.id);
  reg.accountIds.push(account.id);
  return { user, ws, account };
}

afterEach(async () => {
  if (reg.accountIds.length) {
    await db.delete(meetings).where(inArray(meetings.sourceAccountId, reg.accountIds));
    await db.delete(userGoogleCalendarAccounts).where(inArray(userGoogleCalendarAccounts.id, reg.accountIds));
  }
  if (reg.wsIds.length) await db.delete(workspaces).where(inArray(workspaces.id, reg.wsIds));
  if (reg.userIds.length) await db.delete(users).where(inArray(users.id, reg.userIds));
  reg.userIds = [];
  reg.wsIds = [];
  reg.accountIds = [];
});

// Factory de evento já normalizado (formato do mapGoogleEvent / GoogleCalendarEvent).
function ev(o: {
  id: string;
  iCalUID: string | null;
  summary?: string | null;
  hangoutLink?: string | null;
  startDateTime?: string | null;
  endDateTime?: string | null;
  originalStartTime?: string | null;
  recurringEventId?: string | null;
  attendees?: Array<{ email: string; displayName?: string }>;
}): GoogleCalendarEvent {
  const start = o.startDateTime ?? null;
  return {
    id: o.id,
    iCalUID: o.iCalUID,
    recurringEventId: o.recurringEventId ?? null,
    originalStartTime: o.originalStartTime ?? null,
    summary: o.summary ?? null,
    hangoutLink: o.hangoutLink ?? null,
    attendees: o.attendees ?? [],
    start: start ? { dateTime: start } : {},
    end: o.endDateTime ? { dateTime: o.endDateTime } : {},
    startDateTime: start,
    endDateTime: o.endDateTime ?? null,
  };
}

// Base injetável: só o DB é real; Google + worker são fakes.
function deps(over: Partial<SyncDeps>): Partial<SyncDeps> {
  return {
    listEnabledCalendars: async () => ["primary"],
    getAccessToken: async () => "tok",
    now: () => NOW,
    windowDays: 14,
    ...over,
  };
}

describe("runMeetingsSync", () => {
  it("1. evento cliente (domain) → row scheduled com workspace/meetCode/title/attendees/janela", async () => {
    const { ws, account } = await seed();
    const P = randomUUID().slice(0, 8);
    const events = [
      ev({
        id: `${P}-e1`,
        iCalUID: `${P}-uid1`,
        summary: "Call ACME",
        hangoutLink: "https://meet.google.com/abc-defg-hij",
        startDateTime: T1,
        endDateTime: T1END,
        attendees: [{ email: "x@acme.com", displayName: "X" }],
      }),
    ];
    let captured: Parameters<SyncDeps["listEvents"]> | null = null;
    const report = await runMeetingsSync(
      deps({
        listAccounts: async () => [{ id: account.id, userId: account.userId }],
        listEvents: async (...args) => {
          captured = args;
          return events;
        },
        resolveAttribution: async () => ({ workspace_id: ws.id, project_slug: "p", method: "domain", unresolved_domains: [] }),
      }),
    );
    expect(report.created).toBe(1);
    expect(report.seen).toBe(1);
    // Call-shape do listEvents: janela de 14d + timezone fixa. Uma regressão na
    // janela ou na TZ passaria despercebida sem este assert.
    expect(captured).not.toBeNull();
    const [, , timeMin, timeMax, tz] = captured!;
    expect(tz).toBe("America/Sao_Paulo");
    expect(timeMin).toBe(NOW.toISOString());
    expect(timeMax).toBe(new Date(NOW.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString());
    const rows = await db.select().from(meetings).where(eq(meetings.sourceAccountId, account.id));
    expect(rows).toHaveLength(1);
    const m = rows[0];
    expect(m.status).toBe("scheduled");
    expect(m.workspaceId).toBe(ws.id);
    expect(m.meetCode).toBe("abc-defg-hij");
    expect(m.meetUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(m.title).toBe("Call ACME");
    expect(m.attributionMethod).toBe("domain");
    expect(m.collectEnabled).toBe(true);
    expect(m.gcalIcalUid).toBe(`${P}-uid1`);
    expect(m.attendees).toEqual([{ email: "x@acme.com", displayName: "X" }]);
    expect(m.scheduledStartAt?.getTime()).toBe(new Date(T1).getTime());
    expect(m.scheduledEndAt?.getTime()).toBe(new Date(T1END).getTime());
    expect(m.gcalOriginalStartAt?.getTime()).toBe(new Date(T1).getTime());
    expect(m.occurredAt?.getTime()).toBe(new Date(T1).getTime());
    expect(m.createdBy).toBeNull();
  });

  it("2. evento interno → nenhuma row", async () => {
    const { account } = await seed();
    const P = randomUUID().slice(0, 8);
    const report = await runMeetingsSync(
      deps({
        listAccounts: async () => [{ id: account.id, userId: account.userId }],
        listEvents: async () => [
          ev({ id: `${P}-e`, iCalUID: `${P}-u`, summary: "Interno", hangoutLink: "https://meet.google.com/int-tttt-nal", startDateTime: T1, endDateTime: T1END }),
        ],
        resolveAttribution: async () => ({ workspace_id: null, project_slug: null, method: "internal", unresolved_domains: [] }),
      }),
    );
    expect(report.skippedInternal).toBe(1);
    expect(report.created).toBe(0);
    const rows = await db.select().from(meetings).where(eq(meetings.sourceAccountId, account.id));
    expect(rows).toHaveLength(0);
  });

  it("3. none COM unresolved → needs_triage; none SEM unresolved → nada", async () => {
    const { account } = await seed();
    const P = randomUUID().slice(0, 8);
    const events = [
      ev({ id: `${P}-a`, iCalUID: `${P}-ua`, summary: "A", hangoutLink: "https://meet.google.com/aaa-aaaa-aaa", startDateTime: T1, endDateTime: T1END }),
      ev({ id: `${P}-b`, iCalUID: `${P}-ub`, summary: "B", hangoutLink: "https://meet.google.com/bbb-bbbb-bbb", startDateTime: T2 }),
    ];
    const report = await runMeetingsSync(
      deps({
        listAccounts: async () => [{ id: account.id, userId: account.userId }],
        listEvents: async () => events,
        resolveAttribution: async (a) =>
          a.title === "A"
            ? { workspace_id: null, project_slug: null, method: "none", unresolved_domains: ["ext.com"] }
            : { workspace_id: null, project_slug: null, method: "none", unresolved_domains: [] },
      }),
    );
    expect(report.triaged).toBe(1);
    expect(report.skippedNone).toBe(1);
    const rows = await db.select().from(meetings).where(eq(meetings.sourceAccountId, account.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("needs_triage");
    expect(rows[0].workspaceId).toBeNull();
    expect(rows[0].title).toBe("A");
    // needs_triage nunca carrega attributionMethod: só é setado ao resolver
    // ('domain'/'title'); 'manual' viria da triagem humana, não daqui.
    expect(rows[0].attributionMethod).toBeNull();
  });

  it("4. recorrente: 3 ocorrências (mesmo iCalUID, starts distintos) → 3 rows com gcalRecurringEventId", async () => {
    const { ws, account } = await seed();
    const P = randomUUID().slice(0, 8);
    const uid = `${P}-recur`;
    const base = `${P}-base`;
    const mk = (i: number, t: string) =>
      ev({ id: `${uid}_${i}`, iCalUID: uid, recurringEventId: base, summary: "Weekly", hangoutLink: "https://meet.google.com/rec-uuuu-rng", startDateTime: t, endDateTime: t });
    const report = await runMeetingsSync(
      deps({
        listAccounts: async () => [{ id: account.id, userId: account.userId }],
        listEvents: async () => [mk(1, T1), mk(2, T2), mk(3, T3)],
        resolveAttribution: async () => ({ workspace_id: ws.id, project_slug: "p", method: "domain", unresolved_domains: [] }),
      }),
    );
    expect(report.created).toBe(3);
    const rows = await db.select().from(meetings).where(eq(meetings.sourceAccountId, account.id));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.gcalRecurringEventId === base)).toBe(true);
    expect(rows.every((r) => r.gcalIcalUid === uid)).toBe(true);
    const starts = rows.map((r) => r.gcalOriginalStartAt!.getTime());
    expect(new Set(starts).size).toBe(3);
  });

  it("5. re-sync idempotente: mesmo fetch 2x → mesmas rows (updated, não duplicadas)", async () => {
    const { ws, account } = await seed();
    const P = randomUUID().slice(0, 8);
    const events = [
      ev({ id: `${P}-e1`, iCalUID: `${P}-u1`, summary: "Call", hangoutLink: "https://meet.google.com/abc-defg-hij", startDateTime: T1, endDateTime: T1END }),
    ];
    const d = deps({
      listAccounts: async () => [{ id: account.id, userId: account.userId }],
      listEvents: async () => events,
      resolveAttribution: async () => ({ workspace_id: ws.id, project_slug: "p", method: "domain", unresolved_domains: [] }),
    });
    const r1 = await runMeetingsSync(d);
    const r2 = await runMeetingsSync(d);
    expect(r1.created).toBe(1);
    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(1);
    const rows = await db.select().from(meetings).where(eq(meetings.sourceAccountId, account.id));
    expect(rows).toHaveLength(1);
  });

  it("6. ocorrência some → canceled; ocorrência movida (mesmo originalStart) → scheduledStartAt atualizado", async () => {
    const { ws, account } = await seed();
    const P = randomUUID().slice(0, 8);
    const T2MOVED = "2026-07-22T16:00:00-03:00";
    const o1 = ev({ id: `${P}-o1`, iCalUID: `${P}-a`, summary: "O1", hangoutLink: "https://meet.google.com/oaa-aaaa-aaa", startDateTime: T1, endDateTime: T1END });
    const o2 = ev({ id: `${P}-o2`, iCalUID: `${P}-b`, summary: "O2", hangoutLink: "https://meet.google.com/obb-bbbb-bbb", startDateTime: T2, endDateTime: T2 });
    const o2moved = ev({
      id: `${P}-o2`,
      iCalUID: `${P}-b`,
      summary: "O2",
      hangoutLink: "https://meet.google.com/obb-bbbb-bbb",
      originalStartTime: T2,
      startDateTime: T2MOVED,
      endDateTime: T2MOVED,
    });
    const attr = async () => ({ workspace_id: ws.id, project_slug: "p", method: "domain", unresolved_domains: [] });

    const r1 = await runMeetingsSync(
      deps({ listAccounts: async () => [{ id: account.id, userId: account.userId }], listEvents: async () => [o1, o2], resolveAttribution: attr }),
    );
    expect(r1.created).toBe(2);

    const r2 = await runMeetingsSync(
      deps({ listAccounts: async () => [{ id: account.id, userId: account.userId }], listEvents: async () => [o2moved], resolveAttribution: attr }),
    );
    expect(r2.canceled).toBe(1);
    expect(r2.updated).toBe(1);

    const rows = await db.select().from(meetings).where(eq(meetings.sourceAccountId, account.id));
    const byUid = Object.fromEntries(rows.map((r) => [r.gcalIcalUid, r]));
    expect(byUid[`${P}-a`].status).toBe("canceled");
    expect(byUid[`${P}-b`].status).toBe("scheduled");
    expect(byUid[`${P}-b`].scheduledStartAt?.getTime()).toBe(new Date(T2MOVED).getTime());
    expect(byUid[`${P}-b`].gcalOriginalStartAt?.getTime()).toBe(new Date(T2).getTime());
  });

  it("7. needs_triage re-resolve: 2ª rodada title-match → vira scheduled", async () => {
    const { ws, account } = await seed();
    const P = randomUUID().slice(0, 8);
    const events = [
      ev({ id: `${P}-e`, iCalUID: `${P}-u`, summary: "Weekly XYZ", hangoutLink: "https://meet.google.com/ttt-tttt-ttt", startDateTime: T1, endDateTime: T1END }),
    ];
    let round = 0;
    const resolveAttribution = async () => {
      round++;
      return round === 1
        ? { workspace_id: null, project_slug: null, method: "none", unresolved_domains: ["ext.com"] }
        : { workspace_id: ws.id, project_slug: "p", method: "title", unresolved_domains: [] };
    };
    const d = deps({
      listAccounts: async () => [{ id: account.id, userId: account.userId }],
      listEvents: async () => events,
      resolveAttribution,
    });
    await runMeetingsSync(d);
    const r2 = await runMeetingsSync(d);
    expect(r2.updated).toBe(1);
    const rows = await db.select().from(meetings).where(eq(meetings.sourceAccountId, account.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("scheduled");
    expect(rows[0].workspaceId).toBe(ws.id);
    expect(rows[0].attributionMethod).toBe("title");
  });

  it("8. duas contas veem o mesmo evento → 1 row só (não sobrescreve sourceAccountId)", async () => {
    const a = await seed("A");
    const b = await seed("B");
    const P = randomUUID().slice(0, 8);
    const shared = ev({ id: `${P}-shared`, iCalUID: `${P}-uid`, summary: "Shared", hangoutLink: "https://meet.google.com/sha-rrrr-red", startDateTime: T1, endDateTime: T1END });
    const report = await runMeetingsSync(
      deps({
        listAccounts: async () => [
          { id: a.account.id, userId: a.account.userId },
          { id: b.account.id, userId: b.account.userId },
        ],
        listEvents: async () => [shared],
        resolveAttribution: async () => ({ workspace_id: a.ws.id, project_slug: "p", method: "domain", unresolved_domains: [] }),
      }),
    );
    expect(report.created).toBe(1);
    expect(report.updated).toBe(1);
    const rows = await db.select().from(meetings).where(inArray(meetings.sourceAccountId, [a.account.id, b.account.id]));
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceAccountId).toBe(a.account.id);
  });

  it("9. evento sem hangoutLink / all-day → ignorado", async () => {
    const { ws, account } = await seed();
    const P = randomUUID().slice(0, 8);
    const noLink = ev({ id: `${P}-n`, iCalUID: `${P}-un`, summary: "No link", hangoutLink: null, startDateTime: T1, endDateTime: T1END });
    const allDay = ev({ id: `${P}-d`, iCalUID: `${P}-ud`, summary: "All day", hangoutLink: "https://meet.google.com/all-dddd-day", startDateTime: null });
    const report = await runMeetingsSync(
      deps({
        listAccounts: async () => [{ id: account.id, userId: account.userId }],
        listEvents: async () => [noLink, allDay],
        resolveAttribution: async () => ({ workspace_id: ws.id, project_slug: "p", method: "domain", unresolved_domains: [] }),
      }),
    );
    expect(report.seen).toBe(0);
    expect(report.created).toBe(0);
    const rows = await db.select().from(meetings).where(eq(meetings.sourceAccountId, account.id));
    expect(rows).toHaveLength(0);
  });

  it("10. erro na conta A (token revogado) não derruba a conta B → B ainda sincroniza/reconcilia", async () => {
    const a = await seed("Fail");
    const b = await seed("OK");
    const P = randomUUID().slice(0, 8);
    const bEvent = ev({
      id: `${P}-b`,
      iCalUID: `${P}-ub`,
      summary: "B call",
      hangoutLink: "https://meet.google.com/bok-bbbb-bbb",
      startDateTime: T1,
      endDateTime: T1END,
    });
    const report = await runMeetingsSync(
      deps({
        listAccounts: async () => [
          { id: a.account.id, userId: a.account.userId },
          { id: b.account.id, userId: b.account.userId },
        ],
        // Conta A explode no boundary por-conta; B segue normalmente.
        getAccessToken: async (userId) => {
          if (userId === a.account.userId) throw new Error("token revogado");
          return "tok";
        },
        listEvents: async () => [bEvent],
        resolveAttribution: async () => ({ workspace_id: b.ws.id, project_slug: "p", method: "domain", unresolved_domains: [] }),
      }),
    );
    expect(report.created).toBe(1);
    expect(report.seen).toBe(1);
    // Conta A não deixou nenhuma row (falhou antes de qualquer fetch).
    const aRows = await db.select().from(meetings).where(eq(meetings.sourceAccountId, a.account.id));
    expect(aRows).toHaveLength(0);
    // Conta B sincronizou/reconciliou de fato.
    const bRows = await db.select().from(meetings).where(eq(meetings.sourceAccountId, b.account.id));
    expect(bRows).toHaveLength(1);
    expect(bRows[0].status).toBe("scheduled");
    expect(bRows[0].workspaceId).toBe(b.ws.id);
    expect(bRows[0].attributionMethod).toBe("domain");
  });

  it("11. method domain mas workspace_id null (violação de contrato) → needs_triage (nunca scheduled c/ workspace null)", async () => {
    const { account } = await seed("NullWs");
    const P = randomUUID().slice(0, 8);
    const events = [
      ev({ id: `${P}-e`, iCalUID: `${P}-u`, summary: "Broken attr", hangoutLink: "https://meet.google.com/nnn-wwww-null", startDateTime: T1, endDateTime: T1END }),
    ];
    const report = await runMeetingsSync(
      deps({
        listAccounts: async () => [{ id: account.id, userId: account.userId }],
        listEvents: async () => events,
        // Contrato violado: domain sem workspace_id, mas com domínio pendente.
        resolveAttribution: async () => ({ workspace_id: null, project_slug: null, method: "domain", unresolved_domains: ["x.com"] }),
      }),
    );
    // Não conta como created (não vira scheduled); cai em triage por causa do unresolved.
    expect(report.created).toBe(0);
    expect(report.triaged).toBe(1);
    const rows = await db.select().from(meetings).where(eq(meetings.sourceAccountId, account.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("needs_triage");
    expect(rows[0].workspaceId).toBeNull();
    expect(rows[0].attributionMethod).toBeNull();
  });
});
