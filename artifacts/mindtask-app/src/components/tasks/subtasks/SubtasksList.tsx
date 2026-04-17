import { ListChecks } from "lucide-react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableSubtask, type SubtaskItem } from "./SortableSubtask";
import type { useSensors } from "@dnd-kit/core";

export function SubtasksList({
  subtasks,
  sensors,
  inputRefs,
  onAdd,
  onChange,
  onToggle,
  onBlur,
  onKeyDown,
  onDragEnd,
}: {
  subtasks: SubtaskItem[];
  sensors: ReturnType<typeof useSensors>;
  inputRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
  onAdd: () => void;
  onChange: (id: string, text: string) => void;
  onToggle: (id: string) => void;
  onBlur: (id: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, id: string) => void;
  onDragEnd: (event: DragEndEvent) => void;
}) {
  return (
    <div>
      <div className="flex items-center mb-1.5">
        <button
          onClick={onAdd}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-muted"
          title="Adicionar subtarefa"
        >
          <ListChecks className="w-3.5 h-3.5" />
          <span className="lowercase">subtarefas +</span>
        </button>
      </div>
      {subtasks.length > 0 && (
        <div className="bg-muted/30 rounded-xl px-2 py-1.5 space-y-0.5">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={subtasks.map(s => s.id)} strategy={verticalListSortingStrategy}>
              {subtasks.map(subtask => (
                <SortableSubtask
                  key={subtask.id}
                  subtask={subtask}
                  onChange={onChange}
                  onToggle={onToggle}
                  onBlur={onBlur}
                  onKeyDown={onKeyDown}
                  inputRef={(el) => { inputRefs.current[subtask.id] = el; }}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
}
