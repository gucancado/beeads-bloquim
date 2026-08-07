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

export type DispatchReport = { dispatched: number; missed: number; retried: number; polled: number; errors: number };

// Espera mínima entre tentativas de coleta da MESMA reunião, medida a partir do
// updated_at (que é gravado tanto na transição pra failed quanto num retry que
// erra). Não há contador de tentativas persistido: o teto é implícito
// (janela da reunião ÷ backoff), o que dá ~2-3 retentativas numa reunião de 1h.
// Casar com MEETINGS_ADMISSION_TIMEOUT_MIN=10 do worker é de propósito — uma
// tentativa que morre por falta de admissão já consumiu ~10min sozinha.
const RETRY_BACKOFF_MS = 10 * 60_000;

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

// Tick do cron de agenda. Quatro fases sequenciais sobre a tabela meetings:
//   1. Disparo: reuniões cuja janela [start, end) contém `now`, com coleta
//      habilitada e workspace resolvido, ainda sem worker → cria a coleta.
//   1b. Retry: failed cuja janela AINDA está aberta → tenta de novo (respeitando
//      RETRY_BACKOFF_MS). A falha mais comum era o bot chegar antes da sala
//      encher; sem isso, uma coleta que falha às 14:00 nunca é refeita às 14:20.
//   2. Missed: scheduled cuja janela já passou sem nunca ter disparado (cobre
//      opt-out collect_enabled=false e disparo perdido) → missed.
//   3. Poll: collecting com worker → sincroniza o estado (transcribed/failed)
//      sem depender de um GET da UI.
export async function runMeetingsDispatch(partial?: Partial<DispatchDeps>): Promise<DispatchReport> {
  const deps: DispatchDeps = { ...defaultDeps(), ...partial };
  const report: DispatchReport = { dispatched: 0, missed: 0, retried: 0, polled: 0, errors: 0 };
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

  // 1b. Retry das que falharam com a janela ainda aberta. episode_id preenchido
  // fica de fora: o worker já produziu episódio, recoletar geraria um segundo.
  const retriable = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.status, "failed"),
        eq(meetings.collectEnabled, true),
        isNotNull(meetings.workspaceId),
        isNull(meetings.episodeId),
        lte(meetings.scheduledStartAt, now),
        gt(meetings.scheduledEndAt, now),
        lte(meetings.updatedAt, new Date(now.getTime() - RETRY_BACKOFF_MS)),
      ),
    );

  const attempts = [
    ...dispatchable.map((row) => ({ row, retry: false })),
    ...retriable.map((row) => ({ row, retry: true })),
  ];

  for (const { row, retry } of attempts) {
    try {
      const created = await deps.createCollection({
        meetCode: row.meetCode,
        workspaceId: row.workspaceId as string, // filtrado por isNotNull acima
        title: row.title,
        expiresAt: (row.scheduledEndAt as Date).toISOString(), // filtrado por gt acima
      });
      await db
        .update(meetings)
        .set({ workerMeetingId: created.id, status: "collecting", failureReason: null, updatedAt: now })
        .where(eq(meetings.id, row.id));
      if (retry) report.retried++;
      else report.dispatched++;
    } catch (err) {
      // Erro do worker: row FICA como está (scheduled → retry no próximo tick até
      // o fim da janela; failed → volta a ser elegível quando o backoff vencer).
      if (retry) {
        // Arma o backoff: sem tocar updated_at, o tick de 1min re-tentaria em loop.
        await db.update(meetings).set({ updatedAt: now }).where(eq(meetings.id, row.id));
      }
      log.error({ err, meetingId: row.id, retry }, "dispatch: worker falhou; row mantida para nova tentativa");
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
