import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@beeads/ui";
import { customFetch } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/apiErrorMessage";
import {
  PLAN_TEMPLATES_QUERY_KEY,
  skippedDescription,
  type PlanApplyResult,
  type PlanCaptureResult,
  type PlanSelection,
  type PlanTemplateListItem,
} from "@/lib/planTemplates";

type CaptureBody = { cardIds?: string[]; textElementIds?: string[]; shapeIds?: string[] };

const EMPTY_SELECTION: PlanSelection = { cardIds: [], textElementIds: [], shapeIds: [], usable: false };

export function PlanTemplateMenu({
  workspaceId,
  mapId,
  getSelection,
  onApplied,
}: {
  workspaceId: string;
  mapId: string;
  getSelection: () => PlanSelection;
  onApplied: (r: PlanApplyResult) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "list">("menu");
  const [selection, setSelection] = useState<PlanSelection>(EMPTY_SELECTION);
  const base = `/api/workspaces/${workspaceId}/maps/${mapId}/plan-templates`;

  const { data: templates, isLoading } = useQuery<PlanTemplateListItem[]>({
    queryKey: PLAN_TEMPLATES_QUERY_KEY,
    queryFn: () => customFetch("/api/plan-templates"),
    enabled: open && view === "list",
  });

  const captureMut = useMutation({
    mutationFn: (body: CaptureBody) =>
      customFetch<PlanCaptureResult>(`${base}/capture`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (r) => {
      toast({ title: "novo modelo de plano de ação criado", description: skippedDescription(r.skipped) });
      queryClient.invalidateQueries({ queryKey: PLAN_TEMPLATES_QUERY_KEY });
    },
    onError: (e: unknown) => {
      toast({ title: apiErrorMessage(e, "erro ao criar modelo de plano de ação"), variant: "destructive" });
    },
  });

  const applyMut = useMutation({
    mutationFn: (templateId: string) =>
      customFetch<PlanApplyResult>(`${base}/${templateId}/apply`, { method: "POST" }),
    onSuccess: (r) => {
      onApplied(r);
      toast({ title: "modelo de plano de ação aplicado" });
    },
    onError: (e: unknown) => {
      toast({
        title: apiErrorMessage(e, "erro ao aplicar modelo de plano de ação", {
          403: "você não tem permissão pra aplicar modelos neste plano",
        }),
        variant: "destructive",
      });
    },
  });

  const busy = captureMut.isPending || applyMut.isPending;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (next && busy) return;
        setOpen(next);
        if (next) {
          setView("menu");
          setSelection(getSelection());
        }
      }}
    >
      <DropdownMenuTrigger
        render={(props) => (
          <button
            {...props}
            type="button"
            title="modelos de plano de ação"
            aria-busy={busy}
            className="w-10 h-10 rounded-xl bg-card border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          </button>
        )}
      />
      <DropdownMenuContent sideOffset={6} className="w-64 max-h-72 overflow-y-auto">
        {view === "menu" ? (
          <>
            <DropdownMenuItem closeOnClick={false} className="lowercase cursor-pointer" onClick={() => setView("list")}>
              aplicar modelo de plano de ação
            </DropdownMenuItem>
            <DropdownMenuItem className="lowercase cursor-pointer" onClick={() => captureMut.mutate({})}>
              criar modelo de plano de ação
            </DropdownMenuItem>
            {selection.usable && (
              <DropdownMenuItem
                className="lowercase cursor-pointer"
                onClick={() =>
                  captureMut.mutate({
                    cardIds: selection.cardIds,
                    textElementIds: selection.textElementIds,
                    shapeIds: selection.shapeIds,
                  })
                }
              >
                criar modelo a partir da seleção
              </DropdownMenuItem>
            )}
          </>
        ) : isLoading ? (
          <div className="px-3 py-4 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : !templates || templates.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground text-center lowercase">
            você ainda não tem modelos de plano de ação
          </div>
        ) : (
          templates.map((t) => (
            <DropdownMenuItem
              key={t.id}
              className="cursor-pointer truncate"
              title={t.name}
              onClick={() => applyMut.mutate(t.id)}
            >
              {t.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
