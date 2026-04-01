import { useState, useRef, useCallback, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useComments, useCreateComment, useToggleCommentHidden, useTaskComments, useCreateTaskComment, useToggleTaskCommentHidden, useTaskActivities, useStandaloneTaskComments, useCreateStandaloneTaskComment, CommentItem, TaskActivityItem } from "@/hooks/useComments";
import { Button } from "@/components/ui/button";
import { Loader2, Bold, Italic, List, EyeOff, Eye, MessageSquare, Send } from "lucide-react";
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
  const submitRef = useRef<() => void>(() => {});

  const editor = useEditor({
    extensions: [
      StarterKit,
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
      <div className="flex items-center gap-0.5 px-2 pt-1.5 border-b border-border/60">
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBold().run(); }}
          className={`p-1.5 rounded-md transition-colors ${editor?.isActive("bold") ? "bg-slate-200 dark:bg-slate-700" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
          title="negrito"
        >
          <Bold className="w-3.5 h-3.5" />
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
          onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBulletList().run(); }}
          className={`p-1.5 rounded-md transition-colors ${editor?.isActive("bulletList") ? "bg-slate-200 dark:bg-slate-700" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
          title="lista"
        >
          <List className="w-3.5 h-3.5" />
        </button>
      </div>

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
        if (!d) return "sem prazo";
        const [year, month, day] = d.slice(0, 10).split("-");
        return `${day}/${month}/${year}`;
      };
      const oldDate = formatDate(m.oldDueDate);
      const newDate = formatDate(m.newDueDate);
      return `${dateStr}: ${actor} alterou prazo de ${oldDate} para ${newDate}.`;
    }
    case "status_changed": {
      const actor = m.actorName ?? activity.actorName ?? "Alguém";
      const oldLabel = STATUS_LABELS[m.oldStatus ?? ""] ?? m.oldStatus ?? "?";
      const newLabel = STATUS_LABELS[m.newStatus ?? ""] ?? m.newStatus ?? "?";
      return `${dateStr}: ${actor} mudou tarefa de ${oldLabel} para ${newLabel}`;
    }
    default:
      return "";
  }
}

function ActivityEntry({ activity }: { activity: TaskActivityItem }) {
  const text = formatActivityText(activity);
  if (!text) return null;

  return (
    <div className="flex items-start gap-2 py-1 px-2">
      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" />
      <p className="text-xs text-muted-foreground">{text}</p>
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
