import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces, type TestUser } from "./helpers";
import type { Agent } from "supertest";

describe("GET /workspaces/:id/tasks/stats", () => {
  let agent: Agent;
  let user: TestUser;
  let workspaceId: string;
  const taskIds: string[] = [];

  beforeAll(async () => {
    ({ agent, user } = await registerAndLogin("Stats Owner"));
    const ws = await agent.post("/api/workspaces").send({ name: "WS Stats" });
    expect(ws.status).toBe(201);
    workspaceId = ws.body.id;

    // 3 tasks: 1 fica pending/high, 1 completa, 1 completa→reabre→completa (re-conclusão)
    for (const t of [
      { title: "T pending", priority: "high" },
      { title: "T done", priority: "medium" },
      { title: "T redone", priority: "medium" },
    ]) {
      const r = await agent.post(`/api/workspaces/${workspaceId}/tasks`).send(t);
      expect(r.status).toBe(201);
      taskIds.push(r.body.id);
      // tasks nascem draft — ativar para pending
      await agent.patch(`/api/workspaces/${workspaceId}/tasks/${r.body.id}/status`).send({ status: "pending" });
    }
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${taskIds[1]}/status`).send({ status: "completed" });
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${taskIds[2]}/status`).send({ status: "completed" });
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${taskIds[2]}/status`).send({ status: "pending" });
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${taskIds[2]}/status`).send({ status: "completed" });
  });

  afterAll(async () => {
    await deleteWorkspaces([workspaceId]);
    await deleteUser(user.id);
  });

  it("agrega byStatus/byPriority/byAssignee/aging", async () => {
    const r = await agent.get(`/api/workspaces/${workspaceId}/tasks/stats`);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(3);
    expect(r.body.byStatus.pending).toBe(1);
    expect(r.body.byStatus.completed).toBe(2);
    expect(r.body.byPriority.high).toBe(1);
    expect(r.body.overdue).toBe(0);
    expect(r.body.aging.d0_7).toBe(1); // só a pending conta como aberta
    expect(r.body.window).toBeNull();
    const me = r.body.byAssignee.find((a: any) => a.userId === user.id);
    expect(me.total).toBe(3);
    expect(me.open).toBe(1);
  });

  it("window.completed conta DISTINCT tasks pelo activity log (re-conclusão não duplica)", async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const r = await agent.get(`/api/workspaces/${workspaceId}/tasks/stats?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`);
    expect(r.status).toBe(200);
    expect(r.body.window.created).toBe(3);
    expect(r.body.window.completed).toBe(2); // T done + T redone (1x cada, apesar de 3 eventos)
  });

  it("400 em since/until inválido, 403 pra não-membro", async () => {
    const bad = await agent.get(`/api/workspaces/${workspaceId}/tasks/stats?since=xx`);
    expect(bad.status).toBe(400);
    const { agent: stranger, user: strangerUser } = await registerAndLogin("Stranger");
    const forbidden = await stranger.get(`/api/workspaces/${workspaceId}/tasks/stats`);
    expect(forbidden.status).toBe(403);
    await deleteUser(strangerUser.id);
  });
});
