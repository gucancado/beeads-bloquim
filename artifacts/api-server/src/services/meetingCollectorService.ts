export type WorkerCollection = {
  id: string;
  status: string;
  meet_code: string;
  vexa_meeting_id: number | null;
  episode_id: number | null;
  failure_reason: string | null;
  segment_count: number | null;
  speakers: string[] | null;
  participants: Array<{ name: string; segments: number }> | null;
  occurred_at: string | null;
  duration_seconds: number | null;
  workspace_id?: string | null;
};

export type MeetingStatus = "collecting" | "transcribed" | "failed" | "canceled";

export function workerStatusToMeeting(status: string): MeetingStatus {
  switch (status) {
    case "collecting":
    case "stopping":
      return "collecting";
    case "imported":
      return "transcribed";
    case "canceled":
      return "canceled";
    default:
      return "failed";
  }
}

export class WorkerConflictError extends Error {}
export class AttributionFrozenError extends Error {}
export class WorkerError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class WorkerMeetingClient {
  private baseUrl: string;

  constructor(
    baseUrl: string,
    private panelToken: string,
    private fetchFn: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async req(actingUser: string, method: string, path: string, body?: unknown): Promise<WorkerCollection> {
    const r = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Panel-Token": this.panelToken,
        "X-Acting-User": actingUser,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const data = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
      if (r.status === 409 && data.error === "collection_active") {
        throw new WorkerConflictError(data.message ?? "coleta ativa");
      }
      if (r.status === 409 && data.error === "attribution_frozen") {
        throw new AttributionFrozenError(data.message ?? "atribuição congelada");
      }
      throw new WorkerError(r.status, data.message ?? data.error ?? `HTTP ${r.status}`);
    }
    return (await r.json()) as WorkerCollection;
  }

  create(actingUser: string, a: { meetCode: string; workspaceId: string | null }) {
    return this.req(actingUser, "POST", "/meetings-collect", { meetCode: a.meetCode, workspaceId: a.workspaceId });
  }

  get(actingUser: string, workerId: string) {
    return this.req(actingUser, "GET", `/meetings-collect/${workerId}`);
  }

  stop(actingUser: string, workerId: string) {
    return this.req(actingUser, "POST", `/meetings-collect/${workerId}/stop`);
  }

  patchAttribution(actingUser: string, workerId: string, a: { workspaceId: string | null }) {
    return this.req(actingUser, "PATCH", `/meetings-collect/${workerId}/attribution`, { workspaceId: a.workspaceId });
  }
}

let cached: WorkerMeetingClient | null = null;

export function getWorkerClient(): WorkerMeetingClient {
  if (cached) return cached;
  const baseUrl = process.env.WORKER_URL;
  const token = process.env.WORKER_PANEL_TOKEN;
  if (!baseUrl || !token) {
    throw new Error("WORKER_URL e WORKER_PANEL_TOKEN são obrigatórios para reuniões.");
  }
  cached = new WorkerMeetingClient(baseUrl, token);
  return cached;
}
