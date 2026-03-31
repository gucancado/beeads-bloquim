import { useEffect, useRef, RefObject, forwardRef, useImperativeHandle } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

const EMPTY_TIPTAP_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

function parseContent(raw: string): object {
  if (!raw || raw === '{}') return EMPTY_TIPTAP_DOC;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.type === 'doc') return parsed;
    return EMPTY_TIPTAP_DOC;
  } catch {
    return EMPTY_TIPTAP_DOC;
  }
}

function isEmptyDoc(raw: string): boolean {
  try {
    const doc = JSON.parse(raw);
    for (const block of doc?.content ?? []) {
      const text = (block?.content ?? [])
        .filter((n: { type: string }) => n.type === 'text')
        .map((n: { text: string }) => n.text ?? '')
        .join('');
      if (text.trim()) return false;
    }
    return true;
  } catch {
    return !raw?.trim();
  }
}

export interface TextNodeEditorHandle {
  toggleBold: () => void;
  toggleItalic: () => void;
}

interface EditingEditorProps {
  initialContent: string;
  containerRef: RefObject<HTMLDivElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  onSave: (content: string, isEmpty: boolean) => void;
}

const EditingEditor = forwardRef<TextNodeEditorHandle, EditingEditorProps>(
  ({ initialContent, containerRef, menuRef, onSave }, ref) => {
    const savedRef = useRef(false);
    const initialContentRef = useRef(initialContent);

    const editor = useEditor({
      extensions: [StarterKit],
      content: parseContent(initialContent),
      editable: true,
      immediatelyRender: false,
      autofocus: 'end',
      editorProps: {
        attributes: { class: 'outline-none nodrag nopan w-full h-full min-h-[1em]' },
      },
    });

    // Expose bold/italic toggle to parent via ref
    useImperativeHandle(ref, () => ({
      toggleBold: () => {
        if (!editor || editor.isDestroyed) return;
        try { editor.chain().focus().toggleBold().run(); } catch { /* ignore */ }
      },
      toggleItalic: () => {
        if (!editor || editor.isDestroyed) return;
        try { editor.chain().focus().toggleItalic().run(); } catch { /* ignore */ }
      },
    }), [editor]);

    // Save on unmount if not already saved
    useEffect(() => {
      return () => {
        if (!savedRef.current && editor && !editor.isDestroyed) {
          try {
            const content = JSON.stringify(editor.getJSON());
            onSave(content, isEmptyDoc(content));
            savedRef.current = true;
          } catch { /* ignore */ }
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editor]);

    // Click-outside: save and exit edit mode
    // Uses initialContentRef as fallback when editor hasn't initialized yet (immediatelyRender: false)
    // so the node never gets stuck in editing mode with a null editor.
    useEffect(() => {
      const handleMouseDown = (e: MouseEvent) => {
        const target = e.target as Node;
        if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
        if (savedRef.current || editor?.isDestroyed) return;
        try {
          const content = editor
            ? JSON.stringify(editor.getJSON())
            : initialContentRef.current;
          onSave(content, isEmptyDoc(content));
          savedRef.current = true;
        } catch { /* ignore */ }
      };
      document.addEventListener('mousedown', handleMouseDown, true);
      return () => document.removeEventListener('mousedown', handleMouseDown, true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editor]);

    return <EditorContent editor={editor} className="w-full h-full" />;
  },
);

EditingEditor.displayName = 'EditingEditor';
export default EditingEditor;
