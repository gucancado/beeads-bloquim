import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { EventRow } from "@/components/meetings/EventRow";
import type { Meeting } from "@/components/meetings/useMeetings";
import type { AvatarPickerMember } from "@/components/tasks/AssigneeAvatarPicker";
import { dayContainerId } from "@/lib/calendar/dnd";
import type { CalendarTask, DayColumnModel } from "@/lib/calendar/placement";
import { parseYmd, WEEKDAY_SHORT } from "@/lib/calendar/week";
import { CalendarApprovalCard } from "./CalendarApprovalCard";
import { CalendarTaskCard } from "./CalendarTaskCard";
import { MeetingCard } from "./MeetingCard";
import { SortableItem } from "./SortableItem";

export interface ColumnCallbacks {
  membersFor: (workspaceId: string | null) => AvatarPickerMember[];
  invalidateKeys: unknown[][];
  onOpenTask: (task: CalendarTask) => void;
  onTriage: (m: Meeting) => void;
}

/** `isOver` vem do WeekCalendar: cobre hover na coluna e nos cards dela. */
export function DayColumn({ day, cb, isOver }: { day: DayColumnModel; cb: ColumnCallbacks; isOver: boolean }) {
  // Coluna passada segue droppable: o drop registra nela e o computeDrop
  // devolve `past` (toast). Só o anel de hover fica desligado.
  const { setNodeRef } = useDroppable({ id: dayContainerId(day.date) });
  const d = parseYmd(day.date);
  const weekday = WEEKDAY_SHORT[(d.getDay() + 6) % 7];
  return (
    <section
      aria-label={`${weekday} ${d.getDate()}`}
      data-calendar-day={day.date}
      className={`flex min-w-[200px] flex-1 flex-col rounded-2xl border p-2 transition-colors ${
        day.isToday ? "border-primary/50 bg-primary/5" : "border-border bg-card/40"
      } ${isOver && !day.isPast ? "ring-2 ring-primary/40" : ""} ${day.isPast ? "opacity-80" : ""}`}
    >
      <header className="mb-2 flex items-baseline justify-between px-1">
        <span className={`text-xs lowercase ${day.isToday ? "font-semibold text-primary" : "text-muted-foreground"}`}>
          {weekday}{day.isToday ? " · hoje" : ""}
        </span>
        <span className={`text-lg font-light tabular-nums ${day.isToday ? "text-primary" : "text-foreground/80"}`}>{d.getDate()}</span>
      </header>

      {day.events.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {day.events.map(e => <EventRow key={`${e.calendarId}:${e.id}`} event={e} />)}
        </div>
      )}

      <div ref={setNodeRef} className="flex min-h-[80px] flex-1 flex-col gap-3">
        <SortableContext id={dayContainerId(day.date)} items={day.items.map(i => i.key)} strategy={verticalListSortingStrategy}>
          {day.items.map(item => (
            <SortableItem key={item.key} id={item.key} dragDisabled={day.isPast}>
              {item.kind === "meeting" ? (
                <MeetingCard meeting={item.meeting} onTriage={cb.onTriage} />
              ) : item.kind === "approval" ? (
                <CalendarApprovalCard task={item.task} onOpen={cb.onOpenTask} />
              ) : (
                <CalendarTaskCard
                  task={item.task}
                  members={cb.membersFor(item.task.workspaceId)}
                  invalidateKeys={cb.invalidateKeys}
                  onOpen={cb.onOpenTask}
                />
              )}
            </SortableItem>
          ))}
        </SortableContext>
        {day.terminal.map(t => (
          <CalendarTaskCard
            key={t.id}
            task={t}
            members={cb.membersFor(t.workspaceId)}
            invalidateKeys={cb.invalidateKeys}
            onOpen={cb.onOpenTask}
          />
        ))}
      </div>
    </section>
  );
}
