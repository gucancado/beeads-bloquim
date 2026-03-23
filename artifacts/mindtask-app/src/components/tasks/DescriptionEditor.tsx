import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List } from "lucide-react";

interface DescriptionEditorProps {
  value: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
}

export function DescriptionEditor({ value, onChange, onBlur }: DescriptionEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    editorProps: {
      attributes: {
        class: "description-editor-area",
      },
    },
    content: value || "",
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const text = editor.getText().trim();
      onChange(text ? html : "");
    },
    onBlur: () => {
      onBlur?.();
    },
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      const currentText = editor.getText().trim();
      const incomingIsEmpty = !value || value === "<p></p>";
      if (incomingIsEmpty && !currentText) return;
      if (value !== editor.getHTML()) {
        editor.commands.setContent(value || "");
      }
    }
  }, [value, editor]);

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
    </div>
  );
}
