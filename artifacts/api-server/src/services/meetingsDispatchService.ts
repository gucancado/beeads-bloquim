import { and, eq, gt, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import { meetings, type Meeting } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { getWorkerClient, syncMeetingFromWorker } from "./meetingCollectorService";

const log = logger.child({ module: "meetingsDispatchService" });

const ACTING_USER = "system:agenda-dispatch";

export type DispatchDeps = {
  createCollection: (a: {
    meetCode: string;
    workspaceId: string;
    title: string | null;
    expiresAt: string;
  }) => Promise<{ id: string }>;
  syncFromWorker: (row: Meeting) => Promise<Meeting>;
  now: () => Date;
};

export type DispatchReport = { dispatched: number; missed: number; polled: number; errors: number };

// Defaults de produção: worker client (create) + poll-through (syncMeetingFromWorker),
// ambos com o acting-user de sistema. getWorkerClient() só é chamado dentro dos
// closures (lazy), então montar os defaults nunca exige WORKER_URL/TOKEN — só o
// disparo/poll real precisa da env.
function defaultDeps(): DispatchDeps {
  return {
    createCollection: (a) =>
      getWorkerClient().create(ACTING_USER, {
        meetCode: a.meetCode,
        workspaceId: a.workspaceId,
        title: a.title,
        expiresAt: a.expiresAt,
      }),
    syncFromWorker: (row) => syncMeetingFromWorker(row, ACTING_USER),
    now: () => new Date(),
  };
}

// Tick do cron de agenda. Três fases sequenciais sobre a tabela meetings:
//   1. Disparo: reuniões cuja janela [start, end) contém `now`, com coleta
//      habilitada e workspace resolvido, ainda sem worker → cria a coleta.
//   2. Missed: scheduled cuja janela já passou sem nunca ter disparado (cobre
//      opt-out collect_enabled=false e disparo perdido) → missed.
//   3. Poll: collecting com worker → sincroniza o estado (transcribed/failed)
//      sem depender de um GET da UI.
export async function runMeetingsDispatch(partial?: Partial<DispatchDeps>): Promise<DispatchReport> {
  const deps: DispatchDeps = { ...defaultDeps(), ...partial };
  const report: DispatchReport = { dispatched: 0, missed: 0, polled: 0, errors: 0 };
  const now = deps.now();

  // 1. Disparo.
  const dispatchable = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.status, "scheduled"),
        eq(meetings.collectEnabled, true),
        isNotNull(meetings.workspaceId),
        isNull(meetings.workerMeetingId),
        lte(meetings.scheduledStartAt, now),
        gt(meetings.scheduledEndAt, now),
      ),
    );

  for (const row of dispatchable) {
    try {
      const created = await deps.createCollection({
        meetCode: row.meetCode,
        workspaceId: row.workspaceId as string, // filtrado por isNotNull acima
        title: row.title,
        expiresAt: (row.scheduledEndAt as Date).toISOString(), // filtrado por gt acima
      });
      await db
        .update(meetings)
        .set({ workerMeetingId: created.id, status: "collecting", updatedAt: new Date() })
        .where(eq(meetings.id, row.id));
      report.dispatched++;
    } catch (err) {
      // Erro do worker: row FICA scheduled (retry no próximo tick até o fim da janela).
      log.error({ err, meetingId: row.id }, "dispatch: worker falhou; row segue scheduled (retry)");
      report.errors++;
    }
  }

  // 2. Missed — janela vencida sem disparo (independe de collect_enabled).
  const missable = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        eq(meetings.status, "scheduled"),
        isNull(meetings.workerMeetingId),
        lte(meetings.scheduledEndAt, now),
      ),
    );

  for (const row of missable) {
    await db.update(meetings).set({ status: "missed", updatedAt: new Date() }).where(eq(meetings.id, row.id));
    report.missed++;
  }

  // 3. Poll das que estão coletando.
  const collecting = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.status, "collecting"), isNotNull(meetings.workerMeetingId)));

  for (const row of collecting) {
    try {
      await deps.syncFromWorker(row);
      report.polled++;
    } catch (err) {
      // Erro por row NÃO derruba o batch.
      log.error({ err, meetingId: row.id }, "poll: sync falhou; segue");
    }
  }

  return report;
}
