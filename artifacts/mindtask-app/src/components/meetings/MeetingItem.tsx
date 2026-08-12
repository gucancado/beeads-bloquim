import { Loader2, Check, X, Square, Repeat, CalendarClock, AlertCircle } from "lucide-react";
import { Switch } from "@beeads/ui";
import { type Meeting, useMeetingPoll, useStopMeeting, useToggleCollect } from "./useMeetings";

// Barra de status à esquerda da linha (mesmo padrão visual do EventRow da agenda).
const STATUS_BAR: Record<Meeting["status"], string> = {
  collecting: "bg-amber-500",
  transcribed: "bg-emerald-500",
  failed: "bg-red-500",
  canceled: "bg-slate-400",
  scheduled: "bg-sky-500",
  needs_triage: "bg-amber-400",
  missed: "bg-slate-400",
};

// failure_reason vem cru do worker (src/meetings-collect/*). Traduz o que ele
// sabe emitir; qualquer código novo cai no fallback e aparece como veio, em vez
// de sumir — é diagnóstico, não decoração.
const FAILURE_LABEL: Record<string, string> = {
  silent_room: "ninguém falou na sala",
  // Legado: até 2026-08-12 o worker emitia `not_admitted` pra ESTA mesma
  // condição (zero fala no tempo limite). Rows antigas seguem no banco e a
  // causa real delas é ambígua — sala muda OU bot barrado de fato, antes de o
  // bot autenticado existir. Texto vago de propósito.
  not_admitted: "sem transcrição (sala muda ou bot barrado)",
  stopped_empty: "ninguém falou",
  vexa_send_failed: "falha ao acionar o bot",
  vexa_failed: "falha na transcrição",
};

function failureLabel(reason: string | null): string | null {
  if (!reason) return null;
  return FAILURE_LABEL[reason] ?? reason;
}

/** Linha de reunião no estilo da agenda — renderizada na mesma lista dos eventos do Google Calendar. */
export function MeetingItem({ meeting, onTriage }: { meeting: Meeting; onTriage?: (m: Meeting) => void }) {
  // poll-through enquanto coletando
  const poll = useMeetingPoll(meeting.id, meeting.status === "collecting");
  const m = poll.data ?? meeting;
  const stop = useStopMeeting(m.id);
  const toggle = useToggleCollect(m.id);
  const willRecord = m.status === "scheduled" && m.collectEnabled && !!m.workspaceId;

  const startIso = (m.status === "scheduled" || m.status === "needs_triage" || m.status === "missed") && m.scheduledStartAt
    ? m.scheduledStartAt : m.occurredAt;
  const start = new Date(startIso);
  const time = start.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const title = m.title ?? `reunião ${new Date(m.occurredAt).toLocaleDateString("pt-BR")}`;
  const participants =
    m.status === "transcribed" && m.participants && m.participants.length > 0
      ? m.participants.map((p) => p.name).join(", ")
      : null;

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-transparent border border-transparent hover:border-border/60 transition-colors">
      <span className={`w-1 self-stretch rounded-full shrink-0 mt-0.5 ${STATUS_BAR[m.status]}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>
          {m.gcalRecurringEventId && <Repeat className="w-3 h-3 text-muted-foreground shrink-0" aria-label="reunião recorrente" />}
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground shrink-0 lowercase">
            {m.status === "collecting" && <Loader2 className="w-3 h-3 animate-spin" />}
            {m.status === "transcribed" && <Check className="w-3 h-3" />}
            {m.status === "failed" && <X className="w-3 h-3" />}
            {m.status === "scheduled" && <CalendarClock className="w-3 h-3" />}
            {m.status === "needs_triage" && <AlertCircle className="w-3 h-3" />}
            <span>
              {m.status === "collecting" && "coletando"}
              {m.status === "transcribed" && "transcrita"}
              {m.status === "failed" && `falhou${failureLabel(m.failureReason) ? `: ${failureLabel(m.failureReason)}` : ""}`}
              {m.status === "canceled" && `cancelada${failureLabel(m.failureReason) ? `: ${failureLabel(m.failureReason)}` : ""}`}
              {m.status === "scheduled" && "agendada"}
              {m.status === "needs_triage" && "precisa triagem"}
              {m.status === "missed" && "não gravada"}
            </span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 mt-0.5">
          <span className="text-xs text-muted-foreground tabular-nums">{time}</span>
          <span className="text-[11px] text-muted-foreground/70 truncate">· {m.meetCode}</span>
          {participants && <span className="text-xs text-muted-foreground truncate">· {participants}</span>}
        </div>
      </div>
      {m.status === "collecting" && (
        <button
          onClick={() => stop.mutate()}
          disabled={stop.isPending}
          title="encerrar coleta"
          className="shrink-0 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors lowercase disabled:opacity-50"
        >
          <Square className="w-3 h-3" /> encerrar
        </button>
      )}
      {m.status === "scheduled" && (
        <div className="shrink-0 flex items-center gap-2">
          <span className={`text-[11px] lowercase ${willRecord ? "text-emerald-600" : "text-muted-foreground"}`}>
            {willRecord ? "vai gravar" : "não vai gravar"}
          </span>
          <Switch
            checked={m.collectEnabled}
            onCheckedChange={(v) => toggle.mutate({ collectEnabled: v })}
            disabled={toggle.isPending}
            aria-label="gravar esta reunião"
          />
        </div>
      )}
      {m.status === "needs_triage" && onTriage && (
        <button
          onClick={() => onTriage(m)}
          className="shrink-0 inline-flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-700 transition-colors lowercase"
        >
          triar
        </button>
      )}
    </div>
  );
}
