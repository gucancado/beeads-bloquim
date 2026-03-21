import { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useCreateWorkspace } from "@workspace/api-client-react";
import { FolderGit2, Plus, Loader2, ArrowRight, EyeOff, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useListWorkspacesWithHidden, useToggleWorkspaceHidden } from "@/hooks/useHidden";

function translateRole(role: string) {
  switch (role) {
    case 'admin': return 'Administrador';
    case 'editor': return 'Editor';
    case 'executor': return 'Executor';
    default: return role;
  }
}

type TaskCounts = {
  overdue: number;
  blocked: number;
  in_progress: number;
  pending: number;
  total: number;
  completed: number;
};

const STATUS_BADGES: Array<{
  key: keyof TaskCounts;
  label: string;
  className: string;
}> = [
  { key: "overdue", label: "vencidas", className: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/60" },
  { key: "blocked", label: "interrompidas", className: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-900/60" },
  { key: "in_progress", label: "em andamento", className: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/60" },
  { key: "pending", label: "pendentes", className: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700" },
];

function WorkspaceCard({ ws, showHidden }: {
  ws: { id: string; name: string; hidden: boolean; role: string; taskCounts?: TaskCounts };
  showHidden: boolean;
}) {
  const toggleHidden = useToggleWorkspaceHidden(ws.id);
  const isAdmin = ws.role === "admin";

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleHidden.mutate(!ws.hidden);
  };

  const counts = ws.taskCounts ?? { overdue: 0, blocked: 0, in_progress: 0, pending: 0, total: 0, completed: 0 };
  const hasAnyCounts = STATUS_BADGES.some((b) => counts[b.key] > 0);
  const noTasks = counts.total === 0;
  const allCompleted = counts.total > 0 && counts.completed === counts.total;

  return (
    <div className={`relative group ${ws.hidden ? 'opacity-60' : ''}`}>
      <Link href={`/workspaces/${ws.id}`}>
        <div className="group/card bg-card p-6 rounded-3xl border border-border/60 shadow-sm hover:shadow-xl hover:border-primary/30 transition-all duration-300 cursor-pointer flex flex-col h-full hover:-translate-y-1">
          <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-6 group-hover/card:bg-primary group-hover/card:text-primary-foreground transition-colors">
            <FolderGit2 className="w-6 h-6" />
          </div>
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="text-xl font-bold font-display text-foreground group-hover/card:text-primary transition-colors">{ws.name}</h3>
            {ws.hidden && (
              <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                <EyeOff className="w-3 h-3" /> Oculto
              </span>
            )}
          </div>
          {noTasks ? (
            <p className="text-[13px] text-muted-foreground mt-3">Sem tarefas</p>
          ) : allCompleted ? (
            <p className="text-[13px] text-emerald-600 dark:text-emerald-400 font-medium mt-3">Tarefas concluídas</p>
          ) : hasAnyCounts ? (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {STATUS_BADGES.map((badge) =>
                counts[badge.key] > 0 ? (
                  <span
                    key={badge.key}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${badge.className}`}
                  >
                    {counts[badge.key]} {badge.label}
                  </span>
                ) : null
              )}
            </div>
          ) : null}
          <div className="mt-auto pt-6 flex items-center justify-between text-sm text-muted-foreground">
            <span>{translateRole(ws.role)}</span>
            <span className="flex items-center text-primary font-medium opacity-0 group-hover/card:opacity-100 transition-opacity -translate-x-2 group-hover/card:translate-x-0 duration-300">
              Acessar <ArrowRight className="w-4 h-4 ml-1" />
            </span>
          </div>
        </div>
      </Link>

      {isAdmin && (
        <button
          onClick={handleToggle}
          disabled={toggleHidden.isPending}
          title={ws.hidden ? "Tornar visível" : "Ocultar espaço"}
          className="absolute top-3 right-3 w-8 h-8 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all bg-background border border-border shadow-sm hover:border-slate-400 dark:hover:border-slate-500 text-muted-foreground hover:text-foreground z-10"
        >
          {toggleHidden.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : ws.hidden ? (
            <Eye className="w-3.5 h-3.5" />
          ) : (
            <EyeOff className="w-3.5 h-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

export default function WorkspacesPage() {
  const [showHidden, setShowHidden] = useState(false);
  const { data: workspaces, isLoading } = useListWorkspacesWithHidden(showHidden);
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const isAdmin = workspaces?.some((ws) => ws.role === "admin") ?? false;

  const createMutation = useCreateWorkspace({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
        setIsOpen(false);
        setName("");
        toast({ title: "Espaço criado com sucesso!" });
      },
      onError: () => {
        toast({ title: "Falha ao criar espaço", variant: "destructive" });
      }
    }
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({ data: { name } });
  };

  return (
    <AppLayout>
      <div className="flex-1 overflow-auto bg-slate-50 dark:bg-background">
        <div className="max-w-6xl mx-auto p-8 lg:p-12">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-12">
            <div>
              <h1 className="text-4xl font-display font-bold text-foreground">Espaços de Trabalho</h1>
              <p className="text-muted-foreground mt-2 text-lg">Gerencie suas equipes e projetos</p>
            </div>

            <div className="flex items-center gap-3">
              {isAdmin && (
                <Button
                  variant="outline"
                  className="rounded-xl h-12 px-5 gap-2"
                  onClick={() => setShowHidden((v) => !v)}
                >
                  {showHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  {showHidden ? "Ocultar ocultos" : "Ver ocultos"}
                </Button>
              )}

              <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogTrigger asChild>
                  <Button className="rounded-xl px-6 h-12 shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-all text-base">
                    <Plus className="w-5 h-5 mr-2" />
                    Novo Espaço
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md rounded-2xl">
                  <DialogHeader>
                    <DialogTitle className="text-2xl font-display">Criar Espaço de Trabalho</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleCreate} className="space-y-6 mt-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Nome do Espaço</label>
                      <Input 
                        placeholder="ex: Equipe de Engenharia, Projetos Pessoais" 
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="h-12 rounded-xl"
                        autoFocus
                      />
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setIsOpen(false)} className="rounded-xl">
                        Cancelar
                      </Button>
                      <Button type="submit" disabled={createMutation.isPending || !name.trim()} className="rounded-xl">
                        {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {showHidden && (
            <div className="mb-6 flex items-center gap-2 px-4 py-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-2xl text-sm text-amber-700 dark:text-amber-400">
              <EyeOff className="w-4 h-4 shrink-0" />
              <span>Mostrando espaços ocultos. Apenas administradores podem ver e restaurar espaços ocultos.</span>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
            </div>
          ) : workspaces?.length === 0 ? (
            <div className="text-center py-24 bg-card rounded-3xl border border-border shadow-sm">
              <div className="w-20 h-20 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-6">
                <FolderGit2 className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold font-display text-foreground">
                {showHidden ? "Nenhum espaço oculto" : "Nenhum espaço ainda"}
              </h3>
              <p className="text-muted-foreground mt-2 mb-8 max-w-md mx-auto">
                {showHidden
                  ? "Você não possui espaços ocultos no momento."
                  : "Crie um espaço para começar a organizar seus planos e tarefas."}
              </p>
              {!showHidden && (
                <Button onClick={() => setIsOpen(true)} className="rounded-xl px-8 h-12">
                  Criar primeiro espaço
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {workspaces?.map((ws) => (
                <WorkspaceCard key={ws.id} ws={ws} showHidden={showHidden} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
