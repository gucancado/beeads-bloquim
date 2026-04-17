import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DescriptionEditor } from "@/components/tasks/DescriptionEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Trash2, Copy, Flag, Calendar, User, AlertTriangle, Briefcase, ChevronDown, LayoutDashboard } from "lucide-react";
import { RecurrencePanel } from "@/components/tasks/RecurrencePanel";
import type { RecurrenceConfig } from "@/components/tasks/RecurrencePanel";
import { TASK_STATUS_ORDER } from "@/lib/taskStatusConstants";
import { useToast } from "@/hooks/use-toast";
import {
  customFetch,
  useGetMe,
  useGetCard,
  useUpdateCard,
  useCreateTask,
  useUpdateTaskDetails,
  useUpdateTaskStatus,
  useListWorkspaceMembers,
  useDeleteCard,
} from "@workspace/api-client-react";
import type { WorkspaceMemberResponse, TaskPriority, TaskStatus, TaskResponse } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CommentsSection } from "@/components/maps/CommentsSection";
import { ApprovalTaskView } from "@/components/tasks/ApprovalTaskView";
import { AttachmentsSection } from "@/components/tasks/AttachmentsSection";
import { PriorityBadge } from "@/components/tasks/PriorityBadge";
import { AssigneeAvatarPicker } from "@/components/tasks/AssigneeAvatarPicker";
import { ApprovalSection } from "@/components/tasks/approval/ApprovalSection";
import { TaskDeleteDialog } from "@/components/tasks/TaskDeleteDialog";
import { SubtasksList } from "@/components/tasks/subtasks/SubtasksList";
import { TaskAssociationSelector } from "@/components/tasks/association/TaskAssociationSelector";
import { TaskHeaderActions } from "@/components/tasks/TaskHeaderActions";
import { useTaskAssociation } from "@/components/tasks/association/useTaskAssociation";
import { useSubtasksState } from "@/components/tasks/subtasks/useSubtasksState";
import { useAutoCreateTask } from "@/components/tasks/useAutoCreateTask";
import { RecurrencePopover } from "@/components/tasks/RecurrencePopover";

interface TaskResponseExtended extends TaskResponse {
  overdue?: boolean;
  previousStatus?: string | null;
  isApprovalTask?: boolean;
  parentTaskId?: string | null;
  parentApprovalStatus?: string | null;
}

interface WorkspaceTask {
  id: string;
  workspaceId: string | null;
  mapId: string | null;
  title: string;
  description: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  priority: string;
  status: string;
  previousStatus?: string | null;
  overdue?: boolean;
  isApprovalTask?: boolean;
  parentTaskId?: string | null;
  parentApprovalStatus?: string | null;
  isRecurring?: boolean;
  recurrenceConfig?: RecurrenceConfig | null;
}

interface UpdateTaskPayload {
  title?: string;
  description?: string | null;
  assignedTo?: string | null;
  priority?: string;
  dueDate?: string | null;
  isRecurring?: boolean;
  recurrenceConfig?: RecurrenceConfig | null;
}

interface CreateTaskPayload {
  title: string;
  description?: string | null;
  assignedTo?: string | null;
  priority?: string;
  dueDate?: string | null;
}

interface TaskDetailModalProps {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
  taskId?: string | null;
  onAutoCreated?: (taskId: string) => void;

  mapId?: string;
  cardId?: string | null;
  onDeleteCard?: (cardId: string) => void;
  onDuplicated?: (newTaskId: string, newCardId: string | null) => void;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}

export function TaskDetailModal({
  workspaceId: propWorkspaceId,
  open,
  onClose,
  taskId = null,
  onAutoCreated,
  mapId,
  cardId = null,
  onDeleteCard,
  onDuplicated,
}: TaskDetailModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isCardMode = !!(mapId && cardId);

  const { data: me } = useGetMe({ query: { enabled: open } });
  const currentUserId = me?.id ?? "";

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("unassigned");
  const [priority, setPriority] = useState<string>("medium");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<string>("pending");
  const [showDelete, setShowDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceConfig, setRecurrenceConfig] = useState<RecurrenceConfig | null>(null);
  const [showRecurrencePanel, setShowRecurrencePanel] = useState(false);
  const initializedForTaskRef = useRef<string | null>(null);
  const [dialogContentEl, setDialogContentEl] = useState<HTMLDivElement | null>(null);
  const dialogContentCallbackRef = useCallback((el: HTMLDivElement | null) => setDialogContentEl(el), []);

  // Forward refs to bridge auto-create <-> association <-> invalidateTask without TDZ.
  const setTaskWorkspaceIdRef = useRef<(v: string | null) => void>(() => {});
  const invalidateTaskRef = useRef<() => void>(() => {});

  const auto = useAutoCreateTask({
    open,
    isCardMode,
    taskId,
    propWorkspaceId,
    currentUserId,
    setTitle,
    setAssignedTo,
    setTaskWorkspaceId: (v) => setTaskWorkspaceIdRef.current(v),
    invalidateTask: () => invalidateTaskRef.current(),
    onAutoCreated,
  });

  const isEditing = isCardMode ? true : !!(taskId || auto.autoCreatedTaskId);
  const resolvedTaskId = taskId || auto.autoCreatedTaskId;

  const markDirty = () => { if (auto.autoCreatedTaskId) auto.setAutoCreateDirty(true); };

  useEffect(() => {
    if (!open) {
      setIsRecurring(false);
      setRecurrenceConfig(null);
      setShowRecurrencePanel(false);
    }
  }, [open]);

  const {
    showMore,
    setShowMore,
    setTaskWorkspaceId,
    taskMapId,
    setTaskMapId,
    effectiveWorkspaceId,
    userWorkspaces,
    workspaceMaps,
    changeWorkspace,
    changeMap,
  } = useTaskAssociation({
    resolvedTaskId,
    propWorkspaceId,
    currentUserId,
    open,
    isCardMode,
    markDirty,
    setAssignedTo,
    setIsRecurring,
    setRecurrenceConfig,
    setShowRecurrencePanel,
  });

  setTaskWorkspaceIdRef.current = setTaskWorkspaceId;

  const { data: rawCard, isLoading: isCardLoading } = useGetCard(effectiveWorkspaceId, mapId ?? "", cardId ?? "", {
    query: { enabled: isCardMode && open && !!cardId }
  });

  const card = rawCard as (Omit<typeof rawCard, "task"> & { task?: TaskResponseExtended | null }) | undefined;

  const taskIdResolved: string | undefined = isCardMode ? (card?.task?.id ?? undefined) : (resolvedTaskId ?? undefined);

  // isStandalone is derived from the PROP, not effectiveWorkspaceId.
  // effectiveWorkspaceId can change mid-flight (once taskWorkspaceId resolves),
  // which would switch the query key and trigger a 403 workspace fetch for
  // users who are assigned a task but not workspace members.
  const isStandalone = !propWorkspaceId;

  const {
    subtasks,
    setSubtasks,
    sensors,
    inputRefs,
    addSubtask,
    handleChange,
    handleToggle,
    handleBlur,
    handleKeyDown,
    handleDragEnd,
    flushPending,
  } = useSubtasksState({
    taskIdResolved,
    effectiveWorkspaceId,
    open,
    markDirty,
  });

  const { data: task, isLoading: isTaskLoading, error: taskError } = useQuery<WorkspaceTask>({
    queryKey: isStandalone
      ? [`/api/my-tasks/${resolvedTaskId}`]
      : [`/api/workspaces/${effectiveWorkspaceId}/tasks/${resolvedTaskId}`],
    queryFn: () => customFetch(isStandalone ? `/api/my-tasks/${resolvedTaskId}` : `/api/workspaces/${effectiveWorkspaceId}/tasks/${resolvedTaskId}`),
    enabled: !isCardMode && isEditing && open && !!resolvedTaskId,
    retry: false,
  });
  const taskNotFound = !isTaskLoading && !!taskError && !task;
  const taskErrorStatus = taskError && typeof (taskError as { status?: unknown }).status === "number" ? (taskError as { status: number }).status : 0;

  const { data: cardModeMembers } = useListWorkspaceMembers(effectiveWorkspaceId, {
    query: { enabled: open && isCardMode }
  });

  const { data: taskModeMembers } = useQuery<WorkspaceMemberResponse[]>({
    queryKey: [`/api/workspaces/${effectiveWorkspaceId}/members`],
    queryFn: () => customFetch(`/api/workspaces/${effectiveWorkspaceId}/members`),
    enabled: open && !!effectiveWorkspaceId && !isCardMode,
  });

  const members: WorkspaceMemberResponse[] | undefined = isCardMode ? cardModeMembers : taskModeMembers;

  const isAdmin = (members?.find((m) => m.userId === currentUserId)?.role === "admin") || false;

  useEffect(() => {
    if (isCardMode && card) {
      setTitle(card.title);
      setDescription(card.description ?? "");
      if (card.task) {
        setPriority(card.task.priority);
        setStatus(card.task.status);
        setAssignedTo(card.task.assignedTo ?? "unassigned");
        setDueDate(card.task.dueDate ? card.task.dueDate.slice(0, 10) : "");
      } else {
        setPriority("medium");
        setStatus("pending");
        setAssignedTo("unassigned");
        setDueDate("");
      }
    }
  }, [card, isCardMode]);

  useEffect(() => {
    if (!isCardMode) {
      if (task && isEditing && task.id === resolvedTaskId) {
        if (initializedForTaskRef.current !== resolvedTaskId) {
          initializedForTaskRef.current = resolvedTaskId;
          setTitle(task.title ?? "");
          setDescription(task.description ?? "");
          setAssignedTo(task.assignedTo ?? "unassigned");
          setPriority(task.priority ?? "medium");
          setDueDate(task.dueDate ? task.dueDate.split("T")[0] : "");
          setStatus(task.status ?? "pending");
          setTaskWorkspaceId(task.workspaceId ?? null);
          setTaskMapId(task.mapId ?? null);
          setIsRecurring(task.isRecurring ?? false);
          setRecurrenceConfig(task.recurrenceConfig ?? null);
          if (task.isRecurring && task.recurrenceConfig) {
            setShowRecurrencePanel(true);
          }
        }
      } else if (!isEditing) {
        initializedForTaskRef.current = null;
        setTitle("");
        setDescription("");
        setAssignedTo("unassigned");
        setPriority("medium");
        setDueDate("");
        setStatus("pending");
        setSubtasks([]);
        setIsRecurring(false);
        setRecurrenceConfig(null);
        setShowRecurrencePanel(false);
      }
    }
  }, [task, isEditing, open, isCardMode, resolvedTaskId]);

  const invalidateCard = () => {
    if (!mapId || !cardId) return;
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${effectiveWorkspaceId}/maps/${mapId}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${effectiveWorkspaceId}/maps/${mapId}/cards/${cardId}`] });
    if (taskIdResolved) {
      queryClient.invalidateQueries({ queryKey: [`task-activities`, effectiveWorkspaceId, taskIdResolved] });
    }
  };

  const invalidateTask = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/my-tasks"] });
    if (effectiveWorkspaceId) {
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${effectiveWorkspaceId}/tasks`] });
    }
  };

  const updateCardMut = useUpdateCard();
  const updateTaskDetailsMut = useUpdateTaskDetails();
  const updateTaskStatusMut = useUpdateTaskStatus();
  const createTaskMut = useCreateTask();
  const deleteCardMut = useDeleteCard();

  useEffect(() => {
    if (isCardMode && card && !card.task && cardId && !createTaskMut.isPending) {
      createTaskMut.mutate(
        { workspaceId: effectiveWorkspaceId, mapId: mapId!, cardId, data: { title: card.title, priority: "medium" } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${effectiveWorkspaceId}/maps/${mapId}`] });
            queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${effectiveWorkspaceId}/maps/${mapId}/cards/${cardId}`] });
          }
        }
      );
    }
  }, [card, cardId, isCardMode]);

  const saveCard = () => {
    if (!cardId || !mapId) return;
    updateCardMut.mutate(
      { workspaceId: effectiveWorkspaceId, mapId, cardId, data: { title, description } },
      { onSuccess: () => invalidateCard() }
    );
  };

  const saveCardTaskDetails = (overrides: { priority?: string; assignedTo?: string; dueDate?: string } = {}) => {
    if (!cardId || !mapId || !card?.task) return;
    const p = (overrides.priority ?? priority) as TaskPriority;
    const a = overrides.assignedTo ?? assignedTo;
    const d = overrides.dueDate ?? dueDate;
    updateTaskDetailsMut.mutate(
      {
        workspaceId: effectiveWorkspaceId, mapId, cardId, data: {
          title,
          priority: p,
          assignedTo: a === "unassigned" ? null : a,
          dueDate: d ? d + "T12:00:00.000Z" : null,
        }
      },
      { onSuccess: () => invalidateCard() }
    );
  };

  const handleCardStatusChange = (val: string) => {
    if (!cardId || !mapId || !card?.task) return;
    setStatus(val);
    updateTaskStatusMut.mutate(
      { workspaceId: effectiveWorkspaceId, mapId, cardId, data: { status: val as TaskStatus } },
      { onSuccess: () => invalidateCard() }
    );
  };

  const handleDeleteCard = () => {
    if (!cardId || !mapId) return;
    const deletedId = cardId;
    deleteCardMut.mutate(
      { workspaceId: effectiveWorkspaceId, mapId, cardId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${effectiveWorkspaceId}/maps/${mapId}`] });
          queryClient.invalidateQueries({ queryKey: ["/api/my-tasks"] });
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${effectiveWorkspaceId}/tasks`] });
          toast({ title: "Card removido do plano." });
          onClose();
          onDeleteCard?.(deletedId);
        },
        onError: () => toast({ title: "Erro ao deletar card.", variant: "destructive" }),
      }
    );
  };

  interface SaveMutationInput {
    body: UpdateTaskPayload;
    taskId: string;
    standalone: boolean;
    wsId: string;
  }

  const saveMutation = useMutation({
    mutationFn: ({ body, taskId, standalone, wsId }: SaveMutationInput) =>
      customFetch(standalone ? `/api/my-tasks/${taskId}` : `/api/workspaces/${wsId}/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (_, { taskId, standalone, wsId }) => {
      invalidateTask();
      if (standalone) {
        queryClient.invalidateQueries({ queryKey: [`/api/my-tasks/${taskId}`] });
        queryClient.invalidateQueries({ queryKey: [`task-activities`, "standalone", taskId] });
      } else {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${wsId}/tasks/${taskId}`] });
        queryClient.invalidateQueries({ queryKey: [`task-activities`, wsId, taskId] });
      }
    },
    onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
  });

  interface StatusMutationInput {
    newStatus: string;
    taskId: string;
    standalone: boolean;
    wsId: string;
    currentIsRecurring?: boolean;
    currentRecurrenceConfig?: RecurrenceConfig | null;
  }

  const statusMutation = useMutation({
    mutationFn: ({ newStatus, taskId, standalone, wsId, currentIsRecurring, currentRecurrenceConfig }: StatusMutationInput) => {
      const body: Record<string, unknown> = { status: newStatus };
      if (currentIsRecurring !== undefined) body.isRecurring = currentIsRecurring;
      if (currentRecurrenceConfig !== undefined) body.recurrenceConfig = currentRecurrenceConfig ?? null;
      return customFetch(standalone ? `/api/my-tasks/${taskId}/status` : `/api/workspaces/${wsId}/tasks/${taskId}/status`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: (_, { taskId, standalone, wsId }) => {
      invalidateTask();
      if (standalone) {
        queryClient.invalidateQueries({ queryKey: [`/api/my-tasks/${taskId}`] });
        queryClient.invalidateQueries({ queryKey: [`task-activities`, "standalone", taskId] });
      } else {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${wsId}/tasks/${taskId}`] });
        queryClient.invalidateQueries({ queryKey: [`task-activities`, wsId, taskId] });
      }
    },
    onError: () => toast({ title: "Erro ao atualizar status", variant: "destructive" }),
  });

  invalidateTaskRef.current = invalidateTask;

  const handleSaveTask = () => {
    if (!resolvedTaskId) return;
    const payload: UpdateTaskPayload = {
      title, description: description || null,
      priority, dueDate: dueDate || null,
      isRecurring,
      recurrenceConfig: recurrenceConfig ?? null,
    };
    if (!isStandalone) {
      payload.assignedTo = assignedTo === "unassigned" ? null : assignedTo;
    }
    saveMutation.mutate({ body: payload, taskId: resolvedTaskId, standalone: isStandalone, wsId: effectiveWorkspaceId });
    flushPending();
  };

  const handleStatusChange = (newStatus: string) => {
    if (!isEditing) return;
    if (!isCardMode && !resolvedTaskId) return;
    setStatus(newStatus);
    markDirty();
    if (isCardMode) handleCardStatusChange(newStatus);
    else statusMutation.mutate({
      newStatus,
      taskId: resolvedTaskId!,
      standalone: isStandalone,
      wsId: effectiveWorkspaceId,
      currentIsRecurring: isRecurring,
      currentRecurrenceConfig: recurrenceConfig,
    });
  };

  const handleConcluir = () => {
    if (!isEditing || !resolvedTaskId) return;
    markDirty();
    const previousStatus = isCardMode
      ? (card?.task?.previousStatus ?? "pending")
      : (task?.previousStatus ?? "pending");
    if (status === "completed") {
      setStatus(previousStatus);
      if (isCardMode) handleCardStatusChange(previousStatus);
      else statusMutation.mutate({ newStatus: previousStatus, taskId: resolvedTaskId, standalone: isStandalone, wsId: effectiveWorkspaceId });
    } else {
      setStatus("completed");
      if (isCardMode) handleCardStatusChange("completed");
      else statusMutation.mutate({
        newStatus: "completed",
        taskId: resolvedTaskId,
        standalone: isStandalone,
        wsId: effectiveWorkspaceId,
        currentIsRecurring: isRecurring,
        currentRecurrenceConfig: recurrenceConfig,
      });
    }
  };

  const handleDelete = async () => {
    if (isCardMode) {
      handleDeleteCard();
      setShowDelete(false);
      return;
    }
    if (!resolvedTaskId) return;
    setIsDeleting(true);
    try {
      const deletePath = isStandalone ? `/api/my-tasks/${resolvedTaskId}` : `/api/workspaces/${effectiveWorkspaceId}/tasks/${resolvedTaskId}`;
      await customFetch(deletePath, { method: "DELETE" });
      toast({ title: "Tarefa excluída" });
      invalidateTask();
      onClose();
    } catch {
      toast({ title: "Erro ao excluir tarefa", variant: "destructive" });
    } finally {
      setIsDeleting(false);
      setShowDelete(false);
    }
  };

  const handleDuplicate = async () => {
    const dupWorkspaceId = effectiveWorkspaceId;
    const dupTaskId = isCardMode ? (card?.task?.id ?? null) : resolvedTaskId;
    if (!dupWorkspaceId || !dupTaskId) return;
    setIsDuplicating(true);
    try {
      const result = await customFetch(`/api/workspaces/${dupWorkspaceId}/tasks/${dupTaskId}/duplicate`, { method: "POST" });
      const newTaskId = result.id as string;
      const newCardId = (result.cardId as string | null) ?? null;
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${dupWorkspaceId}/tasks`] });
      if (mapId) queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${dupWorkspaceId}/maps/${mapId}`] });
      onClose();
      onDuplicated?.(newTaskId, newCardId);
    } catch {
      toast({ title: "Erro ao duplicar tarefa", variant: "destructive" });
    } finally {
      setIsDuplicating(false);
    }
  };

  const handleCloseModal = async () => {
    if (showDelete || isDeleting || deleteCardMut.isPending) return;
    if (isCardMode) { saveCard(); if (card?.task) saveCardTaskDetails(); }
    else if (isEditing && resolvedTaskId) {
      if (auto.autoCreatedTaskId && !auto.autoCreateDirty) {
        try {
          const delPath = isStandalone
            ? `/api/my-tasks/${auto.autoCreatedTaskId}`
            : `/api/workspaces/${effectiveWorkspaceId}/tasks/${auto.autoCreatedTaskId}`;
          await customFetch(delPath, { method: "DELETE" });
          invalidateTask();
        } catch { /* ignore */ }
      } else if (title.trim()) {
        handleSaveTask();
      }
    }
    onClose();
  };

  const isOverdue = isCardMode
    ? (card?.task?.overdue === true) && status !== "completed" && status !== "blocked"
    : (task?.overdue === true) && status !== "completed" && status !== "blocked";

  const parentApprovalStatus = isCardMode
    ? (card?.task as TaskResponseExtended | null | undefined)?.parentApprovalStatus ?? null
    : task?.parentApprovalStatus ?? null;

  const isTaskReady = isCardMode ? !!card?.task : true;
  const isLoading = isCardMode ? isCardLoading : (auto.isAutoCreating || isTaskLoading);

  const deleteLabel = isCardMode ? "Deletar card?" : "Excluir tarefa?";
  const deleteDescription = isCardMode
    ? "O card e sua tarefa serão removidos permanentemente do plano. Esta ação não pode ser desfeita."
    : "A tarefa será removida permanentemente. Esta ação não pode ser desfeita.";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v && !showDelete && !isDeleting && !deleteCardMut.isPending) handleCloseModal();
        }}
      >
        <DialogContent
          ref={dialogContentCallbackRef}
          hideClose
          className="w-full max-w-2xl p-0 flex flex-col gap-0 overflow-y-auto max-h-[90vh] rounded-2xl"
          onInteractOutside={(e) => {
            e.preventDefault();
            if (showDelete || isDeleting || deleteCardMut.isPending) return;
            handleCloseModal();
          }}
        >
          <DialogTitle className="sr-only">
            {isCardMode ? "Editar card" : isEditing ? "Editar tarefa" : "Nova tarefa"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isCardMode ? "Detalhes do card selecionado" : "Formulário de tarefa"}
          </DialogDescription>
          {auto.autoCreateError ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 gap-3">
              <AlertTriangle className="w-8 h-8 text-destructive" />
              <p className="text-sm text-muted-foreground lowercase">Erro ao criar tarefa.</p>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl lowercase"
                onClick={auto.retryAutoCreate}
              >
                Tentar novamente
              </Button>
            </div>
          ) : taskNotFound ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 gap-3">
              <AlertTriangle className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground lowercase text-center">
                {taskErrorStatus === 403
                  ? "Você não tem permissão para acessar esta tarefa."
                  : "Tarefa não encontrada."}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl lowercase"
                onClick={onClose}
              >
                Fechar
              </Button>
            </div>
          ) : isLoading || (isCardMode && !card) ? (
            <div className="flex-1 flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : isCardMode && card?.task?.isApprovalTask && card.task.id ? (
            <ApprovalTaskView
              taskId={card.task.id}
              workspaceId={effectiveWorkspaceId}
              onClose={onClose}
            />
          ) : !isCardMode && task?.isApprovalTask && resolvedTaskId ? (
            <ApprovalTaskView
              taskId={resolvedTaskId}
              workspaceId={effectiveWorkspaceId}
              onClose={onClose}
            />
          ) : (
            <div className="p-5 space-y-4 flex-1">

              {/* Title + actions */}
              <div>
                <TaskHeaderActions
                  parentApprovalStatus={parentApprovalStatus}
                  isEditing={isEditing}
                  isTaskReady={isTaskReady}
                  isStandalone={isStandalone}
                  isCardMode={isCardMode}
                  effectiveWorkspaceId={effectiveWorkspaceId}
                  status={status}
                  isDuplicating={isDuplicating}
                  onStatusChange={handleStatusChange}
                  onDuplicate={handleDuplicate}
                  onDelete={() => setShowDelete(true)}
                />
                <div>
                  <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1 block lowercase">Título</label>
                  <Input
                    value={title}
                    autoCapitalize="none"
                    onChange={e => {
                      setTitle(e.target.value);
                      markDirty();
                    }}
                    onBlur={() => {
                      if (isCardMode) saveCard();
                      else if (isEditing && title.trim()) handleSaveTask();
                    }}
                    className="bg-background rounded-xl"
                    placeholder="Nome da tarefa"
                  />
                </div>

                {!isCardMode && isEditing && (
                  <TaskAssociationSelector
                    showMore={showMore}
                    onExpand={() => setShowMore(true)}
                    effectiveWorkspaceId={effectiveWorkspaceId}
                    taskMapId={taskMapId}
                    propWorkspaceId={propWorkspaceId}
                    userWorkspaces={userWorkspaces}
                    workspaceMaps={workspaceMaps}
                    onWorkspaceChange={changeWorkspace}
                    onMapChange={changeMap}
                  />
                )}
              </div>

              <div className="border-t pt-4">
                {isCardMode && !isTaskReady ? (
                  <div className="flex items-center justify-center py-4 gap-3 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm lowercase">Preparando tarefa…</span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      {isStandalone ? (
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1.5 flex items-center gap-1 block lowercase">
                            <User className="w-3 h-3" /> Responsável
                          </label>
                          <div className="bg-muted/50 rounded-xl h-10 flex items-center px-3 text-sm text-muted-foreground">
                            {me?.name ?? "Você"}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1.5 flex items-center gap-1 block lowercase">
                            <User className="w-3 h-3" /> Responsável
                          </label>
                          <AssigneeAvatarPicker
                            assignedTo={assignedTo}
                            members={members}
                            onSelect={v => {
                              setAssignedTo(v);
                              markDirty();
                              if (isCardMode) saveCardTaskDetails({ assignedTo: v });
                              else if (isEditing && resolvedTaskId) saveMutation.mutate({ body: { assignedTo: v === "unassigned" ? null : v }, taskId: resolvedTaskId, standalone: isStandalone, wsId: effectiveWorkspaceId });
                            }}
                          />
                        </div>
                      )}

                      {/* Due Date + Recurrence */}
                      <div>
                        <label className={`text-xs font-semibold tracking-wider mb-1.5 flex items-center gap-1 block lowercase ${isOverdue ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>
                          <Calendar className="w-3 h-3" /> Prazo
                        </label>
                        <div className="flex items-center gap-1.5">
                          <Input
                            type="date"
                            value={dueDate}
                            onChange={e => {
                              setDueDate(e.target.value);
                              markDirty();
                              if (isCardMode) saveCardTaskDetails({ dueDate: e.target.value });
                              else if (isEditing && resolvedTaskId) saveMutation.mutate({ body: { dueDate: e.target.value || null }, taskId: resolvedTaskId, standalone: isStandalone, wsId: effectiveWorkspaceId });
                            }}
                            className={`rounded-xl h-10 text-sm flex-1 min-w-0 ${isOverdue ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400" : "bg-background"}`}
                          />
                          {!isCardMode && (
                            <RecurrencePopover
                              disabled={!!(mapId || taskMapId)}
                              open={showRecurrencePanel}
                              onOpenChange={(open) => {
                                if (mapId || taskMapId) return;
                                if (open && !showRecurrencePanel) {
                                  setShowRecurrencePanel(true);
                                  if (!recurrenceConfig) {
                                    const defaultCfg: RecurrenceConfig = { type: "weekly", weekDays: [1] };
                                    setRecurrenceConfig(defaultCfg);
                                    setIsRecurring(true);
                                    if (isEditing && resolvedTaskId) {
                                      saveMutation.mutate({ body: { isRecurring: true, recurrenceConfig: defaultCfg }, taskId: resolvedTaskId, standalone: isStandalone, wsId: effectiveWorkspaceId });
                                    }
                                  }
                                } else if (!open) {
                                  setShowRecurrencePanel(false);
                                }
                              }}
                              isRecurring={isRecurring}
                              value={recurrenceConfig}
                              onChange={(cfg) => {
                                setRecurrenceConfig(cfg);
                                setIsRecurring(!!cfg);
                                markDirty();
                                if (!cfg) {
                                  setShowRecurrencePanel(false);
                                }
                                if (isEditing && resolvedTaskId) {
                                  saveMutation.mutate({ body: { isRecurring: !!cfg, recurrenceConfig: cfg ?? null }, taskId: resolvedTaskId, standalone: isStandalone, wsId: effectiveWorkspaceId });
                                }
                              }}
                            />
                          )}
                        </div>
                      </div>

                      {/* Priority */}
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1.5 flex items-center justify-end gap-1 block lowercase">
                          <Flag className="w-3 h-3" /> Prioridade
                        </label>
                        <div className="flex items-center justify-end h-10 px-2">
                          <PriorityBadge
                            value={priority}
                            onChange={v => {
                              setPriority(v);
                              markDirty();
                              if (isCardMode) saveCardTaskDetails({ priority: v });
                              else if (isEditing && resolvedTaskId) saveMutation.mutate({ body: { priority: v }, taskId: resolvedTaskId, standalone: isStandalone, wsId: effectiveWorkspaceId });
                            }}
                            portalContainer={dialogContentEl}
                          />
                        </div>
                      </div>
                    </div>

                    <SubtasksList
                      subtasks={subtasks}
                      sensors={sensors}
                      inputRefs={inputRefs}
                      onAdd={() => addSubtask()}
                      onChange={handleChange}
                      onToggle={handleToggle}
                      onBlur={handleBlur}
                      onKeyDown={handleKeyDown}
                      onDragEnd={handleDragEnd}
                    />

                    {/* Description */}
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1 block lowercase">Descrição</label>
                      <DescriptionEditor
                        value={description}
                        onChange={v => { setDescription(v); markDirty(); }}
                        onBlur={() => {
                          if (isCardMode) saveCard();
                          else if (isEditing && resolvedTaskId) saveMutation.mutate({ body: { description: description || null }, taskId: resolvedTaskId, standalone: isStandalone, wsId: effectiveWorkspaceId });
                        }}
                      />
                    </div>

                    {/* Attachments section — only shown when a task exists */}
                    {!!taskIdResolved && (
                      <AttachmentsSection
                        workspaceId={effectiveWorkspaceId}
                        taskId={taskIdResolved}
                        dropTargetEl={dialogContentEl}
                      />
                    )}

                    {/* Approval section — only shown for workspace tasks */}
                    {!!effectiveWorkspaceId && !!taskIdResolved && (
                      <ApprovalSection
                        workspaceId={effectiveWorkspaceId}
                        taskId={taskIdResolved}
                        mapId={mapId || taskMapId}
                        members={members}
                      />
                    )}

                  </div>
                )}
              </div>

              {/* Comments */}
              {isCardMode && cardId && (
                <CommentsSection
                  workspaceId={effectiveWorkspaceId}
                  mapId={mapId!}
                  cardId={cardId}
                  linkedTaskId={taskIdResolved}
                  currentUserId={currentUserId}
                  isAdmin={isAdmin}
                />
              )}
              {!isCardMode && isEditing && resolvedTaskId && !isStandalone && (
                <CommentsSection
                  workspaceId={effectiveWorkspaceId}
                  taskId={resolvedTaskId}
                  currentUserId={currentUserId}
                  isAdmin={isAdmin}
                />
              )}
              {!isCardMode && isEditing && resolvedTaskId && isStandalone && (
                <CommentsSection
                  standalone
                  taskId={resolvedTaskId}
                  currentUserId={currentUserId}
                  isAdmin={false}
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <TaskDeleteDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        label={deleteLabel}
        description={deleteDescription}
        confirmLabel={isCardMode ? "Deletar" : "Excluir"}
        loading={isDeleting || deleteCardMut.isPending}
        onConfirm={handleDelete}
      />
    </>
  );
}
