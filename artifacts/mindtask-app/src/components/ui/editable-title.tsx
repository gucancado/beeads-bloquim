import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface EditableTitleProps {
  /** Current title value (controlled). */
  value: string;
  /** Called with trimmed new value when the user commits via Enter or blur.
   * Not called when the user cancels (Escape) or when value is unchanged.
   */
  onSave: (next: string) => void;
  /** Optional notifier for parents that need to react to edit-mode transitions.
   * (E.g. ReactFlow nodes that disable drag while editing.)
   */
  onEditingChange?: (editing: boolean) => void;
  /** Class applied to the <h3> display state. */
  displayClassName?: string;
  /** Class applied to the <input> edit state. */
  inputClassName?: string;
  /** Tooltip shown on hover over the display state. */
  hoverTitle?: string;
  /** Whether to select all input text on entering edit (default true). */
  selectOnEdit?: boolean;
  /**
   * Stop click propagation on both display and input. Useful when the editor
   * is nested in a row/node that handles its own click (TaskListItem,
   * ReactFlow nodes). Default false.
   */
  stopPropagation?: boolean;
  /**
   * Append the `nodrag` class to disable ReactFlow drag while the input is
   * focused. Default false.
   */
  nodragForReactFlow?: boolean;
  /** Optional rejection: return false to abort save & restore previous value. */
  shouldSave?: (next: string) => boolean;
  /**
   * When this transitions from falsy → truthy, the component enters edit mode
   * automatically and selects the text. Once consumed, the parent should
   * reset the trigger via `onAutoFocusConsumed`.
   */
  autoFocus?: boolean;
  onAutoFocusConsumed?: () => void;
}

/**
 * Click-to-edit inline title. Replaces the duplicated implementations in
 * TaskListItem and MindMapNode. Commits on Enter or blur; cancels on Escape.
 */
export function EditableTitle({
  value,
  onSave,
  onEditingChange,
  displayClassName,
  inputClassName,
  hoverTitle = "Clique para editar",
  selectOnEdit = true,
  stopPropagation = false,
  nodragForReactFlow = false,
  shouldSave,
  autoFocus,
  onAutoFocusConsumed,
}: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastAutoFocus = useRef<boolean | undefined>(autoFocus);

  // Sync external value changes while not editing — important for autosave
  // races where the server returns canonical title after a separate update.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // External "start editing" trigger — fires once on false→true transition.
  useEffect(() => {
    if (autoFocus && !lastAutoFocus.current) {
      setDraft(value);
      setEditing(true);
      onEditingChange?.(true);
      onAutoFocusConsumed?.();
    }
    lastAutoFocus.current = autoFocus;
  }, [autoFocus, value, onEditingChange, onAutoFocusConsumed]);

  useEffect(() => {
    if (editing && selectOnEdit) {
      const t = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => clearTimeout(t);
    }
  }, [editing, selectOnEdit]);

  const enter = (e?: React.MouseEvent) => {
    if (stopPropagation) e?.stopPropagation();
    setDraft(value);
    setEditing(true);
    onEditingChange?.(true);
  };

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    onEditingChange?.(false);
    if (!next || next === value) return;
    if (shouldSave && !shouldSave(next)) return;
    onSave(next);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
    onEditingChange?.(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        autoCapitalize="none"
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onClick={e => {
          if (stopPropagation) e.stopPropagation();
        }}
        onDoubleClick={e => {
          if (stopPropagation) e.stopPropagation();
        }}
        className={cn(
          "bg-transparent border-b border-primary outline-none w-full min-w-0",
          nodragForReactFlow && "nodrag",
          inputClassName,
        )}
      />
    );
  }

  return (
    <h3
      className={cn("cursor-text", displayClassName)}
      title={hoverTitle}
      onClick={enter}
      onDoubleClick={e => {
        if (stopPropagation) e.stopPropagation();
      }}
    >
      {value}
    </h3>
  );
}
