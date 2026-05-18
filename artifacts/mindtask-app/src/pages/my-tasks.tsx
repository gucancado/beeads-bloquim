import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageBreadcrumb } from "@/components/layout/PageBreadcrumb";
import { DashboardGreeting } from "@/components/DashboardGreeting";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { Loader2, Plus } from "lucide-react";
import { TaskDetailModal } from "@/components/tasks/TaskDetailModal";
import { AssigneeFilterPills } from "@/components/tasks/AssigneeFilterPills";
import { TaskListItem, TaskListItemMember } from "@/components/tasks/TaskListItem";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { groupTasksByDeadline } from "@/lib/groupTasksByDeadline";
import { AgendaPanel } from "@/components/tasks/AgendaPanel";
import { useRoute, useLocation } from "wouter";
import { TASK_STATUS_ORDER } from "@/lib/taskStatusConstants";

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

const STATUS_OPTIONS = TASK_STATUS_ORDER;

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
      // Janela "hoje" no fuso do navegador — o server roda em UTC.
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      p.set("dayStart", dayStart.toISOString());
      p.set("dayEnd", dayEnd.toISOString());
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
          const wsId = deepLinkTaskMeta?.workspaceId ?? "";
          setStandaloneTask({ workspaceId: wsId, id: deepLinkTaskId, mapId: null, cardId: null, title: "" });
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
    if (task.workspaceId && task.cardId && task.mapId) {
      setOpenCard({ workspaceId: task.workspaceId, mapId: task.mapId, cardId: task.cardId });
      navigate(`/my-tasks/tasks/${task.id}`);
    } else {
      setStandaloneTask({ workspaceId: task.workspaceId ?? "", id: task.id, mapId: task.mapId, cardId: task.cardId, title: task.title });
      navigate(`/my-tasks/tasks/${task.id}`);
    }
  };

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
          <PageBreadcrumb items={[{ label: "tarefas" }]} className="mb-4" />
          <div className="flex flex-col gap-6 mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div />
              <Button
                title="nova tarefa"
                className="rounded-xl px-4 h-12 shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-all"
                onClick={handleNewTaskClick}
              >
                <Plus className="w-5 h-5" />
              </Button>
            </div>

            {me && (me as { createdAt?: string }).createdAt && (
              <DashboardGreeting
                name={me.name}
                createdAt={(me as { createdAt: string }).createdAt}
                tasksDueToday={statusCounts?.dueToday ?? 0}
                overdueTasks={statusCounts?.overdue ?? 0}
                className="text-base font-light lowercase text-foreground/80 text-center"
              />
            )}

            <div className="flex flex-wrap items-center justify-center gap-2">
              <AssigneeFilterPills
                members={Array.from(new Map((members ?? []).filter(m => m.userId !== undefined && m.userId !== me?.id).map(m => [m.userId, { userId: m.userId, name: m.name, avatarUrl: m.avatarUrl }])).values())}
                selected={selectedAssignees}
                onToggle={toggleAssignee}
                showMe
                meLabel="Eu"
                meAvatarUrl={(me as { avatarUrl?: string | null } | undefined)?.avatarUrl}
              />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {STATUS_OPTIONS.map(opt => {
                const isActive = selectedStatuses.includes(opt.value);
                const cnt = statusCounts?.[opt.value] ?? 0;
                const OptIcon = opt.icon;
                const ariaLabel = cnt > 1 ? opt.labelPlural : opt.label;
                return (
                  <button
                    key={opt.value}
                    onClick={() => toggleStatus(opt.value)}
                    title={`${cnt} ${ariaLabel}`}
                    aria-label={`${cnt} ${ariaLabel}`}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold border transition-all duration-150 cursor-pointer ${
                      isActive
                        ? opt.activeClass
                        : "bg-card text-muted-foreground border-border hover:border-slate-400 dark:hover:border-slate-600"
                    }`}
                  >
                    <OptIcon className="w-3.5 h-3.5" />
                    <span>{cnt}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mb-6">
            <AgendaPanel />
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
            </div>
          ) : tasks?.length === 0 ? (
            <div className="text-center py-24">
              <p className="text-muted-foreground lowercase">nada.</p>
            </div>
          ) : (() => {
            const now = new Date();
            const isFriday = now.getDay() === 5;
            const { today: todayTasks, untilFriday: untilFridayTasks, upcoming: upcomingTasks, noDueDate: noDueDateTasks } = groupTasksByDeadline(tasks ?? [], now);

            type TaskItem = NonNullable<typeof tasks>[number];
            const renderSection = (label: string, sectionTasks: TaskItem[]) => (
              <div>
                <p className="text-xs font-light text-muted-foreground mb-2 text-center lowercase">{label}</p>
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
                  <p className="text-xs font-light text-muted-foreground text-center lowercase">nada até sexta</p>
                )}
                {showNadaHoje && (
                  <p className="text-xs font-light text-muted-foreground text-center lowercase">nada pra hoje</p>
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
          onDuplicated={(newTaskId) => {
            navigate(`/my-tasks/tasks/${newTaskId}`);
          }}
        />
      )}

      <TaskDetailModal
        workspaceId={standaloneTask?.workspaceId ?? ""}
        taskId={standaloneTask?.id ?? null}
        open={!!standaloneTask}
        onClose={handleCloseSheet}
        onDuplicated={(newTaskId) => {
          navigate(`/my-tasks/tasks/${newTaskId}`);
        }}
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
