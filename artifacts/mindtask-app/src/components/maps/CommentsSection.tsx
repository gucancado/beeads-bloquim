import { useState, useRef, useCallback, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { ConsolidatedActivityResponse } from "@workspace/api-client-react";
import { useComments, useCreateComment, useToggleCommentHidden, useTaskComments, useCreateTaskComment, useToggleTaskCommentHidden, useTaskActivities, useStandaloneTaskComments, useCreateStandaloneTaskComment, CommentItem, TaskActivityItem } from "@/hooks/useComments";
import { Button } from "@/components/ui/button";
import { Loader2, Italic, List, EyeOff, Eye, MessageSquare, Send } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type CommentsSectionProps =
  | {
      workspaceId: string;
      mapId: string;
      cardId: string;
      linkedTaskId?: string | null;
      taskId?: never;
      standalone?: never;
      currentUserId: string;
      isAdmin: boolean;
    }
  | {
      workspaceId: string;
      taskId: string;
      mapId?: never;
      cardId?: never;
      linkedTaskId?: never;
      standalone?: never;
      currentUserId: string;
      isAdmin: boolean;
    }
  | {
      standalone: true;
      taskId: string;
      workspaceId?: never;
      mapId?: never;
      cardId?: never;
      linkedTaskId?: never;
      currentUserId: string;
      isAdmin: boolean;
    };

function RichTextEditor({ onSubmit, isPending }: { onSubmit: (html: string) => void; isPending: boolean }) {
  const [isEmpty, setIsEmpty] = useState(true);
  const [isFocused, setIsFocused] = useState(false);
  const submitRef = useRef<() => void>(() => {});

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
    ],
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "comment-editor-area",
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          submitRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      setIsEmpty(!editor.getText().trim());
    },
    onFocus: () => {
      setIsFocused(true);
    },
    onBlur: () => {
      setIsFocused(false);
    },
  });

  const handleSubmit = useCallback(() => {
    if (!editor || isPending) return;
    const html = editor.getHTML();
    const text = editor.getText().trim();
    if (!text) return;
    onSubmit(html);
    editor.commands.clearContent();
    setIsEmpty(true);
  }, [editor, onSubmit, isPending]);

  submitRef.current = handleSubmit;

  return (
    <div className="border border-border rounded-xl bg-background focus-within:ring-2 focus-within:ring-primary/30 transition-all">
      {isFocused && (
        <div className="flex items-center gap-0.5 px-2 pt-1.5 border-b border-border/60">
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBold().run(); }}
            className={`p-1.5 rounded-md transition-colors text-xs font-bold w-6 h-6 flex items-center justify-center ${editor?.isActive("bold") ? "bg-slate-200 dark:bg-slate-700" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
            title="negrito"
          >
            N
          </button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleItalic().run(); }}
            className={`p-1.5 rounded-md transition-colors ${editor?.isActive("italic") ? "bg-slate-200 dark:bg-slate-700" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
            title="itálico"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleUnderline().run(); }}
            className={`p-1.5 rounded-md transition-colors text-xs font-bold underline w-6 h-6 flex items-center justify-center ${editor?.isActive("underline") ? "bg-slate-200 dark:bg-slate-700" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
            title="sublinhado"
          >
            S
          </button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleStrike().run(); }}
            className={`p-1.5 rounded-md transition-colors text-xs font-bold line-through w-6 h-6 flex items-center justify-center ${editor?.isActive("strike") ? "bg-slate-200 dark:bg-slate-700" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
            title="tachado"
          >
            T
          </button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBulletList().run(); }}
            className={`p-1.5 rounded-md transition-colors ${editor?.isActive("bulletList") ? "bg-slate-200 dark:bg-slate-700" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
            title="lista"
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <EditorContent editor={editor} />

      <div className="flex justify-end px-2 pb-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 rounded-lg gap-1.5 text-xs text-muted-foreground border-border bg-white hover:bg-slate-50 dark:bg-background dark:hover:bg-slate-900"
          disabled={isEmpty || isPending}
          onClick={handleSubmit}
        >
          {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          <span className="lowercase">Comentar</span>
        </Button>
      </div>
    </div>
  );
}

function CommentCard({
  comment,
  currentUserId,
  isAdmin,
  onToggleHidden,
  isToggling,
}: {
  comment: CommentItem;
  currentUserId: string;
  isAdmin: boolean;
  onToggleHidden: (id: string) => void;
  isToggling: boolean;
}) {
  const canToggle = comment.authorId === currentUserId || isAdmin;
  const date = new Date(comment.createdAt);

  return (
    <div
      className={`rounded-xl border p-3 transition-all ${
        comment.hidden
          ? "bg-slate-50/60 dark:bg-slate-900/30 border-dashed border-slate-200 dark:border-slate-700 opacity-60"
          : "bg-background border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0 overflow-hidden">
            {comment.authorAvatar ? (
              <img src={comment.authorAvatar} alt={comment.authorName} className="w-full h-full object-cover rounded-full" />
            ) : (
              comment.authorName.charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <span className="text-xs font-semibold text-foreground truncate">{comment.authorName}</span>
            <span className="text-[10px] text-muted-foreground ml-1.5">
              {format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
            </span>
          </div>
        </div>
        {canToggle && (
          <button
            type="button"
            onClick={() => onToggleHidden(comment.id)}
            disabled={isToggling}
            className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title={comment.hidden ? "mostrar comentário" : "ocultar comentário"}
          >
            {isToggling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : comment.hidden ? (
              <Eye className="w-3.5 h-3.5" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>

      {comment.hidden ? (
        <p className="text-xs text-muted-foreground mt-2 italic">Comentário oculto.</p>
      ) : (
        <div
          className="comment-rendered-content mt-2"
          dangerouslySetInnerHTML={{ __html: comment.content }}
        />
      )}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: "pendente",
  in_progress: "em andamento",
  completed: "concluída",
  blocked: "cancelada",
  draft: "rascunho",
  overdue: "atrasada",
};

function formatActivityText(activity: TaskActivityItem): string {
  const date = new Date(activity.createdAt);
  const dateStr = format(date, "dd/MM/yyyy HH:mm");
  const m = activity.metadata ?? {};

  switch (activity.type) {
    case "task_created": {
      const actor = m.actorName ?? activity.actorName ?? "Alguém";
      return `${dateStr}: tarefa criada por ${actor}`;
    }
    case "assignee_changed": {
      const actor = m.actorName ?? activity.actorName ?? "Alguém";
      const newName = m.newAssigneeName;
      if (!newName) {
        return `${dateStr}: ${actor} removeu responsável.`;
      }
      if (m.actorId && m.newAssigneeId && m.actorId === m.newAssigneeId) {
        return `${dateStr}: ${actor} atribuiu a tarefa para si.`;
      }
      return `${dateStr}: ${actor} atribuiu a tarefa para ${newName}.`;
    }
    case "priority_changed": {
      const actor = m.actorName ?? activity.actorName ?? "Alguém";
      const PRIORITY_LABELS: Record<string, string> = {
        low: "baixa",
        medium: "média",
        high: "alta",
        critical: "máxima",
      };
      const oldLabel = PRIORITY_LABELS[m.oldPriority ?? ""] ?? m.oldPriority ?? "?";
      const newLabel = PRIORITY_LABELS[m.newPriority ?? ""] ?? m.newPriority ?? "?";
      return `${dateStr}: ${actor} alterou prioridade de ${oldLabel} para ${newLabel}.`;
    }
    case "due_date_changed": {
      const actor = m.actorName ?? activity.actorName ?? "Alguém";
      const formatDate = (d: string | null | undefined) => {
        if (!d) return "sem fazer";
        const [year, month, day] = d.slice(0, 10).split("-");
        return `${day}/${month}/${year}`;
      };
      const oldDate = formatDate(m.oldDueDate);
      const newDate = formatDate(m.newDueDate);
      return `${dateStr}: ${actor} alterou fazer de ${oldDate} para ${newDate}.`;
    }
    case "status_changed": {
      const actor = m.actorName ?? activity.actorName ?? "Alguém";
      const oldLabel = STATUS_LABELS[m.oldStatus ?? ""] ?? m.oldStatus ?? "?";
      const newLabel = STATUS_LABELS[m.newStatus ?? ""] ?? m.newStatus ?? "?";
      return `${dateStr}: ${actor} mudou tarefa de ${oldLabel} para ${newLabel}`;
    }
    case "task_approved": {
      const actor = m.actorName ?? activity.actorName ?? "Alguém";
      const comment = m.comment ? ` — "${m.comment}"` : "";
      return `${dateStr}: ${actor} aprovou a tarefa${comment}`;
    }
    case "task_rejected": {
      const actor = m.actorName ?? activity.actorName ?? "Alguém";
      const comment = m.comment ? ` — "${m.comment}"` : "";
      return `${dateStr}: ${actor} reprovou a tarefa${comment}`;
    }
    case "task_duplicated":
      return "";
    default:
      return "";
  }
}

const APP_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function DuplicatedActivityEntry({ activity }: { activity: TaskActivityItem }) {
  const date = new Date(activity.createdAt);
  const dateStr = format(date, "dd/MM/yyyy HH:mm");
  const m = activity.metadata ?? {};
  const originalTaskId = m.originalTaskId;
  const wsId = m.workspaceId;

  const href = originalTaskId && wsId
    ? `${window.location.origin}${APP_BASE}/workspaces/${wsId}/tasks/${originalTaskId}`
    : null;

  return (
    <div className="flex items-start gap-2 py-1 px-2">
      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" />
      <p className="text-xs text-muted-foreground">
        {dateStr}: duplicada{" "}
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground transition-colors"
          >
            dessa tarefa
          </a>
        ) : (
          "dessa tarefa"
        )}
      </p>
    </div>
  );
}

function ApprovalCommentEntry({ activity }: { activity: TaskActivityItem }) {
  const m = activity.metadata ?? {};
  const date = new Date(activity.createdAt);
  const actor = m.actorName ?? activity.actorName ?? "Alguém";
  const avatarUrl = activity.actorAvatarUrl;
  const decision = m.decision as "approved" | "rejected" | undefined;
  const comment = m.comment;

  return (
    <div className="rounded-xl border p-3 bg-background border-border">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0 overflow-hidden">
            {avatarUrl ? (
              <img src={avatarUrl} alt={actor} className="w-full h-full object-cover rounded-full" />
            ) : (
              actor.charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="text-xs font-semibold text-foreground truncate">{actor}</span>
            <span className="text-[10px] text-muted-foreground">
              {format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
            </span>
            <span className="inline-flex items-center rounded-full border border-violet-300 bg-violet-50 px-1.5 py-0 text-[10px] font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-400 dark:border-violet-800">
              aprovação
            </span>
            {decision === "approved" && (
              <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-0 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800">
                aprovada
              </span>
            )}
            {decision === "rejected" && (
              <span className="inline-flex items-center rounded-full border border-red-300 bg-red-50 px-1.5 py-0 text-[10px] font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800">
                reprovada
              </span>
            )}
          </div>
        </div>
      </div>
      {comment && (
        <p className="text-sm text-foreground mt-2">{comment}</p>
      )}
    </div>
  );
}

interface ActivitySource {
  taskId: string;
  taskTitle: string;
  isApprovalTask: boolean;
  approverName?: string | null;
}

function SourceChip({ source }: { source: ActivitySource }) {
  if (source.isApprovalTask) {
    const label = source.approverName
      ? `aprovação · ${source.approverName}`
      : "aprovação";
    return (
      <span className="inline-flex items-center rounded-full border border-violet-300 bg-violet-50 px-1.5 py-0 text-[10px] font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-400 dark:border-violet-800 lowercase">
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-1.5 py-0 text-[10px] font-semibold text-slate-700 dark:bg-slate-800/40 dark:text-slate-300 dark:border-slate-700 lowercase">
      tarefa principal
    </span>
  );
}

function ActivityEntry({ activity, source }: { activity: TaskActivityItem; source?: ActivitySource | null }) {
  if (activity.type === "approval_comment") {
    return (
      <div className="space-y-1">
        {source && (
          <div className="flex justify-end px-1">
            <SourceChip source={source} />
          </div>
        )}
        <ApprovalCommentEntry activity={activity} />
      </div>
    );
  }

  if (activity.type === "task_duplicated") {
    return (
      <div className="flex items-center gap-2 px-2">
        <DuplicatedActivityEntry activity={activity} />
        {source && <SourceChip source={source} />}
      </div>
    );
  }

  const text = formatActivityText(activity);
  if (!text) return null;

  return (
    <div className="flex items-start gap-2 py-1 px-2">
      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" />
      <p className="text-xs text-muted-foreground flex-1">{text}</p>
      {source && <SourceChip source={source} />}
    </div>
  );
}

type TimelineEntry =
  | { kind: "comment"; item: CommentItem }
  | { kind: "activity"; item: TaskActivityItem };

function CardCommentsSection({ workspaceId, mapId, cardId, linkedTaskId, currentUserId, isAdmin }: { workspaceId: string; mapId: string; cardId: string; linkedTaskId?: string | null; currentUserId: string; isAdmin: boolean }) {
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const { data: comments, isLoading: commentsLoading } = useComments(workspaceId, mapId, cardId);
  const { data: activities, isLoading: activitiesLoading } = useTaskActivities(workspaceId, linkedTaskId ?? null);
  const createMut = useCreateComment(workspaceId, mapId, cardId);
  const toggleMut = useToggleCommentHidden(workspaceId, mapId, cardId);

  const handleSubmit = (html: string) => { createMut.mutate(html); };
  const handleToggle = (commentId: string) => {
    setTogglingId(commentId);
    toggleMut.mutate(commentId, { onSettled: () => setTogglingId(null) });
  };

  const isLoading = commentsLoading || activitiesLoading;

  return <CommentsList comments={comments} activities={activities} isLoading={isLoading} currentUserId={currentUserId} isAdmin={isAdmin} onSubmit={handleSubmit} onToggle={handleToggle} togglingId={togglingId} isPending={createMut.isPending} />;
}

function TaskCommentsSection({ workspaceId, taskId, currentUserId, isAdmin }: { workspaceId: string; taskId: string; currentUserId: string; isAdmin: boolean }) {
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const { data: comments, isLoading: commentsLoading } = useTaskComments(workspaceId, taskId);
  const { data: activities, isLoading: activitiesLoading } = useTaskActivities(workspaceId, taskId);
  const createMut = useCreateTaskComment(workspaceId, taskId);
  const toggleMut = useToggleTaskCommentHidden(workspaceId, taskId);

  const handleSubmit = (html: string) => { createMut.mutate(html); };
  const handleToggle = (commentId: string) => {
    setTogglingId(commentId);
    toggleMut.mutate(commentId, { onSettled: () => setTogglingId(null) });
  };

  const isLoading = commentsLoading || activitiesLoading;

  return <CommentsList comments={comments} activities={activities} isLoading={isLoading} currentUserId={currentUserId} isAdmin={isAdmin} onSubmit={handleSubmit} onToggle={handleToggle} togglingId={togglingId} isPending={createMut.isPending} />;
}

function StandaloneActivitySection({ taskId, currentUserId, isAdmin }: { taskId: string; currentUserId: string; isAdmin: boolean }) {
  const { data: comments, isLoading: commentsLoading } = useStandaloneTaskComments(taskId);
  const { data: activities, isLoading: activitiesLoading } = useTaskActivities(null, taskId);
  const createMut = useCreateStandaloneTaskComment(taskId);

  const isLoading = commentsLoading || activitiesLoading;

  return <CommentsList comments={comments} activities={activities} isLoading={isLoading} currentUserId={currentUserId} isAdmin={isAdmin} onSubmit={(html) => createMut.mutate(html)} onToggle={() => {}} togglingId={null} isPending={createMut.isPending} />;
}

function CommentsList({ comments, activities, isLoading, currentUserId, isAdmin, onSubmit, onToggle, togglingId, isPending, hideEditor }: {
  comments: CommentItem[] | undefined;
  activities: TaskActivityItem[] | undefined;
  isLoading: boolean;
  currentUserId: string;
  isAdmin: boolean;
  onSubmit: (html: string) => void;
  onToggle: (id: string) => void;
  togglingId: string | null;
  isPending: boolean;
  hideEditor?: boolean;
}) {
  const timeline = useMemo<TimelineEntry[]>(() => {
    const entries: TimelineEntry[] = [];
    if (comments) {
      for (const c of comments) entries.push({ kind: "comment", item: c });
    }
    if (activities) {
      for (const a of activities) entries.push({ kind: "activity", item: a });
    }
    entries.sort((a, b) => new Date(a.item.createdAt).getTime() - new Date(b.item.createdAt).getTime());
    return entries;
  }, [comments, activities]);

  const commentCount = comments?.length ?? 0;
  const hasActivitiesOnly = !comments && !!activities;

  return (
    <div className="border-t pt-5 space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-xs font-semibold text-muted-foreground tracking-wider lowercase">
          {hasActivitiesOnly ? "Atividades" : `Comentários ${commentCount > 0 ? `(${commentCount})` : ""}`}
        </h3>
      </div>

      {!hideEditor && <RichTextEditor onSubmit={onSubmit} isPending={isPending} />}

      {isLoading ? (
        <div className="flex justify-center py-3">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : timeline.length > 0 ? (
        <div className="space-y-2">
          {timeline.map((entry) => {
            if (entry.kind === "comment") {
              return (
                <CommentCard
                  key={`comment-${entry.item.id}`}
                  comment={entry.item}
                  currentUserId={currentUserId}
                  isAdmin={isAdmin}
                  onToggleHidden={onToggle}
                  isToggling={togglingId === entry.item.id}
                />
              );
            }
            return (
              <ActivityEntry key={`activity-${entry.item.id}`} activity={entry.item} />
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-center text-muted-foreground py-2 lowercase">
          {hasActivitiesOnly ? "Nenhuma atividade ainda." : "Nenhum comentário ainda."}
        </p>
      )}
    </div>
  );
}

export function ApprovalTaskActivityHistory({ workspaceId, taskId }: { workspaceId: string; taskId: string }) {
  const { data: activities, isLoading } = useTaskActivities(workspaceId, taskId);

  return (
    <div className="border-t pt-5 space-y-2">
      <div className="flex items-center gap-2 pb-1">
        <MessageSquare className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-xs font-semibold text-muted-foreground tracking-wider lowercase">
          Histórico de atividades
        </h3>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-3">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : activities && activities.length > 0 ? (
        <div className="space-y-0.5">
          {activities.map((a) => (
            <ActivityEntry key={a.id} activity={a} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-center text-muted-foreground py-2 lowercase">
          Nenhuma atividade ainda.
        </p>
      )}
    </div>
  );
}

// The consolidated endpoint returns a discriminated union — generated by
// orval from the OpenAPI spec. We narrow each row by `kind` at render time
// and reuse the existing CommentCard / ActivityEntry components by mapping
// the generated shape to the local CommentItem / TaskActivityItem shapes.
type ConsolidatedRow = ConsolidatedActivityResponse;

function adaptToCommentItem(
  row: ConsolidatedActivityResponse & { kind: "comment" },
): CommentItem {
  return {
    id: row.id,
    taskId: row.taskId,
    authorId: row.authorId ?? "",
    authorName: row.authorName ?? "Usuário removido",
    authorAvatar: row.authorAvatarUrl ?? null, // CommentItem uses `authorAvatar`; mapped from API's `authorAvatarUrl`
    content: row.content,
    hidden: row.hidden,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function adaptToActivityItem(
  row: ConsolidatedActivityResponse & { kind: "activity" },
): TaskActivityItem {
  return {
    id: row.id,
    taskId: row.taskId,
    actorId: row.actorId ?? null,
    actorName: row.actorName ?? null,
    actorAvatarUrl: row.actorAvatarUrl ?? null,
    type: row.type as TaskActivityItem["type"],
    metadata: row.metadata as Record<string, string | null>,
    createdAt: row.createdAt,
  };
}

/**
 * Renders the parent task's full timeline (activities + comments) merged
 * with the timeline of every sibling approver. Each row is annotated with
 * an "origem" chip so the approver can tell apart what happened on the
 * main task vs other approvers' tasks.
 */
export function ConsolidatedActivityHistory({
  workspaceId,
  approvalTaskId,
  currentUserId = "",
  isAdmin = false,
}: {
  workspaceId: string;
  approvalTaskId: string;
  currentUserId?: string;
  isAdmin?: boolean;
}) {
  const queryClient = useQueryClient();
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery<ConsolidatedRow[]>({
    queryKey: ["consolidated-activities", workspaceId, approvalTaskId],
    queryFn: () =>
      customFetch<ConsolidatedRow[]>(
        `/api/workspaces/${workspaceId}/tasks/${approvalTaskId}/consolidated-activities`,
      ),
    enabled: !!workspaceId && !!approvalTaskId,
  });

  // Each comment row carries its originating taskId (parent or sibling
  // approval task), so we toggle visibility against the comment's own
  // task — the standard `PATCH /tasks/:taskId/comments/:commentId`
  // endpoint already enforces author/admin permissions server-side.
  const handleToggleHidden = async (commentTaskId: string, commentId: string) => {
    setTogglingId(commentId);
    try {
      await customFetch(
        `/api/workspaces/${workspaceId}/tasks/${commentTaskId}/comments/${commentId}`,
        { method: "PATCH" },
      );
      await queryClient.invalidateQueries({
        queryKey: ["consolidated-activities", workspaceId, approvalTaskId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["task-comments", workspaceId, commentTaskId],
      });
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="border-t pt-5 space-y-2">
      <div className="flex items-center gap-2 pb-1">
        <MessageSquare className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-xs font-semibold text-muted-foreground tracking-wider lowercase">
          Histórico consolidado
        </h3>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-3">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows && rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((row) => {
            if (row.kind === "comment") {
              return (
                <div key={`c-${row.id}`} className="space-y-1">
                  {row.source && (
                    <div className="flex justify-end px-1">
                      <SourceChip source={row.source} />
                    </div>
                  )}
                  <CommentCard
                    comment={adaptToCommentItem(row)}
                    currentUserId={currentUserId}
                    isAdmin={isAdmin}
                    onToggleHidden={(id) => handleToggleHidden(row.taskId, id)}
                    isToggling={togglingId === row.id}
                  />
                </div>
              );
            }
            return (
              <ActivityEntry
                key={`a-${row.id}`}
                activity={adaptToActivityItem(row)}
                source={row.source ?? null}
              />
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-center text-muted-foreground py-2 lowercase">
          Nenhuma atividade ainda.
        </p>
      )}
    </div>
  );
}

export function CommentsSection(props: CommentsSectionProps) {
  if ("standalone" in props && props.standalone) {
    return <StandaloneActivitySection taskId={props.taskId} currentUserId={props.currentUserId} isAdmin={props.isAdmin} />;
  }

  const { workspaceId, currentUserId, isAdmin } = props as { workspaceId: string; currentUserId: string; isAdmin: boolean };

  if (props.taskId) {
    return <TaskCommentsSection workspaceId={workspaceId} taskId={props.taskId} currentUserId={currentUserId} isAdmin={isAdmin} />;
  }

  return <CardCommentsSection workspaceId={workspaceId} mapId={props.mapId!} cardId={props.cardId!} linkedTaskId={props.linkedTaskId} currentUserId={currentUserId} isAdmin={isAdmin} />;
}
