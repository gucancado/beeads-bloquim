import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces, type TestUser } from "./helpers";
import type { Agent } from "supertest";
import { db } from "@workspace/db";
import { tasks, taskActivities } from "@workspace/db/schema";
import { and, eq, gt, sql } from "drizzle-orm";

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

describe("GET /workspaces/:id/tasks/health", () => {
  let agent: Agent;
  let user: TestUser;
  let workspaceId: string;

  beforeAll(async () => {
    ({ agent, user } = await registerAndLogin("Health Owner"));
    const ws = await agent.post("/api/workspaces").send({ name: "WS Health" });
    workspaceId = ws.body.id;

    // t1: pending saudável (recém-criada)
    const t1 = await agent.post(`/api/workspaces/${workspaceId}/tasks`).send({ title: "ok" });
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${t1.body.id}/status`).send({ status: "pending" });

    // t2: in_progress ESTAGNADA — forjar: status in_progress + backdate de TODAS as activities e do created_at
    const t2 = await agent.post(`/api/workspaces/${workspaceId}/tasks`).send({ title: "estagnada" });
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${t2.body.id}/status`).send({ status: "in_progress" });
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await db.update(taskActivities).set({ createdAt: tenDaysAgo }).where(eq(taskActivities.taskId, t2.body.id));
    await db.update(tasks).set({ createdAt: tenDaysAgo }).where(eq(tasks.id, t2.body.id));

    // t3: urgente velha — schedule urgente + backdate created_at
    const t3 = await agent.post(`/api/workspaces/${workspaceId}/tasks`).send({ title: "urgente velha", scheduleMode: "urgente" });
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${t3.body.id}/status`).send({ status: "pending" });
    await db.update(tasks).set({ createdAt: tenDaysAgo }).where(eq(tasks.id, t3.body.id));
  });

  afterAll(async () => {
    await deleteWorkspaces([workspaceId]);
    await deleteUser(user.id);
  });

  it("retorna score deduzido, band e os 6 sinais sempre presentes", async () => {
    const r = await agent.get(`/api/workspaces/${workspaceId}/tasks/health`);
    expect(r.status).toBe(200);
    expect(r.body.signals).toHaveLength(6);
    const keys = r.body.signals.map((s: any) => s.key).sort();
    expect(keys).toEqual(["old_blocked", "old_tail", "old_urgent", "overdue", "stale_in_progress", "unassigned_backlog"]);

    const stale = r.body.signals.find((s: any) => s.key === "stale_in_progress");
    expect(stale.value).toBe(1);
    expect(stale.of).toBe(1); // 1 in_progress no ws
    expect(stale.deduction).toBe(20); // 1/1 * 20
    expect(stale.sample[0].title).toBe("estagnada");

    const urgent = r.body.signals.find((s: any) => s.key === "old_urgent");
    expect(urgent.value).toBe(1);
    expect(urgent.deduction).toBe(5);

    // score = 100 - 20 (stale) - 5 (urgent) - unassigned? tasks têm assignee (criador) → 0
    expect(r.body.score).toBe(75);
    expect(r.body.band).toBe("atencao");
    expect(r.body.totals.inProgress).toBe(1);
  });

  it("403 pra não-membro", async () => {
    const { agent: stranger, user: strangerUser } = await registerAndLogin("Stranger");
    expect((await stranger.get(`/api/workspaces/${workspaceId}/tasks/health`)).status).toBe(403);
    await deleteUser(strangerUser.id);
  });
});

// `value` sai de count(*) sem teto; `sample` é capado em 10. Um `value`
// re-derivado de sample.length reportaria 10 e deduziria round(10/12*15)=13
// em vez de round(12/12*15)=15 — sempre subestimando a doença do workspace.
describe("GET /workspaces/:id/tasks/health — value vem da contagem, não da amostra", () => {
  let agent: Agent;
  let user: TestUser;
  let workspaceId: string;
  const SEEDED = 12;

  beforeAll(async () => {
    ({ agent, user } = await registerAndLogin("Health Count Owner"));
    const ws = await agent.post("/api/workspaces").send({ name: "WS Health Count" });
    workspaceId = ws.body.id;

    // 12 tarefas abertas SEM responsável (assignedTo: null explícito — omitir
    // o campo faria o backend default pro criador) — acima do teto de amostra.
    for (let i = 0; i < SEEDED; i++) {
      const t = await agent
        .post(`/api/workspaces/${workspaceId}/tasks`)
        .send({ title: `sem dono ${i}`, assignedTo: null });
      // tasks nascem draft — ativar pra entrar nos denominadores
      await agent.patch(`/api/workspaces/${workspaceId}/tasks/${t.body.id}/status`).send({ status: "pending" });
    }
  });

  afterAll(async () => {
    await deleteWorkspaces([workspaceId]);
    await deleteUser(user.id);
  });

  it("value reflete a contagem real, sample é capado em 10 e a dedução usa o value real", async () => {
    const r = await agent.get(`/api/workspaces/${workspaceId}/tasks/health`);
    expect(r.status).toBe(200);

    const unassigned = r.body.signals.find((s: any) => s.key === "unassigned_backlog");
    expect(unassigned.value).toBe(SEEDED); // contagem real, não o tamanho da amostra
    expect(unassigned.sample).toHaveLength(10); // amostra capada
    expect(unassigned.of).toBe(SEEDED);
    expect(unassigned.deduction).toBe(15); // round(12/12 * 15) — não round(10/12 * 15) = 13
    expect(r.body.totals.open).toBe(SEEDED);
    expect(r.body.score).toBe(85); // 100 − 15
  });
});

// "Bloqueada desde" vem do activity log, não de tasks.cancelled_at: a rota de
// card bloqueia sem nunca escrever a coluna, e `NULL < now() - interval` é
// NULL (não false), então a tarefa sumia do FILTER. Estas tarefas são
// bloqueadas via PATCH /status (que ESCREVE cancelled_at = agora); backdatear
// só o evento do log prova que a contagem lê o log, porque pela coluna as
// duas seriam "bloqueadas agora" e o sinal daria 0.
describe("GET /workspaces/:id/tasks/health — old_blocked conta pelo activity log", () => {
  let agent: Agent;
  let user: TestUser;
  let workspaceId: string;

  beforeAll(async () => {
    ({ agent, user } = await registerAndLogin("Health Blocked Owner"));
    const ws = await agent.post("/api/workspaces").send({ name: "WS Health Blocked" });
    workspaceId = ws.body.id;

    // bloqueada há 20 dias (> 14) — deve contar
    const velha = await agent.post(`/api/workspaces/${workspaceId}/tasks`).send({ title: "bloqueada velha" });
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${velha.body.id}/status`).send({ status: "blocked" });
    await db
      .update(taskActivities)
      .set({ createdAt: daysAgo(20) })
      .where(and(eq(taskActivities.taskId, velha.body.id), eq(taskActivities.type, "status_changed")));

    // bloqueada agora (< 14 dias) — NÃO deve contar
    const recente = await agent.post(`/api/workspaces/${workspaceId}/tasks`).send({ title: "bloqueada recente" });
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${recente.body.id}/status`).send({ status: "blocked" });

    // desbloqueio → re-block: bloqueada há 30d, desbloqueada há 15d, re-bloqueada
    // há 2d. "Bloqueada desde" é o re-block (MAX), então NÃO conta. Ancora o MAX:
    // com MIN, o evento de 30d venceria e ela entraria no sinal.
    const rebloq = await agent.post(`/api/workspaces/${workspaceId}/tasks`).send({ title: "re-bloqueada" });
    const rebloqId = rebloq.body.id;
    const isRebloq = eq(taskActivities.taskId, rebloqId);
    // 1º block (30d atrás) — único evento até aqui
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${rebloqId}/status`).send({ status: "blocked" });
    await db.update(taskActivities).set({ createdAt: daysAgo(30) })
      .where(and(isRebloq, eq(taskActivities.type, "status_changed")));
    // desbloqueio (15d atrás) — o único evento com newStatus='pending'
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${rebloqId}/status`).send({ status: "pending" });
    await db.update(taskActivities).set({ createdAt: daysAgo(15) })
      .where(and(isRebloq, sql`${taskActivities.metadata}->>'newStatus' = 'pending'`));
    // re-block (2d atrás) — o evento blocked recém-criado; o de 30d já está
    // retroagido, então o corte por createdAt isola só este.
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${rebloqId}/status`).send({ status: "blocked" });
    await db.update(taskActivities).set({ createdAt: daysAgo(2) })
      .where(and(isRebloq, sql`${taskActivities.metadata}->>'newStatus' = 'blocked'`, gt(taskActivities.createdAt, daysAgo(1))));
  });

  afterAll(async () => {
    await deleteWorkspaces([workspaceId]);
    await deleteUser(user.id);
  });

  it("conta só a bloqueada há 14+ dias, medindo pelo MAX do evento status_changed→blocked", async () => {
    const r = await agent.get(`/api/workspaces/${workspaceId}/tasks/health`);
    expect(r.status).toBe(200);

    const blocked = r.body.signals.find((s: any) => s.key === "old_blocked");
    // só a velha: a recente é nova, e a re-bloqueada conta a partir do re-block
    // de 2d (com MIN, o block original de 30d a incluiria e value seria 2).
    expect(blocked.value).toBe(1);
    expect(blocked.deduction).toBe(5); // cap(1 * 5, 10)
    expect(blocked.sample).toHaveLength(1);
    expect(blocked.sample[0].title).toBe("bloqueada velha");
    expect(r.body.totals.open).toBe(3); // as três blocked contam como abertas
    expect(r.body.score).toBe(95); // 100 − 5
  });
});
