import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DescriptionEditor } from "@/components/tasks/DescriptionEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Trash2, Flag, Calendar, User, AlertTriangle, ListChecks, GripVertical, Check, Briefcase, ChevronDown, LayoutDashboard } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface TaskResponseExtended extends TaskResponse {
  overdue?: boolean;
  previousStatus?: string | null;
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
}

interface SubtaskItem {
  id: string;
  text: string;
  completed: boolean;
  order: number;
}

interface UpdateTaskPayload {
  title?: string;
  description?: string | null;
  assignedTo?: string | null;
  priority?: string;
  dueDate?: string | null;
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

  mapId?: string;
  cardId?: string | null;
  onDeleteCard?: (cardId: string) => void;
}

function generateLocalId() {
  return `local-${Math.random().toString(36).slice(2)}`;
}

function SortableSubtask({
  subtask,
  onChange,
  onToggle,
  onBlur,
  onKeyDown,
  inputRef,
}: {
  subtask: SubtaskItem;
  onChange: (id: string, text: string) => void;
  onToggle: (id: string) => void;
  onBlur: (id: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, id: string) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: subtask.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1.5 group rounded-lg px-1 py-0.5 ${subtask.completed ? "opacity-50" : ""}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing shrink-0 touch-none"
        tabIndex={-1}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => onToggle(subtask.id)}
        className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-all ${
          subtask.completed
            ? "bg-primary border-primary text-primary-foreground"
            : "border-border bg-background hover:border-primary/60"
        }`}
      >
        {subtask.completed && <Check className="w-2.5 h-2.5" />}
      </button>
      <input
        ref={inputRef}
        value={subtask.text}
        onChange={e => onChange(subtask.id, e.target.value)}
        onBlur={() => onBlur(subtask.id)}
        onKeyDown={e => onKeyDown(e, subtask.id)}
        className={`flex-1 bg-transparent text-sm outline-none border-none focus:outline-none placeholder:text-muted-foreground/40 ${
          subtask.completed ? "line-through text-muted-foreground" : ""
        }`}
        placeholder="Subtarefa..."
      />
    </div>
  );
}

export function TaskDetailModal({
  workspaceId: propWorkspaceId,
  open,
  onClose,
  taskId = null,
  mapId,
  cardId = null,
  onDeleteCard,
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
  const [localSubtasks, setLocalSubtasks] = useState<SubtaskItem[]>([]);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [taskWorkspaceId, setTaskWorkspaceId] = useState<string | null>(null);
  const [taskMapId, setTaskMapId] = useState<string | null>(null);
  const [autoCreateDirty, setAutoCreateDirty] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const effectiveWorkspaceId = propWorkspaceId || taskWorkspaceId || "";
  const isStandalone = !effectiveWorkspaceId;

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

  const { data: task, isLoading: isTaskLoading } = useQuery<WorkspaceTask>({
    queryKey: isStandalone
      ? [`/api/my-tasks/${resolvedTaskId}`]
      : [`/api/workspaces/${effectiveWorkspaceId}/tasks/${resolvedTaskId}`],
    queryFn: () => customFetch(isStandalone ? `/api/my-tasks/${resolvedTaskId}` : `/api/workspaces/${effectiveWorkspaceId}/tasks/${resolvedTaskId}`),
    enabled: !isCardMode && isEditing && open && !!resolvedTaskId,
  });

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

  const { data: subtasksData } = useQuery<SubtaskItem[]>({
    queryKey: [`/api/workspaces/${effectiveWorkspaceId}/tasks/${taskIdResolved}/subtasks`],
    queryFn: () => customFetch(`/api/workspaces/${effectiveWorkspaceId}/tasks/${taskIdResolved}/subtasks`),
    enabled: open && !!taskIdResolved && !!effectiveWorkspaceId,
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
      if (task && isEditing) {
        setTitle(task.title ?? "");
        setDescription(task.description ?? "");
        setAssignedTo(task.assignedTo ?? "unassigned");
        setPriority(task.priority ?? "medium");
        setDueDate(task.dueDate ? task.dueDate.split("T")[0] : "");
        setStatus(task.status ?? "pending");
        setTaskWorkspaceId(task.workspaceId ?? null);
        setTaskMapId(task.mapId ?? null);
      } else if (!isEditing) {
        setTitle("");
        setDescription("");
        setAssignedTo("unassigned");
        setPriority("medium");
        setDueDate("");
        setStatus("pending");
        setLocalSubtasks([]);
      }
    }
  }, [task, isEditing, open, isCardMode]);

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
      customFetch(`/api/workspaces/${effectiveWorkspaceId}/tasks/${taskIdResolved}/subtasks`, {
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

  const saveMutation = useMutation({
    mutationFn: (body: UpdateTaskPayload) =>
      customFetch(isStandalone ? `/api/my-tasks/${resolvedTaskId}` : `/api/workspaces/${effectiveWorkspaceId}/tasks/${resolvedTaskId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      invalidateTask();
      if (isStandalone) {
        queryClient.invalidateQueries({ queryKey: [`/api/my-tasks/${resolvedTaskId}`] });
        queryClient.invalidateQueries({ queryKey: [`task-activities`, "standalone", resolvedTaskId] });
      } else {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${effectiveWorkspaceId}/tasks/${resolvedTaskId}`] });
        queryClient.invalidateQueries({ queryKey: [`task-activities`, effectiveWorkspaceId, resolvedTaskId] });
      }
    },
    onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: (newStatus: string) =>
      customFetch(isStandalone ? `/api/my-tasks/${resolvedTaskId}/status` : `/api/workspaces/${effectiveWorkspaceId}/tasks/${resolvedTaskId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      }),
    onSuccess: () => {
      invalidateTask();
      if (isStandalone) {
        queryClient.invalidateQueries({ queryKey: [`/api/my-tasks/${resolvedTaskId}`] });
        queryClient.invalidateQueries({ queryKey: [`task-activities`, "standalone", resolvedTaskId] });
      } else {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${effectiveWorkspaceId}/tasks/${resolvedTaskId}`] });
        queryClient.invalidateQueries({ queryKey: [`task-activities`, effectiveWorkspaceId, resolvedTaskId] });
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
          body: JSON.stringify({ title: "Nova tarefa", priority: "medium" }),
        });
      }
      return customFetch("/api/my-tasks", {
        method: "POST",
        body: JSON.stringify({ title: "Nova tarefa", priority: "medium" }),
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

      setTitle("Nova tarefa");
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
    };
    if (!isStandalone) {
      payload.assignedTo = assignedTo === "unassigned" ? null : assignedTo;
    }
    saveMutation.mutate(payload);
    if (effectiveWorkspaceId && taskIdResolved) {
      saveSubtasksMutation.mutate(localSubtasks.filter(s => s.text.trim() !== ""));
    }
  };

  const handleStatusChange = (newStatus: string) => {
    if (!isEditing) return;
    setStatus(newStatus);
    markDirty();
    if (isCardMode) handleCardStatusChange(newStatus);
    else statusMutation.mutate(newStatus);
  };

  const handleConcluir = () => {
    if (!isEditing) return;
    markDirty();
    const previousStatus = isCardMode
      ? (card?.task?.previousStatus ?? "pending")
      : (task?.previousStatus ?? "pending");
    if (status === "completed") {
      setStatus(previousStatus);
      if (isCardMode) handleCardStatusChange(previousStatus);
      else statusMutation.mutate(previousStatus);
    } else {
      setStatus("completed");
      if (isCardMode) handleCardStatusChange("completed");
      else statusMutation.mutate("completed");
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
    ? (card?.task?.overdue === true) && status !== "completed"
    : (task?.overdue === true) && status !== "completed";

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
          ) : isLoading || (isCardMode && !card) ? (
            <div className="flex-1 flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="p-5 space-y-4 flex-1">

              {/* Title + actions */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  {isOverdue && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-500 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-2 py-1 rounded-full lowercase">
                      🔴 Atrasada
                    </span>
                  )}
                  <div className="flex items-center gap-2 ml-auto">
                    {isEditing && isTaskReady && status !== "completed" && (
                      <Select value={status} onValueChange={handleStatusChange}>
                        <SelectTrigger className="h-auto w-auto px-3 py-1 rounded-full border text-xs font-semibold bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground transition-all shadow-none focus:ring-0 gap-1.5">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending"><span className="lowercase">Pendente</span></SelectItem>
                          <SelectItem value="in_progress"><span className="lowercase">Em andamento</span></SelectItem>
                          <SelectItem value="blocked"><span className="lowercase">Interrompida</span></SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    {isEditing && isTaskReady && (
                      <button
                        onClick={handleConcluir}
                        className={`text-xs font-semibold px-3 py-1 rounded-full border transition-all ${
                          status === "completed"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                            : "bg-background text-muted-foreground border-border hover:border-emerald-400 hover:text-emerald-600"
                        }`}
                      >
                        <span className="lowercase">{status === "completed" ? "Concluída" : "Concluir"}</span>
                      </button>
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
                          <Select
                            value={assignedTo}
                            onValueChange={v => {
                              setAssignedTo(v);
                              markDirty();
                              if (isCardMode) saveCardTaskDetails({ assignedTo: v });
                              else if (isEditing && resolvedTaskId) saveMutation.mutate({ assignedTo: v === "unassigned" ? null : v });
                            }}
                          >
                            <SelectTrigger className="bg-background rounded-xl h-10">
                              <SelectValue placeholder="Sem responsável" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unassigned"><span className="lowercase">Sem responsável</span></SelectItem>
                              {members?.map((m) => (
                                <SelectItem key={m.userId} value={m.userId}>{m.user.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {/* Priority */}
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1.5 flex items-center gap-1 block lowercase">
                          <Flag className="w-3 h-3" /> Prioridade
                        </label>
                        <Select
                          value={priority}
                          onValueChange={v => {
                            setPriority(v);
                            markDirty();
                            if (isCardMode) saveCardTaskDetails({ priority: v });
                            else if (isEditing && resolvedTaskId) saveMutation.mutate({ priority: v });
                          }}
                        >
                          <SelectTrigger className="bg-background rounded-xl h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low"><span className="lowercase">Baixa</span></SelectItem>
                            <SelectItem value="medium"><span className="lowercase">Média</span></SelectItem>
                            <SelectItem value="high"><span className="lowercase">Alta</span></SelectItem>
                            <SelectItem value="critical"><span className="lowercase">Máxima</span></SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Due Date */}
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1.5 flex items-center gap-1 block lowercase">
                          <Calendar className="w-3 h-3" /> Prazo
                        </label>
                        <Input
                          type="date"
                          value={dueDate}
                          onChange={e => { setDueDate(e.target.value); markDirty(); }}
                          onBlur={e => {
                            if (isCardMode) saveCardTaskDetails({ dueDate: e.target.value });
                            else if (isEditing && resolvedTaskId) saveMutation.mutate({ dueDate: e.target.value || null });
                          }}
                          className="bg-background rounded-xl h-10 text-sm"
                        />
                      </div>
                    </div>

                    {!!effectiveWorkspaceId && (
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
                    )}

                    {/* Description */}
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1 block lowercase">Descrição</label>
                      <DescriptionEditor
                        value={description}
                        onChange={v => { setDescription(v); markDirty(); }}
                        onBlur={() => {
                          if (isCardMode) saveCard();
                          else if (isEditing && resolvedTaskId) saveMutation.mutate({ description: description || null });
                        }}
                      />
                    </div>

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

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 lowercase">
              <AlertTriangle className="w-5 h-5 text-destructive" /> {deleteLabel}
            </AlertDialogTitle>
            <AlertDialogDescription className="lowercase">
              {deleteDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl lowercase">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 lowercase"
              onClick={handleDelete}
            >
              {(isDeleting || deleteCardMut.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : (isCardMode ? "Deletar" : "Excluir")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
