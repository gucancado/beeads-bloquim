import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useGetCard, useUpdateCard, useCreateTask, useUpdateTaskDetails, useUpdateTaskStatus, useUnlinkTask, useListWorkspaceMembers } from "@workspace/api-client-react";
import { Loader2, Calendar as CalendarIcon, CheckCircle2, User, Flag, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

  // Local state for editing card
  const [cardTitle, setCardTitle] = useState("");
  const [cardDesc, setCardDesc] = useState("");
  
  // Local state for editing task
  const [isTaskMode, setIsTaskMode] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskPriority, setTaskPriority] = useState<any>("medium");
  const [taskStatus, setTaskStatus] = useState<any>("pending");
  const [taskAssignee, setTaskAssignee] = useState<string>("unassigned");

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
      }
    }
  }, [card]);

  const updateCardMut = useUpdateCard();
  const handleSaveCard = () => {
    if (!cardId) return;
    updateCardMut.mutate(
      { workspaceId, mapId, cardId, data: { title: cardTitle, description: cardDesc } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          toast({ title: "Card updated" });
        }
      }
    );
  };

  const createTaskMut = useCreateTask();
  const handleCreateTask = () => {
    if (!cardId) return;
    createTaskMut.mutate(
      { 
        workspaceId, 
        mapId, 
        cardId, 
        data: { 
          title: cardTitle, 
          description: cardDesc,
          priority: "medium",
        } 
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}/cards/${cardId}`] });
          toast({ title: "Task created and linked" });
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
          description: taskDesc,
          priority: taskPriority,
          assignedTo: taskAssignee === "unassigned" ? null : taskAssignee
        }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          toast({ title: "Task details updated" });
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
          toast({ title: "Status updated" });
        }
      }
    );
  };

  const unlinkTaskMut = useUnlinkTask();
  const handleUnlink = () => {
    if (!cardId) return;
    unlinkTaskMut.mutate(
      { workspaceId, mapId, cardId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}/cards/${cardId}`] });
          toast({ title: "Task removed" });
        }
      }
    );
  };

  return (
    <Sheet open={isOpen} onOpenChange={(val) => !val && onClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto p-0 flex flex-col border-l-0 shadow-2xl">
        {isCardLoading || !card ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="p-6 bg-slate-50 dark:bg-slate-900 border-b relative">
              <div className="absolute top-6 right-6">
                <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full h-8 w-8 hover:bg-slate-200 dark:hover:bg-slate-800">
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <SheetHeader className="pr-8 text-left">
                <SheetTitle className="text-2xl font-display">Edit Card</SheetTitle>
                <SheetDescription>Update the visual node or manage its task.</SheetDescription>
              </SheetHeader>
            </div>

            <div className="p-6 space-y-8">
              {/* Card Section */}
              <div className="space-y-4 bg-card rounded-2xl p-5 border shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 flex items-center justify-center">
                    <span className="font-bold text-sm">C</span>
                  </div>
                  <h3 className="font-semibold text-foreground">Visual Card Info</h3>
                </div>
                
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Title</label>
                    <Input value={cardTitle} onChange={e => setCardTitle(e.target.value)} className="bg-background rounded-xl" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Description</label>
                    <Textarea value={cardDesc} onChange={e => setCardDesc(e.target.value)} className="bg-background rounded-xl resize-none min-h-[80px]" />
                  </div>
                  <Button onClick={handleSaveCard} disabled={updateCardMut.isPending} size="sm" className="rounded-xl w-full">
                    {updateCardMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Save className="w-4 h-4 mr-2"/>}
                    Save Card
                  </Button>
                </div>
              </div>

              {/* Task Section */}
              <div className="space-y-4 bg-card rounded-2xl p-5 border shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                    <h3 className="font-semibold text-foreground">Task Execution</h3>
                  </div>
                  {card.task && (
                    <Button variant="ghost" size="sm" onClick={handleUnlink} className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 px-2 rounded-lg">
                      <Trash2 className="w-4 h-4 mr-1" /> Remove
                    </Button>
                  )}
                </div>

                {!card.task ? (
                  <div className="text-center py-6">
                    <p className="text-sm text-muted-foreground mb-4">This card is just a visual node. Link a task to track execution.</p>
                    <Button onClick={handleCreateTask} disabled={createTaskMut.isPending} className="rounded-xl px-6">
                      {createTaskMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Plus className="w-4 h-4 mr-2"/>}
                      Convert to Task
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Status</label>
                        <Select value={taskStatus} onValueChange={handleStatusChange}>
                          <SelectTrigger className="bg-background rounded-xl h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="in_progress">In Progress</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                            <SelectItem value="overdue">Overdue</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Priority</label>
                        <Select value={taskPriority} onValueChange={setTaskPriority}>
                          <SelectTrigger className="bg-background rounded-xl h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="critical">Critical</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Assignee</label>
                      <Select value={taskAssignee} onValueChange={setTaskAssignee}>
                        <SelectTrigger className="bg-background rounded-xl h-10">
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {members?.map(m => (
                            <SelectItem key={m.userId} value={m.userId}>{m.user.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Task Title (Syncs with Card)</label>
                      <Input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} className="bg-background rounded-xl" />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Task Details</label>
                      <Textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)} className="bg-background rounded-xl resize-none min-h-[100px]" />
                    </div>

                    <Button onClick={handleUpdateTaskDetails} disabled={updateTaskDetailsMut.isPending} className="rounded-xl w-full">
                      {updateTaskDetailsMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin"/> : <Save className="w-4 h-4 mr-2"/>}
                      Save Task Details
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
