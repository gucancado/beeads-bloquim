import { useDroppable } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import { POOL_ID } from "@/lib/calendar/dnd";
import type { CalendarTask } from "@/lib/calendar/placement";
import { CalendarApprovalCard } from "./CalendarApprovalCard";
import { CalendarTaskCard } from "./CalendarTaskCard";
import type { ColumnCallbacks } from "./DayColumn";
import { SortableItem } from "./SortableItem";

export function PoolSection({ tasks, cb, isOver }: { tasks: CalendarTask[]; cb: ColumnCallbacks; isOver: boolean }) {
  const { setNodeRef } = useDroppable({ id: POOL_ID });
  return (
    <section aria-label="sem data" data-calendar-pool className="mt-8">
      <h3 className="mb-3 px-1 text-xs font-light lowercase text-muted-foreground">sem data · {tasks.length}</h3>
      <div
        ref={setNodeRef}
        className={`grid min-h-[96px] grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 rounded-2xl border border-dashed p-3 ${
          isOver ? "border-primary/60 bg-primary/5" : "border-border/60"
        }`}
      >
        <SortableContext id={POOL_ID} items={tasks.map(t => `task:${t.id}`)} strategy={rectSortingStrategy}>
          {tasks.map(t => (
            <SortableItem key={t.id} id={`task:${t.id}`}>
              {t.isApprovalTask ? (
                <CalendarApprovalCard task={t} onOpen={cb.onOpenTask} />
              ) : (
                <CalendarTaskCard task={t} members={cb.membersFor(t.workspaceId)} invalidateKeys={cb.invalidateKeys} onOpen={cb.onOpenTask} />
              )}
            </SortableItem>
          ))}
        </SortableContext>
        {tasks.length === 0 && <p className="col-span-full self-center text-center text-xs text-muted-foreground">arraste um card para cá para tirar a data</p>}
      </div>
    </section>
  );
}
