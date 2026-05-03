import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageBreadcrumb } from "@/components/layout/PageBreadcrumb";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { TemplateDetailModal } from "@/components/templates/TemplateDetailModal";
import { TaskDeleteDialog } from "@/components/tasks/TaskDeleteDialog";

interface Template {
  id: string;
  name: string | null;
  title: string | null;
  description: string | null;
  priority: string | null;
}

export default function TemplatesPage() {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ["/api/task-templates"],
    queryFn: () => customFetch("/api/task-templates"),
  });

  const createMut = useMutation({
    mutationFn: () => customFetch<Template>("/api/task-templates", { method: "POST" }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/task-templates"] });
      setOpenId(created.id);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => customFetch(`/api/task-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/task-templates"] });
      setDeletingId(null);
    },
  });

  const closeModal = () => {
    setOpenId(null);
    queryClient.invalidateQueries({ queryKey: ["/api/task-templates"] });
  };

  const displayName = (t: Template) =>
    (t.name && t.name.trim()) || (t.title && t.title.trim()) || "modelo sem nome";

  return (
    <AppLayout>
      <div className="flex-1 overflow-auto bg-slate-50 dark:bg-background">
        <div className="max-w-6xl mx-auto p-8 lg:p-12">
          <PageBreadcrumb items={[{ label: "modelos de tarefas" }]} className="mb-4" />
          <div className="flex flex-col gap-6 mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div />
              <Button
                title="novo modelo"
                className="rounded-xl px-4 h-12 shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-all"
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending}
              >
                {createMut.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
            </div>
          ) : !templates || templates.length === 0 ? (
            <div className="text-center py-24">
              <p className="text-muted-foreground lowercase">você ainda não tem modelos.</p>
            </div>
          ) : (
            <div className="bg-card rounded-3xl border border-border/60 shadow-sm overflow-hidden">
              <div className="divide-y divide-border/50">
                {templates.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => setOpenId(t.id)}
                    className="px-4 py-3 flex items-center gap-3 group cursor-pointer hover:bg-muted/50 dark:hover:bg-[#404040] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-semibold text-foreground truncate">{displayName(t)}</p>
                      {t.title && t.name && t.title.trim() && t.title.trim() !== t.name?.trim() && (
                        <p className="text-xs text-muted-foreground truncate lowercase">aplica: {t.title}</p>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenId(t.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-opacity p-1.5 rounded-lg hover:bg-primary/10"
                      title="editar modelo"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingId(t.id);
                      }}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1.5 rounded-lg hover:bg-destructive/10"
                      title="excluir modelo"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <TemplateDetailModal templateId={openId} open={!!openId} onClose={closeModal} />

      <TaskDeleteDialog
        open={!!deletingId}
        onOpenChange={(v) => {
          if (!v) setDeletingId(null);
        }}
        label="Excluir modelo?"
        description="O modelo será removido permanentemente. Tarefas já criadas a partir dele não serão afetadas."
        confirmLabel="Excluir"
        loading={deleteMut.isPending}
        onConfirm={() => {
          if (deletingId) deleteMut.mutate(deletingId);
        }}
      />
    </AppLayout>
  );
}
