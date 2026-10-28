import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useListWorkspaceMembers, useGetMe, customFetch } from "@workspace/api-client-react";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@beeads/ui";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { TaskDetailModal } from "@/components/tasks/TaskDetailModal";
import { AssigneeFilterPills } from "@/components/tasks/AssigneeFilterPills";
import { TaskListItemMember, TaskListItemData } from "@/components/tasks/TaskListItem";
import { TaskTable } from "@/components/tasks/TaskTable";
import { groupTasksByDeadline, selectWindow, ateSextaLabel, type TimeWindow } from "@/lib/groupTasksByDeadline";
import { TimeWindowFilterPills } from "@/components/tasks/TimeWindowFilterPills";
import { TASK_STATUS_ORDER, TODOS_STATUS, statusFilterToApi } from "@/lib/taskStatusConstants";
import { TodosStatusPill } from "@/components/tasks/TodosStatusPill";
import { ViewModeToggle, type ViewMode } from "@/components/tasks/ViewModeToggle";
import { WeekCalendar } from "@/components/calendar/WeekCalendar";
import { changedMessage, workspaceRouteBase } from "@/lib/embedBridge";
import { postToEmbedParent } from "@/lib/embedParent";

const STATUS_OPTIONS = TASK_STATUS_ORDER;

/**
 * Aba "tarefas" do workspace: criar, filtros (status com contagens, janela de
 * prazo, visão lista/calendário, responsáveis), a lista/calendário e os dois
 * `TaskDetailModal` (tarefa de plano e tarefa avulsa).
 *
 * Renderizada pela página do workspace (`embedded={false}`) e pela rota
 * `/embed/workspaces/:wsId/tasks[/:taskId]` (`embedded`). No embed:
 * - as rotas ficam sob `/embed` (`workspaceRouteBase`) e fechar a tarefa
 *   volta para `/embed/workspaces/:id/tasks`, não para `?tab=tasks`;
 * - toda navegação é `replace` — o iframe não empilha histórico no painel;
 * - fechar um modal avisa o pai (`changed: tasks`) para ele recarregar.
 */
export function WorkspaceTasksPanel({
  workspaceId,
  deepLinkTaskId,
  embedded,
  onViewModeChange,
}: {
  workspaceId: string;
  deepLinkTaskId: string | null;
  embedded: boolean;
  /** A página do workspace estreita o padding lateral no modo calendário. */
  onViewModeChange?: (v: ViewMode) => void;
}) {
  const [location, navigate] = useLocation();
  const routeBase = workspaceRouteBase(workspaceId, location);
  const taskPath = (id: string) => `${routeBase}/tasks/${id}`;
  const listPath = embedded ? `${routeBase}/tasks` : `${routeBase}?tab=tasks`;

  const [selectedStatus, setSelectedStatus] = useState<string>("in_progress");
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>(["me"]);
  // Default "todas" no workspace — usuário pediu (decisão diferente da tela
  // de /my-tasks, que defaulta pra "hoje").
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("todas");
  const [viewMode, setViewMode] = useState<ViewMode>("lista");

  // Fallback caso o usuário esteja em "ate_sexta" quando o dia vira pra
  // sexta-feira (botão fica oculto).
  useEffect(() => {
    if (timeWindow === "ate_sexta" && ateSextaLabel() === null) {
      setTimeWindow("todas");
    }
  }, [timeWindow]);
  const [openCard, setOpenCard] = useState<{ workspaceId: string; mapId: string; cardId: string } | null>(null);
  const [taskSheetOpen, setTaskSheetOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const { data: workspaceMembers } = useListWorkspaceMembers(workspaceId);

  const { data: me } = useGetMe();
  const currentUserId = me?.id ?? "";

  const resolvedAssignees = selectedAssignees
    .map(a => (a === "me" ? currentUserId : a))
    .filter(Boolean);

  const tasksQueryKey = [`/api/workspaces/${workspaceId}/tasks`, selectedStatus, resolvedAssignees];
  const { data: workspaceTasks, isLoading: isTasksLoading } = useQuery<any[]>({
    queryKey: tasksQueryKey,
    queryFn: () => {
      const p = new URLSearchParams();
      p.set("status", statusFilterToApi(selectedStatus));
      if (resolvedAssignees.length > 0) p.set("assignedTo", resolvedAssignees.join(","));
      const qs = p.toString() ? `?${p.toString()}` : "";
      return customFetch(`/api/workspaces/${workspaceId}/tasks${qs}`);
    },
    enabled: !selectedAssignees.includes("me") || !!currentUserId,
  });

  const countsQueryKey = [`/api/workspaces/${workspaceId}/tasks/counts`, resolvedAssignees];
  const { data: statusCounts } = useQuery<Record<string, number>>({
    queryKey: countsQueryKey,
    queryFn: () => {
      const p = new URLSearchParams();
      if (resolvedAssignees.length > 0) p.set("assignedTo", resolvedAssignees.join(","));
      const qs = p.toString() ? `?${p.toString()}` : "";
      return customFetch(`/api/workspaces/${workspaceId}/tasks/counts${qs}`);
    },
    enabled: !selectedAssignees.includes("me") || !!currentUserId,
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const calendarExtraKeys = useMemo(() => [countsQueryKey, ["/api/my-tasks"]], [JSON.stringify(countsQueryKey)]);

  const queryClient = useQueryClient();

  const toggleAssignee = (id: string) => {
    setSelectedAssignees(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  const selectStatus = (value: string) => {
    setSelectedStatus(value);
  };

  const changeView = (v: ViewMode) => {
    setViewMode(v);
    onViewModeChange?.(v);
    if (v === "calendario") setSelectedStatus(TODOS_STATUS);
  };

  useEffect(() => {
    if (deepLinkTaskId) {
      // Always sync the open sheet to the URL — including when the user
      // navigates between tasks while a modal is already open (e.g. from
      // an approval task to its parent via "abrir tarefa principal").
      if (deepLinkTaskId !== editingTaskId) {
        setEditingTaskId(deepLinkTaskId);
        setTaskSheetOpen(true);
        setOpenCard(null);
      }
    } else {
      if (taskSheetOpen || openCard) {
        setTaskSheetOpen(false);
        setEditingTaskId(null);
        setOpenCard(null);
      }
    }
  }, [deepLinkTaskId]);

  const handleClosePanel = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/my-tasks"] });
    queryClient.invalidateQueries({ queryKey: tasksQueryKey });
    queryClient.invalidateQueries({ queryKey: countsQueryKey });
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks`] });
    setOpenCard(null);
    if (deepLinkTaskId) navigate(listPath, { replace: true });
    if (embedded) postToEmbedParent(changedMessage("tasks"));
  };

  const handleDeleteCardFromPanel = () => {
    setOpenCard(null);
    if (deepLinkTaskId) navigate(listPath, { replace: true });
  };

  const handleCloseTaskSheet = () => {
    queryClient.invalidateQueries({ queryKey: tasksQueryKey });
    queryClient.invalidateQueries({ queryKey: countsQueryKey });
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks`] });
    setTaskSheetOpen(false);
    setEditingTaskId(null);
    if (deepLinkTaskId) navigate(listPath, { replace: true });
    if (embedded) postToEmbedParent(changedMessage("tasks"));
  };

  const openTaskItem = (task: any) => {
    if (task.cardId && task.mapId) {
      setOpenCard({ workspaceId: task.workspaceId, mapId: task.mapId, cardId: task.cardId });
      navigate(taskPath(task.id), { replace: embedded });
    } else {
      setEditingTaskId(task.id);
      setTaskSheetOpen(true);
      navigate(taskPath(task.id), { replace: embedded });
    }
  };

  return (
    <>
      {/* Header row: filters + nova tarefa button */}
      <div className="flex flex-col gap-6 mb-12">
        <div className="flex justify-end">
          <Button
            variant="outline"
            className="rounded-xl h-10 px-5 shadow-md bg-background border-border/60 select-none cursor-pointer shrink-0 lowercase"
            onClick={() => { setEditingTaskId(null); setTaskSheetOpen(true); }}
          >
            <Plus className="w-4 h-4 mr-1.5" /> criar
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <TodosStatusPill
                active={selectedStatus === TODOS_STATUS}
                onSelect={() => selectStatus(TODOS_STATUS)}
              />
              {STATUS_OPTIONS.map(opt => {
                const isActive = selectedStatus === opt.value;
                const cnt = statusCounts?.[opt.value] ?? 0;
                const OptIcon = opt.icon;
                const ariaLabel = cnt === 1 ? opt.label : opt.labelPlural;
                // "Concluídas" e "canceladas" são estados terminais
                // — contador escondido pra reduzir ruído.
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
            {viewMode === "lista" && selectedStatus !== "completed" && selectedStatus !== "blocked" && (
              <TimeWindowFilterPills
                value={timeWindow}
                onChange={setTimeWindow}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ViewModeToggle value={viewMode} onChange={changeView} />
            {(workspaceMembers && workspaceMembers.length > 0) && (
              <AssigneeFilterPills
                members={(workspaceMembers ?? [])
                  .filter(m => m.userId !== currentUserId)
                  .map(m => ({ userId: m.userId, name: m.user.name, avatarUrl: m.user.avatarUrl }))}
                selected={selectedAssignees}
                onToggle={toggleAssignee}
                showMe
                meLabel="Eu"
                meAvatarUrl={(me as { avatarUrl?: string | null } | undefined)?.avatarUrl}
              />
            )}
          </div>
        </div>
      </div>

      {viewMode === "calendario" ? (
        <WeekCalendar
          scope={{ kind: "workspace", workspaceId }}
          status={selectedStatus}
          assignees={selectedAssignees}
          membersFor={() => (workspaceMembers ?? []).map(m => ({ userId: m.userId, user: { name: m.user.name, avatarUrl: m.user.avatarUrl ?? null } }))}
          extraInvalidateKeys={calendarExtraKeys}
          onOpenTask={openTaskItem}
        />
      ) : isTasksLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      ) : (() => {
        const detailMembers: TaskListItemMember[] = (workspaceMembers ?? []).map(m => ({
          userId: m.userId,
          name: m.user.name,
        }));

        // Em status terminais (completed/blocked) ordenamos pelo
        // timestamp de conclusão/cancelamento; em qualquer outro
        // estado o backend já devolve na ordem certa e o filtro
        // de janela escolhe um subset desse array.
        let flatTasks: TaskListItemData[];
        let dateColumnMode: "default" | "completed" | "cancelled" = "default";
        if (selectedStatus === "completed" || selectedStatus === "blocked") {
          const dateKey = selectedStatus === "completed" ? "completedAt" : "blockedSince";
          flatTasks = [...(workspaceTasks ?? [])].sort((a, b) => {
            const ta = a[dateKey] ? new Date(a[dateKey]).getTime() : 0;
            const tb = b[dateKey] ? new Date(b[dateKey]).getTime() : 0;
            return tb - ta;
          });
          dateColumnMode = selectedStatus === "completed" ? "completed" : "cancelled";
        } else if (timeWindow === "todas") {
          flatTasks = workspaceTasks ?? [];
        } else {
          const grouped = groupTasksByDeadline(workspaceTasks ?? []);
          flatTasks = selectWindow(grouped, timeWindow);
        }

        if (flatTasks.length === 0) {
          return (
            <div className="text-center py-24">
              <p className="text-muted-foreground lowercase">nada</p>
              <Button variant="outline" className="mt-6 rounded-xl h-10 px-5 shadow-md bg-background border-border/60 select-none cursor-pointer lowercase" onClick={() => { setEditingTaskId(null); setTaskSheetOpen(true); }}>
                <Plus className="w-4 h-4 mr-1.5" /> criar
              </Button>
            </div>
          );
        }

        return (
          <TaskTable
            sections={[{ label: "", tasks: flatTasks }]}
            members={detailMembers}
            invalidateQueryKeys={[tasksQueryKey, countsQueryKey, ["/api/my-tasks"]]}
            countsQueryKeys={[countsQueryKey]}
            onOpenDetail={openTaskItem}
            showMapName
            dateColumnMode={dateColumnMode}
          />
        );
      })()}

      {openCard && (
        <TaskDetailModal
          workspaceId={openCard.workspaceId}
          mapId={openCard.mapId}
          cardId={openCard.cardId}
          open={!!openCard}
          onClose={handleClosePanel}
          onDeleteCard={handleDeleteCardFromPanel}
          onDuplicated={(newTaskId) => {
            navigate(taskPath(newTaskId), { replace: embedded });
          }}
        />
      )}

      <TaskDetailModal
        workspaceId={workspaceId}
        taskId={editingTaskId}
        open={taskSheetOpen}
        onClose={handleCloseTaskSheet}
        onAutoCreated={(newTaskId) => {
          navigate(taskPath(newTaskId), { replace: embedded });
        }}
        onDuplicated={(newTaskId) => {
          navigate(taskPath(newTaskId), { replace: embedded });
        }}
      />
    </>
  );
}
