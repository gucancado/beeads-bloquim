import { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useComments, useCreateComment, useToggleCommentHidden, useTaskComments, useCreateTaskComment, useToggleTaskCommentHidden, CommentItem } from "@/hooks/useComments";
import { Button } from "@/components/ui/button";
import { Loader2, Bold, Italic, List, EyeOff, Eye, MessageSquare, Send } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type CommentsSectionProps =
  | {
      workspaceId: string;
      mapId: string;
      cardId: string;
      taskId?: never;
      currentUserId: string;
      isAdmin: boolean;
    }
  | {
      workspaceId: string;
      taskId: string;
      mapId?: never;
      cardId?: never;
      currentUserId: string;
      isAdmin: boolean;
    };

function RichTextEditor({ onSubmit, isPending }: { onSubmit: (html: string) => void; isPending: boolean }) {
  const [isEmpty, setIsEmpty] = useState(true);

  const editor = useEditor({
    extensions: [
      StarterKit,
    ],
    editorProps: {
      attributes: {
        class: "comment-editor-area",
      },
    },
    onUpdate: ({ editor }) => {
      setIsEmpty(!editor.getText().trim());
    },
  });

  const handleSubmit = () => {
    if (!editor) return;
    const html = editor.getHTML();
    const text = editor.getText().trim();
    if (!text) return;
    onSubmit(html);
    editor.commands.clearContent();
    setIsEmpty(true);
  };

  return (
    <div className="border border-border rounded-xl bg-background focus-within:ring-2 focus-within:ring-primary/30 transition-all">
      {/* Toolbar */}
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
          size="sm"
          className="h-7 rounded-lg gap-1.5 text-xs"
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
          <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
            {comment.authorName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <span className="text-xs font-semibold text-foreground truncate">{comment.authorName}</span>
            <span className="text-[10px] text-muted-foreground ml-1.5">
              {format(date, "d 'de' MMM 'às' HH:mm", { locale: ptBR })}
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

function CardCommentsSection({ workspaceId, mapId, cardId, currentUserId, isAdmin }: { workspaceId: string; mapId: string; cardId: string; currentUserId: string; isAdmin: boolean }) {
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const { data: comments, isLoading } = useComments(workspaceId, mapId, cardId);
  const createMut = useCreateComment(workspaceId, mapId, cardId);
  const toggleMut = useToggleCommentHidden(workspaceId, mapId, cardId);

  const handleSubmit = (html: string) => { createMut.mutate(html); };
  const handleToggle = (commentId: string) => {
    setTogglingId(commentId);
    toggleMut.mutate(commentId, { onSettled: () => setTogglingId(null) });
  };

  return <CommentsList comments={comments} isLoading={isLoading} currentUserId={currentUserId} isAdmin={isAdmin} onSubmit={handleSubmit} onToggle={handleToggle} togglingId={togglingId} isPending={createMut.isPending} />;
}

function TaskCommentsSection({ workspaceId, taskId, currentUserId, isAdmin }: { workspaceId: string; taskId: string; currentUserId: string; isAdmin: boolean }) {
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const { data: comments, isLoading } = useTaskComments(workspaceId, taskId);
  const createMut = useCreateTaskComment(workspaceId, taskId);
  const toggleMut = useToggleTaskCommentHidden(workspaceId, taskId);

  const handleSubmit = (html: string) => { createMut.mutate(html); };
  const handleToggle = (commentId: string) => {
    setTogglingId(commentId);
    toggleMut.mutate(commentId, { onSettled: () => setTogglingId(null) });
  };

  return <CommentsList comments={comments} isLoading={isLoading} currentUserId={currentUserId} isAdmin={isAdmin} onSubmit={handleSubmit} onToggle={handleToggle} togglingId={togglingId} isPending={createMut.isPending} />;
}

function CommentsList({ comments, isLoading, currentUserId, isAdmin, onSubmit, onToggle, togglingId, isPending }: {
  comments: CommentItem[] | undefined;
  isLoading: boolean;
  currentUserId: string;
  isAdmin: boolean;
  onSubmit: (html: string) => void;
  onToggle: (id: string) => void;
  togglingId: string | null;
  isPending: boolean;
}) {
  return (
    <div className="border-t pt-5 space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-xs font-semibold text-muted-foreground tracking-wider lowercase">
          Comentários {comments && comments.length > 0 ? `(${comments.length})` : ""}
        </h3>
      </div>

      <RichTextEditor onSubmit={onSubmit} isPending={isPending} />

      {isLoading ? (
        <div className="flex justify-center py-3">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : comments && comments.length > 0 ? (
        <div className="space-y-2">
          {comments.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              onToggleHidden={onToggle}
              isToggling={togglingId === c.id}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-center text-muted-foreground py-2 lowercase">Nenhum comentário ainda.</p>
      )}
    </div>
  );
}

export function CommentsSection(props: CommentsSectionProps) {
  const { workspaceId, currentUserId, isAdmin } = props;

  if (props.taskId) {
    return <TaskCommentsSection workspaceId={workspaceId} taskId={props.taskId} currentUserId={currentUserId} isAdmin={isAdmin} />;
  }

  return <CardCommentsSection workspaceId={workspaceId} mapId={props.mapId!} cardId={props.cardId!} currentUserId={currentUserId} isAdmin={isAdmin} />;
}

