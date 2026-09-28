import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Agent } from "supertest";
import { db } from "@workspace/db";
import { tasks } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { registerAndLogin, deleteUser, deleteWorkspaces, type TestUser } from "./helpers";

const DAY = 86_400_000;
const noon = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * DAY);
  return d.toISOString().slice(0, 10) + "T12:00:00.000Z";
};

describe("GET /api/calendar/tasks", () => {
  let agent: Agent;
  let user: TestUser;
  let outsider: { agent: Agent; user: TestUser };
  let wsId: string;
  let alienWsId: string;
  const ids: Record<string, string> = {};

  const create = async (title: string, body: Record<string, unknown> = {}) => {
    const r = await agent.post(`/api/workspaces/${wsId}/tasks`).send({ title, ...body });
    expect(r.status).toBe(201);
    ids[title] = r.body.id;
    return r.body.id as string;
  };
  const setStatus = async (id: string, status: string) => {
    const r = await agent.patch(`/api/workspaces/${wsId}/tasks/${id}/status`).send({ status });
    expect(r.status).toBe(200);
  };

  beforeAll(async () => {
    ({ agent, user } = await registerAndLogin("Calendar Owner"));
    outsider = await registerAndLogin("Calendar Outsider");
    wsId = (await agent.post("/api/workspaces").send({ name: "WS Calendar" })).body.id;
    alienWsId = (await outsider.agent.post("/api/workspaces").send({ name: "WS Alheio" })).body.id;

    const future = await create("ativa-futura", { scheduleMode: "ate", dueDate: noon(10) });
    await setStatus(future, "pending");
    const done = await create("concluida-agora");
    await setStatus(done, "pending");
    await setStatus(done, "completed");
    const oldDone = await create("concluida-antiga");
    await setStatus(oldDone, "pending");
    await setStatus(oldDone, "completed");
    await db.update(tasks).set({ completedAt: new Date(Date.now() - 30 * DAY) }).where(eq(tasks.id, oldDone));
    const cancelled = await create("cancelada-agora");
    await setStatus(cancelled, "pending");
    await setStatus(cancelled, "blocked");
    await create("rascunho-urgente", { scheduleMode: "urgente" });
    const standalone = await agent.post("/api/my-tasks").send({ title: "avulsa" });
    ids["avulsa"] = standalone.body.id;
  });

  afterAll(async () => {
    await db.delete(tasks).where(eq(tasks.id, ids["avulsa"]));
    await deleteWorkspaces([wsId, alienWsId]);
    await deleteUser(user.id);
    await deleteUser(outsider.user.id);
  });

  const range = () => {
    const from = new Date(Date.now() - 3 * DAY).toISOString();
    const to = new Date(Date.now() + 3 * DAY).toISOString();
    return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  };
  const titles = (body: Array<{ title: string }>) => body.map(t => t.title).sort();

  it("default (todos): ativas + concluídas na janela; sem canceladas nem concluídas fora da janela", async () => {
    const r = await agent.get(`/api/calendar/tasks?${range()}&workspaceId=${wsId}`);
    expect(r.status).toBe(200);
    expect(titles(r.body)).toEqual(["ativa-futura", "concluida-agora", "rascunho-urgente"]);
    const row = r.body.find((t: any) => t.title === "ativa-futura");
    expect(row).toHaveProperty("plannedDate", null);
    expect(row).toHaveProperty("plannedOrder", null);
    expect(row).toHaveProperty("description");
    expect(row).toHaveProperty("approvalStatus");
    expect(row).toHaveProperty("updatedAt");
  });

  it("status=blocked traz a cancelada da janela", async () => {
    const r = await agent.get(`/api/calendar/tasks?${range()}&workspaceId=${wsId}&status=blocked`);
    expect(r.status).toBe(200);
    expect(titles(r.body)).toEqual(["cancelada-agora"]);
  });

  it("assignedTo=unassigned exclui as minhas", async () => {
    const r = await agent.get(`/api/calendar/tasks?${range()}&workspaceId=${wsId}&assignedTo=unassigned`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it("sem workspaceId: escopo cross-workspace inclui avulsa", async () => {
    const r = await agent.get(`/api/calendar/tasks?${range()}`);
    expect(r.status).toBe(200);
    expect(titles(r.body)).toContain("avulsa");
    expect(titles(r.body)).toContain("ativa-futura");
  });

  it("403 em workspace alheio; 400 em datas inválidas, intervalo > 31 dias e status inválido", async () => {
    expect((await agent.get(`/api/calendar/tasks?${range()}&workspaceId=${alienWsId}`)).status).toBe(403);
    expect((await agent.get(`/api/calendar/tasks?from=xx&to=yy`)).status).toBe(400);
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 40 * DAY).toISOString();
    expect((await agent.get(`/api/calendar/tasks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).status).toBe(400);
    expect((await agent.get(`/api/calendar/tasks?${range()}&status=overdue`)).status).toBe(400);
  });
});
