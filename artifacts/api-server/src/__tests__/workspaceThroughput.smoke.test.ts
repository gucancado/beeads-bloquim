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

  // `month` é a granularidade cuja aritmética NÃO é uniforme (date_trunc('month')
  // + interval '1 month' variam de 28 a 31 dias, ao contrário de day/week), então
  // day/week passando não diz nada sobre ela.
  it("granularity=month: buckets no 1º dia do mês, sem duplicar, métricas fechando entre si", async () => {
    // Janela do 1º dia do mês 2 meses atrás (03:00Z = 00:00 em SP) até amanhã:
    // cobre o seed (criado agora) e garante ≥3 buckets mensais.
    const now = new Date();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1, 3, 0, 0)).toISOString();
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const r = await agent.get(
      `/api/workspaces/${workspaceId}/tasks/throughput?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&granularity=month`,
    );
    expect(r.status).toBe(200);
    expect(r.body.granularity).toBe("month");

    // Todo bucket cai no 1º dia de um mês — invariante do date_trunc('month')
    // (com granularity=day isto falharia no primeiro bucket que não fosse dia 1).
    for (const b of r.body.series) expect(b.bucketStart.slice(-2)).toBe("01");

    // Meses distintos e consecutivos: o generate_series não repete nem pula bucket.
    const months = r.body.series.map((b: any) => b.bucketStart.slice(0, 7));
    expect(new Set(months).size).toBe(months.length);
    expect(months.length).toBeGreaterThanOrEqual(3);

    // Seed inteiro cai no bucket do mês corrente; re-conclusão segue sem duplicar.
    const totalCreated = r.body.series.reduce((s: number, b: any) => s + b.created, 0);
    const totalCompleted = r.body.series.reduce((s: number, b: any) => s + b.completed, 0);
    expect(totalCreated).toBe(3);
    expect(totalCompleted).toBe(2);

    // As 3 métricas saem da MESMA CTE canônica de conclusão (fonte única em
    // workspaceThroughput.ts) — têm que contar o mesmo conjunto de tasks. Se
    // alguém reescrever a CTE à mão numa das queries e ela driftar, a falha é
    // silenciosa; esta asserção é a rede.
    expect(r.body.byAssignee.reduce((s: number, a: any) => s + a.completed, 0)).toBe(totalCompleted);
    expect(r.body.leadTimeDays.count).toBe(totalCompleted);
  });

  it("403 pra não-membro", async () => {
    const { agent: stranger, user: strangerUser } = await registerAndLogin("Stranger");
    expect((await stranger.get(`/api/workspaces/${workspaceId}/tasks/throughput`)).status).toBe(403);
    await deleteUser(strangerUser.id);
  });
});
