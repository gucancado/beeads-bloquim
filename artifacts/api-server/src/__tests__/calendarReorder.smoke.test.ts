import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Agent } from "supertest";
import { db } from "@workspace/db";
import { tasks, meetings } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { registerAndLogin, deleteUser, deleteWorkspaces, type TestUser } from "./helpers";

describe("PUT /api/calendar/reorder", () => {
  let agent: Agent;
  let user: TestUser;
  let outsider: { agent: Agent; user: TestUser };
  let wsId: string;
  let alienWsId: string;
  let a: string, b: string, c: string, done: string, alienTask: string, meetingId: string;

  const mk = async (ag: Agent, ws: string, title: string) => {
    const r = await ag.post(`/api/workspaces/${ws}/tasks`).send({ title });
    await ag.patch(`/api/workspaces/${ws}/tasks/${r.body.id}/status`).send({ status: "pending" });
    return r.body.id as string;
  };
  const row = async (id: string) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0];

  beforeAll(async () => {
    ({ agent, user } = await registerAndLogin("Reorder Owner"));
    outsider = await registerAndLogin("Reorder Outsider");
    wsId = (await agent.post("/api/workspaces").send({ name: "WS Reorder" })).body.id;
    alienWsId = (await outsider.agent.post("/api/workspaces").send({ name: "WS Reorder Alheio" })).body.id;
    a = await mk(agent, wsId, "A");
    b = await mk(agent, wsId, "B");
    c = await mk(agent, wsId, "C");
    done = await mk(agent, wsId, "D");
    await agent.patch(`/api/workspaces/${wsId}/tasks/${done}/status`).send({ status: "completed" });
    alienTask = await mk(outsider.agent, alienWsId, "X");
    const [m] = await db.insert(meetings).values({
      workspaceId: wsId, meetCode: "cal-reorder-m", status: "scheduled",
      occurredAt: new Date(), scheduledStartAt: new Date(), scheduledEndAt: new Date(Date.now() + 3_600_000),
    }).returning();
    meetingId = m.id;
  });

  afterAll(async () => {
    await db.delete(meetings).where(eq(meetings.id, meetingId));
    await deleteWorkspaces([wsId, alienWsId]);
    await deleteUser(user.id);
    await deleteUser(outsider.user.id);
  });

  it("grava ordem densa na coluna e data pretendida só no movido", async () => {
    const r = await agent.put("/api/calendar/reorder").send({
      date: "2030-01-07",
      items: [{ kind: "task", id: c }, { kind: "meeting", id: meetingId }, { kind: "task", id: a }],
      moved: { kind: "task", id: c, target: "day" },
    });
    expect(r.status).toBe(200);
    expect((await row(c)).plannedDate).toBe("2030-01-07");
    expect((await row(c)).plannedOrder).toBe(0);
    expect((await row(a)).plannedDate).toBeNull();
    expect((await row(a)).plannedOrder).toBe(2);
    const [m] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
    expect(m.plannedOrder).toBe(1);
  });

  it("soltar no pool limpa data e ordem", async () => {
    const r = await agent.put("/api/calendar/reorder").send({
      date: "2030-01-07", items: [], moved: { kind: "task", id: c, target: "pool" },
    });
    expect(r.status).toBe(200);
    expect((await row(c)).plannedDate).toBeNull();
    expect((await row(c)).plannedOrder).toBeNull();
  });

  it("403 com tarefa de workspace alheio e nada é gravado", async () => {
    await db.update(tasks).set({ plannedOrder: null }).where(inArray(tasks.id, [a, b]));
    const r = await agent.put("/api/calendar/reorder").send({
      date: "2030-01-08",
      items: [{ kind: "task", id: a }, { kind: "task", id: alienTask }],
    });
    expect(r.status).toBe(403);
    expect((await row(a)).plannedOrder).toBeNull();
  });

  it("400: reunião movida, terminal movida, ids duplicados, pool com itens, movido fora dos itens", async () => {
    const put = (body: Record<string, unknown>) => agent.put("/api/calendar/reorder").send(body);
    expect((await put({ date: "2030-01-08", items: [{ kind: "meeting", id: meetingId }], moved: { kind: "meeting", id: meetingId, target: "day" } })).status).toBe(400);
    expect((await put({ date: "2030-01-08", items: [{ kind: "task", id: done }], moved: { kind: "task", id: done, target: "day" } })).status).toBe(400);
    expect((await put({ date: "2030-01-08", items: [{ kind: "task", id: a }, { kind: "task", id: a }] })).status).toBe(400);
    expect((await put({ date: "2030-01-08", items: [{ kind: "task", id: a }], moved: { kind: "task", id: a, target: "pool" } })).status).toBe(400);
    expect((await put({ date: "2030-01-08", items: [{ kind: "task", id: a }], moved: { kind: "task", id: b, target: "day" } })).status).toBe(400);
    expect((await put({ date: "08/01/2030", items: [] })).status).toBe(400);
    expect((await put({ date: "2030-02-30", items: [] })).status).toBe(400);
    expect((await put({ date: "2030-13-01", items: [] })).status).toBe(400);
  });

  it("404 com id inexistente", async () => {
    const r = await agent.put("/api/calendar/reorder").send({
      date: "2030-01-08", items: [{ kind: "task", id: "00000000-0000-4000-8000-000000000000" }],
    });
    expect(r.status).toBe(404);
  });
});
