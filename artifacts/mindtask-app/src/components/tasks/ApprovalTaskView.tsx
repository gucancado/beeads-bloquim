import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, Loader2, Calendar, ExternalLink, CheckCircle2, FileText } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react";
import { getStatusLabel } from "@/lib/taskStatusConstants";
import { ConsolidatedActivityHistory } from "@/components/maps/CommentsSection";
import { ApprovalBadge, getApprovalDisplayTitle } from "@/lib/approvalTaskTitle";
import { AttachmentsSection } from "@/components/tasks/AttachmentsSection";
import { PriorityBadge } from "@/components/tasks/PriorityBadge";

interface ParentTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  scheduleMode: string | null;
  startAt: string | null;
  dueDate: string | null;
  completedAt: string | null;
  assignedTo: string | null;
  assigneeName: string | null;
  assigneeAvatarUrl: string | null;
  completedById: string | null;
  completedByName: string | null;
  completedByAvatarUrl: string | null;
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
  /** Deadline carried by the approval task itself (set by the executor when
   * sending the parent for approval). May fall back to the parent task's
   * own dueDate when the approver wasn't given a separate deadline. */
  dueDate: string | null;
  /** When the approver decided (status flipped to completed). Used to show
   * the "decisão registrada em ..." timestamp in the approval card. */
  completedAt: string | null;
  parentTask: ParentTask | null;
  parentTaskId: string | null;
}

interface ApprovalTaskViewProps {
  taskId: string;
  workspaceId: string;
  onClose: () => void;
  /** Viewer identity, forwarded to the consolidated history so hidden
   * comments stay visible/togglable for their author and workspace admins
   * (matches the standard comments view behaviour). */
  currentUserId?: string;
  isAdmin?: boolean;
}

const APPROVAL_HEADER_STATUS: Record<string, { label: string; cls: string }> = {
  approved: {
    label: "aprovado",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800",
  },
  rejected: {
    label: "reprovado",
    cls: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800",
  },
  pending: {
    label: "pendente",
    cls: "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800",
  },
};

const APP_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

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

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("pt-BR");
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString("pt-BR");
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${date} às ${time}`;
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Avatar({ name, url, size = "md" }: { name: string | null; url: string | null; size?: "sm" | "md" }) {
  const cls = size === "sm" ? "w-7 h-7 text-xs" : "w-9 h-9 text-sm";
  if (url) {
    return (
      <img
        src={url}
        alt={name ?? ""}
        className={`${cls} rounded-full object-cover ring-1 ring-border flex-shrink-0`}
      />
    );
  }
  return (
    <div className={`${cls} rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold flex-shrink-0 ring-1 ring-border`}>
      {getInitials(name)}
    </div>
  );
}

function ParentTaskCard({ parent }: { parent: ParentTask }) {
  const completedAt = parent.status === "completed" ? formatDateTime(parent.completedAt) : null;
  // Decide whether to append "por <name>" to the completion line. We compare
  // user IDs when both sides are known; if the completer ID is missing
  // (legacy rows derived only from activity metadata) we fall back to a
  // case-insensitive name match so we don't show "por <self>" by mistake.
  const completedBySelf = (() => {
    if (parent.status !== "completed") return true;
    if (parent.completedById && parent.assignedTo) {
      return parent.completedById === parent.assignedTo;
    }
    if (parent.completedByName && parent.assigneeName) {
      return parent.completedByName.trim().toLowerCase() ===
        parent.assigneeName.trim().toLowerCase();
    }
    return true;
  })();

  const descriptionHtml = parent.description?.trim();
  const hasDescription = !!descriptionHtml && descriptionHtml !== "<p></p>";

  return (
    <div className="rounded-xl border border-border bg-transparent p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {completedAt ? (
          <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-transparent text-muted-foreground lowercase">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            concluída em {completedAt}
            {!completedBySelf && (
              <> por {parent.completedByName ?? "Usuário desconhecido"}</>
            )}
          </span>
        ) : (
          <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border lowercase ${statusBadgeClass(parent.status)}`}>
            {getStatusLabel(parent.status)}
          </span>
        )}
        <PriorityBadge value={parent.priority} onChange={() => {}} disabled />
        {/* Responsible info pushed to the right edge of the same row. */}
        <div className="ml-auto flex items-center gap-2 min-w-0">
          <span className="text-[10px] text-muted-foreground tracking-wider lowercase">responsável</span>
          <Avatar name={parent.assigneeName} url={parent.assigneeAvatarUrl} size="sm" />
          <span className="text-xs font-medium text-foreground truncate">
            {parent.assigneeName ?? "Sem responsável"}
          </span>
        </div>
      </div>

      {hasDescription && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-muted-foreground tracking-wider lowercase">
            descrição
          </p>
          <div
            className="comment-rendered-content text-xs text-foreground"
            dangerouslySetInnerHTML={{ __html: descriptionHtml! }}
          />
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ task }: { task: ApprovalTaskDetail }) {
  // The approver may have been given their own deadline; if the approval
  // task didn't get one, fall back to the parent's dueDate so the chip is
  // still informative.
  const deadlineRaw = task.dueDate ?? task.parentTask?.dueDate ?? null;
  const deadline = formatDate(deadlineRaw);
  const decidedAt =
    task.approvalStatus === "approved" || task.approvalStatus === "rejected"
      ? formatDateTime(task.completedAt)
      : null;

  return (
    <div className="rounded-xl bg-transparent p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Avatar name={task.assigneeName} url={task.assigneeAvatarUrl} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">
            {task.assigneeName ?? "Sem aprovador"}
          </p>
          {(task.approvalStatus === "approved" || task.approvalStatus === "rejected") && (
            <p className="text-[11px] text-muted-foreground lowercase">
              {task.approvalStatus === "approved" ? "decisão: aprovada" : "decisão: reprovada"}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {deadline && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-background border border-border rounded-full px-2 py-0.5 lowercase">
            <Calendar className="w-3 h-3" />
            aprovar até {deadline}
          </span>
        )}
        {decidedAt && (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-medium border rounded-full px-2 py-0.5 lowercase ${
              task.approvalStatus === "approved"
                ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800"
                : "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-300 dark:border-red-800"
            }`}
          >
            {task.approvalStatus === "approved" ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
            decidida em {decidedAt}
          </span>
        )}
      </div>

      {task.approvalComment && (task.approvalStatus === "approved" || task.approvalStatus === "rejected") && (
        <div className="rounded-lg bg-background border border-border p-2.5">
          <p className="text-[10px] font-semibold text-muted-foreground tracking-wider lowercase mb-1">
            comentário registrado
          </p>
          <p className="text-xs text-foreground whitespace-pre-wrap">{task.approvalComment}</p>
        </div>
      )}
    </div>
  );
}

export function ApprovalTaskView({ taskId, workspaceId, onClose, currentUserId = "", isAdmin = false }: ApprovalTaskViewProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [comment, setComment] = useState("");
  const [commentDirty, setCommentDirty] = useState(false);
  const [pending, setPending] = useState(false);

  const { data: task, isLoading } = useQuery<ApprovalTaskDetail>({
    queryKey: [`/api/workspaces/${workspaceId}/tasks/${taskId}`],
    queryFn: () => customFetch(`/api/workspaces/${workspaceId}/tasks/${taskId}`),
    enabled: !!taskId && !!workspaceId,
  });

  // When the approval already has a recorded comment, pre-fill the textarea
  // so changing the decision (approve <-> reject) without retyping doesn't
  // wipe the previously stored comment. We reset the dirty flag whenever the
  // viewed task changes so reusing the component for a different approval
  // doesn't carry the previous draft over.
  useEffect(() => {
    setCommentDirty(false);
    setComment("");
  }, [taskId]);

  useEffect(() => {
    if (commentDirty) return;
    setComment(task?.approvalComment ?? "");
  }, [task?.id, task?.approvalComment, commentDirty]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks`] });
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks/${taskId}`] });
    queryClient.invalidateQueries({ queryKey: ["task-activities", workspaceId, taskId] });
    queryClient.invalidateQueries({ queryKey: ["consolidated-activities", workspaceId, taskId] });
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

  const handleOpenParent = () => {
    if (!task?.parentTaskId) return;
    // Navigate without closing the modal: the parent page listens for the
    // URL change (deepLinkTaskId) and swaps the modal contents to the
    // parent task. Calling onClose() here would dispatch the host's
    // close handler, which navigates back to the task list and tears the
    // modal down before the parent gets a chance to render.
    navigate(`${APP_BASE}/workspaces/${workspaceId}/tasks/${task.parentTaskId}`);
  };

  if (isLoading || !task) {
    return (
      <div className="flex-1 flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const decided = task.approvalStatus === "approved" || task.approvalStatus === "rejected";
  // After a decision we keep the *opposite* action available so the
  // approver can change their mind (a common request from reviewers in
  // multi-step approval flows). The currently-recorded decision is shown
  // as a status banner above the action button.
  const oppositeAction: "approve" | "reject" | null = !decided
    ? null
    : task.approvalStatus === "approved"
      ? "reject"
      : "approve";

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <ApprovalBadge />
          <h2 className="text-base font-semibold text-foreground truncate">
            {getApprovalDisplayTitle({ isApprovalTask: true, parentTask: task.parentTask, title: task.title })}
          </h2>
          {(() => {
            const key = decided ? (task.approvalStatus as string) : "pending";
            const meta = APPROVAL_HEADER_STATUS[key];
            if (!meta) return null;
            return (
              <span
                className={`shrink-0 inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border lowercase ${meta.cls}`}
                title={`status da aprovação: ${meta.label}`}
              >
                {meta.label}
              </span>
            );
          })()}
        </div>
        {task.parentTaskId && (
          <button
            type="button"
            onClick={handleOpenParent}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 hover:bg-primary/5 rounded-lg px-2 py-1 transition-colors lowercase cursor-pointer"
            title="Abrir tarefa principal"
          >
            <ExternalLink className="w-3 h-3" />
            tarefa principal
          </button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-7 w-7 text-muted-foreground hover:text-foreground rounded-lg shrink-0"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Approval card */}
      <ApprovalCard task={task} />

      {/* Parent task card */}
      {task.parentTask && (
        <ParentTaskCard parent={task.parentTask} />
      )}

      {/* Deliverables (read-only, served from parent's `deliverable` attachments) */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="text-xs font-semibold text-muted-foreground tracking-wider lowercase">
            Entregáveis
          </p>
        </div>
        <AttachmentsSection
          workspaceId={workspaceId}
          taskId={taskId}
          mode="deliverables-readonly"
        />
      </div>

      {/* Comment field — always editable. When changing decision, the new
          comment overwrites the previously recorded one. */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground tracking-wider lowercase">
          comentário
        </p>
        <Textarea
          value={comment}
          onChange={(e) => {
            setCommentDirty(true);
            setComment(e.target.value);
          }}
          placeholder={
            decided
              ? `Comentário registrado: "${task.approvalComment ?? "(vazio)"}". Edite para registrar uma nova decisão.`
              : "Deixe um comentário sobre sua decisão (opcional)..."
          }
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

      {/* Action buttons. When pending → both buttons; once decided → only
          the opposite action so the approver can change their mind without
          re-confirming the same decision. */}
      <div className="flex gap-3 pt-1">
        {(!decided || oppositeAction === "reject") && (
          <Button
            variant="outline"
            className="flex-1 rounded-xl border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40 lowercase font-semibold h-11 cursor-pointer"
            onClick={handleReject}
            disabled={pending}
          >
            <X className="w-4 h-4 mr-2" />
            {decided ? "Mudar para reprovado" : "Reprovar"}
          </Button>
        )}
        {(!decided || oppositeAction === "approve") && (
          <Button
            className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white lowercase font-semibold h-11 cursor-pointer"
            onClick={handleApprove}
            disabled={pending}
          >
            <Check className="w-4 h-4 mr-2" />
            {decided ? "Mudar para aprovado" : "Aprovar"}
          </Button>
        )}
      </div>

      {/* Consolidated history (parent + sibling approvals) */}
      <ConsolidatedActivityHistory
        workspaceId={workspaceId}
        approvalTaskId={taskId}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
      />
    </div>
  );
}
