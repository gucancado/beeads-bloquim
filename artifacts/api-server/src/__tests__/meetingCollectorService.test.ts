import { describe, it, expect } from "vitest";
import {
  WorkerMeetingClient,
  workerStatusToMeeting,
  WorkerConflictError,
  AttributionFrozenError,
} from "../services/meetingCollectorService";

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

  it("create 409 → WorkerConflictError", async () => {
    const client = new WorkerMeetingClient("http://worker.local", "T", fakeFetch(409, { error: "collection_active" }) as any);
    await expect(client.create("u", { meetCode: "abc-defg-hij", workspaceId: null })).rejects.toBeInstanceOf(WorkerConflictError);
  });

  it("patchAttribution 409 attribution_frozen → AttributionFrozenError", async () => {
    const client = new WorkerMeetingClient("http://worker.local", "T", fakeFetch(409, { error: "attribution_frozen" }) as any);
    await expect(client.patchAttribution("u", "w1", { workspaceId: "ws-2" })).rejects.toBeInstanceOf(AttributionFrozenError);
  });
});
