import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces, type TestUser } from "./helpers";
import type { Agent } from "supertest";
import { db } from "@workspace/db";
import { tasks, taskActivities } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

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
