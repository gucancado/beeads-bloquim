import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces, type TestUser } from "./helpers";
import type { Agent } from "supertest";
import { db } from "@workspace/db";
import { taskActivities } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

// blockedSince ("bloqueada desde") sai do activity log (último evento
// status_changed→blocked), NÃO de tasks.cancelled_at. Motivo: o caminho de
// bloqueio via canvas (cards.ts) grava o evento no log mas NUNCA escreve
// cancelled_at → a UI, que lia a coluna, mostrava data vazia. O log é a fonte
// confiável (mesmo canon do old_blocked do health e da conclusão).
//
// Estas tarefas são bloqueadas via PATCH /status (que ESCREVE cancelled_at=agora
// E grava o evento). Backdatear SÓ o evento pra 5 dias atrás discrimina: se
// blockedSince lesse a coluna viria "agora"; lendo o log, vem 5 dias atrás.
describe("listagem de tasks — blockedSince derivado do activity log", () => {
  let agent: Agent;
  let user: TestUser;
  let workspaceId: string;
  let blockedId: string;
  let neverBlockedId: string;

  beforeAll(async () => {
    ({ agent, user } = await registerAndLogin("BlockedSince Owner"));
    const ws = await agent.post("/api/workspaces").send({ name: "WS BlockedSince" });
    workspaceId = ws.body.id;

    const blocked = await agent.post(`/api/workspaces/${workspaceId}/tasks`).send({ title: "bloqueada" });
    blockedId = blocked.body.id;
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${blockedId}/status`).send({ status: "blocked" });
    await db
      .update(taskActivities)
      .set({ createdAt: daysAgo(5) })
      .where(and(eq(taskActivities.taskId, blockedId), eq(taskActivities.type, "status_changed")));

    const never = await agent.post(`/api/workspaces/${workspaceId}/tasks`).send({ title: "nunca bloqueada" });
    neverBlockedId = never.body.id;
    await agent.patch(`/api/workspaces/${workspaceId}/tasks/${neverBlockedId}/status`).send({ status: "pending" });
  });

  afterAll(async () => {
    await deleteWorkspaces([workspaceId]);
    await deleteUser(user.id);
  });

  it("workspaceTasks: blockedSince = data do evento (não cancelled_at); null quando nunca bloqueada", async () => {
    const r = await agent.get(`/api/workspaces/${workspaceId}/tasks`);
    expect(r.status).toBe(200);
    const blocked = r.body.find((t: any) => t.id === blockedId);
    const never = r.body.find((t: any) => t.id === neverBlockedId);

    expect(blocked.blockedSince).toBeTruthy();
    // ~5 dias atrás (o evento backdated), não "agora" (o cancelled_at real).
    const ageMs = Date.now() - new Date(blocked.blockedSince).getTime();
    expect(ageMs).toBeGreaterThan(4 * 24 * 60 * 60 * 1000);
    expect(ageMs).toBeLessThan(6 * 24 * 60 * 60 * 1000);
    // cancelled_at (a coluna) é "agora" → prova que blockedSince NÃO é a coluna.
    const cancelledAgeMs = Date.now() - new Date(blocked.cancelledAt).getTime();
    expect(cancelledAgeMs).toBeLessThan(60 * 60 * 1000);

    expect(never.blockedSince).toBeNull();
  });

  it("myTasks: blockedSince também presente e derivado do log", async () => {
    const r = await agent.get(`/api/my-tasks?status=blocked`);
    expect(r.status).toBe(200);
    const blocked = r.body.find((t: any) => t.id === blockedId);
    expect(blocked).toBeTruthy();
    const ageMs = Date.now() - new Date(blocked.blockedSince).getTime();
    expect(ageMs).toBeGreaterThan(4 * 24 * 60 * 60 * 1000);
    expect(ageMs).toBeLessThan(6 * 24 * 60 * 60 * 1000);
  });
});

// Cenário-RAIZ: bloqueio pelo CANVAS (PATCH .../cards/:id/task/status) grava o
// evento status_changed→blocked no log mas NUNCA escreve tasks.cancelled_at — era
// exatamente aqui que a UI mostrava data vazia. Prova end-to-end do fix: após
// bloquear via card, blockedSince vem POPULADO enquanto cancelledAt fica NULL.
describe("listagem — blockedSince populado em bloqueio via canvas (cancelled_at NULL)", () => {
  let agent: Agent;
  let user: TestUser;
  let workspaceId: string;
  let taskId: string;

  beforeAll(async () => {
    ({ agent, user } = await registerAndLogin("Canvas Block Owner"));
    const ws = await agent.post("/api/workspaces").send({ name: "WS Canvas Block" });
    workspaceId = ws.body.id;

    const map = await agent.post(`/api/workspaces/${workspaceId}/maps`).send({ name: "Mapa" });
    const card = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${map.body.id}/cards`)
      .send({ title: "tarefa do canvas", positionX: 0, positionY: 0 });
    taskId = card.body.taskId;

    // Bloqueio pela rota do CARD — grava o log, não a coluna cancelled_at.
    const patch = await agent
      .patch(`/api/workspaces/${workspaceId}/maps/${map.body.id}/cards/${card.body.id}/task/status`)
      .send({ status: "blocked" });
    expect(patch.status).toBe(200);
  });

  afterAll(async () => {
    await deleteWorkspaces([workspaceId]);
    await deleteUser(user.id);
  });

  it("blockedSince vem do log (populado) mesmo com cancelled_at NULL", async () => {
    const r = await agent.get(`/api/workspaces/${workspaceId}/tasks?status=blocked`);
    expect(r.status).toBe(200);
    const t = r.body.find((x: any) => x.id === taskId);
    expect(t).toBeTruthy();
    // O fix: blockedSince populado (recém-bloqueado) apesar da coluna vazia.
    expect(t.blockedSince).toBeTruthy();
    expect(Date.now() - new Date(t.blockedSince).getTime()).toBeLessThan(60 * 60 * 1000);
    // A prova da causa-raiz: o canvas NÃO escreveu cancelled_at (era a data vazia).
    expect(t.cancelledAt).toBeNull();
  });
});
