import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Agent } from "supertest";
import { db } from "@workspace/db";
import { tasks, workspaceMembers } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { registerAndLogin, deleteUser, deleteWorkspaces, type TestUser } from "./helpers";
import { applyOrderRules, todayYmdSP } from "../services/calendarOrderService";

const addDays = (ymd: string, n: number) => {
  const d = new Date(ymd + "T12:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe("calendarOrderService.applyOrderRules", () => {
  let agent: Agent;
  let owner: TestUser;
  let mate: TestUser;
  let wsId: string;
  const today = todayYmdSP();
  const future = addDays(today, 10);

  const insert = async (v: Partial<typeof tasks.$inferInsert> & { title: string }) => {
    const [t] = await db.insert(tasks).values({
      workspaceId: wsId, status: "pending", createdBy: owner.id, ownerId: owner.id, ...v,
    }).returning();
    return t.id;
  };
  const order = async (id: string) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0].plannedOrder;

  beforeAll(async () => {
    ({ agent, user: owner } = await registerAndLogin("Order Owner"));
    const m = await registerAndLogin("Order Mate");
    mate = m.user;
    wsId = (await agent.post("/api/workspaces").send({ name: "WS Order" })).body.id;
    await db.insert(workspaceMembers).values({ workspaceId: wsId, userId: mate.id, role: "editor" });
  });

  afterAll(async () => {
    await deleteWorkspaces([wsId]);
    await deleteUser(owner.id);
    await deleteUser(mate.id);
  });

  it("reatribuir via PATCH vai para o fim do dia do novo responsável", async () => {
    await insert({ title: "m0", assignedTo: mate.id, plannedDate: future, plannedOrder: 0 });
    await insert({ title: "m1", assignedTo: mate.id, dueDate: new Date(future + "T12:00:00.000Z"), scheduleMode: "ate", plannedOrder: 1 });
    const moving = await insert({ title: "mv", assignedTo: owner.id, plannedDate: future, plannedOrder: 0 });
    const r = await agent.patch(`/api/workspaces/${wsId}/tasks/${moving}`).send({ assignedTo: mate.id });
    expect(r.status).toBe(200);
    expect(await order(moving)).toBe(2);
  });

  it("urgente vai para o topo (min - 1) na coluna de hoje", async () => {
    await insert({ title: "h0", assignedTo: owner.id, plannedDate: today, plannedOrder: 0 });
    await insert({ title: "h-late", assignedTo: owner.id, dueDate: new Date(addDays(today, -3) + "T12:00:00.000Z"), scheduleMode: "ate", plannedOrder: 1 });
    const urg = await insert({ title: "urg", assignedTo: owner.id, scheduleMode: "urgente" });
    await applyOrderRules(urg, today);
    expect(await order(urg)).toBe(-1);
  });

  it("coluna sem ordem manual → null; terminal → no-op; atrasada ancora em hoje", async () => {
    const lonely = await insert({ title: "lonely", assignedTo: mate.id, plannedDate: addDays(today, 20), plannedOrder: 5 });
    await applyOrderRules(lonely, today);
    expect(await order(lonely)).toBeNull();

    const done = await insert({ title: "done", assignedTo: mate.id, status: "completed", plannedOrder: 7 });
    await applyOrderRules(done, today);
    expect(await order(done)).toBe(7);

    const late = await insert({ title: "late", assignedTo: owner.id, dueDate: new Date(addDays(today, -1) + "T12:00:00.000Z"), scheduleMode: "ate" });
    await applyOrderRules(late, today);
    // irmãs em hoje: h0 (0), h-late (1), urg (-1) → max + 1 = 2
    expect(await order(late)).toBe(2);
  });

  it("PATCH scheduleMode=urgente aplica o topo", async () => {
    const t = await insert({ title: "vira-urgente", assignedTo: owner.id, plannedDate: today });
    const r = await agent.patch(`/api/workspaces/${wsId}/tasks/${t}`).send({ scheduleMode: "urgente" });
    expect(r.status).toBe(200);
    // irmãs em hoje do owner: h0 (0), h-late (1), urg (-1), late (2) → min - 1 = -2
    expect(await order(t)).toBe(-2);
  });
});
