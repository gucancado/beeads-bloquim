import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces, type TestUser } from "./helpers";
import type { Agent } from "supertest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

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

describe("GET /workspaces/:id/activities — ORDER BY casa a chave do keyset (mesmo ms)", () => {
  let agent: Agent;
  let user: TestUser;
  let workspaceId: string;
  let taskId: string;

  // 3 activities forjadas no MESMO milissegundo (2026-01-02 10:00:00.111) mas
  // com microssegundos e ids escolhidos para que as duas ordenações
  // discordem:
  //   - ordem por µs cru DESC (o que o ORDER BY bugado usava): X, Z, Y
  //   - ordem por id DESC (o que o desempate do cursor usa, e o que o
  //     ORDER BY corrigido usa após o date_trunc): Y, Z, X
  // idX é o menor id — sob o bug, X sai primeiro (maior µs) e vira cursor;
  // como Y e Z têm id MAIOR que X, o predicado "id < cursor.id" nunca mais
  // os inclui (o branch "< cursor_ms" também nunca dispara, pois estão no
  // mesmo ms) — ficam perdidos pra sempre.
  const idX = "10000000-0000-4000-8000-000000000001"; // µs mais alto (.111700) -> 1º pelo ORDER BY bugado
  const idY = "f0000000-0000-4000-8000-000000000002"; // µs mais baixo (.111100), id maior -> some sob o bug
  const idZ = "80000000-0000-4000-8000-000000000003"; // µs médio (.111400), id médio -> some sob o bug

  beforeAll(async () => {
    ({ agent, user } = await registerAndLogin("Keyset Regression"));
    const ws = await agent.post("/api/workspaces").send({ name: "WS Keyset" });
    workspaceId = ws.body.id;
    const r = await agent.post(`/api/workspaces/${workspaceId}/tasks`).send({ title: "Keyset task" });
    taskId = r.body.id;

    // Insert direto (bypassa a API) pra controlar microssegundos e ids —
    // impossível de forjar via helpers, que só têm precisão de ms (JS Date).
    await db.execute(sql`
      INSERT INTO task_activities (id, task_id, type, metadata, created_at) VALUES
        (${idX}, ${taskId}, 'status_changed', '{}'::jsonb, '2026-01-02 10:00:00.111700'::timestamp),
        (${idY}, ${taskId}, 'status_changed', '{}'::jsonb, '2026-01-02 10:00:00.111100'::timestamp),
        (${idZ}, ${taskId}, 'status_changed', '{}'::jsonb, '2026-01-02 10:00:00.111400'::timestamp)
    `);
  });

  afterAll(async () => {
    await deleteWorkspaces([workspaceId]);
    await deleteUser(user.id);
  });

  it("não pula atividade ao paginar com limit=1 quando duas linhas caem no mesmo ms", async () => {
    const collected = new Set<string>();
    let cursor: string | undefined;
    let guard = 0;
    do {
      const url = cursor
        ? `/api/workspaces/${workspaceId}/activities?limit=1&cursor=${encodeURIComponent(cursor)}`
        : `/api/workspaces/${workspaceId}/activities?limit=1`;
      const p = await agent.get(url);
      expect(p.status).toBe(200);
      for (const item of p.body.items) {
        expect(collected.has(item.id)).toBe(false); // sem duplicata entre páginas
        collected.add(item.id);
      }
      cursor = p.body.nextCursor;
      guard++;
    } while (cursor && guard < 50);

    for (const id of [idX, idY, idZ]) {
      expect(collected.has(id)).toBe(true);
    }
  });
});
