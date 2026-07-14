import { Badge, Button } from "@beeads/ui";
import { Loader2, Check, X, Square } from "lucide-react";
import { type Meeting, useMeetingPoll, useStopMeeting } from "./useMeetings";

function StatusBadge({ m }: { m: Meeting }) {
  if (m.status === "collecting") return <Badge className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> coletando</Badge>;
  if (m.status === "transcribed") return <Badge className="gap-1 bg-honey text-ink"><Check className="h-3 w-3" /> transcrita</Badge>;
  if (m.status === "failed") return <Badge variant="destructive" className="gap-1"><X className="h-3 w-3" /> falhou{m.failureReason ? `: ${m.failureReason}` : ""}</Badge>;
  return <Badge variant="outline" className="gap-1">cancelada</Badge>;
}

export function MeetingItem({ meeting }: { meeting: Meeting }) {
  // poll-through enquanto coletando
  const poll = useMeetingPoll(meeting.id, meeting.status === "collecting");
  const m = poll.data ?? meeting;
  const stop = useStopMeeting(m.id);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">{m.title ?? `Reunião ${new Date(m.occurredAt).toLocaleDateString("pt-BR")}`}</div>
          <div className="text-xs text-muted-foreground">{new Date(m.occurredAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · {m.meetCode}</div>
        </div>
        <StatusBadge m={m} />
      </div>
      {m.status === "transcribed" && m.participants && m.participants.length > 0 && (
        <div className="text-xs text-muted-foreground">Participantes: {m.participants.map((p) => p.name).join(", ")}</div>
      )}
      {m.status === "collecting" && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" className="gap-1" disabled={stop.isPending} onClick={() => stop.mutate()}>
            <Square className="h-3 w-3" /> encerrar coleta
          </Button>
        </div>
      )}
    </div>
  );
}
