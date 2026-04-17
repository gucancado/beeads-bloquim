import { GripVertical, Check } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export interface SubtaskItem {
  id: string;
  text: string;
  completed: boolean;
  order: number;
}

export function SortableSubtask({
  subtask,
  onChange,
  onToggle,
  onBlur,
  onKeyDown,
  inputRef,
}: {
  subtask: SubtaskItem;
  onChange: (id: string, text: string) => void;
  onToggle: (id: string) => void;
  onBlur: (id: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, id: string) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: subtask.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1.5 group rounded-lg px-1 py-0.5 ${subtask.completed ? "opacity-50" : ""}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing shrink-0 touch-none"
        tabIndex={-1}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => onToggle(subtask.id)}
        className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-all ${
          subtask.completed
            ? "bg-primary border-primary text-primary-foreground"
            : "border-border bg-background hover:border-primary/60"
        }`}
      >
        {subtask.completed && <Check className="w-2.5 h-2.5" />}
      </button>
      <input
        ref={inputRef}
        value={subtask.text}
        onChange={e => onChange(subtask.id, e.target.value)}
        onBlur={() => onBlur(subtask.id)}
        onKeyDown={e => onKeyDown(e, subtask.id)}
        className={`flex-1 bg-transparent text-sm outline-none border-none focus:outline-none placeholder:text-muted-foreground/40 ${
          subtask.completed ? "line-through text-muted-foreground" : ""
        }`}
        placeholder="Subtarefa..."
      />
    </div>
  );
}
