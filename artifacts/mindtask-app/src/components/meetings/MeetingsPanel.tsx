import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Loader2 } from "lucide-react";
import { Button } from "@beeads/ui";
import { useMeetings } from "./useMeetings";
import { MeetingItem } from "./MeetingItem";
import { NewMeetingModal } from "./NewMeetingModal";

export function MeetingsPanel() {
  const [expanded, setExpanded] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const { data: meetings, isLoading } = useMeetings();

  return (
    <div className="rounded-2xl border border-border bg-paper">
      <div className="flex items-center justify-between p-3">
        <button className="flex items-center gap-2 text-sm font-medium text-fg" onClick={() => setExpanded((v) => !v)}>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Reuniões
        </button>
        <Button size="sm" className="gap-1" onClick={() => setModalOpen(true)}><Plus className="h-4 w-4" /> Nova reunião</Button>
      </div>
      {expanded && (
        <div className="flex flex-col gap-2 p-3 pt-0">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> carregando…</div>
          ) : !meetings || meetings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma reunião ainda. Clique em "Nova reunião" para colar um Meet acontecendo agora.</p>
          ) : (
            meetings.map((m) => <MeetingItem key={m.id} meeting={m} />)
          )}
        </div>
      )}
      <NewMeetingModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
