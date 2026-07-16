import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageBreadcrumb } from "@/components/layout/PageBreadcrumb";
import { DashboardGreeting } from "@/components/DashboardGreeting";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { Inbox, Plus, RotateCcw, Video } from "lucide-react";
import { TaskDetailModal } from "@/components/tasks/TaskDetailModal";
import { AssigneeFilterPills } from "@/components/tasks/AssigneeFilterPills";
import { TaskListItemMember, TaskListItemData } from "@/components/tasks/TaskListItem";
import { TaskTable } from "@/components/tasks/TaskTable";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@beeads/ui";
import { Empty, EmptyIcon, EmptyTitle, EmptyDescription } from "@beeads/ui";
import { TaskTableSkeleton } from "@/components/tasks/TaskTableSkeleton";
import { groupTasksByDeadline, selectWindow, type TimeWindow } from "@/lib/groupTasksByDeadline";
import { ateSextaLabel } from "@/lib/groupTasksByDeadline";
import { TimeWindowFilterPills } from "@/components/tasks/TimeWindowFilterPills";
import { AgendaPanel } from "@/components/tasks/AgendaPanel";
import { NewMeetingModal } from "@/components/meetings/NewMeetingModal";
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

const VALID_TIME_WINDOWS: TimeWindow[] = ["hoje", "ate_sexta", "todas"];
const VALID_STATUSES = new Set(STATUS_OPTIONS.map(o => o.value));

function readInitialFilters() {
  if (typeof window === "undefined") {
    return { status: "in_progress", window: "hoje" as TimeWindow, assignees: ["me"] };
  }
  const p = new URLSearchParams(window.location.search);
  const rawStatus = p.get("status");
  const rawWindow = p.get("window") as TimeWindow | null;
  const rawAssignees = p.get("assignees");
  return {
    status: rawStatus && VALID_STATUSES.has(rawStatus) ? rawStatus : "in_progress",
    window: rawWindow && VALID_TIME_WINDOWS.includes(rawWindow) ? rawWindow : ("hoje" as TimeWindow),
    assignees: rawAssignees ? rawAssignees.split(",").filter(Boolean) : ["me"],
  };
}

export default function MyTasksPage() {
  const initial = readInitialFilters();
  const [selectedStatus, setSelectedStatus] = useState<string>(initial.status);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>(initial.assignees);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(initial.window);

  // Sync filter state → URL (query string only, preserves path so deep links keep
  // working). Defaults are stripped so a clean URL like /my-tasks stays clean.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (selectedStatus === "in_progress") p.delete("status");
    else p.set("status", selectedStatus);
    if (timeWindow === "hoje") p.delete("window");
    else p.set("window", timeWindow);
    if (selectedAssignees.length === 1 && selectedAssignees[0] === "me") {
      p.delete("assignees");
    } else {
      p.set("assignees", selectedAssignees.join(","));
    }
    const qs = p.toString();
    const next = `${window.location.pathname}${qs ? "?" + qs : ""}`;
    if (window.location.pathname + window.location.search !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [selectedStatus, timeWindow, selectedAssignees]);

  // Se o usuário tinha "ate_sexta" selecionado quando o relógio virou pra
  // sexta-feira, o botão some — fallback automático pra "hoje".
  useEffect(() => {
    if (timeWindow === "ate_sexta" && ateSextaLabel() === null) {
      setTimeWindow("hoje");
    }
  }, [timeWindow]);
  const [openCard, setOpenCard] = useState<OpenCard | null>(null);
  const [standaloneTask, setStandaloneTask] = useState<StandaloneTask | null>(null);
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const [, navigate] = useLocation();
  const [, deepLinkParams] = useRoute("/my-tasks/tasks/:taskId");
  const deepLinkTaskId = deepLinkParams?.taskId ?? null;

  const selectStatus = (value: string) => {
    setSelectedStatus(value);
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

  const tasksQueryKey = ["/api/my-tasks", selectedStatus, selectedAssignees];
  const { data: tasks, isLoading } = useQuery<any[]>({
    queryKey: tasksQueryKey,
    queryFn: () => {
      const p = new URLSearchParams();
      p.set("status", selectedStatus);
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

  const [meetingModalOpen, setMeetingModalOpen] = useState(false);

  return (
    <AppLayout>
      <div className="flex-1 overflow-auto bg-slate-50 dark:bg-background">
        <div className="max-w-screen-2xl mx-auto p-8 lg:p-12">
          <PageBreadcrumb items={[{ label: "tarefas" }]} className="mb-4" />
          <div className="flex flex-col gap-6 mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div />
              <div className="flex items-center gap-2">
                <Button
                  title="nova reunião"
                  variant="outline"
                  className="rounded-xl h-12 w-12 p-0 hover:-translate-y-0.5 transition-all"
                  onClick={() => setMeetingModalOpen(true)}
                >
                  <Video className="w-5 h-5" />
                </Button>
                <Button
                  title="nova tarefa"
                  className="rounded-xl px-4 h-12 shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-all"
                  onClick={handleNewTaskClick}
                >
                  <Plus className="w-5 h-5" />
                </Button>
              </div>
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

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {STATUS_OPTIONS.map(opt => {
                    const isActive = selectedStatus === opt.value;
                    const cnt = statusCounts?.[opt.value] ?? 0;
                    const OptIcon = opt.icon;
                    const ariaLabel = cnt === 1 ? opt.label : opt.labelPlural;
                    // "Concluídas" e "canceladas" são estados terminais com
                    // crescimento ilimitado — o contador vira ruído, então é
                    // ocultado (mas o filtro continua clicável).
                    const showCount = opt.value !== "completed" && opt.value !== "blocked";
                    return (
                      <button
                        key={opt.value}
                        onClick={() => selectStatus(opt.value)}
                        title={showCount ? `${cnt} ${ariaLabel}` : opt.labelPlural}
                        aria-label={showCount ? `${cnt} ${ariaLabel}` : opt.labelPlural}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold border transition-all duration-150 cursor-pointer ${
                          isActive
                            ? opt.activeClass
                            : "bg-card text-muted-foreground border-border hover:border-slate-400 dark:hover:border-slate-600"
                        }`}
                      >
                        <OptIcon className="w-3.5 h-3.5" />
                        {showCount && <span>{cnt}</span>}
                      </button>
                    );
                  })}
                </div>
                {selectedStatus !== "completed" && selectedStatus !== "blocked" && (
                  <TimeWindowFilterPills
                    value={timeWindow}
                    onChange={setTimeWindow}
                  />
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
          </div>

          <div className="mb-6">
            <AgendaPanel />
          </div>

          {isLoading ? (
            <TaskTableSkeleton />
          ) : (() => {
            // Em status terminais (completed/blocked) ordenamos pelo timestamp
            // de conclusão/cancelamento; em qualquer outro estado o backend já
            // devolve na ordem certa (urgente → dueDate → priority) e o filtro
            // de janela escolhe um subset desse array.
            let flatTasks: TaskListItemData[];
            let dateColumnMode: "default" | "completed" | "cancelled" = "default";
            if (selectedStatus === "completed" || selectedStatus === "blocked") {
              const dateKey = selectedStatus === "completed" ? "completedAt" : "blockedSince";
              flatTasks = [...(tasks ?? [])].sort((a, b) => {
                const ta = a[dateKey] ? new Date(a[dateKey]).getTime() : 0;
                const tb = b[dateKey] ? new Date(b[dateKey]).getTime() : 0;
                return tb - ta;
              });
              dateColumnMode = selectedStatus === "completed" ? "completed" : "cancelled";
            } else if (timeWindow === "todas") {
              flatTasks = tasks ?? [];
            } else {
              const grouped = groupTasksByDeadline(tasks ?? []);
              flatTasks = selectWindow(grouped, timeWindow);
            }

            if (flatTasks.length === 0) {
              const hasNonDefaultFilters =
                selectedStatus !== "in_progress" ||
                timeWindow !== "todas" ||
                selectedAssignees.length !== 1 ||
                selectedAssignees[0] !== "me";
              const resetFilters = () => {
                setSelectedStatus("in_progress");
                setTimeWindow("todas");
                setSelectedAssignees(["me"]);
              };
              return (
                <Empty className="border border-dashed border-border/60 bg-card/30 my-8">
                  <EmptyIcon>
                    <Inbox />
                  </EmptyIcon>
                  <EmptyTitle className="lowercase">
                    {hasNonDefaultFilters ? "nada por aqui" : "tudo limpo"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {hasNonDefaultFilters
                      ? "nenhuma tarefa bate com esses filtros."
                      : "você não tem tarefas em andamento no momento."}
                  </EmptyDescription>
                  <div className="mt-4">
                    {hasNonDefaultFilters ? (
                      <Button variant="outline" size="sm" onClick={resetFilters}>
                        <RotateCcw className="w-4 h-4" />
                        limpar filtros
                      </Button>
                    ) : (
                      <Button size="sm" onClick={handleNewTaskClick}>
                        <Plus className="w-4 h-4" />
                        nova tarefa
                      </Button>
                    )}
                  </div>
                </Empty>
              );
            }

            return (
              <TaskTable
                sections={[{ label: "", tasks: flatTasks }]}
                getMembers={task => membersByWorkspace[task.workspaceId] ?? []}
                invalidateQueryKeys={[["/api/my-tasks"], countsQueryKey]}
                countsQueryKeys={[countsQueryKey]}
                onOpenDetail={openTaskItem}
                showWorkspaceName
                showMapName
                dateColumnMode={dateColumnMode}
                compactSchedule={selectedStatus === "in_progress"}
              />
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

      <NewMeetingModal open={meetingModalOpen} onOpenChange={setMeetingModalOpen} />
    </AppLayout>
  );
}
