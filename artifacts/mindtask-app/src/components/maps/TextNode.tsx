import { memo, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useUpdateTextElement, useDeleteTextElement } from '@workspace/api-client-react';
import { createPortal } from 'react-dom';
import { generateHTML } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { useTheme } from 'next-themes';

// Tiptap only mounts inside EditingEditor — never during view-only mode
import EditingEditor, { TextNodeEditorHandle } from './TextNodeEditor';

const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48];
const TEXT_COLORS_LIGHT = [
  { label: 'Preto',    value: '#111827', display: '#111827' },
  { label: 'Vermelho', value: '#dc2626', display: '#dc2626' },
  { label: 'Azul',     value: '#2563eb', display: '#2563eb' },
  { label: 'Verde',    value: '#16a34a', display: '#16a34a' },
];
const TEXT_COLORS_DARK = [
  { label: 'Branco',   value: '#111827', display: '#ffffff' },
  { label: 'Vermelho', value: '#dc2626', display: '#dc2626' },
  { label: 'Azul',     value: '#2563eb', display: '#2563eb' },
  { label: 'Verde',    value: '#16a34a', display: '#16a34a' },
];

function resolveDisplayColor(stored: string, dark: boolean): string {
  if (stored === '#111827') return dark ? '#ffffff' : '#111827';
  return stored;
}

const EMPTY_TIPTAP_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

function renderContentAsHTML(rawContent: string): string {
  try {
    const doc = JSON.parse(rawContent);
    if (doc && typeof doc === 'object' && doc.type === 'doc') {
      return generateHTML(doc, [StarterKit]);
    }
    return generateHTML(EMPTY_TIPTAP_DOC, [StarterKit]);
  } catch {
    return '';
  }
}

function isContentEmpty(rawContent: string): boolean {
  try {
    const doc = JSON.parse(rawContent);
    for (const block of doc?.content ?? []) {
      const text = (block?.content ?? [])
        .filter((n: { type: string }) => n.type === 'text')
        .map((n: { text: string }) => n.text ?? '')
        .join('');
      if (text.trim()) return false;
    }
    return true;
  } catch {
    return !rawContent?.trim();
  }
}

interface TextNodeData {
  elementId: string;
  content: string;
  fontSize: number;
  color: string;
  workspaceId: string;
  mapId: string;
  onDelete?: (elementId: string) => void;
  autoFocus?: boolean;
}

interface TextNodeProps {
  id: string;
  data: TextNodeData;
  selected: boolean;
}

function TextNode({ id, data, selected }: TextNodeProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const TEXT_COLORS = useMemo(() => isDark ? TEXT_COLORS_DARK : TEXT_COLORS_LIGHT, [isDark]);

  const [isEditing, setIsEditing] = useState(false);
  const [fontSize, setFontSize] = useState(data.fontSize ?? 32);
  const [color, setColor] = useState(data.color ?? '#111827');

  const displayColor = resolveDisplayColor(color, isDark);
  const [content, setContent] = useState(data.content);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const fontWrapperRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<TextNodeEditorHandle>(null);

  const updateMut = useUpdateTextElement();
  const deleteMut = useDeleteTextElement();

  // AutoFocus: brand-new elements enter edit mode immediately
  const autoFocusHandledRef = useRef(false);
  useEffect(() => {
    if (autoFocusHandledRef.current || !data.autoFocus) return;
    autoFocusHandledRef.current = true;
    setTimeout(() => {
      setIsEditing(true);
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setMenuPos({ top: rect.top - 48, left: rect.left });
      }
    }, 60);
  }, [data.autoFocus]);

  const handleEditorSave = useCallback((newContent: string, isEmpty: boolean) => {
    setIsEditing(false);
    if (isEmpty) {
      data.onDelete?.(id);
      deleteMut.mutate({ workspaceId: data.workspaceId, mapId: data.mapId, elementId: id });
      return;
    }
    setContent(newContent);
    updateMut.mutate({
      workspaceId: data.workspaceId,
      mapId: data.mapId,
      elementId: id,
      data: { content: newContent, fontSize, color },
    });
  }, [fontSize, color, data, id, updateMut, deleteMut]);

  const enterEditMode = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isEditing) return;
    setIsEditing(true);
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.top - 48, left: rect.left });
    }
  }, [isEditing]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    enterEditMode(e);
  }, [enterEditMode]);

  const handleFontSizeChange = useCallback((newSize: number) => {
    setFontSize(newSize);
    if (fontWrapperRef.current) fontWrapperRef.current.style.fontSize = `${newSize}px`;
    updateMut.mutate({
      workspaceId: data.workspaceId,
      mapId: data.mapId,
      elementId: id,
      data: { fontSize: newSize },
    });
  }, [data, id, updateMut]);

  const handleColorChange = useCallback((canonicalColor: string) => {
    setColor(canonicalColor);
    if (fontWrapperRef.current) fontWrapperRef.current.style.color = resolveDisplayColor(canonicalColor, isDark);
    updateMut.mutate({
      workspaceId: data.workspaceId,
      mapId: data.mapId,
      elementId: id,
      data: { color: canonicalColor },
    });
  }, [data, id, updateMut, isDark]);

  useEffect(() => {
    if (fontWrapperRef.current) fontWrapperRef.current.style.color = displayColor;
  }, [displayColor]);

  const floatingMenu = isEditing ? createPortal(
    <div
      ref={menuRef}
      className="fixed z-overlay flex items-center gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl px-3 py-2"
      style={{ top: menuPos.top, left: menuPos.left, minWidth: 200 }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-1 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <button
          title="Diminuir fonte"
          className="text-sm px-1.5 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-30"
          disabled={FONT_SIZES.indexOf(fontSize) <= 0}
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); const i = FONT_SIZES.indexOf(fontSize); if (i > 0) handleFontSizeChange(FONT_SIZES[i - 1]); }}
        >−</button>
        <span className="text-xs w-8 text-center select-none">{fontSize}</span>
        <button
          title="Aumentar fonte"
          className="text-sm px-1.5 py-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-30"
          disabled={FONT_SIZES.indexOf(fontSize) >= FONT_SIZES.length - 1}
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); const i = FONT_SIZES.indexOf(fontSize); if (i < FONT_SIZES.length - 1) handleFontSizeChange(FONT_SIZES[i + 1]); }}
        >+</button>
      </div>

      <div className="flex items-center gap-1">
        {TEXT_COLORS.map(c => (
          <button
            key={c.value}
            title={c.label}
            className={`w-4 h-4 rounded-full border-2 transition-transform hover:scale-110 ${color === c.value ? 'border-gray-800 dark:border-white scale-110' : 'border-transparent'}`}
            style={{ backgroundColor: c.display }}
            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); handleColorChange(c.value); }}
          />
        ))}
      </div>

      <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 mx-1" />

      <button
        title="Negrito (Ctrl+B)"
        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); editorRef.current?.toggleBold(); }}
        className="text-xs font-bold px-1.5 py-0.5 rounded transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
      >B</button>

      <button
        title="Itálico (Ctrl+I)"
        onMouseDown={e => { e.preventDefault(); e.stopPropagation(); editorRef.current?.toggleItalic(); }}
        className="text-xs italic px-1.5 py-0.5 rounded transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
      >I</button>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      {floatingMenu}
      <div
        ref={containerRef}
        style={{
          display: 'inline-block',
          maxWidth: 480,
          cursor: isEditing ? 'text' : 'grab',
          outline: selected && !isEditing ? '3px solid hsl(36 100% 50%)' : 'none',
          outlineOffset: '6px',
          borderRadius: '4px',
        }}
        onClick={handleClick}
        onDoubleClick={enterEditMode}
      >
        <div
          ref={fontWrapperRef}
          className="px-1"
          style={{ fontSize: `${fontSize}px`, color: displayColor, lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
        >
          {isEditing ? (
            <EditingEditor
              ref={editorRef}
              initialContent={content}
              menuRef={menuRef}
              containerRef={containerRef}
              onSave={handleEditorSave}
            />
          ) : isContentEmpty(content) ? (
            <span className="opacity-30 select-none">Texto</span>
          ) : (
            <div
              className="tiptap-view select-none"
              dangerouslySetInnerHTML={{ __html: renderContentAsHTML(content) }}
            />
          )}
        </div>
      </div>
    </>
  );
}

export default memo(TextNode);
