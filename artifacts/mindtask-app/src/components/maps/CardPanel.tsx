import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useGetCard, useUpdateCard, useCreateTask, useUpdateTaskDetails, useUpdateTaskStatus, useListWorkspaceMembers, useDeleteCard } from "@workspace/api-client-react";
import { Loader2, CheckCircle2, Save, Trash2, X, Flag, Calendar, User, AlertTriangle } from "lucide-react";
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

  const [cardTitle, setCardTitle] = useState("");
  const [cardDesc, setCardDesc] = useState("");

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
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
        setTaskDesc(card.task.description || "");
        setTaskPriority(card.task.priority);
        setTaskStatus(card.task.status);
        setTaskAssignee(card.task.assignedTo || "unassigned");
        setTaskDueDate(card.task.dueDate ? format(new Date(card.task.dueDate), "yyyy-MM-dd") : "");
      } else {
        setTaskTitle(card.title);
        setTaskDesc("");
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
  const handleSaveCard = () => {
    if (!cardId) return;
    updateCardMut.mutate(
      { workspaceId, mapId, cardId, data: { title: cardTitle, description: cardDesc } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}/cards/${cardId}`] });
          toast({ title: "Card atualizado." });
        }
      }
    );
  };

  const deleteCardMut = useDeleteCard();
  const handleDeleteCard = () => {
    if (!cardId) return;
    deleteCardMut.mutate(
      { workspaceId, mapId, cardId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          toast({ title: "Card removido do mapa." });
          onClose();
        }
      }
    );
  };

  const updateTaskDetailsMut = useUpdateTaskDetails();
  const handleUpdateTaskDetails = () => {
    if (!cardId || !card?.task) return;
    updateTaskDetailsMut.mutate(
      {
        workspaceId, mapId, cardId, data: {
          title: taskTitle,
          description: taskDesc || null,
          priority: taskPriority,
          assignedTo: taskAssignee === "unassigned" ? null : taskAssignee,
          dueDate: taskDueDate ? new Date(taskDueDate + "T00:00:00").toISOString() : null,
        }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}/cards/${cardId}`] });
          toast({ title: "Detalhes da tarefa atualizados." });
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
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}/cards/${cardId}`] });
          toast({ title: "Status atualizado. O card foi sincronizado." });
        }
      }
    );
  };

  const getStatusDot = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-blue-500';
      case 'in_progress': return 'bg-amber-500';
      case 'completed': return 'bg-emerald-500';
      case 'overdue': return 'bg-red-500';
      default: return 'bg-slate-400';
    }
  };

  const isTaskReady = !!card?.task;

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(val) => !val && onClose()}>
        <SheetContent className="w-[420px] sm:w-[500px] overflow-y-auto p-0 flex flex-col shadow-2xl">
          {isCardLoading || !card ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="p-6 bg-slate-50 dark:bg-slate-900 border-b">
                <div className="flex items-center justify-between mb-1">
                  <SheetHeader className="text-left flex-1">
                    <SheetTitle className="text-xl font-display">Editar Card</SheetTitle>
                    <SheetDescription className="text-sm">Atualize o nó e gerencie sua tarefa.</SheetDescription>
                  </SheetHeader>
                  <div className="flex items-center gap-1 ml-4">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowDeleteCard(true)}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
                      title="Deletar card"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={onClose}
                      className="h-8 w-8 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="p-5 space-y-5 flex-1">
                {/* Card Section */}
                <div className="space-y-4 bg-card rounded-2xl p-5 border shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 flex items-center justify-center text-xs font-bold">N</div>
                    <h3 className="font-semibold text-foreground text-sm">Informações do Nó</h3>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Título</label>
                      <Input value={cardTitle} onChange={e => setCardTitle(e.target.value)} className="bg-background rounded-xl" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Descrição</label>
                      <Textarea value={cardDesc} onChange={e => setCardDesc(e.target.value)} className="bg-background rounded-xl resize-none min-h-[72px]" placeholder="Descrição opcional..." />
                    </div>
                    <Button onClick={handleSaveCard} disabled={updateCardMut.isPending} size="sm" className="rounded-xl w-full">
                      {updateCardMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                      Salvar Card
                    </Button>
                  </div>
                </div>

                {/* Task Section */}
                <div className="space-y-4 bg-card rounded-2xl p-5 border shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 flex items-center justify-center">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </div>
                    <h3 className="font-semibold text-foreground text-sm">Execução de Tarefa</h3>
                  </div>

                  {!isTaskReady ? (
                    <div className="flex items-center justify-center py-6 gap-3 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Preparando tarefa…</span>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Status */}
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5 block">
                          <span className={`w-2 h-2 rounded-full inline-block ${getStatusDot(taskStatus)}`} />
                          Status
                        </label>
                        <Select value={taskStatus} onValueChange={handleStatusChange}>
                          <SelectTrigger className="bg-background rounded-xl h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">⏳ Pendente</SelectItem>
                            <SelectItem value="in_progress">🔄 Em andamento</SelectItem>
                            <SelectItem value="completed">✅ Concluída</SelectItem>
                            <SelectItem value="overdue">🔴 Atrasada</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] text-muted-foreground mt-1.5">Alterar o status sincroniza a cor do card no canvas.</p>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        {/* Priority */}
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1 block">
                            <Flag className="w-3 h-3" /> Prioridade
                          </label>
                          <Select value={taskPriority} onValueChange={setTaskPriority}>
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

                        {/* Due Date */}
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1 block">
                            <Calendar className="w-3 h-3" /> Prazo
                          </label>
                          <Input
                            type="date"
                            value={taskDueDate}
                            onChange={e => setTaskDueDate(e.target.value)}
                            className="bg-background rounded-xl h-10 text-sm"
                          />
                        </div>
                      </div>

                      {/* Assignee */}
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1 block">
                          <User className="w-3 h-3" /> Responsável
                        </label>
                        <Select value={taskAssignee} onValueChange={setTaskAssignee}>
                          <SelectTrigger className="bg-background rounded-xl h-10">
                            <SelectValue placeholder="Sem responsável" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Sem responsável</SelectItem>
                            {members?.map(m => (
                              <SelectItem key={m.userId} value={m.userId}>{m.user.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Task Title */}
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Título da Tarefa</label>
                        <Input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} className="bg-background rounded-xl" />
                      </div>

                      {/* Task Description */}
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Detalhes</label>
                        <Textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)} className="bg-background rounded-xl resize-none min-h-[80px]" placeholder="Descreva os critérios de conclusão..." />
                      </div>

                      <Button onClick={handleUpdateTaskDetails} disabled={updateTaskDetailsMut.isPending} className="rounded-xl w-full">
                        {updateTaskDetailsMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                        Salvar Detalhes
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete Card Confirmation */}
      <AlertDialog open={showDeleteCard} onOpenChange={setShowDeleteCard}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" /> Deletar card?
            </AlertDialogTitle>
            <AlertDialogDescription>
              O card e sua tarefa serão removidos permanentemente do mapa. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
