import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetMyTasks } from "@workspace/api-client-react";
import { CheckSquare, Loader2, Flag, Calendar as CalendarIcon, Map as MapIcon, ArrowRight, Pencil, Building2, User } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardPanel } from "@/components/maps/CardPanel";
import { useQueryClient } from "@tanstack/react-query";

interface OpenCard {
  workspaceId: string;
  mapId: string;
  cardId: string;
}

const STATUS_OPTIONS = [
  { value: "overdue",     label: "Vencida",       activeClass: "bg-red-500 text-white border-red-500 hover:bg-red-600"                       },
  { value: "in_progress", label: "Em andamento",  activeClass: "bg-amber-500 text-white border-amber-500 hover:bg-amber-600"                  },
  { value: "pending",     label: "Pendente",       activeClass: "bg-blue-500 text-white border-blue-500 hover:bg-blue-600"                     },
  { value: "blocked",     label: "Interrompida",   activeClass: "bg-purple-500 text-white border-purple-500 hover:bg-purple-600"               },
  { value: "completed",   label: "Concluída",      activeClass: "bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600"            },
];

export default function MyTasksPage() {
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["overdue", "in_progress"]);
  const [openCard, setOpenCard] = useState<OpenCard | null>(null);
  const queryClient = useQueryClient();

  const toggleStatus = (value: string) => {
    setSelectedStatuses(prev =>
      prev.includes(value) ? prev.filter(s => s !== value) : [...prev, value]
    );
  };

  const { data: tasks, isLoading } = useGetMyTasks({ 
    status: selectedStatuses.length > 0 ? selectedStatuses.join(",") as any : undefined 
  });

  const getPriorityColor = (p: string) => {
    switch (p) {
      case 'critical': return 'text-red-500 bg-red-500/10 border-red-200 dark:border-red-900/50';
      case 'high': return 'text-orange-500 bg-orange-500/10 border-orange-200 dark:border-orange-900/50';
      case 'medium': return 'text-blue-500 bg-blue-500/10 border-blue-200 dark:border-blue-900/50';
      case 'low': return 'text-slate-500 bg-slate-500/10 border-slate-200 dark:border-slate-800';
      default: return '';
    }
  };

  const getVisualStatus = (task: { status: string; overdue?: boolean | null }) => {
    if (task.overdue && task.status !== 'completed' && task.status !== 'blocked') return 'overdue';
    return task.status;
  };

  const getStatusLabel = (s: string) => {
    switch (s) {
      case 'pending': return 'PENDENTE';
      case 'in_progress': return 'EM ANDAMENTO';
      case 'completed': return 'CONCLUÍDA';
      case 'overdue': return 'VENCIDA';
      case 'blocked': return 'INTERROMPIDA';
      default: return s.replace('_', ' ').toUpperCase();
    }
  };

  const getStatusColor = (s: string) => {
    switch (s) {
      case 'overdue': return 'bg-red-500 text-white border-transparent';
      case 'completed': return 'bg-emerald-500 text-white border-transparent';
      case 'in_progress': return 'bg-amber-500 text-white border-transparent';
      case 'pending': return 'bg-blue-500 text-white border-transparent';
      case 'blocked': return 'bg-purple-500 text-white border-transparent';
      default: return '';
    }
  };

  const handleClosePanel = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/my-tasks"] });
    setOpenCard(null);
  };

  return (
    <AppLayout>
      <div className="flex-1 overflow-auto bg-slate-50 dark:bg-background">
        <div className="max-w-6xl mx-auto p-8 lg:p-12">
          <div className="flex flex-col gap-6 mb-12">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-primary/10 text-primary rounded-xl flex items-center justify-center">
                    <CheckSquare className="w-5 h-5" />
                  </div>
                  <h1 className="text-4xl font-display font-bold text-foreground">My Tasks</h1>
                </div>
                <p className="text-muted-foreground text-lg ml-1">Everything assigned to you across all workspaces.</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-1">Filtrar:</span>
              {STATUS_OPTIONS.map(opt => {
                const isActive = selectedStatuses.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() => toggleStatus(opt.value)}
                    className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-all duration-150 cursor-pointer ${
                      isActive
                        ? opt.activeClass
                        : "bg-card text-muted-foreground border-border hover:border-slate-400 dark:hover:border-slate-600"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
              {selectedStatuses.length > 0 && (
                <button
                  onClick={() => setSelectedStatuses([])}
                  className="px-3 py-1.5 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground border border-transparent hover:border-border transition-all duration-150 cursor-pointer ml-1"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
            </div>
          ) : tasks?.length === 0 ? (
            <div className="text-center py-24 bg-card rounded-3xl border border-border shadow-sm">
              <div className="w-20 h-20 bg-slate-100 dark:bg-slate-900 text-muted-foreground rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckSquare className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold font-display text-foreground">You're all caught up!</h3>
              <p className="text-muted-foreground mt-2 max-w-md mx-auto">You have no assigned tasks matching these filters.</p>
            </div>
          ) : (
            <div className="bg-card rounded-3xl border border-border/60 shadow-sm overflow-hidden">
              <div className="divide-y divide-border/50">
                {tasks?.map(task => (
                  <div
                    key={task.id}
                    className="p-6 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors flex flex-col md:flex-row gap-6 md:items-center justify-between group cursor-pointer"
                    onClick={() => setOpenCard({ workspaceId: task.workspaceId, mapId: task.mapId, cardId: (task as any).cardId })}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <Badge className={`rounded-full px-2.5 py-0.5 text-xs font-semibold no-default-active-elevate ${getStatusColor(getVisualStatus(task as any))}`}>
                          {getStatusLabel(getVisualStatus(task as any))}
                        </Badge>
                        <Badge variant="outline" className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border ${getPriorityColor(task.priority)}`}>
                          <Flag className="w-3 h-3 mr-1 inline-block" /> {task.priority}
                        </Badge>
                      </div>
                      <h3 className="text-xl font-bold text-foreground mb-1">{(task as any).cardTitle || task.title}</h3>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate max-w-[140px]">{(task as any).workspaceName}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <MapIcon className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate max-w-[140px]">{task.mapName}</span>
                        </div>
                        {task.dueDate && (
                          <div className="flex items-center gap-1.5">
                            <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
                            <span>{format(new Date(task.dueDate), "dd/MM/yyyy")}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 shrink-0" />
                          <span>{(task as any).assigneeName ?? "Sem responsável"}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-lg bg-background shadow-sm hover:border-primary hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenCard({ workspaceId: task.workspaceId, mapId: task.mapId, cardId: (task as any).cardId });
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1.5" /> Editar
                      </Button>
                      <Link href={`/workspaces/${task.workspaceId}/maps/${task.mapId}`}>
                        <Button variant="outline" size="sm" className="rounded-lg bg-background shadow-sm hover:border-primary hover:text-primary transition-colors">
                          Ver no Mapa <ArrowRight className="w-4 h-4 ml-1.5" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {openCard && (
        <CardPanel
          workspaceId={openCard.workspaceId}
          mapId={openCard.mapId}
          cardId={openCard.cardId}
          onClose={handleClosePanel}
        />
      )}
    </AppLayout>
  );
}
