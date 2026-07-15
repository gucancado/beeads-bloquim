import { Loader2, Check, X, Square } from "lucide-react";
import { type Meeting, useMeetingPoll, useStopMeeting } from "./useMeetings";

// Barra de status à esquerda da linha (mesmo padrão visual do EventRow da agenda).
const STATUS_BAR: Record<Meeting["status"], string> = {
  collecting: "bg-amber-500",
  transcribed: "bg-emerald-500",
  failed: "bg-red-500",
  canceled: "bg-slate-400",
};

/** Linha de reunião no estilo da agenda — renderizada na mesma lista dos eventos do Google Calendar. */
export function MeetingItem({ meeting }: { meeting: Meeting }) {
  // poll-through enquanto coletando
  const poll = useMeetingPoll(meeting.id, meeting.status === "collecting");
  const m = poll.data ?? meeting;
  const stop = useStopMeeting(m.id);

  const time = new Date(m.occurredAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
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
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground shrink-0 lowercase">
            {m.status === "collecting" && <Loader2 className="w-3 h-3 animate-spin" />}
            {m.status === "transcribed" && <Check className="w-3 h-3" />}
            {m.status === "failed" && <X className="w-3 h-3" />}
            <span>
              {m.status === "collecting" && "coletando"}
              {m.status === "transcribed" && "transcrita"}
              {m.status === "failed" && `falhou${m.failureReason ? `: ${m.failureReason}` : ""}`}
              {m.status === "canceled" && "cancelada"}
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
    </div>
  );
}
