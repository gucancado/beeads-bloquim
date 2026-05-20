import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Link2,
  Plus,
  X,
  ArrowRight,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import {
  useListTaskLinks,
  useCreateTaskLink,
  useRemoveTaskLink,
  useGetMap,
  getListTaskLinksQueryKey,
  getListTaskAttachmentsQueryKey,
} from "@workspace/api-client-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";

interface TaskLinksSectionProps {
  workspaceId: string;
  taskId: string;
  /** mapId of the current task — required (the feature is plan-scoped). When
   * null, the section renders a hint that the task needs to be in a plan. */
  mapId: string | null;
}

/**
 * "Tarefas ligadas" section in TaskDetailModal. Lists outgoing/incoming links,
 * with a popover-driven palette to create new links to other tasks in the
 * same plan. Removing a link triggers the inheritance cascade on the backend.
 */
export function TaskLinksSection({
  workspaceId,
  taskId,
  mapId,
}: TaskLinksSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const linksKey = getListTaskLinksQueryKey(workspaceId, taskId);
  const attachmentsKey = getListTaskAttachmentsQueryKey(workspaceId, taskId);

  const { data: links, isLoading: linksLoading } = useListTaskLinks(
    workspaceId,
    taskId,
  );
  const { data: mapDetail, isLoading: mapLoading } = useGetMap(
    workspaceId,
    mapId ?? "",
    { query: { enabled: !!mapId } },
  );

  const createMut = useCreateTaskLink();
  const removeMut = useRemoveTaskLink();

  const outgoing = links?.outgoing ?? [];
  const incoming = links?.incoming ?? [];

  // Candidates: other cards in the same plan that (1) have a task, (2) aren't
  // this task, (3) aren't already linked.
  const candidates = useMemo(() => {
    if (!mapDetail) return [];
    const linkedIds = new Set<string>([
      taskId,
      ...outgoing.map((l) => l.targetTaskId),
      ...incoming.map((l) => l.sourceTaskId),
    ]);
    return mapDetail.cards
      .filter((c) => c.taskId && !linkedIds.has(c.taskId))
      .map((c) => ({ taskId: c.taskId!, title: c.title }));
  }, [mapDetail, outgoing, incoming, taskId]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: linksKey });
    // Inheritance can change the attachment listing on this task too.
    queryClient.invalidateQueries({ queryKey: attachmentsKey });
  }

  async function handleCreate(targetTaskId: string) {
    try {
      const result = await createMut.mutateAsync({
        workspaceId,
        taskId,
        data: { targetTaskId },
      });
      invalidate();
      // Invalidate target's attachments too (it just received inherited ones).
      queryClient.invalidateQueries({
        queryKey: getListTaskAttachmentsQueryKey(workspaceId, targetTaskId),
      });
      setPaletteOpen(false);
      if (result.inheritedCount > 0) {
        toast({
          title: `Vínculo criado · ${result.inheritedCount} entregável herdado`,
        });
      } else {
        toast({ title: "Vínculo criado" });
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "Erro ao criar vínculo";
      toast({ title: msg, variant: "destructive" });
    }
  }

  async function handleRemove(linkId: string, otherTaskId: string) {
    try {
      await removeMut.mutateAsync({ workspaceId, taskId, linkId });
      invalidate();
      queryClient.invalidateQueries({
        queryKey: getListTaskAttachmentsQueryKey(workspaceId, otherTaskId),
      });
    } catch {
      toast({ title: "Erro ao remover vínculo", variant: "destructive" });
    }
  }

  if (!mapId) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link2 className="w-3.5 h-3.5" />
          <span className="lowercase">tarefas ligadas</span>
        </div>
        <p className="text-xs text-muted-foreground italic lowercase">
          Anexe esta tarefa a um plano para vinculá-la a outras tarefas.
        </p>
      </div>
    );
  }

  const hasLinks = outgoing.length > 0 || incoming.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link2 className="w-3.5 h-3.5" />
          <span className="lowercase">tarefas ligadas</span>
        </div>
        <Popover open={paletteOpen} onOpenChange={setPaletteOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary px-2 py-1 rounded-lg hover:bg-muted transition-colors"
              title="Vincular tarefa"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="lowercase">vincular tarefa</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end">
            <Command>
              <CommandInput
                placeholder={
                  mapLoading ? "carregando tarefas…" : "buscar tarefa no plano…"
                }
              />
              <CommandList>
                <CommandEmpty>
                  {mapLoading
                    ? "carregando…"
                    : candidates.length === 0
                      ? "nenhuma tarefa elegível no plano"
                      : "nenhum resultado"}
                </CommandEmpty>
                <CommandGroup>
                  {candidates.map((c) => (
                    <CommandItem
                      key={c.taskId}
                      value={c.title}
                      onSelect={() => handleCreate(c.taskId)}
                      disabled={createMut.isPending}
                    >
                      <span className="truncate">{c.title}</span>
                      {createMut.isPending && (
                        <Loader2 className="ml-auto w-3 h-3 animate-spin" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {linksLoading ? null : !hasLinks ? (
        <p className="text-xs text-muted-foreground italic lowercase">
          Nenhuma tarefa vinculada.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {outgoing.map((l) => (
            <LinkRow
              key={l.id}
              direction="outgoing"
              title={l.targetTitle}
              isPending={removeMut.isPending}
              onRemove={() => handleRemove(l.id, l.targetTaskId)}
            />
          ))}
          {incoming.map((l) => (
            <LinkRow
              key={l.id}
              direction="incoming"
              title={l.sourceTitle}
              isPending={removeMut.isPending}
              onRemove={() => handleRemove(l.id, l.sourceTaskId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface LinkRowProps {
  direction: "outgoing" | "incoming";
  title: string;
  isPending: boolean;
  onRemove: () => void;
}

function LinkRow({ direction, title, isPending, onRemove }: LinkRowProps) {
  const Arrow = direction === "outgoing" ? ArrowRight : ArrowLeft;
  const label =
    direction === "outgoing" ? "entrega para" : "recebe entregáveis de";
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 rounded-xl border border-border group hover:bg-muted/60 transition-colors">
      <Arrow className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="text-sm text-foreground truncate">{title}</p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={isPending}
        className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30"
        title="Remover vínculo"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
