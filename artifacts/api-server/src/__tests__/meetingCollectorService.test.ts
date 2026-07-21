import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import {
  WorkerMeetingClient,
  workerStatusToMeeting,
  syncMeetingFromWorker,
  WorkerConflictError,
  AttributionFrozenError,
} from "../services/meetingCollectorService";

// syncMeetingFromWorker faz um UPDATE no fim; mockamos @workspace/db pra manter
// este arquivo hermético (sem DB migrado/vivo) — o que importa aqui é o header
// da requisição de saída ao worker, não a persistência. @workspace/db/schema é
// livre de conexão, então segue real (fornece a tabela `meetings` / type Meeting).
vi.mock("@workspace/db", () => {
  const chain: any = {
    update: () => chain,
    set: () => chain,
    where: () => chain,
    returning: async () => [{ id: "m1", status: "collecting" }],
  };
  return { db: chain };
});

function fakeFetch(status: number, body: unknown, capture?: any[]) {
  return async (url: string, init: any) => {
    capture?.push({ url, init });
    return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) } as any;
  };
}

describe("workerStatusToMeeting", () => {
  it("mapeia status worker → bloquim", () => {
    expect(workerStatusToMeeting("collecting")).toBe("collecting");
    expect(workerStatusToMeeting("stopping")).toBe("collecting");
    expect(workerStatusToMeeting("queued")).toBe("collecting");
    expect(workerStatusToMeeting("imported")).toBe("transcribed");
    expect(workerStatusToMeeting("failed")).toBe("failed");
    expect(workerStatusToMeeting("canceled")).toBe("canceled");
  });
});

describe("WorkerMeetingClient", () => {
  it("create envia X-Panel-Token + X-Acting-User e body", async () => {
    const calls: any[] = [];
    const client = new WorkerMeetingClient("http://worker.local", "PANELTOK", fakeFetch(200, { id: "w1", status: "collecting", meet_code: "abc-defg-hij", vexa_meeting_id: 1 }, calls) as any);
    const out = await client.create("user-1", { meetCode: "abc-defg-hij", workspaceId: "ws-1" });
    expect(out.id).toBe("w1");
    expect(calls[0].url).toBe("http://worker.local/meetings-collect");
    expect(calls[0].init.headers["X-Panel-Token"]).toBe("PANELTOK");
    expect(calls[0].init.headers["X-Acting-User"]).toBe("user-1");
    expect(JSON.parse(calls[0].init.body)).toEqual({ meetCode: "abc-defg-hij", workspaceId: "ws-1" });
  });

  it("create envia title e expiresAt no body", async () => {
    const calls: any[] = [];
    const client = new WorkerMeetingClient("http://worker.local", "T", fakeFetch(200, { id: "w1", status: "collecting", meet_code: "abc-defg-hij" }, calls) as any);
    await client.create("user-1", { meetCode: "abc-defg-hij", workspaceId: "ws-1", title: "Weekly Sync", expiresAt: "2026-07-20T15:00:00Z" });
    expect(JSON.parse(calls[0].init.body)).toEqual({
      meetCode: "abc-defg-hij", workspaceId: "ws-1", title: "Weekly Sync", expiresAt: "2026-07-20T15:00:00Z",
    });
  });

  it("resolveAttribution faz POST em /attribution/resolve com headers e retorna o JSON", async () => {
    const calls: any[] = [];
    const body = { workspace_id: "ws-9", project_slug: "proj-x", method: "attendee_domain", unresolved_domains: ["gmail.com"] };
    const client = new WorkerMeetingClient("http://worker.local", "PANELTOK", fakeFetch(200, body, calls) as any);
    const out = await client.resolveAttribution("user-1", { title: "Sync", attendees: [{ email: "a@acme.com", name: "A" }] });
    expect(out).toEqual(body);
    expect(calls[0].url).toBe("http://worker.local/attribution/resolve");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["X-Panel-Token"]).toBe("PANELTOK");
    expect(calls[0].init.headers["X-Acting-User"]).toBe("user-1");
    expect(JSON.parse(calls[0].init.body)).toEqual({ title: "Sync", attendees: [{ email: "a@acme.com", name: "A" }] });
  });

  it("upsertTitleRule faz POST em /attribution/title-rules com headers", async () => {
    const calls: any[] = [];
    const client = new WorkerMeetingClient("http://worker.local", "PANELTOK", fakeFetch(200, {}, calls) as any);
    await client.upsertTitleRule("user-1", { pattern: "weekly.*", workspaceId: "ws-1", projectSlug: "proj-x" });
    expect(calls[0].url).toBe("http://worker.local/attribution/title-rules");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["X-Panel-Token"]).toBe("PANELTOK");
    expect(calls[0].init.headers["X-Acting-User"]).toBe("user-1");
    expect(JSON.parse(calls[0].init.body)).toEqual({ pattern: "weekly.*", workspaceId: "ws-1", projectSlug: "proj-x" });
  });

  it("upsertTitleRule resolve com resposta 204/sem body (não exige JSON)", async () => {
    const calls: any[] = [];
    // json() lança (como Response.json() num corpo vazio real) — reqVoid não deve chamá-lo.
    const noBodyFetch = async (url: string, init: any) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 204,
        json: async () => { throw new SyntaxError("Unexpected end of JSON input"); },
        text: async () => "",
      } as any;
    };
    const client = new WorkerMeetingClient("http://worker.local", "PANELTOK", noBodyFetch as any);
    await expect(
      client.upsertTitleRule("user-1", { pattern: "weekly.*", workspaceId: "ws-1" }),
    ).resolves.toBeUndefined();
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["X-Acting-User"]).toBe("user-1");
  });

  it("upsertTitleRule com 201 {ok,pattern} também resolve", async () => {
    const client = new WorkerMeetingClient("http://worker.local", "T", fakeFetch(201, { ok: true, pattern: "weekly.*" }) as any);
    await expect(
      client.upsertTitleRule("user-1", { pattern: "weekly.*", workspaceId: "ws-1" }),
    ).resolves.toBeUndefined();
  });

  it("create 409 → WorkerConflictError", async () => {
    const client = new WorkerMeetingClient("http://worker.local", "T", fakeFetch(409, { error: "collection_active" }) as any);
    await expect(client.create("u", { meetCode: "abc-defg-hij", workspaceId: null })).rejects.toBeInstanceOf(WorkerConflictError);
  });

  it("patchAttribution 409 attribution_frozen → AttributionFrozenError", async () => {
    const client = new WorkerMeetingClient("http://worker.local", "T", fakeFetch(409, { error: "attribution_frozen" }) as any);
    await expect(client.patchAttribution("u", "w1", { workspaceId: "ws-2" })).rejects.toBeInstanceOf(AttributionFrozenError);
  });
});

describe("syncMeetingFromWorker — acting-user", () => {
  const calls: any[] = [];

  beforeAll(() => {
    process.env.WORKER_URL = "http://worker.local";
    process.env.WORKER_PANEL_TOKEN = "PANELTOK";
    // getWorkerClient() cacheia um cliente com o fetch global corrente na 1ª
    // chamada; o stub lê `calls` (mesma ref) então serve todos os casos.
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "w1", status: "collecting", meet_code: "abc-defg-hij", vexa_meeting_id: 1 }),
        text: async () => "",
      } as any;
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  it("row de agenda (createdBy null) → X-Acting-User = 'system:meetings-sync' (nunca vazio)", async () => {
    const row = { id: "00000000-0000-0000-0000-000000000000", status: "collecting", workerMeetingId: "w1", createdBy: null } as any;
    await syncMeetingFromWorker(row);
    expect(calls[0].url).toBe("http://worker.local/meetings-collect/w1");
    expect(calls[0].init.headers["X-Acting-User"]).toBe("system:meetings-sync");
    expect(calls[0].init.headers["X-Acting-User"]).not.toBe("");
  });

  it("actingUser override tem precedência sobre createdBy", async () => {
    const row = { id: "00000000-0000-0000-0000-000000000000", status: "collecting", workerMeetingId: "w1", createdBy: "creator-1" } as any;
    await syncMeetingFromWorker(row, "override-user");
    expect(calls[0].init.headers["X-Acting-User"]).toBe("override-user");
  });

  it("sem override, cai no createdBy da row", async () => {
    const row = { id: "00000000-0000-0000-0000-000000000000", status: "collecting", workerMeetingId: "w1", createdBy: "creator-1" } as any;
    await syncMeetingFromWorker(row);
    expect(calls[0].init.headers["X-Acting-User"]).toBe("creator-1");
  });
});
