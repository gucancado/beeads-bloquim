import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";
import { db } from "@workspace/db";
import { meetings, workspaces, workspaceMembers } from "@workspace/db/schema";
import { userGoogleCalendarAccounts } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

// A rota /upcoming alimenta a seção "próximas" da agenda: agendadas/triagem/coletando
// da janela sincronizada, deduplicadas por série. Cross-workspace, com needs_triage
// visível ao dono da agenda conectada (não tem workspace ainda). Este teste também
// cobre as regras de collecting (ignora a janela; não é deduplicada pela série) e a
// ORDENAÇÃO final (collecting primeiro, depois por scheduledStartAt asc).
describe("GET /api/meetings/upcoming", () => {
  const userIds: string[] = [];
  const wsIds: string[] = [];
  const meetingIds: string[] = [];
  const gcalIds: string[] = [];
  const ENV_KEYS = ["MEETINGS_ENABLED", "WORKER_URL", "WORKER_PANEL_TOKEN"] as const;
  const savedEnv: Record<string, string | undefined> = {};

  afterAll(async () => {
    for (const id of meetingIds) await db.delete(meetings).where(eq(meetings.id, id));
    for (const id of gcalIds) await db.delete(userGoogleCalendarAccounts).where(eq(userGoogleCalendarAccounts.id, id));
    await deleteWorkspaces(wsIds);
    for (const id of userIds) await deleteUser(id);
    // Restaura o env pra não vazar estado pros outros arquivos do mesmo processo Vitest.
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("devolve agendadas/triagem/coletando da janela, dedup por série, respeita collecting e ordena; esconde terminais e workspace alheio", async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.MEETINGS_ENABLED = "true";
    process.env.WORKER_URL = "http://worker.invalid";
    process.env.WORKER_PANEL_TOKEN = "t";

    const { agent, user } = await registerAndLogin();
    const outsider = await registerAndLogin("Outsider");
    userIds.push(user.id, outsider.user.id);

    const [ws] = await db.insert(workspaces).values({ name: "WS F2", createdBy: user.id }).returning();
    const [alien] = await db.insert(workspaces).values({ name: "WS Alheio", createdBy: outsider.user.id }).returning();
    wsIds.push(ws.id, alien.id);
    await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: user.id, role: "admin" });
    await db.insert(workspaceMembers).values({ workspaceId: alien.id, userId: outsider.user.id, role: "admin" });

    // agenda conectada do user (pra visibilidade da needs_triage)
    const [acc] = await db.insert(userGoogleCalendarAccounts).values({
      userId: user.id, googleAccountEmail: "u@test.local",
      accessTokenEncrypted: "x", refreshTokenEncrypted: "y", expiresAt: new Date(Date.now() + 3600_000),
    }).returning();
    gcalIds.push(acc.id);

    const h = 3600_000;
    const now = Date.now();
    const at = (hrs: number) => new Date(now + hrs * h);
    // Tempos distintos pra tornar a ordenação determinística (sem empates).
    const colPastStart = at(-3), colPastEnd = at(-2);        // collecting fora da janela
    const soloStart = at(2), soloEnd = at(3);                // scheduled solo
    const serieColSchStart = at(3), serieColSchEnd = at(4);  // scheduled irmão da série "serie-col"
    const colRecStart = at(5), colRecEnd = at(6);            // collecting da série "serie-col"
    const recNearStart = at(6), recNearEnd = at(7);          // scheduled "serie-1" (mais próxima)
    const triStart = at(8), triEnd = at(9);                  // needs_triage
    const recFarStart = at(26), recFarEnd = at(27);          // scheduled "serie-1" (mais distante) — deduplicada
    const pastStart = at(-3), pastEnd = at(-2);              // scheduled fora da janela

    const rows = await db.insert(meetings).values([
      // COLLECTING fora da janela (end no passado) → aparece mesmo assim (bypass da janela).
      { workspaceId: ws.id, meetCode: "col-past-aaa", status: "collecting", occurredAt: colPastStart,
        scheduledStartAt: colPastStart, scheduledEndAt: colPastEnd, collectEnabled: true },
      // COLLECTING que compartilha gcalRecurringEventId com uma ocorrência scheduled →
      // NÃO pode ser deduplicada pela série (collecting passa sempre).
      { workspaceId: ws.id, meetCode: "col-rec-bbb", status: "collecting", occurredAt: colRecStart,
        scheduledStartAt: colRecStart, scheduledEndAt: colRecEnd, collectEnabled: true, gcalRecurringEventId: "serie-col" },
      // irmã scheduled da mesma série "serie-col" → também aparece (única scheduled da série).
      { workspaceId: ws.id, meetCode: "serie-col-sch", status: "scheduled", occurredAt: serieColSchStart,
        scheduledStartAt: serieColSchStart, scheduledEndAt: serieColSchEnd, collectEnabled: true, gcalRecurringEventId: "serie-col" },
      // scheduled solo do workspace do user, na janela → aparece
      { workspaceId: ws.id, meetCode: "aaa-solo-ccc", status: "scheduled", occurredAt: soloStart,
        scheduledStartAt: soloStart, scheduledEndAt: soloEnd, collectEnabled: true },
      // série "serie-1": 2 ocorrências scheduled → só a mais próxima
      { workspaceId: ws.id, meetCode: "rec-near-ddd", status: "scheduled", occurredAt: recNearStart,
        scheduledStartAt: recNearStart, scheduledEndAt: recNearEnd, collectEnabled: true, gcalRecurringEventId: "serie-1" },
      { workspaceId: ws.id, meetCode: "rec-far-eee", status: "scheduled", occurredAt: recFarStart,
        scheduledStartAt: recFarStart, scheduledEndAt: recFarEnd, collectEnabled: true, gcalRecurringEventId: "serie-1" },
      // needs_triage da agenda conectada do user (sem workspace) → aparece
      { workspaceId: null, sourceAccountId: acc.id, meetCode: "tri-triage-fff", status: "needs_triage",
        occurredAt: triStart, scheduledStartAt: triStart, scheduledEndAt: triEnd, collectEnabled: true },
      // terminal (transcrita) → NÃO aparece
      { workspaceId: ws.id, meetCode: "end-term-ggg", status: "transcribed", occurredAt: pastStart },
      // missed → NÃO aparece
      { workspaceId: ws.id, meetCode: "mis-miss-hhh", status: "missed", occurredAt: pastStart,
        scheduledStartAt: pastStart, scheduledEndAt: pastEnd },
      // scheduled já terminada (fora da janela) → NÃO aparece
      { workspaceId: ws.id, meetCode: "old-past-iii", status: "scheduled", occurredAt: pastStart,
        scheduledStartAt: pastStart, scheduledEndAt: pastEnd, collectEnabled: true },
      // workspace alheio → NÃO aparece
      { workspaceId: alien.id, meetCode: "xxx-alien-jjj", status: "scheduled", occurredAt: soloStart,
        scheduledStartAt: soloStart, scheduledEndAt: soloEnd, collectEnabled: true },
    ]).returning();
    meetingIds.push(...rows.map(r => r.id));

    const r = await agent.get("/api/meetings/upcoming");
    expect(r.status).toBe(200);
    const codes = (r.body as Array<{ meetCode: string }>).map(m => m.meetCode);

    // visibilidade / janela / dedup
    expect(codes).toContain("aaa-solo-ccc");
    expect(codes).toContain("tri-triage-fff");   // needs_triage da agenda conectada
    expect(codes).toContain("rec-near-ddd");     // ocorrência mais próxima da série
    expect(codes).not.toContain("rec-far-eee");  // a segunda ocorrência sai
    expect(codes).not.toContain("end-term-ggg"); // terminal
    expect(codes).not.toContain("mis-miss-hhh"); // missed
    expect(codes).not.toContain("old-past-iii"); // scheduled fora da janela
    expect(codes).not.toContain("xxx-alien-jjj"); // workspace alheio

    // regras de collecting
    expect(codes).toContain("col-past-aaa");  // collecting ignora a janela (end no passado)
    expect(codes).toContain("col-rec-bbb");   // collecting NÃO é deduplicada pela série
    expect(codes).toContain("serie-col-sch"); // o irmão scheduled da série também aparece

    // ordenação exata: collecting primeiro (entre si por start asc), depois o resto por start asc.
    expect(codes).toEqual([
      "col-past-aaa",   // collecting, start now-3h
      "col-rec-bbb",    // collecting, start now+5h
      "aaa-solo-ccc",   // now+2h
      "serie-col-sch",  // now+3h
      "rec-near-ddd",   // now+6h
      "tri-triage-fff", // now+8h
    ]);
  });
});
