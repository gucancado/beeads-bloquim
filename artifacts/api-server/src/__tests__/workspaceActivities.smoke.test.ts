import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces, type TestUser } from "./helpers";
import type { Agent } from "supertest";

describe("GET /workspaces/:id/activities", () => {
  let agent: Agent;
  let user: TestUser;
  let workspaceId: string;

  beforeAll(async () => {
    ({ agent, user } = await registerAndLogin("Feed Owner"));
    const ws = await agent.post("/api/workspaces").send({ name: "WS Feed" });
    workspaceId = ws.body.id;
    // 3 tasks × (task_created + status_changed) = ≥6 activities
    for (let i = 0; i < 3; i++) {
      const r = await agent.post(`/api/workspaces/${workspaceId}/tasks`).send({ title: `T${i}` });
      await agent.patch(`/api/workspaces/${workspaceId}/tasks/${r.body.id}/status`).send({ status: "pending" });
    }
  });

  afterAll(async () => {
    await deleteWorkspaces([workspaceId]);
    await deleteUser(user.id);
  });

  it("lista desc com taskTitle e pagina por cursor até esgotar", async () => {
    const p1 = await agent.get(`/api/workspaces/${workspaceId}/activities?limit=4`);
    expect(p1.status).toBe(200);
    expect(p1.body.items.length).toBe(4);
    expect(p1.body.items[0].taskTitle).toBeTruthy();
    expect(p1.body.nextCursor).toBeTruthy();
    // ordem desc por createdAt
    const ts = p1.body.items.map((i: any) => new Date(i.createdAt).getTime());
    expect([...ts].sort((a, b) => b - a)).toEqual(ts);

    const seen = new Set(p1.body.items.map((i: any) => i.id));
    let cursor = p1.body.nextCursor;
    while (cursor) {
      const p = await agent.get(`/api/workspaces/${workspaceId}/activities?limit=4&cursor=${encodeURIComponent(cursor)}`);
      expect(p.status).toBe(200);
      for (const item of p.body.items) {
        expect(seen.has(item.id)).toBe(false); // sem duplicata entre páginas
        seen.add(item.id);
      }
      cursor = p.body.nextCursor;
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it("filtra por types", async () => {
    const r = await agent.get(`/api/workspaces/${workspaceId}/activities?types=status_changed`);
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThanOrEqual(3);
    for (const item of r.body.items) expect(item.type).toBe("status_changed");
  });

  it("400 em type inválido e cursor malformado; 403 pra não-membro", async () => {
    expect((await agent.get(`/api/workspaces/${workspaceId}/activities?types=xyz`)).status).toBe(400);
    expect((await agent.get(`/api/workspaces/${workspaceId}/activities?cursor=%%%`)).status).toBe(400);
    const { agent: stranger, user: strangerUser } = await registerAndLogin("Stranger");
    expect((await stranger.get(`/api/workspaces/${workspaceId}/activities`)).status).toBe(403);
    await deleteUser(strangerUser.id);
  });
});
