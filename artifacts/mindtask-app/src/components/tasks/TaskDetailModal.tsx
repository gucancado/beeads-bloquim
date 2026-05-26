import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@beeads/ui";
import { Button } from "@beeads/ui";
import { Input } from "@beeads/ui";
import { DescriptionEditor } from "@/components/tasks/DescriptionEditor";
import { Loader2, Flag, Calendar, User, AlertTriangle, ChevronDown, Check } from "lucide-react";
import type { RecurrenceConfig } from "@/components/tasks/RecurrencePanel";
import { TASK_STATUS_ORDER } from "@/lib/taskStatusConstants";
import { addOneDayYmd, formatDueDate } from "@/lib/utils";
import { DatePickerPopover } from "@/components/ui/date-picker-popover";
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
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { Skeleton } from "@beeads/ui";
import { SubtasksList } from "@/components/tasks/subtasks/SubtasksList";
import { TaskAssociationChips } from "@/components/tasks/association/TaskAssociationChips";
import { TaskHeaderActions } from "@/components/tasks/TaskHeaderActions";
import { useTaskAssociation } from "@/components/tasks/association/useTaskAssociation";
import { useSubtasksState } from "@/components/tasks/subtasks/useSubtasksState";
import { useAutoCreateTask } from "@/components/tasks/useAutoCreateTask";
import { useTaskDetailForm } from "@/components/tasks/useTaskDetailForm";
import { RecurrencePopover } from "@/components/tasks/RecurrencePopover";
import { Popover, PopoverContent, PopoverTrigger } from "@beeads/ui";
import { canPersistScheduleMode } from "@/lib/scheduleMode";

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
  cardId?: string | null;
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
  startAt?: string | null;
  scheduleMode?: "ate" | "entre" | "em" | "sem_prazo" | "urgente";
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

type ScheduleModeValue = "ate" | "entre" | "em" | "sem_prazo" | "urgente";

// "urgente" comes first because the lists sort by it as the primary key —
// keeping the dropdown order matched to the sort order makes the UI legible.
const SCHEDULE_MODE_OPTIONS: { value: ScheduleModeValue; label: string }[] = [
  { value: "urgente", label: "urgente" },
  { value: "ate", label: "fazer até" },
  { value: "entre", label: "fazer entre" },
  { value: "em", label: "fazer em" },
  { value: "sem_prazo", label: "sem prazo" },
];

function ScheduleModeDropdown({
  value,
  onChange,
}: {
  value: ScheduleModeValue;
  onChange: (next: ScheduleModeValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = SCHEDULE_MODE_OPTIONS.find(o => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={(props) => (
        <button
          {...props}
          type="button"
          className="flex items-center gap-1 text-xs font-medium text-foreground border border-border rounded-lg px-2.5 py-1 bg-background hover:border-primary/50 transition-colors"
        >
          <span className="lowercase">{current?.label ?? value}</span>
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        </button>
      )} />
      <PopoverContent
        align="start"
        className="p-1 rounded-xl min-w-[140px]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {SCHEDULE_MODE_OPTIONS.map(opt => {
          const isCurrent = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs lowercase rounded-md hover:bg-muted/60 transition-colors text-left ${isCurrent ? "bg-muted/30" : ""}`}
              aria-pressed={isCurrent}
            >
              <span>{opt.label}</span>
              {isCurrent && <Check className="w-3 h-3 text-primary shrink-0" />}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
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

  const [showDelete, setShowDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [dialogContentEl, setDialogContentEl] = useState<HTMLDivElement | null>(null);
  const dialogContentCallbackRef = useCallback((el: HTMLDivElement | null) => setDialogContentEl(el), []);

  // Forward refs to bridge auto-create <-> association <-> form <-> invalidateTask without TDZ.
  const setTaskWorkspaceIdRef = useRef<(v: string | null) => void>(() => {});
  const invalidateTaskRef = useRef<() => void>(() => {});
  const setTitleRef = useRef<(v: string) => void>(() => {});
  const setAssignedToRef = useRef<(v: string) => void>(() => {});
  const setIsRecurringRef = useRef<(v: boolean) => void>(() => {});
  const setRecurrenceConfigRef = useRef<(v: RecurrenceConfig | null) => void>(() => {});
  const setShowRecurrencePanelRef = useRef<(v: boolean) => void>(() => {});

  const auto = useAutoCreateTask({
    open,
    isCardMode,
    taskId,
    propWorkspaceId,
    currentUserId,
    setTitle: (v) => setTitleRef.current(v),
    setAssignedTo: (v) => setAssignedToRef.current(v),
    setTaskWorkspaceId: (v) => setTaskWorkspaceIdRef.current(v),
    invalidateTask: () => invalidateTaskRef.current(),
    onAutoCreated,
  });

  const isEditing = isCardMode ? true : !!(taskId || auto.autoCreatedTaskId);
  const resolvedTaskId = taskId || auto.autoCreatedTaskId;

  const markDirty = () => { if (auto.autoCreatedTaskId) auto.setAutoCreateDirty(true); };

  const {
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
    setAssignedTo: (v) => setAssignedToRef.current(v),
    setIsRecurring: (v) => setIsRecurringRef.current(v),
    setRecurrenceConfig: (v) => setRecurrenceConfigRef.current(v),
    setShowRecurrencePanel: (v) => setShowRecurrencePanelRef.current(v),
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

  const {
    title, setTitle,
    description, setDescription,
    assignedTo, setAssignedTo,
    priority, setPriority,
    dueDate, setDueDate,
    startAt, setStartAt,
    scheduleMode, setScheduleMode,
    status, setStatus,
    isRecurring, setIsRecurring,
    recurrenceConfig, setRecurrenceConfig,
    showRecurrencePanel, setShowRecurrencePanel,
    resetTitleDescriptionInit,
  } = useTaskDetailForm({
    open,
    isCardMode,
    card,
    task,
    resolvedTaskId,
    isEditing,
    setTaskWorkspaceId,
    setTaskMapId,
  });

  setTitleRef.current = setTitle;
  setAssignedToRef.current = setAssignedTo;
  setIsRecurringRef.current = setIsRecurring;
  setRecurrenceConfigRef.current = setRecurrenceConfig;
  setShowRecurrencePanelRef.current = setShowRecurrencePanel;

  // Visual cleanup of recurrence UI when modal closes (kept in modal as external concern).
  useEffect(() => {
    if (!open) {
      setIsRecurring(false);
      setRecurrenceConfig(null);
      setShowRecurrencePanel(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset subtasks alongside form reset (kept in modal because subtasks live elsewhere).
  useEffect(() => {
    if (!isCardMode && !isEditing) {
      setSubtasks([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCardMode, isEditing]);

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
    // If the task is linked to a canvas node, also invalidate the map+card
    // queries so that the node reflects the change immediately.
    const linkedMapId = taskMapId ?? task?.mapId ?? null;
    const linkedCardId = task?.cardId ?? null;
    if (effectiveWorkspaceId && linkedMapId) {
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${effectiveWorkspaceId}/maps/${linkedMapId}`] });
      if (linkedCardId) {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${effectiveWorkspaceId}/maps/${linkedMapId}/cards/${linkedCardId}`] });
      }
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

  const saveCardTaskDetails = (overrides: { priority?: string; assignedTo?: string; dueDate?: string; startAt?: string; scheduleMode?: ScheduleModeValue } = {}) => {
    if (!cardId || !mapId || !card?.task) return;
    const p = (overrides.priority ?? priority) as TaskPriority;
    const a = overrides.assignedTo ?? assignedTo;
    const d = overrides.dueDate ?? dueDate;
    const s = overrides.startAt ?? startAt;
    const m = overrides.scheduleMode ?? scheduleMode;
    updateTaskDetailsMut.mutate(
      {
        workspaceId: effectiveWorkspaceId, mapId, cardId, data: {
          title,
          priority: p,
          assignedTo: a === "unassigned" ? null : a,
          dueDate: d ? d + "T12:00:00.000Z" : null,
          startAt: s ? s + "T12:00:00.000Z" : null,
          scheduleMode: m,
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
    if (!isCardMode && task?.isApprovalTask) return;
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
    const isApprovalTaskOpen = isCardMode
      ? card?.task?.isApprovalTask === true
      : task?.isApprovalTask === true;
    if (isApprovalTaskOpen) {
      onClose();
      return;
    }
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
          className="w-full max-w-2xl p-0 flex flex-col gap-0 overflow-hidden max-h-[90vh] rounded-2xl"
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
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
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
            <div className="flex-1 p-5 space-y-4" aria-busy="true" aria-label="Carregando tarefa">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-32" />
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-8 rounded-lg" />
                  <Skeleton className="h-8 w-8 rounded-lg" />
                </div>
              </div>
              <Skeleton className="h-10 w-full rounded-xl" />
              <div className="grid grid-cols-3 gap-3 pt-2">
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
              </div>
              <Skeleton className="h-32 w-full rounded-xl" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-full rounded-lg" />
                <Skeleton className="h-8 w-3/4 rounded-lg" />
              </div>
            </div>
          ) : isCardMode && card?.task?.isApprovalTask && card.task.id ? (
            <ApprovalTaskView
              taskId={card.task.id}
              workspaceId={effectiveWorkspaceId}
              onClose={onClose}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
            />
          ) : !isCardMode && task?.isApprovalTask && resolvedTaskId ? (
            <ApprovalTaskView
              taskId={resolvedTaskId}
              workspaceId={effectiveWorkspaceId}
              onClose={onClose}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
            />
          ) : (
            <div className="p-5 space-y-4 flex-1">

              {/* Title + actions */}
              <div>
                <TaskHeaderActions
                  parentApprovalStatus={parentApprovalStatus}
                  isEditing={isEditing}
                  isStandalone={isStandalone}
                  isCardMode={isCardMode}
                  effectiveWorkspaceId={effectiveWorkspaceId}
                  isDuplicating={isDuplicating}
                  onDuplicate={handleDuplicate}
                  onDelete={() => setShowDelete(true)}
                  taskId={taskIdResolved ?? null}
                  taskStatus={status}
                  templatePortalContainer={dialogContentEl}
                  templateSkipConfirm={!!auto.autoCreatedTaskId && !auto.autoCreateDirty}
                  onTemplateApplied={() => {
                    resetTitleDescriptionInit();
                    invalidateTask();
                    if (resolvedTaskId) {
                      const subPath = isStandalone
                        ? `/api/my-tasks/${resolvedTaskId}/subtasks`
                        : `/api/workspaces/${effectiveWorkspaceId}/tasks/${resolvedTaskId}/subtasks`;
                      queryClient.invalidateQueries({ queryKey: [subPath] });
                      queryClient.invalidateQueries({
                        queryKey: isStandalone
                          ? [`/api/my-tasks/${resolvedTaskId}`]
                          : [`/api/workspaces/${effectiveWorkspaceId}/tasks/${resolvedTaskId}`],
                      });
                    }
                  }}
                  leftSlot={
                    isEditing ? (
                      <TaskAssociationChips
                        effectiveWorkspaceId={effectiveWorkspaceId}
                        taskMapId={isCardMode ? (mapId ?? null) : taskMapId}
                        propWorkspaceId={propWorkspaceId}
                        userWorkspaces={userWorkspaces}
                        workspaceMaps={workspaceMaps}
                        onWorkspaceChange={changeWorkspace}
                        onMapChange={changeMap}
                        mapDisabled={isCardMode}
                      />
                    ) : null
                  }
                />
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1 min-h-[18px]">
                    <label className="text-xs font-semibold text-muted-foreground tracking-wider block lowercase">Título</label>
                    <AutosaveIndicator
                      isSaving={
                        updateCardMut.isPending ||
                        updateTaskDetailsMut.isPending ||
                        updateTaskStatusMut.isPending ||
                        saveMutation.isPending
                      }
                    />
                  </div>
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
              </div>

              <div className="border-t pt-4">
                {isCardMode && !isTaskReady ? (
                  <div className="flex items-center justify-center py-4 gap-3 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm lowercase">Preparando tarefa…</span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-[0.7fr_1fr_1fr] gap-3">
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
                      <div className={scheduleMode === "entre" ? "col-span-2" : ""}>
                        <div className="mb-1.5 flex items-center justify-start gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5">
                            <ScheduleModeDropdown
                              value={scheduleMode}
                              onChange={(next) => {
                                setScheduleMode(next);
                                markDirty();
                                if (next === "sem_prazo" || next === "urgente") {
                                  setStartAt("");
                                  setDueDate("");
                                  const body = { scheduleMode: next, startAt: null, dueDate: null };
                                  if (isCardMode) saveCardTaskDetails({ scheduleMode: next, startAt: "", dueDate: "" });
                                  else if (isEditing && resolvedTaskId) saveMutation.mutate({ body, taskId: resolvedTaskId, standalone: isStandalone, wsId: effectiveWorkspaceId });
                                  return;
                                }
                                if (!canPersistScheduleMode(next, startAt, dueDate)) return;
                                const body: { scheduleMode: ScheduleModeValue; startAt?: string | null } = { scheduleMode: next };
                                if (next === "ate") { setStartAt(""); body.startAt = null; }
                                if (next === "em" && dueDate) { setStartAt(dueDate); body.startAt = dueDate + "T12:00:00.000Z"; }
                                if (isCardMode) saveCardTaskDetails({ scheduleMode: next, startAt: next === "ate" ? "" : (next === "em" ? dueDate : startAt) });
                                else if (isEditing && resolvedTaskId) saveMutation.mutate({ body, taskId: resolvedTaskId, standalone: isStandalone, wsId: effectiveWorkspaceId });
                              }}
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
                        {scheduleMode !== "sem_prazo" && scheduleMode !== "urgente" && (
                        <div className="flex items-center gap-1.5 w-[85%]">
                          {scheduleMode === "entre" && (
                            <>
                              <DatePickerPopover
                                value={startAt}
                                max={dueDate || undefined}
                                onSelect={(v) => {
                                  if (scheduleMode === "entre" && v && dueDate && v > dueDate) {
                                    toast({ title: "início deve ser até o fim", variant: "destructive" });
                                    return;
                                  }
                                  setStartAt(v);
                                  markDirty();
                                  if (scheduleMode === "entre" && v && !dueDate) {
                                    const autoDue = addOneDayYmd(v);
                                    setDueDate(autoDue);
                                    if (isCardMode) saveCardTaskDetails({ startAt: v, dueDate: autoDue, scheduleMode });
                                    else if (isEditing && resolvedTaskId) saveMutation.mutate({ body: { scheduleMode, startAt: v + "T12:00:00.000Z", dueDate: autoDue + "T12:00:00.000Z" }, taskId: resolvedTaskId, standalone: isStandalone, wsId: effectiveWorkspaceId });
                                    return;
                                  }
                                  if (!canPersistScheduleMode(scheduleMode, v, dueDate)) return;
                                  if (isCardMode) saveCardTaskDetails({ startAt: v, scheduleMode });
                                  else if (isEditing && resolvedTaskId) saveMutation.mutate({ body: { scheduleMode, startAt: v ? v + "T12:00:00.000Z" : null, dueDate: dueDate || null }, taskId: resolvedTaskId, standalone: isStandalone, wsId: effectiveWorkspaceId });
                                }}
                              >
                                <button
                                  type="button"
                                  className="rounded-xl h-10 text-sm flex-1 min-w-0 px-3 bg-background border border-input flex items-center gap-2 text-left hover:border-primary/50 transition-colors"
                                  title="início"
                                >
                                  <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                                  <span className={startAt ? "" : "text-muted-foreground"}>
                                    {startAt ? formatDueDate(startAt) : "vazio"}
                                  </span>
                                </button>
                              </DatePickerPopover>
                              <span className="text-xs text-muted-foreground shrink-0 px-0.5 lowercase">e</span>
                            </>
                          )}
                          <DatePickerPopover
                            value={dueDate}
                            min={scheduleMode === "entre" ? (startAt || undefined) : undefined}
                            onSelect={(v) => {
                              if (scheduleMode === "entre" && v && startAt && v < startAt) {
                                toast({ title: "fim deve ser após o início", variant: "destructive" });
                                return;
                              }
                              setDueDate(v);
                              markDirty();
                              if (!canPersistScheduleMode(scheduleMode, startAt, v)) return;
                              if (scheduleMode === "em") {
                                setStartAt(v);
                                if (isCardMode) saveCardTaskDetails({ dueDate: v, startAt: v, scheduleMode });
                                else if (isEditing && resolvedTaskId) saveMutation.mutate({ body: { scheduleMode, dueDate: v || null, startAt: v ? v + "T12:00:00.000Z" : null }, taskId: resolvedTaskId, standalone: isStandalone, wsId: effectiveWorkspaceId });
                              } else if (scheduleMode === "entre") {
                                if (isCardMode) saveCardTaskDetails({ dueDate: v, scheduleMode });
                                else if (isEditing && resolvedTaskId) saveMutation.mutate({ body: { scheduleMode, dueDate: v || null, startAt: startAt ? startAt + "T12:00:00.000Z" : null }, taskId: resolvedTaskId, standalone: isStandalone, wsId: effectiveWorkspaceId });
                              } else {
                                if (isCardMode) saveCardTaskDetails({ dueDate: v, scheduleMode });
                                else if (isEditing && resolvedTaskId) saveMutation.mutate({ body: { scheduleMode, dueDate: v || null }, taskId: resolvedTaskId, standalone: isStandalone, wsId: effectiveWorkspaceId });
                              }
                            }}
                          >
                            <button
                              type="button"
                              className={`rounded-xl h-10 text-sm flex-1 min-w-0 px-3 border flex items-center gap-2 text-left hover:border-primary/50 transition-colors ${isOverdue ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400" : "bg-background border-input"}`}
                              title={scheduleMode === "entre" ? "fim" : undefined}
                            >
                              <Calendar className={`w-4 h-4 shrink-0 ${isOverdue ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`} />
                              <span className={dueDate ? "" : "text-muted-foreground"}>
                                {dueDate ? formatDueDate(dueDate) : "vazio"}
                              </span>
                            </button>
                          </DatePickerPopover>

                        </div>
                        )}
                        {(() => {
                          // Inline validation hints — these complement the existing
                          // min/max constraints on the date pickers (which already
                          // prevent invalid picks) by surfacing the *reason* the user
                          // can't save yet when datas are missing or inconsistent.
                          if (scheduleMode === "entre") {
                            if (startAt && dueDate && startAt > dueDate) {
                              return (
                                <p className="mt-1.5 text-[11px] text-destructive lowercase">
                                  início deve ser antes ou igual ao fim.
                                </p>
                              );
                            }
                            if ((startAt && !dueDate) || (!startAt && dueDate)) {
                              return (
                                <p className="mt-1.5 text-[11px] text-muted-foreground/80 lowercase">
                                  preencha início e fim pra salvar a janela.
                                </p>
                              );
                            }
                          }
                          if (scheduleMode === "em" && !dueDate) {
                            return (
                              <p className="mt-1.5 text-[11px] text-muted-foreground/80 lowercase">
                                escolha o dia.
                              </p>
                            );
                          }
                          return null;
                        })()}
                      </div>

                      {/* Priority */}
                      <div className={scheduleMode === "entre" ? "col-start-3 row-start-2" : ""}>
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
                        allowKindToggle={!!effectiveWorkspaceId}
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
          </div>
          {!auto.autoCreateError &&
            !taskNotFound &&
            !isLoading &&
            !(isCardMode && !card) &&
            !(isCardMode && card?.task?.isApprovalTask) &&
            !(!isCardMode && task?.isApprovalTask) &&
            isEditing &&
            isTaskReady && (
              <div className="border-t bg-background px-5 py-3 flex items-center justify-center gap-1.5 flex-wrap shrink-0">
                {TASK_STATUS_ORDER.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleStatusChange(opt.value)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all lowercase focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      status === opt.value
                        ? opt.activeClass
                        : "bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {opt.menuLabel}
                  </button>
                ))}
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
