import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Input, Button, Label,
} from "@beeads/ui";
import { useMyWorkspaces } from "@/hooks/useProfile";
import { type Meeting, useTriageMeeting, useDiscardMeeting } from "./useMeetings";

export function TriageDialog({ meeting, open, onOpenChange }: {
  meeting: Meeting | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: workspaces } = useMyWorkspaces();
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [pattern, setPattern] = useState<string>("");
  const triage = useTriageMeeting(meeting?.id ?? "");
  const discard = useDiscardMeeting(meeting?.id ?? "");

  // Pré-preenche o pattern com o título lowercased ao (re)abrir; o operador enxuga.
  useEffect(() => {
    if (open && meeting) {
      setPattern((meeting.title ?? "").toLowerCase());
      setWorkspaceId("");
    }
  }, [open, meeting]);

  if (!meeting) return null;
  const isPending = triage.isPending || discard.isPending;
  const visibleWorkspaces = (workspaces ?? []).filter((w: { hidden: boolean }) => !w.hidden);
  const start = meeting.scheduledStartAt ? new Date(meeting.scheduledStartAt).toLocaleString("pt-BR") : "";
  const guests = (meeting.attendees ?? []).map(a => a.displayName ?? a.email).join(", ");

  function submit() {
    if (!workspaceId) return;
    triage.mutate(
      { workspaceId, titleRulePattern: pattern.trim() || undefined },
      { onSuccess: () => onOpenChange(false) },
    );
  }
  function onDiscard() {
    discard.mutate(undefined, { onSuccess: () => onOpenChange(false) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle className="lowercase">triar reunião</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm">
            <p className="font-medium">{meeting.title ?? meeting.meetCode}</p>
            {start && <p className="text-xs text-muted-foreground">{start}</p>}
            {guests && <p className="text-xs text-muted-foreground truncate">convidados: {guests}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="triage-workspace" className="lowercase">workspace</Label>
            <Select value={workspaceId} onValueChange={(v) => setWorkspaceId(v ?? "")}>
              <SelectTrigger id="triage-workspace"><SelectValue placeholder="escolha o cliente" /></SelectTrigger>
              <SelectContent>
                {visibleWorkspaces.map((w: { id: string; name: string }) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="triage-pattern" className="lowercase">regra de título (opcional)</Label>
            <Input id="triage-pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="ex.: ludi ateliê" />
            <p className="text-[11px] text-muted-foreground">
              Enxugue pro nome do cliente — as próximas reuniões com esse trecho no título resolvem sozinhas.
            </p>
          </div>
        </div>
        <DialogFooter className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={onDiscard} disabled={isPending} className="lowercase">descartar</Button>
          <Button onClick={submit} disabled={!workspaceId || isPending} className="lowercase">atribuir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
