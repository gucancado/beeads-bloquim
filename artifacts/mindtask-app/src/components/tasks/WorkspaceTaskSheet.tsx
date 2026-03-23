import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DescriptionEditor } from "@/components/tasks/DescriptionEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Trash2, Flag, Calendar, User, AlertTriangle, ListChecks, GripVertical, Check } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CommentsSection } from "@/components/maps/CommentsSection";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { KeyboardSensor } from "@dnd-kit/core";

interface Member { userId: string; role: string; user: { id: string; name: string; email: string; }; }

interface WorkspaceTask {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  priority: string;
  status: string;
  previousStatus?: string | null;
  overdue?: boolean;
  members?: Member[];
}

interface SubtaskItem {
  id: string;
  text: string;
  completed: boolean;
  order: number;
}

interface Props {
  workspaceId: string;
  taskId: string | null;
  open: boolean;
  onClose: () => void;
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

export function WorkspaceTaskSheet({ workspaceId, taskId, open, onClose }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: me } = useGetMe({ query: { enabled: open } });
  const currentUserId = me?.id ?? "";

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("unassigned");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState("pending");
  const [showDelete, setShowDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [localSubtasks, setLocalSubtasks] = useState<SubtaskItem[]>([]);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const isEditing = !!taskId;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const { data: task, isLoading } = useQuery<WorkspaceTask>({
    queryKey: [`/api/workspaces/${workspaceId}/tasks/${taskId}`],
    queryFn: () => customFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}`),
    enabled: isEditing && open,
  });

  const { data: membersData } = useQuery<Member[]>({
    queryKey: [`/api/workspaces/${workspaceId}/members`],
    queryFn: () => customFetch(`/api/workspaces/${workspaceId}/members`),
    enabled: open,
  });

  const { data: subtasksData } = useQuery<SubtaskItem[]>({
    queryKey: [`/api/workspaces/${workspaceId}/tasks/${taskId}/subtasks`],
    queryFn: () => customFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/subtasks`),
    enabled: isEditing && open && !!taskId,
  });

  useEffect(() => {
    if (subtasksData) {
      setLocalSubtasks(subtasksData);
    }
  }, [subtasksData]);

  useEffect(() => {
    if (task && isEditing) {
      setTitle(task.title ?? "");
      setDescription(task.description ?? "");
      setAssignedTo(task.assignedTo ?? "unassigned");
      setPriority(task.priority ?? "medium");
      setDueDate(task.dueDate ? task.dueDate.split("T")[0] : "");
      setStatus(task.status ?? "pending");
    } else if (!isEditing) {
      setTitle("");
      setDescription("");
      setAssignedTo("unassigned");
      setPriority("medium");
      setDueDate("");
      setStatus("pending");
      setLocalSubtasks([]);
    }
  }, [task, isEditing, open]);

  useEffect(() => {
    if (pendingFocusId && inputRefs.current[pendingFocusId]) {
      inputRefs.current[pendingFocusId]?.focus();
      setPendingFocusId(null);
    }
  }, [pendingFocusId, localSubtasks]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/my-tasks"] });
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks`] });
  };

  const saveSubtasksMutation = useMutation({
    mutationFn: (items: SubtaskItem[]) =>
      customFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/subtasks`, {
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

  const createMutation = useMutation({
    mutationFn: (body: Record<string, any>) =>
      customFetch(`/api/workspaces/${workspaceId}/tasks`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async (newTask: { id: string }) => {
      const nonEmptySubtasks = localSubtasks.filter(s => s.text.trim() !== "");
      if (nonEmptySubtasks.length > 0) {
        try {
          await customFetch(`/api/workspaces/${workspaceId}/tasks/${newTask.id}/subtasks`, {
            method: "PUT",
            body: JSON.stringify({
              subtasks: nonEmptySubtasks.map((s, idx) => ({
                text: s.text,
                completed: s.completed,
                order: idx,
              })),
            }),
          });
        } catch (err) {
          console.error("Erro ao salvar subtarefas:", err);
        }
      }
      toast({ title: "Tarefa criada!" });
      invalidate();
      onClose();
    },
    onError: (err: any) => {
      console.error("Erro ao criar tarefa:", err);
      toast({ title: "Erro ao criar tarefa", description: err?.message ?? String(err), variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, any>) =>
      customFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks/${taskId}`] });
    },
    onError: () => toast({ title: "Erro ao salvar", variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: (newStatus: string) =>
      customFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      }),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks/${taskId}`] });
    },
    onError: () => toast({ title: "Erro ao atualizar status", variant: "destructive" }),
  });

  const handleSave = () => {
    if (isEditing) {
      const nonEmptySubtasks = localSubtasks.filter(s => s.text.trim() !== "");
      saveMutation.mutate({
        title,
        description: description || null,
        assignedTo: assignedTo === "unassigned" ? null : assignedTo,
        priority,
        dueDate: dueDate || null,
      });
      saveSubtasksMutation.mutate(nonEmptySubtasks);
    } else {
      createMutation.mutate({
        title,
        description: description || null,
        assignedTo: assignedTo === "unassigned" ? null : assignedTo,
        priority,
        dueDate: dueDate || null,
      });
    }
  };

  const handleStatusChange = (newStatus: string) => {
    setStatus(newStatus);
    statusMutation.mutate(newStatus);
  };

  const handleConcluir = () => {
    if (status === "completed") {
      const revert = task?.previousStatus || "pending";
      setStatus(revert);
      statusMutation.mutate(revert);
    } else {
      setStatus("completed");
      statusMutation.mutate("completed");
    }
  };

  const handleDelete = async () => {
    if (!taskId) return;
    setIsDeleting(true);
    try {
      await customFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}`, { method: "DELETE" });
      toast({ title: "Tarefa excluída" });
      invalidate();
      onClose();
    } catch {
      toast({ title: "Erro ao excluir tarefa", variant: "destructive" });
    } finally {
      setIsDeleting(false);
      setShowDelete(false);
    }
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
  };

  const handleSubtaskChange = (id: string, text: string) => {
    setLocalSubtasks(prev => prev.map(s => s.id === id ? { ...s, text } : s));
  };

  const handleSubtaskToggle = (id: string) => {
    const updated = localSubtasks.map(s => s.id === id ? { ...s, completed: !s.completed } : s);
    setLocalSubtasks(updated);
    if (isEditing) {
      saveSubtasksMutation.mutate(updated.filter(s => s.text.trim() !== ""));
    }
  };

  const handleSubtaskBlur = (id: string) => {
    const subtask = localSubtasks.find(s => s.id === id);
    if (subtask && subtask.text.trim() === "") {
      const updated = localSubtasks.filter(s => s.id !== id);
      setLocalSubtasks(updated);
      if (isEditing) {
        saveSubtasksMutation.mutate(updated.filter(s => s.text.trim() !== ""));
      }
    } else if (isEditing) {
      const nonEmpty = localSubtasks.filter(s => s.text.trim() !== "");
      saveSubtasksMutation.mutate(nonEmpty);
    }
  };

  const handleSubtaskKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === "Backspace") {
      const subtask = localSubtasks.find(s => s.id === id);
      if (subtask && subtask.text === "") {
        e.preventDefault();
        const updated = localSubtasks.filter(s => s.id !== id);
        setLocalSubtasks(updated);
        if (isEditing) {
          saveSubtasksMutation.mutate(updated.filter(s => s.text.trim() !== ""));
        }
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      addSubtask(id);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setLocalSubtasks(prev => {
        const oldIndex = prev.findIndex(s => s.id === active.id);
        const newIndex = prev.findIndex(s => s.id === over.id);
        const reordered = arrayMove(prev, oldIndex, newIndex);
        if (isEditing) {
          saveSubtasksMutation.mutate(reordered.filter(s => s.text.trim() !== ""));
        }
        return reordered;
      });
    }
  };

  const members = membersData as Member[] | undefined;
  const isAdmin = members?.find((m) => m.user.id === currentUserId)?.role === "admin" ?? false;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="w-full max-w-2xl p-0 flex flex-col gap-0 overflow-y-auto max-h-[90vh] rounded-2xl">
          {isEditing && isLoading ? (
            <div className="flex-1 flex items-center justify-center p-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="p-5 space-y-4 flex-1">
              {/* Action bar */}
              <div className="flex items-center gap-2 mb-1">
                <div className="flex items-center gap-2 ml-auto">
                  {isEditing && status !== "completed" && (
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
                  {isEditing && (
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
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1 block lowercase">Título</label>
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  onBlur={() => isEditing && title.trim() && handleSave()}
                  className="bg-background rounded-xl"
                  placeholder="Nome da tarefa"
                />
              </div>

              {/* Assignee */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1.5 flex items-center gap-1 block lowercase">
                  <User className="w-3 h-3" /> Responsável
                </label>
                <Select
                  value={assignedTo}
                  onValueChange={v => {
                    setAssignedTo(v);
                    if (isEditing) saveMutation.mutate({ assignedTo: v === "unassigned" ? null : v });
                  }}
                >
                  <SelectTrigger className="bg-background rounded-xl h-10">
                    <SelectValue placeholder="Sem responsável" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned"><span className="lowercase">Sem responsável</span></SelectItem>
                    {members?.map((m) => (
                      <SelectItem key={m.user.id} value={m.user.id}>{m.user.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="border-t pt-4 space-y-4">
                {/* Priority + Due Date */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1.5 flex items-center gap-1 block lowercase">
                      <Flag className="w-3 h-3" /> Prioridade
                    </label>
                    <Select
                      value={priority}
                      onValueChange={v => {
                        setPriority(v);
                        if (isEditing) saveMutation.mutate({ priority: v });
                      }}
                    >
                      <SelectTrigger className="bg-background rounded-xl h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Baixa</SelectItem>
                        <SelectItem value="medium">Média</SelectItem>
                        <SelectItem value="high">Alta</SelectItem>
                        <SelectItem value="critical">Crítica</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1.5 flex items-center gap-1 block lowercase">
                      <Calendar className="w-3 h-3" /> Prazo
                    </label>
                    <Input
                      type="date"
                      value={dueDate}
                      onChange={e => setDueDate(e.target.value)}
                      onBlur={e => isEditing && saveMutation.mutate({ dueDate: e.target.value || null })}
                      className="bg-background rounded-xl h-10 text-sm"
                    />
                  </div>
                </div>

                {/* Subtasks section */}
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
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                      >
                        <SortableContext
                          items={localSubtasks.map(s => s.id)}
                          strategy={verticalListSortingStrategy}
                        >
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
                    onChange={setDescription}
                    onBlur={() => isEditing && saveMutation.mutate({ description: description || null })}
                  />
                </div>

                {/* Create button (only for new tasks) */}
                {!isEditing && (
                  <Button
                    onClick={handleSave}
                    disabled={createMutation.isPending || !title.trim()}
                    className="w-full rounded-xl"
                  >
                    {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="lowercase">Criar Tarefa</span>}
                  </Button>
                )}
              </div>

              {isEditing && taskId && (
                <CommentsSection
                  workspaceId={workspaceId}
                  taskId={taskId}
                  currentUserId={currentUserId}
                  isAdmin={isAdmin}
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
              <AlertTriangle className="w-5 h-5 text-destructive" /> Excluir tarefa?
            </AlertDialogTitle>
            <AlertDialogDescription className="lowercase">
              A tarefa será removida permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl lowercase">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 lowercase"
              onClick={handleDelete}
            >
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
