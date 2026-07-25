import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";
import { db } from "@workspace/db";
import { meetings, workspaces, workspaceMembers } from "@workspace/db/schema";
import { userGoogleCalendarAccounts } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

// A rota /upcoming alimenta a seção "próximas" da agenda: agendadas/triagem/coletando
// da janela sincronizada, deduplicadas por série. Cross-workspace, com needs_triage
// visível ao dono da agenda conectada (não tem workspace ainda).
describe("GET /api/meetings/upcoming", () => {
  const userIds: string[] = [];
  const wsIds: string[] = [];
  const meetingIds: string[] = [];
  const gcalIds: string[] = [];
  afterAll(async () => {
    for (const id of meetingIds) await db.delete(meetings).where(eq(meetings.id, id));
    for (const id of gcalIds) await db.delete(userGoogleCalendarAccounts).where(eq(userGoogleCalendarAccounts.id, id));
    await deleteWorkspaces(wsIds);
    for (const id of userIds) await deleteUser(id);
  });

  it("devolve agendadas/triagem/coletando da janela, dedup por série, esconde terminais e workspace alheio", async () => {
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

    const soon = new Date(Date.now() + 2 * 3600_000);
    const soonEnd = new Date(Date.now() + 3 * 3600_000);
    const later = new Date(Date.now() + 26 * 3600_000);
    const laterEnd = new Date(Date.now() + 27 * 3600_000);
    const past = new Date(Date.now() - 3 * 3600_000);
    const pastEnd = new Date(Date.now() - 2 * 3600_000);

    const rows = await db.insert(meetings).values([
      // 1. agendada do workspace do user, na janela → aparece
      { workspaceId: ws.id, meetCode: "aaa-bbbb-ccc", status: "scheduled", occurredAt: soon,
        scheduledStartAt: soon, scheduledEndAt: soonEnd, collectEnabled: true },
      // 2. série recorrente: 2 ocorrências (mesmo gcalRecurringEventId) → só a mais próxima
      { workspaceId: ws.id, meetCode: "rec-aaaa-bbb", status: "scheduled", occurredAt: soon,
        scheduledStartAt: soon, scheduledEndAt: soonEnd, collectEnabled: true, gcalRecurringEventId: "serie-1" },
      { workspaceId: ws.id, meetCode: "rec-cccc-ddd", status: "scheduled", occurredAt: later,
        scheduledStartAt: later, scheduledEndAt: laterEnd, collectEnabled: true, gcalRecurringEventId: "serie-1" },
      // 3. needs_triage da agenda conectada do user (sem workspace) → aparece
      { workspaceId: null, sourceAccountId: acc.id, meetCode: "tri-aaaa-bbb", status: "needs_triage",
        occurredAt: soon, scheduledStartAt: soon, scheduledEndAt: soonEnd, collectEnabled: true },
      // 4. terminal (transcrita) → NÃO aparece
      { workspaceId: ws.id, meetCode: " end-aaaa-bbb", status: "transcribed", occurredAt: past },
      // 5. missed → NÃO aparece
      { workspaceId: ws.id, meetCode: "mis-aaaa-bbb", status: "missed", occurredAt: past,
        scheduledStartAt: past, scheduledEndAt: pastEnd },
      // 6. scheduled já terminada (fora da janela) → NÃO aparece
      { workspaceId: ws.id, meetCode: "old-aaaa-bbb", status: "scheduled", occurredAt: past,
        scheduledStartAt: past, scheduledEndAt: pastEnd, collectEnabled: true },
      // 7. workspace alheio → NÃO aparece
      { workspaceId: alien.id, meetCode: "xxx-yyyy-zzz", status: "scheduled", occurredAt: soon,
        scheduledStartAt: soon, scheduledEndAt: soonEnd, collectEnabled: true },
    ]).returning();
    meetingIds.push(...rows.map(r => r.id));

    const r = await agent.get("/api/meetings/upcoming");
    expect(r.status).toBe(200);
    const codes = (r.body as Array<{ meetCode: string }>).map(m => m.meetCode);
    expect(codes).toContain("aaa-bbbb-ccc");
    expect(codes).toContain("tri-aaaa-bbb");
    expect(codes).toContain("rec-aaaa-bbb");   // ocorrência mais próxima da série
    expect(codes).not.toContain("rec-cccc-ddd"); // a segunda ocorrência sai
    expect(codes).not.toContain("end-aaaa-bbb");
    expect(codes).not.toContain("mis-aaaa-bbb");
    expect(codes).not.toContain("old-aaaa-bbb");
    expect(codes).not.toContain("xxx-yyyy-zzz");
  });
});
