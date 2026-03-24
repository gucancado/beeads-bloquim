import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { CheckSquare, Loader2 } from "lucide-react";
import { CardPanel } from "@/components/maps/CardPanel";
import { WorkspaceTaskSheet } from "@/components/tasks/WorkspaceTaskSheet";
import { AssigneeFilterPills } from "@/components/tasks/AssigneeFilterPills";
import { TaskListItem, TaskListItemMember } from "@/components/tasks/TaskListItem";
import { useQueryClient, useQuery } from "@tanstack/react-query";

interface OpenCard {
  workspaceId: string;
  mapId: string;
  cardId: string;
}

interface StandaloneTask {
  workspaceId: string;
  id: string;
  mapId: string | null;
  cardId: string | null;
  title: string;
}

const STATUS_OPTIONS = [
  { value: "in_progress", label: "em andamento",  labelPlural: "em andamento",   activeClass: "bg-amber-500 text-white border-amber-500 hover:bg-amber-600"       },
  { value: "pending",     label: "pendente",       labelPlural: "pendentes",      activeClass: "bg-blue-500 text-white border-blue-500 hover:bg-blue-600"         },
  { value: "blocked",     label: "interrompida",   labelPlural: "interrompidas",  activeClass: "bg-purple-500 text-white border-purple-500 hover:bg-purple-600"   },
  { value: "completed",   label: "concluída",      labelPlural: "concluídas",     activeClass: "bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600"},
];

export default function MyTasksPage() {
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["in_progress"]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>(["me"]);
  const [openCard, setOpenCard] = useState<OpenCard | null>(null);
  const [standaloneTask, setStandaloneTask] = useState<StandaloneTask | null>(null);
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();

  const toggleStatus = (value: string) => {
    setSelectedStatuses(prev =>
      prev.includes(value) ? prev.filter(s => s !== value) : [...prev, value]
    );
  };

  const toggleAssignee = (id: string) => {
    setSelectedAssignees(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  const clearAllFilters = () => {
    setSelectedStatuses([]);
    setSelectedAssignees(["me"]);
  };

  const { data: members } = useQuery<{ userId: string; name: string; workspaceId: string }[]>({
    queryKey: ["/api/my-tasks/members"],
    queryFn: () => customFetch("/api/my-tasks/members"),
  });

  const tasksQueryKey = ["/api/my-tasks", selectedStatuses, selectedAssignees];
  const { data: tasks, isLoading } = useQuery<any[]>({
    queryKey: tasksQueryKey,
    queryFn: () => {
      const p = new URLSearchParams();
      if (selectedStatuses.length > 0) p.set("status", selectedStatuses.join(","));
      p.set("assignedTo", selectedAssignees.join(","));
      return customFetch(`/api/my-tasks?${p.toString()}`);
    },
  });

  const countsQueryKey = ["/api/my-tasks/counts", selectedAssignees];
  const { data: statusCounts } = useQuery<Record<string, number>>({
    queryKey: countsQueryKey,
    queryFn: () => {
      const p = new URLSearchParams();
      p.set("assignedTo", selectedAssignees.join(","));
      return customFetch(`/api/my-tasks/counts?${p.toString()}`);
    },
  });

  const handleClosePanel = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/my-tasks"] });
    queryClient.invalidateQueries({ queryKey: countsQueryKey });
    setOpenCard(null);
  };

  const handleDeleteCardFromPanel = () => {
    setOpenCard(null);
  };

  const handleCloseSheet = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/my-tasks"] });
    queryClient.invalidateQueries({ queryKey: countsQueryKey });
    setStandaloneTask(null);
  };

  const openTaskItem = (task: any) => {
    if (task.cardId && task.mapId) {
      setOpenCard({ workspaceId: task.workspaceId, mapId: task.mapId, cardId: task.cardId });
    } else {
      setStandaloneTask({ workspaceId: task.workspaceId, id: task.id, mapId: task.mapId, cardId: task.cardId, title: task.title });
    }
  };

  const hasActiveFilters = selectedStatuses.length > 0 || !( selectedAssignees.length === 1 && selectedAssignees[0] === "me");

  const membersByWorkspace = (members ?? []).reduce<Record<string, TaskListItemMember[]>>((acc, m) => {
    if (!acc[m.workspaceId]) acc[m.workspaceId] = [];
    if (!acc[m.workspaceId].some(x => x.userId === m.userId)) {
      acc[m.workspaceId].push({ userId: m.userId, name: m.name });
    }
    return acc;
  }, {});

  return (
    <AppLayout>
      <div className="flex-1 overflow-auto bg-slate-50 dark:bg-background">
        <div className="max-w-6xl mx-auto p-8 lg:p-12">
          <div className="flex flex-col gap-6 mb-12">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h1 className="text-4xl font-display font-bold text-foreground lowercase">Suas tarefas</h1>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {STATUS_OPTIONS.map(opt => {
                const isActive = selectedStatuses.includes(opt.value);
                const cnt = statusCounts?.[opt.value] ?? 0;
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
                    {cnt} {cnt > 1 ? opt.labelPlural : opt.label}
                  </button>
                );
              })}

              {hasActiveFilters && (
                <button
                  onClick={clearAllFilters}
                  className="px-3 py-1.5 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground border border-transparent hover:border-border transition-all duration-150 cursor-pointer ml-1"
                >
                  <span className="lowercase">Limpar filtros</span>
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground tracking-wider mr-1 lowercase">quem:</span>
              <AssigneeFilterPills
                members={Array.from(new Map((members ?? []).filter(m => m.userId !== undefined && m.userId !== me?.id).map(m => [m.userId, { userId: m.userId, name: m.name }])).values())}
                selected={selectedAssignees}
                onToggle={toggleAssignee}
                onClear={() => setSelectedAssignees([])}
                showMe
                meLabel="Eu"
              />
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
              <h3 className="text-2xl font-bold font-display text-foreground lowercase">Nenhuma tarefa encontrada</h3>
              <p className="text-muted-foreground mt-2 max-w-md mx-auto lowercase">Não há tarefas com os filtros selecionados.</p>
            </div>
          ) : (() => {
            const today = new Date();
            today.setHours(23, 59, 59, 999);
            const todayTasks = (tasks ?? []).filter(task => {
              if (task.dueDate) return new Date(task.dueDate) <= today;
              return !!(task as any).overdue;
            });
            const upcomingTasks = (tasks ?? []).filter(task => {
              if (task.dueDate) return new Date(task.dueDate) > today;
              return !(task as any).overdue;
            });

            return (
              <div className="flex flex-col gap-6">
                {todayTasks.length > 0 && (
                  <div>
                    <p className="text-xs font-light text-muted-foreground mb-2 px-1 lowercase">Pra hoje</p>
                    <div className="bg-card rounded-3xl border border-border/60 shadow-sm overflow-hidden">
                      <div className="divide-y divide-border/50">
                        {todayTasks.map(task => (
                          <TaskListItem
                            key={task.id}
                            task={task}
                            members={membersByWorkspace[task.workspaceId] ?? []}
                            invalidateQueryKeys={[["/api/my-tasks"], countsQueryKey]}
                            onOpenDetail={openTaskItem}
                            showWorkspaceName
                            showMapLink
                            showMapName
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {upcomingTasks.length > 0 && (
                  <div>
                    <p className="text-xs font-light text-muted-foreground mb-2 px-1 lowercase">Próximas</p>
                    <div className="bg-card rounded-3xl border border-border/60 shadow-sm overflow-hidden">
                      <div className="divide-y divide-border/50">
                        {upcomingTasks.map(task => (
                          <TaskListItem
                            key={task.id}
                            task={task}
                            members={membersByWorkspace[task.workspaceId] ?? []}
                            invalidateQueryKeys={[["/api/my-tasks"], countsQueryKey]}
                            onOpenDetail={openTaskItem}
                            showWorkspaceName
                            showMapLink
                            showMapName
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {openCard && (
        <CardPanel
          workspaceId={openCard.workspaceId}
          mapId={openCard.mapId}
          cardId={openCard.cardId}
          onClose={handleClosePanel}
          onDeleteCard={handleDeleteCardFromPanel}
        />
      )}

      <WorkspaceTaskSheet
        workspaceId={standaloneTask?.workspaceId ?? ""}
        taskId={standaloneTask?.id ?? null}
        open={!!standaloneTask}
        onClose={handleCloseSheet}
      />
    </AppLayout>
  );
}
