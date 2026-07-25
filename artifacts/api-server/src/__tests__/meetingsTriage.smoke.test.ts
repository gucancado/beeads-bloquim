import { describe, it, expect, afterAll, vi } from "vitest";

// Mock só o getWorkerClient; preserva o resto do módulo (extractMeetCode,
// syncMeetingFromWorker, classes de erro) que a rota importa.
const upsertTitleRule = vi.fn();
vi.mock("../services/meetingCollectorService", async (importActual) => {
  const actual = await importActual<typeof import("../services/meetingCollectorService")>();
  return { ...actual, getWorkerClient: () => ({ upsertTitleRule }) };
});

import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";
import { db } from "@workspace/db";
import { meetings, workspaces, workspaceMembers } from "@workspace/db/schema";
import { userGoogleCalendarAccounts } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

describe("triagem de reuniões (needs_triage)", () => {
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

  async function seed() {
    process.env.MEETINGS_ENABLED = "true";
    process.env.WORKER_URL = "http://worker.invalid";
    process.env.WORKER_PANEL_TOKEN = "t";
    const { agent, user } = await registerAndLogin();
    userIds.push(user.id);
    const [ws] = await db.insert(workspaces).values({ name: "WS Triagem", createdBy: user.id }).returning();
    wsIds.push(ws.id);
    await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: user.id, role: "admin" });
    const [acc] = await db.insert(userGoogleCalendarAccounts).values({
      userId: user.id, googleAccountEmail: "u@test.local",
      accessTokenEncrypted: "x", refreshTokenEncrypted: "y", expiresAt: new Date(Date.now() + 3600_000),
    }).returning();
    gcalIds.push(acc.id);
    return { agent, user, ws, acc };
  }

  it("atribui workspace, vira scheduled/manual e cria a title rule", async () => {
    upsertTitleRule.mockReset().mockResolvedValue(undefined);
    const { agent, user, ws, acc } = await seed();
    const [m] = await db.insert(meetings).values({
      workspaceId: null, sourceAccountId: acc.id, meetCode: "tri-aaaa-bbb", status: "needs_triage",
      title: "Ludi Ateliê + BeeAds", occurredAt: new Date(),
    }).returning();
    meetingIds.push(m.id);

    const r = await agent.post(`/api/meetings/${m.id}/triage`).send({ workspaceId: ws.id, titleRulePattern: "ludi ateliê" });
    expect(r.status).toBe(200);
    expect(r.body.titleRuleCreated).toBe(true);
    expect(r.body.meeting.status).toBe("scheduled");
    expect(r.body.meeting.workspaceId).toBe(ws.id);
    expect(r.body.meeting.attributionMethod).toBe("manual");
    expect(upsertTitleRule).toHaveBeenCalledWith(user.id, { pattern: "ludi ateliê", workspaceId: ws.id });
  });

  it("atribui mesmo se o worker falhar na regra (best-effort → titleRuleCreated:false)", async () => {
    upsertTitleRule.mockReset().mockRejectedValue(new Error("worker down"));
    const { agent, ws, acc } = await seed();
    const [m] = await db.insert(meetings).values({
      workspaceId: null, sourceAccountId: acc.id, meetCode: "tri-cccc-ddd", status: "needs_triage",
      title: "Cliente X", occurredAt: new Date(),
    }).returning();
    meetingIds.push(m.id);
    const r = await agent.post(`/api/meetings/${m.id}/triage`).send({ workspaceId: ws.id, titleRulePattern: "cliente x" });
    expect(r.status).toBe(200);
    expect(r.body.titleRuleCreated).toBe(false);
    expect(r.body.meeting.status).toBe("scheduled"); // atribuição não foi desfeita
  });

  it("sem titleRulePattern: atribui sem chamar o worker", async () => {
    upsertTitleRule.mockReset();
    const { agent, ws, acc } = await seed();
    const [m] = await db.insert(meetings).values({
      workspaceId: null, sourceAccountId: acc.id, meetCode: "tri-eeee-fff", status: "needs_triage", occurredAt: new Date(),
    }).returning();
    meetingIds.push(m.id);
    const r = await agent.post(`/api/meetings/${m.id}/triage`).send({ workspaceId: ws.id });
    expect(r.status).toBe(200);
    expect(r.body.titleRuleCreated).toBe(false);
    expect(upsertTitleRule).not.toHaveBeenCalled();
  });

  it("rejeita triagem de row que não é needs_triage", async () => {
    upsertTitleRule.mockReset();
    const { agent, ws } = await seed();
    const [m] = await db.insert(meetings).values({
      workspaceId: ws.id, meetCode: "sch-aaaa-bbb", status: "scheduled", occurredAt: new Date(),
    }).returning();
    meetingIds.push(m.id);
    const r = await agent.post(`/api/meetings/${m.id}/triage`).send({ workspaceId: ws.id });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("not_triageable");
  });

  it("discard leva needs_triage pra canceled", async () => {
    const { agent, acc } = await seed();
    const [m] = await db.insert(meetings).values({
      workspaceId: null, sourceAccountId: acc.id, meetCode: "dis-aaaa-bbb", status: "needs_triage", occurredAt: new Date(),
    }).returning();
    meetingIds.push(m.id);
    const r = await agent.post(`/api/meetings/${m.id}/discard`).send();
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("canceled");
  });
});
