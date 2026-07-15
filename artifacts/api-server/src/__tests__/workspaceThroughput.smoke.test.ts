import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces, type TestUser } from "./helpers";
import type { Agent } from "supertest";

describe("GET /workspaces/:id/tasks/throughput", () => {
  let agent: Agent;
  let user: TestUser;
  let workspaceId: string;

  beforeAll(async () => {
    ({ agent, user } = await registerAndLogin("Throughput Owner"));
    const ws = await agent.post("/api/workspaces").send({ name: "WS Thr" });
    workspaceId = ws.body.id;
    // 3 tasks criadas agora; 2 concluídas (1 delas re-concluída — não pode duplicar)
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await agent.post(`/api/workspaces/${workspaceId}/tasks`).send({ title: `T${i}` });
      ids.push(r.body.id);
      await agent.patch(`/api/workspaces/${workspaceId}/tasks/${r.body.id}/status`).send({ status: "pending" });
    }
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${ids[0]}/status`).send({ status: "completed" });
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${ids[1]}/status`).send({ status: "completed" });
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${ids[1]}/status`).send({ status: "pending" });
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${ids[1]}/status`).send({ status: "completed" });
  });

  afterAll(async () => {
    await deleteWorkspaces([workspaceId]);
    await deleteUser(user.id);
  });

  it("série com zero-fill, leadTime e previousPeriod", async () => {
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const r = await agent.get(
      `/api/workspaces/${workspaceId}/tasks/throughput?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&granularity=day`,
    );
    expect(r.status).toBe(200);
    expect(r.body.granularity).toBe("day");
    expect(r.body.series.length).toBeGreaterThanOrEqual(14); // zero-fill diário
    const totalCreated = r.body.series.reduce((s: number, b: any) => s + b.created, 0);
    const totalCompleted = r.body.series.reduce((s: number, b: any) => s + b.completed, 0);
    expect(totalCreated).toBe(3);
    expect(totalCompleted).toBe(2); // re-conclusão de ids[1] NÃO duplica
    expect(r.body.leadTimeDays.count).toBe(2);
    expect(r.body.leadTimeDays.median).toBeGreaterThanOrEqual(0);
    expect(r.body.previousPeriod.created).toBe(0);
    expect(r.body.byAssignee.reduce((s: number, a: any) => s + a.completed, 0)).toBe(2);
  });

  it("default sem janela = 8 semanas / week; 400 em janela absurda", async () => {
    const def = await agent.get(`/api/workspaces/${workspaceId}/tasks/throughput`);
    expect(def.status).toBe(200);
    expect(def.body.granularity).toBe("week");
    expect(def.body.series.length).toBeGreaterThanOrEqual(8);

    const since = "2000-01-01";
    const bad = await agent.get(`/api/workspaces/${workspaceId}/tasks/throughput?since=${since}&granularity=day`);
    expect(bad.status).toBe(400); // > 200 buckets
  });

  it("403 pra não-membro", async () => {
    const { agent: stranger, user: strangerUser } = await registerAndLogin("Stranger");
    expect((await stranger.get(`/api/workspaces/${workspaceId}/tasks/throughput`)).status).toBe(403);
    await deleteUser(strangerUser.id);
  });
});
