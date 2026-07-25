import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";
import { db } from "@workspace/db";
import { meetings, workspaces, workspaceMembers } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

describe("PATCH /api/meetings/:id/collect", () => {
  const userIds: string[] = [];
  const wsIds: string[] = [];
  const meetingIds: string[] = [];
  // Captura os valores pristinos ANTES de qualquer teste mutar (o corpo do describe
  // roda na coleta, antes dos it/seed), pra restaurar em afterAll sem vazar estado
  // pros outros arquivos do mesmo processo Vitest.
  const ENV_KEYS = ["MEETINGS_ENABLED", "WORKER_URL", "WORKER_PANEL_TOKEN"] as const;
  const savedEnv: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];

  afterAll(async () => {
    for (const id of meetingIds) await db.delete(meetings).where(eq(meetings.id, id));
    await deleteWorkspaces(wsIds);
    for (const id of userIds) await deleteUser(id);
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  async function seed() {
    process.env.MEETINGS_ENABLED = "true";
    process.env.WORKER_URL = "http://worker.invalid";
    process.env.WORKER_PANEL_TOKEN = "t";
    const { agent, user } = await registerAndLogin();
    userIds.push(user.id);
    const [ws] = await db.insert(workspaces).values({ name: "WS Collect", createdBy: user.id }).returning();
    wsIds.push(ws.id);
    await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: user.id, role: "admin" });
    return { agent, user, ws };
  }

  it("desliga e religa a coleta de uma agendada", async () => {
    const { agent, ws } = await seed();
    const [m] = await db.insert(meetings).values({
      workspaceId: ws.id, meetCode: "aaa-bbbb-ccc", status: "scheduled",
      occurredAt: new Date(), collectEnabled: true,
    }).returning();
    meetingIds.push(m.id);

    const off = await agent.patch(`/api/meetings/${m.id}/collect`).send({ collectEnabled: false });
    expect(off.status).toBe(200);
    expect(off.body.collectEnabled).toBe(false);

    const on = await agent.patch(`/api/meetings/${m.id}/collect`).send({ collectEnabled: true });
    expect(on.body.collectEnabled).toBe(true);
  });

  it("rejeita toggle em reunião terminal", async () => {
    const { agent, ws } = await seed();
    const [m] = await db.insert(meetings).values({
      workspaceId: ws.id, meetCode: "ddd-eeee-fff", status: "transcribed", occurredAt: new Date(),
    }).returning();
    meetingIds.push(m.id);
    const r = await agent.patch(`/api/meetings/${m.id}/collect`).send({ collectEnabled: false });
    expect(r.status).toBe(400);
  });

  it("403 pra quem não pode agir na reunião", async () => {
    const { ws } = await seed();
    const stranger = await registerAndLogin("Stranger");
    userIds.push(stranger.user.id);
    const [m] = await db.insert(meetings).values({
      workspaceId: ws.id, meetCode: "ggg-hhhh-iii", status: "scheduled", occurredAt: new Date(), collectEnabled: true,
    }).returning();
    meetingIds.push(m.id);
    const r = await stranger.agent.patch(`/api/meetings/${m.id}/collect`).send({ collectEnabled: false });
    expect(r.status).toBe(403);
  });
});
