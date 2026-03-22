import { useState, useEffect } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useGetCard, useUpdateCard, useCreateTask, useUpdateTaskDetails, useUpdateTaskStatus, useListWorkspaceMembers, useDeleteCard, useGetMe } from "@workspace/api-client-react";
import { Loader2, Trash2, Flag, Calendar, User, AlertTriangle } from "lucide-react";
import { CommentsSection } from "@/components/maps/CommentsSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface CardPanelProps {
  workspaceId: string;
  mapId: string;
  cardId: string | null;
  onClose: () => void;
}

export function CardPanel({ workspaceId, mapId, cardId, onClose }: CardPanelProps) {
  const isOpen = !!cardId;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: card, isLoading: isCardLoading } = useGetCard(workspaceId, mapId, cardId || "", {
    query: { enabled: isOpen && !!cardId }
  });

  const { data: members } = useListWorkspaceMembers(workspaceId, {
    query: { enabled: isOpen }
  });

  const { data: me } = useGetMe({ query: { enabled: isOpen } });
  const currentUserId = me?.id ?? "";
  const isAdmin = !!(members?.find(m => m.userId === me?.id)?.role === "admin");

  const [cardTitle, setCardTitle] = useState("");
  const [cardDesc, setCardDesc] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState<any>("medium");
  const [taskStatus, setTaskStatus] = useState<any>("pending");
  const [taskAssignee, setTaskAssignee] = useState<string>("unassigned");
  const [taskDueDate, setTaskDueDate] = useState<string>("");
  const [showDeleteCard, setShowDeleteCard] = useState(false);

  useEffect(() => {
    if (card) {
      setCardTitle(card.title);
      setCardDesc(card.description || "");
      if (card.task) {
        setTaskTitle(card.task.title);
        setTaskPriority(card.task.priority);
        setTaskStatus(card.task.status);
        setTaskAssignee(card.task.assignedTo || "unassigned");
        setTaskDueDate(card.task.dueDate ? format(new Date(card.task.dueDate), "yyyy-MM-dd") : "");
      } else {
        setTaskTitle(card.title);
        setTaskPriority("medium");
        setTaskStatus("pending");
        setTaskAssignee("unassigned");
        setTaskDueDate("");
      }
    }
  }, [card]);

  const createTaskMut = useCreateTask();

  useEffect(() => {
    if (card && !card.task && cardId && !createTaskMut.isPending) {
      createTaskMut.mutate(
        { workspaceId, mapId, cardId, data: { title: card.title, priority: "medium" } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
            queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}/cards/${cardId}`] });
          }
        }
      );
    }
  }, [card, cardId]);

  const updateCardMut = useUpdateCard();
  const updateTaskDetailsMut = useUpdateTaskDetails();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}/cards/${cardId}`] });
  };

  const saveCard = () => {
    if (!cardId) return;
    updateCardMut.mutate(
      { workspaceId, mapId, cardId, data: { title: cardTitle, description: cardDesc } },
      { onSuccess: () => { invalidate(); } }
    );
  };

  const saveTaskDetails = (overrides: { priority?: string; assignedTo?: string; dueDate?: string } = {}) => {
    if (!cardId || !card?.task) return;
    const priority = overrides.priority ?? taskPriority;
    const assignedTo = overrides.assignedTo ?? taskAssignee;
    const dueDate = overrides.dueDate ?? taskDueDate;
    updateTaskDetailsMut.mutate(
      {
        workspaceId, mapId, cardId, data: {
          title: taskTitle,
          priority: priority as any,
          assignedTo: assignedTo === "unassigned" ? null : assignedTo,
          dueDate: dueDate ? new Date(dueDate + "T00:00:00").toISOString() : null,
        }
      },
      { onSuccess: () => { invalidate(); } }
    );
  };

  const handlePriorityChange = (val: string) => {
    setTaskPriority(val);
    saveTaskDetails({ priority: val });
  };

  const handleAssigneeChange = (val: string) => {
    setTaskAssignee(val);
    saveTaskDetails({ assignedTo: val });
  };

  const deleteCardMut = useDeleteCard();
  const handleDeleteCard = () => {
    if (!cardId) return;
    deleteCardMut.mutate(
      { workspaceId, mapId, cardId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          toast({ title: "Card removido do plano." });
          onClose();
        }
      }
    );
  };

  const updateTaskStatusMut = useUpdateTaskStatus();
  const handleStatusChange = (val: string) => {
    if (!cardId || !card?.task) return;
    setTaskStatus(val);
    updateTaskStatusMut.mutate(
      { workspaceId, mapId, cardId, data: { status: val as any } },
      { onSuccess: () => { invalidate(); } }
    );
  };

  const getStatusDot = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-blue-500';
      case 'in_progress': return 'bg-amber-500';
      case 'completed': return 'bg-emerald-500';
      case 'blocked': return 'bg-purple-500';
      default: return 'bg-slate-400';
    }
  };

  const isOverdue = !!(card?.task as any)?.overdue;
  const isTaskReady = !!card?.task;

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(val) => !val && onClose()}>
        <SheetContent
          className="w-[420px] sm:w-[500px] overflow-y-auto p-0 flex flex-col shadow-2xl"
        >
          {isCardLoading || !card ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {/* Form */}
              <div className="p-5 space-y-4 flex-1">

                {/* Title + actions */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {isOverdue && taskStatus !== "completed" && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-500 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-2 py-1 rounded-full lowercase">
                        🔴 Atrasada
                      </span>
                    )}
                    <div className="flex items-center gap-2 ml-auto">
                      {isTaskReady && taskStatus !== "completed" && (
                        <Select value={taskStatus} onValueChange={handleStatusChange}>
                          <SelectTrigger className="h-auto w-auto px-3 py-1 rounded-full border text-xs font-semibold bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground transition-all shadow-none focus:ring-0 gap-1.5">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending"><span className="lowercase">⏳ Pendente</span></SelectItem>
                            <SelectItem value="in_progress"><span className="lowercase">🔄 Em andamento</span></SelectItem>
                            <SelectItem value="blocked"><span className="lowercase">🚫 Interrompida</span></SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      {isTaskReady && (
                        <button
                          onClick={() => {
                            if (taskStatus === "completed") {
                              const revertTo = (card?.task as any)?.previousStatus || "pending";
                              handleStatusChange(revertTo);
                            } else {
                              handleStatusChange("completed");
                            }
                          }}
                          className={`text-xs font-semibold px-3 py-1 rounded-full border transition-all ${
                            taskStatus === "completed"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                              : "bg-background text-muted-foreground border-border hover:border-emerald-400 hover:text-emerald-600"
                          }`}
                        >
                          {taskStatus === "completed" ? "✓ Concluída" : "Concluir"}
                        </button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowDeleteCard(true)}
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
                        title="deletar card"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1 block lowercase">Título</label>
                    <Input
                      value={cardTitle}
                      onChange={e => setCardTitle(e.target.value)}
                      onBlur={saveCard}
                      className="bg-background rounded-xl"
                    />
                  </div>
                </div>

                {/* Assignee */}
                {isTaskReady && (
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1.5 flex items-center gap-1 block lowercase">
                      <User className="w-3 h-3" /> Responsável
                    </label>
                    <Select value={taskAssignee} onValueChange={handleAssigneeChange}>
                      <SelectTrigger className="bg-background rounded-xl h-10">
                        <SelectValue placeholder="Sem responsável" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned"><span className="lowercase">Sem responsável</span></SelectItem>
                        {members?.map(m => (
                          <SelectItem key={m.userId} value={m.userId}>{m.user.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="border-t pt-4">
                  {!isTaskReady ? (
                    <div className="flex items-center justify-center py-4 gap-3 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm lowercase">Preparando tarefa…</span>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        {/* Priority */}
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1.5 flex items-center gap-1 block lowercase">
                            <Flag className="w-3 h-3" /> Prioridade
                          </label>
                          <Select value={taskPriority} onValueChange={handlePriorityChange}>
                            <SelectTrigger className="bg-background rounded-xl h-10">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low"><span className="lowercase">Baixa</span></SelectItem>
                              <SelectItem value="medium"><span className="lowercase">Média</span></SelectItem>
                              <SelectItem value="high"><span className="lowercase">Alta</span></SelectItem>
                              <SelectItem value="critical"><span className="lowercase">Crítica</span></SelectItem>
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
                            value={taskDueDate}
                            onChange={e => setTaskDueDate(e.target.value)}
                            onBlur={e => saveTaskDetails({ dueDate: e.target.value })}
                            className="bg-background rounded-xl h-10 text-sm"
                          />
                        </div>
                      </div>

                      {/* Description */}
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground tracking-wider mb-1 block lowercase">Descrição</label>
                        <Textarea
                          value={cardDesc}
                          onChange={e => setCardDesc(e.target.value)}
                          onBlur={saveCard}
                          className="bg-background rounded-xl resize-none min-h-[72px]"
                          placeholder="Descrição opcional..."
                        />
                      </div>

                    </div>
                  )}
                </div>

                {/* Comments */}
                {cardId && (
                  <CommentsSection
                    workspaceId={workspaceId}
                    mapId={mapId}
                    cardId={cardId}
                    currentUserId={currentUserId}
                    isAdmin={isAdmin}
                  />
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete Card Confirmation */}
      <AlertDialog open={showDeleteCard} onOpenChange={setShowDeleteCard}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 lowercase">
              <AlertTriangle className="w-5 h-5 text-destructive" /> Deletar card?
            </AlertDialogTitle>
            <AlertDialogDescription className="lowercase">
              O card e sua tarefa serão removidos permanentemente do plano. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl lowercase">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 lowercase"
              onClick={handleDeleteCard}
            >
              {deleteCardMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Deletar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
