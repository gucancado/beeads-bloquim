import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { TaskListItem, TaskListItemData, TaskListItemMember } from "./TaskListItem";
import { useTaskColumnOrder } from "@/hooks/useTaskColumnOrder";
import {
  TASK_COLUMN_LABELS,
  TASK_COLUMN_WIDTH_CLASS,
  TaskColumnKey,
} from "@/lib/taskColumnConstants";

export interface TaskTableSection {
  label: string;
  tasks: TaskListItemData[];
}

// When the page filters by a terminal status, the "prazo" column is repurposed
// to show the relevant timestamp (completion / cancellation) instead of the
// regular schedule trio. Both the header label and the row content honor this.
export type DateColumnMode = "default" | "completed" | "cancelled";

interface Props {
  sections: TaskTableSection[];
  // Either a flat list (uniform members across all rows) or a resolver
  // (members vary per task — used by "my tasks" where each row may come
  // from a different workspace).
  members?: TaskListItemMember[];
  getMembers?: (task: TaskListItemData) => TaskListItemMember[];
  invalidateQueryKeys?: string[][];
  countsQueryKeys?: string[][];
  onOpenDetail?: (task: TaskListItemData) => void;
  showWorkspaceName?: boolean;
  showMapName?: boolean;
  dateColumnMode?: DateColumnMode;
  /** Forward pra TaskListItem — coluna `schedule` renderiza só a data final. */
  compactSchedule?: boolean;
}

function SortableHeaderCell({ columnKey, dateColumnMode }: { columnKey: TaskColumnKey; dateColumnMode: DateColumnMode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: columnKey,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const label = columnKey === "schedule" && dateColumnMode === "completed"
    ? "data de conclusão"
    : columnKey === "schedule" && dateColumnMode === "cancelled"
      ? "data de cancelamento"
      : TASK_COLUMN_LABELS[columnKey];

  return (
    <th
      ref={setNodeRef}
      style={style}
      className={`px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70 select-none group/col ${TASK_COLUMN_WIDTH_CLASS[columnKey]}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="inline-flex items-center gap-1.5 cursor-grab active:cursor-grabbing hover:text-foreground transition-colors"
        title="Arraste para reordenar"
      >
        <GripVertical className="w-3 h-3 opacity-0 group-hover/col:opacity-60 transition-opacity" />
        <span>{label}</span>
      </button>
    </th>
  );
}

export function TaskTable({
  sections,
  members,
  getMembers,
  invalidateQueryKeys = [],
  countsQueryKeys = [],
  onOpenDetail,
  showWorkspaceName = false,
  showMapName = false,
  dateColumnMode = "default",
  compactSchedule = false,
}: Props) {
  const resolveMembers = (task: TaskListItemData): TaskListItemMember[] =>
    getMembers ? getMembers(task) : members ?? [];
  const { order, reorder } = useTaskColumnOrder();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.findIndex((k) => k === active.id);
    const newIndex = order.findIndex((k) => k === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    reorder(arrayMove(order, oldIndex, newIndex));
  };

  const totalColumns = order.length;

  const visibleSections = sections.filter((s) => s.tasks.length > 0);

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <table className="w-full table-auto border-separate border-spacing-y-px">
          <thead>
            <tr>
              <SortableContext items={order as string[]} strategy={horizontalListSortingStrategy}>
                {order.map((key) => (
                  <SortableHeaderCell key={key} columnKey={key} dateColumnMode={dateColumnMode} />
                ))}
              </SortableContext>
            </tr>
          </thead>
          {visibleSections.map((section, idx) => (
            <tbody key={section.label || `section-${idx}`}>
              {section.label && (
                <tr>
                  <td
                    colSpan={totalColumns}
                    className="px-4 py-2 text-xs font-light text-muted-foreground lowercase"
                  >
                    {section.label}
                  </td>
                </tr>
              )}
              {section.tasks.map((task) => (
                <TaskListItem
                  key={task.id}
                  task={task}
                  members={resolveMembers(task)}
                  invalidateQueryKeys={invalidateQueryKeys}
                  countsQueryKeys={countsQueryKeys}
                  onOpenDetail={onOpenDetail}
                  showWorkspaceName={showWorkspaceName}
                  showMapName={showMapName}
                  columnOrder={order}
                  dateColumnMode={dateColumnMode}
                  compactSchedule={compactSchedule}
                />
              ))}
            </tbody>
          ))}
          {visibleSections.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={totalColumns} className="px-4 py-12 text-center text-sm text-muted-foreground/70 lowercase">
                  nenhuma tarefa para mostrar.
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </DndContext>
    </div>
  );
}
