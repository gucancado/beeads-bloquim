import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Button, Input, Label, Select, SelectTrigger, SelectContent, SelectItem,
} from "@beeads/ui";
import { useCreateMeeting } from "./useMeetings";

const MEET_RE = /[a-z]{3}-[a-z]{4}-[a-z]{3}/;
function extractCode(input: string): string | null {
  const m = (input ?? "").trim().match(MEET_RE);
  return m ? m[0] : null;
}

export function NewMeetingModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [raw, setRaw] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [mapId, setMapId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const create = useCreateMeeting();

  const code = useMemo(() => extractCode(raw), [raw]);

  const { data: workspaces } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/workspaces"], queryFn: () => customFetch("/api/workspaces"), enabled: open,
  });
  const { data: mapsData } = useQuery<{ id: string; name: string; hidden: boolean }[]>({
    queryKey: [`/api/workspaces/${workspaceId}/maps`], queryFn: () => customFetch(`/api/workspaces/${workspaceId}/maps`),
    enabled: open && !!workspaceId, select: (d) => d.filter((m) => !m.hidden),
  });

  const submit = () => {
    if (!code) return;
    create.mutate(
      { meetUrlOrCode: raw, workspaceId, mapId, title: title.trim() || null },
      { onSuccess: () => { setRaw(""); setTitle(""); setWorkspaceId(null); setMapId(null); onOpenChange(false); } },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Nova reunião</DialogTitle>
        </DialogHeader>
        <DialogDescription className="sr-only">Formulário para iniciar a coleta de uma reunião do Meet</DialogDescription>
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="meet">Link ou código do Meet</Label>
            <Input id="meet" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="https://meet.google.com/xxx-xxxx-xxx" />
            <p className="text-xs text-muted-foreground mt-1">
              {code ? <>Código detectado: <span className="font-mono text-fg">{code}</span></> : "Cole o link de um Meet acontecendo agora."}
            </p>
          </div>
          <div>
            <Label>Espaço de trabalho (opcional)</Label>
            <Select value={workspaceId ?? "none"} onValueChange={(v) => { setWorkspaceId(v === "none" ? null : v); setMapId(null); }}>
              <SelectTrigger>{workspaces?.find((w) => w.id === workspaceId)?.name ?? "Nenhum"}</SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum</SelectItem>
                {workspaces?.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {workspaceId && (
            <div>
              <Label>Plano (opcional)</Label>
              <Select value={mapId ?? "none"} onValueChange={(v) => setMapId(v === "none" ? null : v)}>
                <SelectTrigger>{mapsData?.find((m) => m.id === mapId)?.name ?? "Nenhum"}</SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {mapsData?.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="title">Título (opcional)</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Reunião de alinhamento" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button disabled={!code || create.isPending} onClick={submit}>{create.isPending ? "Iniciando…" : "Iniciar coleta"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
