import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { meetings, type Meeting } from "@workspace/db/schema";

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

export type AttributionResult = {
  workspace_id: string | null;
  project_slug: string | null;
  method: string;
  unresolved_domains: string[];
};

export type MeetingStatus = "collecting" | "transcribed" | "failed" | "canceled";

export function workerStatusToMeeting(status: string): MeetingStatus {
  switch (status) {
    case "queued":
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

export const MEET_CODE_RE = /[a-z]{3}-[a-z]{4}-[a-z]{3}/;

export function extractMeetCode(input: string): string | null {
  const m = (input ?? "").trim().match(MEET_CODE_RE);
  return m ? m[0] : null;
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

  // Faz a requisição e trata os erros; devolve a Response crua no sucesso (o
  // caller decide se lê JSON ou ignora o body). Centraliza o mapeamento 409.
  private async rawReq(actingUser: string, method: string, path: string, body?: unknown): Promise<Response> {
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
    return r;
  }

  private async req<T = WorkerCollection>(actingUser: string, method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.rawReq(actingUser, method, path, body);
    return (await r.json()) as T;
  }

  // Variante para endpoints que resolvem sem body útil (ex.: 204 ou 201 sem
  // JSON). Não exige parse: consome/ignora o corpo e só depende de res.ok.
  private async reqVoid(actingUser: string, method: string, path: string, body?: unknown): Promise<void> {
    const r = await this.rawReq(actingUser, method, path, body);
    await r.text().catch(() => undefined);
  }

  create(actingUser: string, a: { meetCode: string; workspaceId: string | null; title?: string | null; expiresAt?: string | null }) {
    return this.req(actingUser, "POST", "/meetings-collect", {
      meetCode: a.meetCode, workspaceId: a.workspaceId, title: a.title, expiresAt: a.expiresAt,
    });
  }

  resolveAttribution(
    actingUser: string,
    a: { title: string | null; attendees: Array<{ email: string; name?: string }> },
  ): Promise<AttributionResult> {
    return this.req<AttributionResult>(actingUser, "POST", "/attribution/resolve", {
      title: a.title, attendees: a.attendees,
    });
  }

  async upsertTitleRule(
    actingUser: string,
    a: { pattern: string; workspaceId: string; projectSlug?: string | null },
  ): Promise<void> {
    // O worker (W4) lê o body em snake_case (req.body.workspace_id / project_slug);
    // a assinatura pública fica camelCase, mas o BODY enviado casa o contrato do worker.
    await this.reqVoid(actingUser, "POST", "/attribution/title-rules", {
      pattern: a.pattern, workspace_id: a.workspaceId, project_slug: a.projectSlug ?? null,
    });
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

// Sincroniza uma reunião "collecting" com o estado do worker (poll-through). O
// acting-user (só auditoria no worker) resolve como actingUser ?? row.createdBy ??
// 'system:meetings-sync' — nunca string vazia: a rota (GET/:id, stop) passa o
// requester, o cron do B5 pode dar um override, e rows de agenda (createdBy null)
// caem no default de sistema. Worker indisponível: devolve a row intacta.
export async function syncMeetingFromWorker(row: Meeting, actingUser?: string): Promise<Meeting> {
  if (row.status !== "collecting" || !row.workerMeetingId) return row;
  let worker;
  try {
    worker = await getWorkerClient().get(actingUser ?? row.createdBy ?? "system:meetings-sync", row.workerMeetingId);
  } catch {
    return row; // worker indisponível: devolve o que temos
  }
  const mapped = workerStatusToMeeting(worker.status);
  const patch: Record<string, unknown> = { status: mapped, updatedAt: new Date() };
  if (worker.episode_id != null) patch.episodeId = worker.episode_id;
  if (worker.failure_reason != null) patch.failureReason = worker.failure_reason;
  if (mapped === "transcribed") {
    if (worker.participants) patch.participants = worker.participants;
    if (worker.occurred_at) patch.occurredAt = new Date(worker.occurred_at);
    if (worker.duration_seconds != null) patch.durationSeconds = worker.duration_seconds;
  }
  const [updated] = await db.update(meetings).set(patch).where(eq(meetings.id, row.id)).returning();
  return updated;
}
