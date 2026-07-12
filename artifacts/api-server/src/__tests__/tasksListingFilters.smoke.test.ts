import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces, type TestUser } from "./helpers";
import type { Agent } from "supertest";

describe("filtros temporais + keyset nas listagens de tasks", () => {
  let agent: Agent;
  let user: TestUser;
  let workspaceId: string;

  beforeAll(async () => {
    ({ agent, user } = await registerAndLogin("Filter Owner"));
    const ws = await agent.post("/api/workspaces").send({ name: "WS Filters" });
    workspaceId = ws.body.id;
    for (let i = 0; i < 5; i++) {
      const r = await agent.post(`/api/workspaces/${workspaceId}/tasks`).send({
        title: `F${i}`,
        priority: i === 0 ? "critical" : "medium",
      });
      await agent.patch(`/api/workspaces/${workspaceId}/tasks/${r.body.id}/status`).send({ status: "pending" });
      if (i === 4) {
        await agent.patch(`/api/workspaces/${workspaceId}/tasks/${r.body.id}/status`).send({ status: "completed" });
      }
    }
  });

  afterAll(async () => {
    await deleteWorkspaces([workspaceId]);
    await deleteUser(user.id);
  });

  it("modo legacy intacto: sem cursor/limit devolve array", async () => {
    const r = await agent.get(`/api/workspaces/${workspaceId}/tasks`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBe(5);
  });

  it("modo keyset: envelope {items,nextCursor}, pagina sem duplicar", async () => {
    const p1 = await agent.get(`/api/workspaces/${workspaceId}/tasks?limit=2`);
    expect(Array.isArray(p1.body)).toBe(false);
    expect(p1.body.items.length).toBe(2);
    expect(p1.body.nextCursor).toBeTruthy();
    const seen = new Set(p1.body.items.map((t: any) => t.id));
    let cursor = p1.body.nextCursor;
    while (cursor) {
      const p = await agent.get(`/api/workspaces/${workspaceId}/tasks?limit=2&cursor=${encodeURIComponent(cursor)}`);
      for (const t of p.body.items) {
        expect(seen.has(t.id)).toBe(false);
        seen.add(t.id);
      }
      cursor = p.body.nextCursor;
    }
    expect(seen.size).toBe(5);
  });

  it("filtros: priority, createdSince futuro, completedSince", async () => {
    const crit = await agent.get(`/api/workspaces/${workspaceId}/tasks?priority=critical`);
    expect(crit.body.length).toBe(1);

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const none = await agent.get(`/api/workspaces/${workspaceId}/tasks?createdSince=${encodeURIComponent(future)}`);
    expect(none.body.length).toBe(0);

    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const done = await agent.get(`/api/workspaces/${workspaceId}/tasks?completedSince=${encodeURIComponent(past)}`);
    expect(done.body.length).toBe(1);
    expect(done.body[0].title).toBe("F4");
  });

  it("400 em data inválida e priority inválida", async () => {
    expect((await agent.get(`/api/workspaces/${workspaceId}/tasks?createdSince=xx`)).status).toBe(400);
    expect((await agent.get(`/api/workspaces/${workspaceId}/tasks?priority=hyper`)).status).toBe(400);
  });
});

describe("filtros + keyset em GET /my-tasks", () => {
  let agent: Agent;
  let user: TestUser;

  beforeAll(async () => {
    ({ agent, user } = await registerAndLogin("MyTasks Filter"));
    for (let i = 0; i < 3; i++) {
      const r = await agent.post("/api/my-tasks").send({ title: `M${i}` });
      await agent.patch(`/api/my-tasks/${r.body.id}/status`).send({ status: "pending" });
    }
  });

  afterAll(async () => {
    await deleteUser(user.id);
  });

  it("keyset pagina standalone tasks", async () => {
    const p1 = await agent.get("/api/my-tasks?limit=2");
    expect(Array.isArray(p1.body)).toBe(false);
    expect(p1.body.items.length).toBe(2);
    const p2 = await agent.get(`/api/my-tasks?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`);
    expect(p2.body.items.length).toBe(1);
    expect(p2.body.nextCursor).toBeNull();
  });

  it("createdSince futuro zera; legacy continua array", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const none = await agent.get(`/api/my-tasks?createdSince=${encodeURIComponent(future)}`);
    expect(none.body.length).toBe(0);
    const all = await agent.get("/api/my-tasks");
    expect(Array.isArray(all.body)).toBe(true);
  });
});
