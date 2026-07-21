import { randomUUID } from "node:crypto";
import { describe, it, expect, afterEach } from "vitest";
import { db } from "@workspace/db";
import { meetings, users, workspaces, type Meeting } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { runMeetingsDispatch, type DispatchDeps } from "../services/meetingsDispatchService";

// Clock fixo do tick. As janelas são todas relativas a NOW.
const NOW = new Date("2026-07-20T12:00:00Z");
const START_IN_WINDOW = new Date(NOW.getTime() - 5 * 60_000); // começou há 5min
const END_IN_WINDOW = new Date(NOW.getTime() + 55 * 60_000); // termina em 55min
const START_FUTURE = new Date(NOW.getTime() + 60 * 60_000); // começa em 1h
const END_FUTURE = new Date(NOW.getTime() + 120 * 60_000); // termina em 2h
const AFTER_END = new Date(END_IN_WINDOW.getTime() + 60_000); // 1min após o fim da janela

// bloquim_test é compartilhado: limpamos tudo que cada caso semeou.
const reg = { meetingIds: [] as string[], wsIds: [] as string[], userIds: [] as string[] };

async function seedWs(name = "Dispatch") {
  const email = `disp_${randomUUID()}@test.local`;
  const [user] = await db.insert(users).values({ name, email, passwordHash: "x" }).returning();
  const [ws] = await db.insert(workspaces).values({ name: `WS ${name}`, createdBy: user.id }).returning();
  reg.userIds.push(user.id);
  reg.wsIds.push(ws.id);
  return { user, ws };
}

async function seedMeeting(o: {
  workspaceId: string | null;
  status?: Meeting["status"];
  collectEnabled?: boolean;
  workerMeetingId?: string | null;
  meetCode?: string;
  title?: string | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
}): Promise<Meeting> {
  const [m] = await db
    .insert(meetings)
    .values({
      workspaceId: o.workspaceId,
      status: o.status ?? "scheduled",
      collectEnabled: o.collectEnabled ?? true,
      workerMeetingId: o.workerMeetingId ?? null,
      meetCode: o.meetCode ?? "abc-defg-hij",
      title: o.title ?? "Reunião",
      scheduledStartAt: o.scheduledStartAt ?? null,
      scheduledEndAt: o.scheduledEndAt ?? null,
    })
    .returning();
  reg.meetingIds.push(m.id);
  return m;
}

async function reload(id: string): Promise<Meeting> {
  const [row] = await db.select().from(meetings).where(eq(meetings.id, id));
  return row;
}

afterEach(async () => {
  if (reg.meetingIds.length) await db.delete(meetings).where(inArray(meetings.id, reg.meetingIds));
  if (reg.wsIds.length) await db.delete(workspaces).where(inArray(workspaces.id, reg.wsIds));
  if (reg.userIds.length) await db.delete(users).where(inArray(users.id, reg.userIds));
  reg.meetingIds = [];
  reg.wsIds = [];
  reg.userIds = [];
});

describe("runMeetingsDispatch", () => {
  it("1. scheduled na janela → createCollection com title+expiresAt=end ISO; row vira collecting com workerMeetingId", async () => {
    const { ws } = await seedWs();
    const m = await seedMeeting({
      workspaceId: ws.id,
      meetCode: "xyz-abcd-efg",
      title: "Call ACME",
      scheduledStartAt: START_IN_WINDOW,
      scheduledEndAt: END_IN_WINDOW,
    });
    const calls: Array<Parameters<DispatchDeps["createCollection"]>[0]> = [];
    const report = await runMeetingsDispatch({
      now: () => NOW,
      createCollection: async (a) => {
        calls.push(a);
        return { id: "worker-123" };
      },
      syncFromWorker: async (r) => r,
    });

    expect(report.dispatched).toBe(1);
    expect(report.missed).toBe(0);
    expect(report.errors).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].meetCode).toBe("xyz-abcd-efg");
    expect(calls[0].workspaceId).toBe(ws.id);
    expect(calls[0].title).toBe("Call ACME");
    expect(calls[0].expiresAt).toBe(END_IN_WINDOW.toISOString());

    const row = await reload(m.id);
    expect(row.status).toBe("collecting");
    expect(row.workerMeetingId).toBe("worker-123");
  });

  it("2. scheduled com collect_enabled=false → NÃO dispara; após end → missed", async () => {
    const { ws } = await seedWs();
    const m = await seedMeeting({
      workspaceId: ws.id,
      collectEnabled: false,
      scheduledStartAt: START_IN_WINDOW,
      scheduledEndAt: END_IN_WINDOW,
    });
    const calls: unknown[] = [];
    const create: DispatchDeps["createCollection"] = async (a) => {
      calls.push(a);
      return { id: "nope" };
    };

    // 1º tick, dentro da janela: não dispara (opt-out).
    const r1 = await runMeetingsDispatch({ now: () => NOW, createCollection: create, syncFromWorker: async (r) => r });
    expect(r1.dispatched).toBe(0);
    expect(r1.missed).toBe(0);
    expect(calls).toHaveLength(0);
    expect((await reload(m.id)).status).toBe("scheduled");

    // 2º tick, após o fim da janela: vira missed.
    const r2 = await runMeetingsDispatch({ now: () => AFTER_END, createCollection: create, syncFromWorker: async (r) => r });
    expect(r2.missed).toBe(1);
    expect(calls).toHaveLength(0);
    expect((await reload(m.id)).status).toBe("missed");
  });

  it("3. scheduled sem workspace → não dispara", async () => {
    const m = await seedMeeting({
      workspaceId: null,
      scheduledStartAt: START_IN_WINDOW,
      scheduledEndAt: END_IN_WINDOW,
    });
    const calls: unknown[] = [];
    const report = await runMeetingsDispatch({
      now: () => NOW,
      createCollection: async (a) => {
        calls.push(a);
        return { id: "nope" };
      },
      syncFromWorker: async (r) => r,
    });
    expect(report.dispatched).toBe(0);
    expect(calls).toHaveLength(0);
    expect((await reload(m.id)).status).toBe("scheduled");
  });

  it("4. worker lança → row segue scheduled (retry); após end sem sucesso → missed", async () => {
    const { ws } = await seedWs();
    const m = await seedMeeting({
      workspaceId: ws.id,
      scheduledStartAt: START_IN_WINDOW,
      scheduledEndAt: END_IN_WINDOW,
    });
    const throwing: DispatchDeps["createCollection"] = async () => {
      throw new Error("worker fora do ar");
    };

    // 1º tick: worker explode → row fica scheduled, conta erro.
    const r1 = await runMeetingsDispatch({ now: () => NOW, createCollection: throwing, syncFromWorker: async (r) => r });
    expect(r1.dispatched).toBe(0);
    expect(r1.errors).toBe(1);
    expect(r1.missed).toBe(0);
    expect((await reload(m.id)).status).toBe("scheduled");
    expect((await reload(m.id)).workerMeetingId).toBeNull();

    // 2º tick, após o fim sem nunca ter disparado: vira missed.
    const r2 = await runMeetingsDispatch({ now: () => AFTER_END, createCollection: throwing, syncFromWorker: async (r) => r });
    expect(r2.missed).toBe(1);
    expect(r2.errors).toBe(0);
    expect((await reload(m.id)).status).toBe("missed");
  });

  it("5. collecting com workerMeetingId → syncFromWorker chamado; retorno 'transcribed' persiste", async () => {
    const { ws } = await seedWs();
    const m = await seedMeeting({
      workspaceId: ws.id,
      status: "collecting",
      workerMeetingId: "worker-777",
    });
    const synced: string[] = [];
    const report = await runMeetingsDispatch({
      now: () => NOW,
      createCollection: async () => ({ id: "unused" }),
      syncFromWorker: async (r) => {
        synced.push(r.id);
        const [updated] = await db
          .update(meetings)
          .set({ status: "transcribed", updatedAt: new Date() })
          .where(eq(meetings.id, r.id))
          .returning();
        return updated;
      },
    });

    expect(report.polled).toBe(1);
    expect(report.dispatched).toBe(0);
    expect(synced).toEqual([m.id]);
    expect((await reload(m.id)).status).toBe("transcribed");
  });

  it("6. antes da hora (scheduled_start_at futuro) → não dispara", async () => {
    const { ws } = await seedWs();
    const m = await seedMeeting({
      workspaceId: ws.id,
      scheduledStartAt: START_FUTURE,
      scheduledEndAt: END_FUTURE,
    });
    const calls: unknown[] = [];
    const report = await runMeetingsDispatch({
      now: () => NOW,
      createCollection: async (a) => {
        calls.push(a);
        return { id: "nope" };
      },
      syncFromWorker: async (r) => r,
    });
    expect(report.dispatched).toBe(0);
    expect(report.missed).toBe(0);
    expect(calls).toHaveLength(0);
    expect((await reload(m.id)).status).toBe("scheduled");
  });
});
