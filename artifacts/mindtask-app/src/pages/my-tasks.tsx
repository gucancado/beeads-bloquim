import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { CheckSquare, Loader2, Plus } from "lucide-react";
import { TaskDetailModal } from "@/components/tasks/TaskDetailModal";
import { AssigneeFilterPills } from "@/components/tasks/AssigneeFilterPills";
import { TaskListItem, TaskListItemMember } from "@/components/tasks/TaskListItem";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { groupTasksByDeadline } from "@/lib/groupTasksByDeadline";
import { useRoute, useLocation } from "wouter";

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
  { value: "draft",       label: "rascunho",       labelPlural: "rascunhos",      activeClass: "bg-purple-50 text-purple-700 border-purple-300 hover:bg-purple-100 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800 dark:hover:bg-purple-950/60"   },
  { value: "pending",     label: "pendente",       labelPlural: "pendentes",      activeClass: "bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-950/60"             },
  { value: "in_progress", label: "em andamento",  labelPlural: "em andamento",   activeClass: "bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-950/60"     },
  { value: "completed",   label: "concluída",      labelPlural: "concluídas",     activeClass: "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950/60" },
  { value: "blocked",     label: "cancelada",      labelPlural: "canceladas",     activeClass: "bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700 dark:hover:bg-slate-800/60"      },
];

export default function MyTasksPage() {
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["in_progress"]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>(["me"]);
  const [openCard, setOpenCard] = useState<OpenCard | null>(null);
  const [standaloneTask, setStandaloneTask] = useState<StandaloneTask | null>(null);
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const [, navigate] = useLocation();
  const [, deepLinkParams] = useRoute("/my-tasks/tasks/:taskId");
  const deepLinkTaskId = deepLinkParams?.taskId ?? null;

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

  const { data: members } = useQuery<{ userId: string; name: string; workspaceId: string; avatarUrl?: string | null }[]>({
    queryKey: ["/api/my-tasks/members"],
    queryFn: () => customFetch("/api/my-tasks/members"),
  });

  const [createSheetOpen, setCreateSheetOpen] = useState(false);

  const handleNewTaskClick = () => {
    setCreateSheetOpen(true);
  };

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

  const { data: deepLinkTaskMeta } = useQuery<{ id: string; workspaceId: string | null } | null>({
    queryKey: ["/api/my-tasks/task-meta", deepLinkTaskId],
    queryFn: async () => {
      if (!deepLinkTaskId) return null;
      try {
        return await customFetch<{ id: string; workspaceId: string | null }>(`/api/my-tasks/${deepLinkTaskId}/meta`);
      } catch {
        return null;
      }
    },
    enabled: !!deepLinkTaskId,
    retry: false,
  });

  useEffect(() => {
    if (deepLinkTaskId) {
      if (!standaloneTask && !openCard && !createSheetOpen) {
        if (deepLinkTaskMeta !== undefined) {
          if (deepLinkTaskMeta && deepLinkTaskMeta.workspaceId) {
            navigate(`/workspaces/${deepLinkTaskMeta.workspaceId}/tasks/${deepLinkTaskId}`, { replace: true });
          } else {
            setStandaloneTask({ workspaceId: "", id: deepLinkTaskId, mapId: null, cardId: null, title: "" });
          }
        }
      }
    } else {
      if (standaloneTask || openCard) {
        setStandaloneTask(null);
        setOpenCard(null);
      }
    }
  }, [deepLinkTaskId, deepLinkTaskMeta, createSheetOpen]);

  const handleClosePanel = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/my-tasks"] });
    queryClient.invalidateQueries({ queryKey: countsQueryKey });
    setOpenCard(null);
    if (deepLinkTaskId) navigate("/my-tasks", { replace: true });
  };

  const handleDeleteCardFromPanel = () => {
    setOpenCard(null);
    if (deepLinkTaskId) navigate("/my-tasks", { replace: true });
  };

  const handleCloseSheet = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/my-tasks"] });
    queryClient.invalidateQueries({ queryKey: countsQueryKey });
    setStandaloneTask(null);
    if (deepLinkTaskId) navigate("/my-tasks", { replace: true });
  };

  const handleCloseCreateSheet = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/my-tasks"] });
    queryClient.invalidateQueries({ queryKey: countsQueryKey });
    setCreateSheetOpen(false);
    if (deepLinkTaskId) navigate("/my-tasks", { replace: true });
  };

  const openTaskItem = (task: any) => {
    if (task.workspaceId) {
      navigate(`/workspaces/${task.workspaceId}/tasks/${task.id}`);
    } else if (task.cardId && task.mapId) {
      setOpenCard({ workspaceId: task.workspaceId, mapId: task.mapId, cardId: task.cardId });
      navigate(`/my-tasks/tasks/${task.id}`);
    } else {
      setStandaloneTask({ workspaceId: task.workspaceId ?? "", id: task.id, mapId: task.mapId, cardId: task.cardId, title: task.title });
      navigate(`/my-tasks/tasks/${task.id}`);
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-4xl font-display font-bold text-foreground lowercase">Suas tarefas</h1>
              </div>
              <Button
                title="nova tarefa"
                className="rounded-xl px-4 h-12 shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-all"
                onClick={handleNewTaskClick}
              >
                <Plus className="w-5 h-5" />
              </Button>
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
              <AssigneeFilterPills
                members={Array.from(new Map((members ?? []).filter(m => m.userId !== undefined && m.userId !== me?.id).map(m => [m.userId, { userId: m.userId, name: m.name, avatarUrl: m.avatarUrl }])).values())}
                selected={selectedAssignees}
                onToggle={toggleAssignee}
                showMe
                meLabel="Eu"
                meAvatarUrl={(me as { avatarUrl?: string | null } | undefined)?.avatarUrl}
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
            const now = new Date();
            const isFriday = now.getDay() === 5;
            const { today: todayTasks, untilFriday: untilFridayTasks, upcoming: upcomingTasks, noDueDate: noDueDateTasks } = groupTasksByDeadline(tasks ?? [], now);

            type TaskItem = NonNullable<typeof tasks>[number];
            const renderSection = (label: string, sectionTasks: TaskItem[]) => (
              <div>
                <p className="text-xs font-light text-muted-foreground mb-2 px-1 lowercase">{label}</p>
                <div className="bg-card rounded-3xl border border-border/60 shadow-sm overflow-hidden">
                  <div className="divide-y divide-border/50">
                    {sectionTasks.map(task => (
                      <TaskListItem
                        key={task.id}
                        task={task}
                        members={membersByWorkspace[task.workspaceId] ?? []}
                        invalidateQueryKeys={[["/api/my-tasks"], countsQueryKey]}
                        countsQueryKeys={[countsQueryKey]}
                        onOpenDetail={openTaskItem}
                        showWorkspaceName
                        showMapName
                      />
                    ))}
                  </div>
                </div>
              </div>
            );

            const showNadaAteSexta = !isFriday && todayTasks.length === 0 && untilFridayTasks.length === 0;
            const showNadaHoje = !showNadaAteSexta && todayTasks.length === 0;

            return (
              <div className="flex flex-col gap-6">
                {showNadaAteSexta && (
                  <p className="text-xs font-light text-muted-foreground px-1 lowercase">nada até sexta</p>
                )}
                {showNadaHoje && (
                  <p className="text-xs font-light text-muted-foreground px-1 lowercase">nada pra hoje</p>
                )}
                {todayTasks.length > 0 && renderSection("hoje", todayTasks)}
                {untilFridayTasks.length > 0 && renderSection("até sexta", untilFridayTasks)}
                {upcomingTasks.length > 0 && renderSection("próximas", upcomingTasks)}
                {noDueDateTasks.length > 0 && renderSection("sem prazo", noDueDateTasks)}
              </div>
            );
          })()}
        </div>
      </div>

      {openCard && (
        <TaskDetailModal
          workspaceId={openCard.workspaceId}
          mapId={openCard.mapId}
          cardId={openCard.cardId}
          open={!!openCard}
          onClose={handleClosePanel}
          onDeleteCard={handleDeleteCardFromPanel}
        />
      )}

      <TaskDetailModal
        workspaceId={standaloneTask?.workspaceId ?? ""}
        taskId={standaloneTask?.id ?? null}
        open={!!standaloneTask}
        onClose={handleCloseSheet}
      />

      <TaskDetailModal
        workspaceId=""
        taskId={null}
        open={createSheetOpen}
        onClose={handleCloseCreateSheet}
        onAutoCreated={(newTaskId) => {
          navigate(`/my-tasks/tasks/${newTaskId}`, { replace: true });
        }}
      />
    </AppLayout>
  );
}
