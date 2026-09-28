import { describe, it, expect, afterAll } from "vitest";
import { db } from "@workspace/db";
import { meetings, workspaces, workspaceMembers } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

describe("GET /api/meetings com from/to", () => {
  const ENV_KEYS = ["MEETINGS_ENABLED", "WORKER_URL", "WORKER_PANEL_TOKEN"] as const;
  const saved: Record<string, string | undefined> = {};
  const cleanup: { users: string[]; ws: string[]; meetings: string[] } = { users: [], ws: [], meetings: [] };

  afterAll(async () => {
    for (const id of cleanup.meetings) await db.delete(meetings).where(eq(meetings.id, id));
    await deleteWorkspaces(cleanup.ws);
    for (const id of cleanup.users) await deleteUser(id);
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  it("filtra por início na janela, exclui canceladas, ordena crescente; 400 com só um limite", async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.MEETINGS_ENABLED = "true";
    process.env.WORKER_URL = "http://worker.invalid";
    process.env.WORKER_PANEL_TOKEN = "t";

    const { agent, user } = await registerAndLogin();
    cleanup.users.push(user.id);
    const [ws] = await db.insert(workspaces).values({ name: "WS Range", createdBy: user.id }).returning();
    cleanup.ws.push(ws.id);
    await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: user.id, role: "admin" });

    const h = 3_600_000;
    const base = Date.now();
    const at = (hrs: number) => new Date(base + hrs * h);
    const rows = await db.insert(meetings).values([
      { workspaceId: ws.id, meetCode: "rng-late", status: "scheduled", occurredAt: at(30), scheduledStartAt: at(30), scheduledEndAt: at(31) },
      { workspaceId: ws.id, meetCode: "rng-early", status: "scheduled", occurredAt: at(2), scheduledStartAt: at(2), scheduledEndAt: at(3) },
      { workspaceId: ws.id, meetCode: "rng-canceled", status: "canceled", occurredAt: at(5), scheduledStartAt: at(5), scheduledEndAt: at(6) },
      { workspaceId: ws.id, meetCode: "rng-out", status: "scheduled", occurredAt: at(24 * 20), scheduledStartAt: at(24 * 20), scheduledEndAt: at(24 * 20 + 1) },
      { workspaceId: ws.id, meetCode: "rng-transcribed", status: "transcribed", occurredAt: at(-2) },
    ]).returning();
    cleanup.meetings.push(...rows.map(r => r.id));

    const from = encodeURIComponent(at(-24).toISOString());
    const to = encodeURIComponent(at(24 * 7).toISOString());
    const r = await agent.get(`/api/meetings?workspaceId=${ws.id}&from=${from}&to=${to}`);
    expect(r.status).toBe(200);
    expect(r.body.map((m: any) => m.meetCode)).toEqual(["rng-transcribed", "rng-early", "rng-late"]);
    expect(r.body[0]).toHaveProperty("plannedOrder");

    const cross = await agent.get(`/api/meetings?from=${from}&to=${to}`);
    expect(cross.status).toBe(200);
    expect(cross.body.map((m: any) => m.meetCode)).toEqual(["rng-transcribed", "rng-early", "rng-late"]);

    expect((await agent.get(`/api/meetings?from=${from}`)).status).toBe(400);
    expect((await agent.get(`/api/meetings?from=xx&to=yy`)).status).toBe(400);
    const legacy = await agent.get(`/api/meetings?workspaceId=${ws.id}`);
    expect(legacy.body.length).toBe(5);
  });
});
