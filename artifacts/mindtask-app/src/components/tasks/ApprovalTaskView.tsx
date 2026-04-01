import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, ClipboardCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react";
import { getStatusLabel } from "@/lib/taskStatusConstants";
import { ApprovalTaskActivityHistory } from "@/components/maps/CommentsSection";

interface ParentTask {
  id: string;
  title: string;
  status: string;
  completedAt: string | null;
}

interface ApprovalTaskDetail {
  id: string;
  workspaceId: string;
  title: string;
  assignedTo: string | null;
  assigneeName: string | null;
  assigneeAvatarUrl: string | null;
  approvalStatus: string | null;
  approvalComment: string | null;
  parentTask: ParentTask | null;
  parentTaskId: string | null;
}

interface ApprovalTaskViewProps {
  taskId: string;
  workspaceId: string;
  onClose: () => void;
}

function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    completed:   "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800",
    in_progress: "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800",
    pending:     "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800",
    blocked:     "bg-slate-50 text-slate-700 border-slate-300 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700",
    overdue:     "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800",
    draft:       "bg-purple-50 text-purple-700 border-purple-300 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800",
  };
  return map[status] ?? "bg-muted text-muted-foreground border-border";
}

function formatCompletedAt(completedAt: string | null): string | null {
  if (!completedAt) return null;
  const d = new Date(completedAt);
  if (isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString("pt-BR");
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `concluída em ${date} às ${time}`;
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ApprovalTaskView({ taskId, workspaceId, onClose }: ApprovalTaskViewProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);

  const { data: task, isLoading } = useQuery<ApprovalTaskDetail>({
    queryKey: [`/api/workspaces/${workspaceId}/tasks/${taskId}`],
    queryFn: () => customFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}`),
    enabled: !!taskId && !!workspaceId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks`] });
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks/${taskId}`] });
    queryClient.invalidateQueries({ queryKey: ["task-activities", workspaceId, taskId] });
    if (task?.parentTaskId) {
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks/${task.parentTaskId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks/${task.parentTaskId}/approvals`] });
      queryClient.invalidateQueries({ queryKey: ["task-activities", workspaceId, task.parentTaskId] });
    }
  };

  const approveMut = useMutation({
    mutationFn: () =>
      customFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/approve`, {
        method: "POST",
        body: JSON.stringify({ comment: comment.trim() || null }),
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Tarefa aprovada com sucesso." });
      onClose();
    },
    onError: () => toast({ title: "Erro ao aprovar tarefa", variant: "destructive" }),
    onSettled: () => setPending(false),
  });

  const rejectMut = useMutation({
    mutationFn: () =>
      customFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/reject`, {
        method: "POST",
        body: JSON.stringify({ comment: comment.trim() || null }),
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Tarefa reprovada." });
      onClose();
    },
    onError: () => toast({ title: "Erro ao reprovar tarefa", variant: "destructive" }),
    onSettled: () => setPending(false),
  });

  const handleApprove = () => {
    setPending(true);
    approveMut.mutate();
  };

  const handleReject = () => {
    setPending(true);
    rejectMut.mutate();
  };

  if (isLoading || !task) {
    return (
      <div className="flex-1 flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const parentStatus = task.parentTask?.status ?? "";
  const completedLabel =
    parentStatus === "completed"
      ? formatCompletedAt(task.parentTask?.completedAt ?? null)
      : null;

  return (
    <div className="p-6 space-y-6">

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400">
          <ClipboardCheck className="w-4 h-4" />
          <span className="text-xs font-semibold tracking-wider lowercase">tarefa de aprovação</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-7 w-7 text-muted-foreground hover:text-foreground rounded-lg"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Approver (read-only) */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground tracking-wider lowercase">aprovador</p>
        <div className="flex items-center gap-3 px-3 py-2.5 bg-muted/40 rounded-xl border border-border">
          {task.assigneeAvatarUrl ? (
            <img
              src={task.assigneeAvatarUrl}
              alt={task.assigneeName ?? ""}
              className="w-9 h-9 rounded-full object-cover ring-2 ring-violet-300 dark:ring-violet-700 flex-shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 flex items-center justify-center text-sm font-semibold flex-shrink-0 ring-2 ring-violet-300 dark:ring-violet-700">
              {getInitials(task.assigneeName)}
            </div>
          )}
          <span className="text-sm font-medium text-foreground">
            {task.assigneeName ?? "Sem nome"}
          </span>
        </div>
      </div>

      {/* Linked common task */}
      {task.parentTask && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground tracking-wider lowercase">tarefa vinculada</p>
          <div className="px-3 py-3 bg-muted/40 rounded-xl border border-border space-y-2">
            <p className="text-sm font-semibold text-foreground leading-snug">
              {task.parentTask.title}
            </p>
            <div>
              {completedLabel ? (
                <span className={`inline-flex items-center text-xs font-medium px-2.5 py-0.5 rounded-full border lowercase ${statusBadgeClass("completed")}`}>
                  {completedLabel}
                </span>
              ) : (
                <span className={`inline-flex items-center text-xs font-medium px-2.5 py-0.5 rounded-full border lowercase ${statusBadgeClass(parentStatus)}`}>
                  {getStatusLabel(parentStatus)}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Comment field */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground tracking-wider lowercase">comentário</p>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Deixe um comentário sobre sua decisão (opcional)..."
          className="bg-background rounded-xl text-sm resize-none min-h-[96px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.stopPropagation();
            }
          }}
        />
        <p className="text-[11px] text-muted-foreground lowercase">
          o comentário é salvo ao clicar em aprovar ou reprovar
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 pt-1">
        <Button
          variant="outline"
          className="flex-1 rounded-xl border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40 lowercase font-semibold h-11"
          onClick={handleReject}
          disabled={pending}
        >
          <X className="w-4 h-4 mr-2" />
          Reprovar
        </Button>
        <Button
          className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white lowercase font-semibold h-11"
          onClick={handleApprove}
          disabled={pending}
        >
          <Check className="w-4 h-4 mr-2" />
          Aprovar
        </Button>
      </div>

      {/* Activity history of this approval task */}
      <ApprovalTaskActivityHistory workspaceId={workspaceId} taskId={taskId} />
    </div>
  );
}
