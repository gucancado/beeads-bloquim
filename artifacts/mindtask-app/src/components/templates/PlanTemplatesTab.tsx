import { useEffect, useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Input } from "@beeads/ui";
import { customFetch } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TaskDeleteDialog } from "@/components/tasks/TaskDeleteDialog";
import { toast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/apiErrorMessage";
import { formatPlanCounts, PLAN_TEMPLATES_QUERY_KEY, type PlanTemplateListItem } from "@/lib/planTemplates";

function PlanTemplateRow({
  template,
  onRename,
  onDelete,
}: {
  template: PlanTemplateListItem;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(template.name);
  useEffect(() => setName(template.name), [template.name]);
  // Escape descarta: o blur disparado em seguida ainda vê o `name` editado no closure.
  const discardOnBlur = useRef(false);

  // Autosave no blur (convenção do app); nome vazio volta ao anterior.
  const commit = () => {
    if (discardOnBlur.current) {
      discardOnBlur.current = false;
      return;
    }
    const v = name.trim();
    if (!v) {
      setName(template.name);
      return;
    }
    if (v !== template.name) onRename(template.id, v);
  };

  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              discardOnBlur.current = true;
              setName(template.name);
              e.currentTarget.blur();
            }
          }}
          aria-label="nome do modelo de plano"
          className="h-8 border-transparent bg-transparent px-1 text-base font-semibold shadow-none hover:border-border focus:border-border"
        />
        <p className="px-1 text-xs text-muted-foreground lowercase">{formatPlanCounts(template.counts)}</p>
      </div>
      <button
        type="button"
        onClick={() => onDelete(template.id)}
        className="text-muted-foreground hover:text-destructive transition-colors p-1.5 rounded-lg hover:bg-destructive/10"
        title="excluir modelo"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

export function PlanTemplatesTab() {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery<PlanTemplateListItem[]>({
    queryKey: PLAN_TEMPLATES_QUERY_KEY,
    queryFn: () => customFetch("/api/plan-templates"),
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      customFetch(`/api/plan-templates/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: PLAN_TEMPLATES_QUERY_KEY }),
    onError: (e: unknown) => toast({ title: apiErrorMessage(e, "erro ao renomear modelo"), variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => customFetch(`/api/plan-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PLAN_TEMPLATES_QUERY_KEY });
      setDeletingId(null);
    },
    onError: (e: unknown) => toast({ title: apiErrorMessage(e, "erro ao excluir modelo"), variant: "destructive" }),
  });

  return (
    <>
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      ) : !templates || templates.length === 0 ? (
        <div className="text-center py-24">
          <p className="text-muted-foreground lowercase">
            você ainda não tem modelos de plano de ação. crie um a partir de um plano no mapa.
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-3xl border border-border/60 shadow-sm overflow-hidden">
          <div className="divide-y divide-border/50">
            {templates.map((t) => (
              <PlanTemplateRow
                key={t.id}
                template={t}
                onRename={(id, name) => renameMut.mutate({ id, name })}
                onDelete={setDeletingId}
              />
            ))}
          </div>
        </div>
      )}

      <TaskDeleteDialog
        open={!!deletingId}
        onOpenChange={(v) => {
          if (!v) setDeletingId(null);
        }}
        label="Excluir modelo de plano?"
        description="O modelo será removido permanentemente. Planos já criados a partir dele não serão afetados."
        confirmLabel="Excluir"
        loading={deleteMut.isPending}
        onConfirm={() => {
          if (deletingId) deleteMut.mutate(deletingId);
        }}
      />
    </>
  );
}
