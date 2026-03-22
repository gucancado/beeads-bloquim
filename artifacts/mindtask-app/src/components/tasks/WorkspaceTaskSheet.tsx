import { useState, useEffect } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Trash2, Flag, Calendar, User, AlertTriangle } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CommentsSection } from "@/components/maps/CommentsSection";

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

interface Props {
  workspaceId: string;
  taskId: string | null;
  open: boolean;
  onClose: () => void;
}

function translatePriority(p: string) {
  switch (p) {
    case 'critical': return 'Crítica';
    case 'high': return 'Alta';
    case 'medium': return 'Média';
    case 'low': return 'Baixa';
    default: return p;
  }
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

  const isEditing = !!taskId;

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
    }
  }, [task, isEditing, open]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/my-tasks"] });
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks`] });
  };

  const createMutation = useMutation({
    mutationFn: (body: Record<string, any>) =>
      customFetch(`/api/workspaces/${workspaceId}/tasks`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
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
      saveMutation.mutate({
        title,
        description: description || null,
        assignedTo: assignedTo === "unassigned" ? null : assignedTo,
        priority,
        dueDate: dueDate || null,
      });
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

  const members = membersData as Member[] | undefined;
  const isAdmin = members?.find((m) => m.user.id === currentUserId)?.role === "admin" ?? false;

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col gap-0 overflow-y-auto">
          {isEditing && isLoading ? (
            <div className="flex-1 flex items-center justify-center">
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
                        <SelectItem value="pending">⏳ Pendente</SelectItem>
                        <SelectItem value="in_progress">🔄 Em andamento</SelectItem>
                        <SelectItem value="blocked">🚫 Interrompida</SelectItem>
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
                      {status === "completed" ? "✓ Concluída" : "Concluir"}
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
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Título</label>
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
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1 block">
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
                    <SelectItem value="unassigned">Sem responsável</SelectItem>
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
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1 block">
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
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1 block">
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

                {/* Description */}
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Descrição</label>
                  <Textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    onBlur={() => isEditing && saveMutation.mutate({ description: description || null })}
                    className="bg-background rounded-xl resize-none min-h-[72px]"
                    placeholder="Descrição opcional..."
                  />
                </div>

                {/* Create button (only for new tasks) */}
                {!isEditing && (
                  <Button
                    onClick={handleSave}
                    disabled={createMutation.isPending || !title.trim()}
                    className="w-full rounded-xl"
                  >
                    {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar Tarefa"}
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
        </SheetContent>
      </Sheet>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" /> Excluir tarefa?
            </AlertDialogTitle>
            <AlertDialogDescription>
              A tarefa será removida permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
