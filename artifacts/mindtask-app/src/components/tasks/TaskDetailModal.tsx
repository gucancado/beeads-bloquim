import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DescriptionEditor } from "@/components/tasks/DescriptionEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Trash2, Copy, Flag, Calendar, User, AlertTriangle, ListChecks, Briefcase, ChevronDown, LayoutDashboard } from "lucide-react";
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
import { SortableSubtask, type SubtaskItem } from "@/components/tasks/subtasks/SortableSubtask";
import { TaskDeleteDialog } from "@/components/tasks/TaskDeleteDialog";
import { RecurrencePopover } from "@/components/tasks/RecurrencePopover";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  KeyboardSensor,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

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

function generateLocalId() {
  return `local-${Math.random().toString(36).slice(2)}`;
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
  const [autoCreatedTaskId, setAutoCreatedTaskId] = useState<string | null>(null);
  const isEditing = isCardMode ? true : !!(taskId || autoCreatedTaskId);
  const resolvedTaskId = taskId || autoCreatedTaskId;

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
  const [localSubtasks, setLocalSubtasks] = useState<SubtaskItem[]>([]);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [taskWorkspaceId, setTaskWorkspaceId] = useState<string | null>(null);
  const [taskMapId, setTaskMapId] = useState<string | null>(null);
  const [autoCreateDirty, setAutoCreateDirty] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceConfig, setRecurrenceConfig] = useState<RecurrenceConfig | null>(null);
  const [showRecurrencePanel, setShowRecurrencePanel] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const initializedForTaskRef = useRef<string | null>(null);
  const [dialogContentEl, setDialogContentEl] = useState<HTMLDivElement | null>(null);
  const dialogContentCallbackRef = useCallback((el: HTMLDivElement | null) => setDialogContentEl(el), []);

  const effectiveWorkspaceId = propWorkspaceId || taskWorkspaceId || "";
  // isStandalone is derived from the PROP, not effectiveWorkspaceId.
  // effectiveWorkspaceId can change mid-flight (once taskWorkspaceId resolves),
  // which would switch the query key and trigger a 403 workspace fetch for
  // users who are assigned a task but not workspace members.
  const isStandalone = !propWorkspaceId;

  const markDirty = () => { if (autoCreatedTaskId) setAutoCreateDirty(true); };

  const { data: userWorkspaces } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/workspaces"],
    queryFn: () => customFetch("/api/workspaces"),
    enabled: open && !isCardMode,
  });

  const { data: workspaceMaps } = useQuery<{ id: string; name: string; hidden: boolean }[]>({
    queryKey: [`/api/workspaces/${effectiveWorkspaceId}/maps`],
    queryFn: () => customFetch(`/api/workspaces/${effectiveWorkspaceId}/maps`),
    enabled: open && !!effectiveWorkspaceId && !isCardMode,
    select: (data) => data.filter(m => !m.hidden),
  });

  useEffect(() => {
    if (!open) {
      setAutoCreatedTaskId(null);
      setTaskWorkspaceId(null);
      setTaskMapId(null);
      setShowMore(false);
      setAutoCreateDirty(false);
      setIsRecurring(false);
      setRecurrenceConfig(null);
      setShowRecurrencePanel(false);
    }
  }, [open]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const { data: rawCard, isLoading: isCardLoading } = useGetCard(effectiveWorkspaceId, mapId ?? "", cardId ?? "", {
    query: { enabled: isCardMode && open && !!cardId }
  });

  const card = rawCard as (Omit<typeof rawCard, "task"> & { task?: TaskResponseExtended | null }) | undefined;

  const taskIdResolved: string | undefined = isCardMode ? (card?.task?.id ?? undefined) : (resolvedTaskId ?? undefined);

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

  const subtasksEndpoint = effectiveWorkspaceId
    ? `/api/workspaces/${effectiveWorkspaceId}/tasks/${taskIdResolved}/subtasks`
    : `/api/my-tasks/${taskIdResolved}/subtasks`;

  const { data: subtasksData } = useQuery<SubtaskItem[]>({
    queryKey: [subtasksEndpoint],
    queryFn: () => customFetch(subtasksEndpoint),
    enabled: open && !!taskIdResolved,
  });

  useEffect(() => {
    if (subtasksData) setLocalSubtasks(subtasksData);
  }, [subtasksData]);

  useEffect(() => {
    if (pendingFocusId && inputRefs.current[pendingFocusId]) {
      inputRefs.current[pendingFocusId]?.focus();
      setPendingFocusId(null);
    }
  }, [pendingFocusId, localSubtasks]);

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
        setLocalSubtasks([]);
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

  const saveSubtasksMutation = useMutation({
    mutationFn: (items: SubtaskItem[]) =>
      customFetch(subtasksEndpoint, {
        method: "PUT",
        body: JSON.stringify({ subtasks: items.map((s, idx) => ({ id: s.id.startsWith("local-") ? undefined : s.id, text: s.text, completed: s.completed, order: idx })) }),
      }),
    onSuccess: (data: SubtaskItem[]) => {
      setLocalSubtasks(prev => {
        const newLocal = prev.filter(s => s.id.startsWith("local-") && s.text.trim() === "");
        return [...data, ...newLocal];
      });
    },
  });

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

  const autoCreateMutRef = useRef(false);
  const [autoCreateError, setAutoCreateError] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;

  const autoCreateMutation = useMutation({
    mutationFn: () => {
      if (propWorkspaceId) {
        return customFetch(`/api/workspaces/${propWorkspaceId}/tasks`, {
          method: "POST",
          body: JSON.stringify({ title: "nova tarefa", priority: "medium" }),
        });
      }
      return customFetch("/api/my-tasks", {
        method: "POST",
        body: JSON.stringify({ title: "nova tarefa", priority: "medium" }),
      });
    },
    onSuccess: (newTask: { id: string }) => {
      const wasStandalone = !propWorkspaceId;
      if (!openRef.current) {
        const delPath = wasStandalone
          ? `/api/my-tasks/${newTask.id}`
          : `/api/workspaces/${propWorkspaceId}/tasks/${newTask.id}`;
        customFetch(delPath, { method: "DELETE" }).catch(() => {});
        invalidateTask();
        return;
      }
      setAutoCreatedTaskId(newTask.id);
      onAutoCreated?.(newTask.id);

      setTitle("nova tarefa");
      if (wasStandalone) {
        setAssignedTo(currentUserId);
      }
      if (propWorkspaceId) {
        setTaskWorkspaceId(propWorkspaceId);
      }
      invalidateTask();
    },
    onError: () => {
      autoCreateMutRef.current = false;
      setAutoCreateError(true);
    },
  });

  useEffect(() => {
    if (open && !isCardMode && !taskId && !autoCreatedTaskId && !autoCreateMutRef.current && !autoCreateError) {
      autoCreateMutRef.current = true;
      setAutoCreateError(false);
      autoCreateMutation.mutate();
    }
    if (!open) {
      autoCreateMutRef.current = false;
      setAutoCreateError(false);
    }
  }, [open, isCardMode, taskId, autoCreatedTaskId, autoCreateError]);

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
    if (taskIdResolved) {
      saveSubtasksMutation.mutate(localSubtasks.filter(s => s.text.trim() !== ""));
    }
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
      if (autoCreatedTaskId && !autoCreateDirty) {
        try {
          const delPath = isStandalone
            ? `/api/my-tasks/${autoCreatedTaskId}`
            : `/api/workspaces/${effectiveWorkspaceId}/tasks/${autoCreatedTaskId}`;
          await customFetch(delPath, { method: "DELETE" });
          invalidateTask();
        } catch { /* ignore */ }
      } else if (title.trim()) {
        handleSaveTask();
      }
    }
    onClose();
  };

  const addSubtask = (afterId?: string) => {
    const newId = generateLocalId();
    setLocalSubtasks(prev => {
      if (afterId) {
        const idx = prev.findIndex(s => s.id === afterId);
        const insertAt = idx >= 0 ? idx + 1 : prev.length;
        const next = [...prev];
        next.splice(insertAt, 0, { id: newId, text: "", completed: false, order: insertAt });
        return next;
      }
      return [...prev, { id: newId, text: "", completed: false, order: prev.length }];
    });
    setPendingFocusId(newId);
    markDirty();
  };

  const handleSubtaskChange = (id: string, text: string) => {
    setLocalSubtasks(prev => prev.map(s => s.id === id ? { ...s, text } : s));
    markDirty();
  };

  const handleSubtaskToggle = (id: string) => {
    const updated = localSubtasks.map(s => s.id === id ? { ...s, completed: !s.completed } : s);
    setLocalSubtasks(updated);
    markDirty();
    if (taskIdResolved) saveSubtasksMutation.mutate(updated.filter(s => s.text.trim() !== ""));
  };

  const handleSubtaskBlur = (id: string) => {
    const subtask = localSubtasks.find(s => s.id === id);
    if (subtask && subtask.text.trim() === "") {
      const updated = localSubtasks.filter(s => s.id !== id);
      setLocalSubtasks(updated);
      if (taskIdResolved) saveSubtasksMutation.mutate(updated.filter(s => s.text.trim() !== ""));
    } else if (taskIdResolved) {
      saveSubtasksMutation.mutate(localSubtasks.filter(s => s.text.trim() !== ""));
    }
  };

  const handleSubtaskKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === "Backspace") {
      const subtask = localSubtasks.find(s => s.id === id);
      if (subtask && subtask.text === "") {
        e.preventDefault();
        const updated = localSubtasks.filter(s => s.id !== id);
        setLocalSubtasks(updated);
        if (taskIdResolved) saveSubtasksMutation.mutate(updated.filter(s => s.text.trim() !== ""));
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      addSubtask(id);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = localSubtasks.findIndex(s => s.id === active.id);
      const newIndex = localSubtasks.findIndex(s => s.id === over.id);
      const reordered = arrayMove(localSubtasks, oldIndex, newIndex);
      setLocalSubtasks(reordered);
      if (taskIdResolved) saveSubtasksMutation.mutate(reordered.filter(s => s.text.trim() !== ""));
    }
  };

  const isOverdue = isCardMode
    ? (card?.task?.overdue === true) && status !== "completed" && status !== "blocked"
    : (task?.overdue === true) && status !== "completed" && status !== "blocked";

  const parentApprovalStatus = isCardMode
    ? (card?.task as TaskResponseExtended | null | undefined)?.parentApprovalStatus ?? null
    : task?.parentApprovalStatus ?? null;

  const isTaskReady = isCardMode ? !!card?.task : true;
  const isAutoCreating = !autoCreateError && (autoCreateMutation.isPending || (!isCardMode && !taskId && !autoCreatedTaskId));
  const isLoading = isCardMode ? isCardLoading : (isAutoCreating || isTaskLoading);

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
          {autoCreateError ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 gap-3">
              <AlertTriangle className="w-8 h-8 text-destructive" />
              <p className="text-sm text-muted-foreground lowercase">Erro ao criar tarefa.</p>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl lowercase"
                onClick={() => {
                  setAutoCreateError(false);
                  autoCreateMutRef.current = false;
                }}
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
                <div className="flex items-center gap-2 mb-1">
                  {parentApprovalStatus && (
                    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full lowercase border ${
                      parentApprovalStatus === 'approved'
                        ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800'
                        : parentApprovalStatus === 'rejected'
                        ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800'
                        : 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        parentApprovalStatus === 'approved' ? 'bg-emerald-500' :
                        parentApprovalStatus === 'rejected' ? 'bg-red-500' : 'bg-amber-500'
                      }`} />
                      {parentApprovalStatus === 'in_approval' ? 'em aprovação' :
                       parentApprovalStatus === 'approved' ? 'aprovada' : 'reprovada'}
                    </span>
                  )}
                  <div className="flex items-center gap-1.5 ml-auto flex-wrap justify-end">
                    {isEditing && isTaskReady && TASK_STATUS_ORDER.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => handleStatusChange(opt.value)}
                        className={`text-xs font-semibold px-3 py-1 rounded-full border transition-all lowercase ${
                          status === opt.value
                            ? opt.activeClass
                            : "bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                    {isEditing && !isStandalone && !!effectiveWorkspaceId && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleDuplicate}
                        disabled={isDuplicating}
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg"
                        title="duplicar tarefa"
                      >
                        {isDuplicating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
                      </Button>
                    )}
                    {isEditing && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowDelete(true)}
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
                        title={isCardMode ? "deletar card" : "excluir tarefa"}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
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
                  <div>
                    {!showMore && (
                      <button
                        type="button"
                        onClick={() => setShowMore(true)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-1 py-0.5 rounded lowercase"
                      >
                        <ChevronDown className="w-3 h-3" />
                        mais
                      </button>
                    )}
                    {showMore && (
                      <div className="mt-2 grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1.5 flex items-center gap-1 block lowercase">
                            <Briefcase className="w-3 h-3" /> Espaço de trabalho
                          </label>
                          <Select
                            value={effectiveWorkspaceId || "none"}
                            onValueChange={v => {
                              const newWsId = v === "none" ? null : v;
                              if (resolvedTaskId) {
                                customFetch(`/api/my-tasks/${resolvedTaskId}/association`, {
                                  method: "PATCH",
                                  body: JSON.stringify({ workspaceId: newWsId, mapId: null }),
                                }).then(() => {
                                  setTaskWorkspaceId(newWsId);
                                  setTaskMapId(null);
                                  markDirty();
                                  if (!newWsId) {
                                    setAssignedTo(currentUserId);
                                  }
                                  invalidateTask();
                                  queryClient.invalidateQueries({ queryKey: [`/api/my-tasks/${resolvedTaskId}`] });
                                  if (newWsId) {
                                    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${newWsId}/tasks`] });
                                    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${newWsId}/tasks/${resolvedTaskId}`] });
                                  }
                                }).catch(() => toast({ title: "Erro ao alterar workspace", variant: "destructive" }));
                              }
                            }}
                            disabled={!!propWorkspaceId}
                          >
                            <SelectTrigger className="bg-background rounded-xl h-10">
                              <SelectValue placeholder="Nenhum" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none"><span className="lowercase">Nenhum</span></SelectItem>
                              {userWorkspaces?.map((ws) => (
                                <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1.5 flex items-center gap-1 block lowercase">
                            <LayoutDashboard className="w-3 h-3" /> Plano
                          </label>
                          <Select
                            value={taskMapId || "none"}
                            onValueChange={v => {
                              const newMapId = v === "none" ? null : v;
                              if (resolvedTaskId) {
                                customFetch(`/api/my-tasks/${resolvedTaskId}/association`, {
                                  method: "PATCH",
                                  body: JSON.stringify({ mapId: newMapId }),
                                }).then(() => {
                                  setTaskMapId(newMapId);
                                  markDirty();
                                  // Clear recurrence when associating with a map
                                  if (newMapId) {
                                    setIsRecurring(false);
                                    setRecurrenceConfig(null);
                                    setShowRecurrencePanel(false);
                                  }
                                  invalidateTask();
                                }).catch(() => toast({ title: "Erro ao alterar plano", variant: "destructive" }));
                              }
                            }}
                            disabled={!effectiveWorkspaceId}
                          >
                            <SelectTrigger className="bg-background rounded-xl h-10">
                              <SelectValue placeholder="Nenhum" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none"><span className="lowercase">Nenhum</span></SelectItem>
                              {workspaceMaps?.map((m) => (
                                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                  </div>
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

                    <div>
                      <div className="flex items-center mb-1.5">
                        <button
                          onClick={() => addSubtask()}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-muted"
                          title="Adicionar subtarefa"
                        >
                          <ListChecks className="w-3.5 h-3.5" />
                          <span className="lowercase">subtarefas +</span>
                        </button>
                      </div>
                      {localSubtasks.length > 0 && (
                        <div className="bg-muted/30 rounded-xl px-2 py-1.5 space-y-0.5">
                          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                            <SortableContext items={localSubtasks.map(s => s.id)} strategy={verticalListSortingStrategy}>
                              {localSubtasks.map(subtask => (
                                <SortableSubtask
                                  key={subtask.id}
                                  subtask={subtask}
                                  onChange={handleSubtaskChange}
                                  onToggle={handleSubtaskToggle}
                                  onBlur={handleSubtaskBlur}
                                  onKeyDown={handleSubtaskKeyDown}
                                  inputRef={(el) => { inputRefs.current[subtask.id] = el; }}
                                />
                              ))}
                            </SortableContext>
                          </DndContext>
                        </div>
                      )}
                    </div>

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
