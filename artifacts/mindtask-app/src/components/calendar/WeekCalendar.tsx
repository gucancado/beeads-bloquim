import { useMemo, useState } from "react";
import { DndContext, DragOverlay, closestCorners, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@beeads/ui";
import { TriageDialog } from "@/components/meetings/TriageDialog";
import type { Meeting } from "@/components/meetings/useMeetings";
import type { AvatarPickerMember } from "@/components/tasks/AssigneeAvatarPicker";
import { useToast } from "@/hooks/use-toast";
import { getApprovalDisplayTitle } from "@/lib/approvalTaskTitle";
import { useGoogleCalendarStatus, useRangeEvents } from "@/hooks/useGoogleCalendar";
import {
  calendarMeetingsKey, calendarTasksKey, useCalendarMeetings, useCalendarTasks, useReorderCalendar, type CalendarScope,
} from "@/hooks/useCalendarData";
import { computeDrop } from "@/lib/calendar/dnd";
import { placeWeek, type CalendarTask } from "@/lib/calendar/placement";
import { CalendarPointerSensor } from "@/lib/calendar/sensor";
import { addDaysYmd, parseYmd, startOfWeekMonday, weekBoundsISO, ymdLocal } from "@/lib/calendar/week";
import { DayColumn, type ColumnCallbacks } from "./DayColumn";
import { PoolSection } from "./PoolSection";

export interface WeekCalendarProps {
  scope: CalendarScope;
  status: string;
  assignees: string[];
  membersFor: (workspaceId: string | null) => AvatarPickerMember[];
  extraInvalidateKeys: unknown[][];
  onOpenTask: (task: CalendarTask) => void;
}

function weekLabel(weekStart: string): string {
  const s = parseYmd(weekStart);
  const e = parseYmd(addDaysYmd(weekStart, 6));
  const fmt = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
  return `${fmt(s)} – ${fmt(e)}`;
}

export function WeekCalendar({ scope, status, assignees, membersFor, extraInvalidateKeys, onOpenTask }: WeekCalendarProps) {
  const today = ymdLocal(new Date());
  const currentWeek = startOfWeekMonday(today);
  const [weekStart, setWeekStart] = useState(currentWeek);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [triageTarget, setTriageTarget] = useState<Meeting | null>(null);
  const { toast } = useToast();

  const tasksQ = useCalendarTasks(scope, weekStart, status, assignees);
  const meetingsQ = useCalendarMeetings(scope, weekStart);
  const { data: gcal } = useGoogleCalendarStatus();
  const { from, to } = weekBoundsISO(weekStart);
  const eventsQ = useRangeEvents(from, to, !!gcal?.connected && assignees.includes("me"));

  const week = useMemo(() => placeWeek({
    tasks: tasksQ.data ?? [],
    meetings: meetingsQ.data ?? [],
    events: eventsQ.data?.events ?? [],
    weekStart,
    today,
  }), [tasksQ.data, meetingsQ.data, eventsQ.data, weekStart, today]);

  const tasksKey = calendarTasksKey(scope, weekStart, status, assignees);
  const meetingsKey = calendarMeetingsKey(scope, weekStart);
  const reorder = useReorderCalendar(tasksKey, meetingsKey, extraInvalidateKeys);
  const sensors = useSensors(useSensor(CalendarPointerSensor, { activationConstraint: { distance: 4 } }));

  // Chaves ESTÁVEIS: o useInlineTaskEditor libera a invalidação represada no
  // cleanup do efeito que depende delas; identidade nova a cada render soltaria
  // a represa no meio da edição de prazo.
  const extraKeySig = JSON.stringify(extraInvalidateKeys);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const invalidateKeys = useMemo(() => [[tasksKey[0]], ...extraInvalidateKeys], [tasksKey[0], extraKeySig]);
  const cb: ColumnCallbacks = { membersFor, invalidateKeys, onOpenTask, onTriage: setTriageTarget };

  const onDragStart = (e: DragStartEvent) => setActiveKey(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveKey(null);
    if (!e.over) return;
    const result = computeDrop({ week, activeKey: String(e.active.id), overId: String(e.over.id), today });
    if (result.ok) {
      reorder.mutate({ body: result.body, optimistic: result.optimistic });
    } else if (result.reason === "past") {
      toast({ title: "dias passados não recebem tarefas" });
    } else if (result.reason === "meeting-cross-day") {
      toast({ title: "reunião só muda de posição dentro do dia" });
    }
  };

  const activeTitle = useMemo(() => {
    if (!activeKey) return null;
    for (const d of week.days) {
      const it = d.items.find(i => i.key === activeKey);
      if (it) return it.kind === "meeting" ? (it.meeting.title ?? "reunião") : getApprovalDisplayTitle(it.task);
    }
    const poolTask = week.pool.find(t => `task:${t.id}` === activeKey);
    return poolTask ? getApprovalDisplayTitle(poolTask) : null;
  }, [activeKey, week]);

  // Com keepPreviousData, troca de semana não zera `data`: spinner só no
  // primeiro carregamento, sem dado nenhum.
  const loading = !tasksQ.data && tasksQ.isLoading;
  const refreshing = tasksQ.isPlaceholderData;

  return (
    <div data-testid="week-calendar">
      <div className="mb-4 flex items-center justify-center gap-3">
        <span className="text-sm font-light lowercase text-foreground/80">{weekLabel(weekStart)}</span>
        {weekStart !== currentWeek && (
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(currentWeek)}>hoje</Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveKey(null)}>
          {/* Setas nas laterais do calendário (pedido do produto). Ficam fora da
              área com scroll horizontal, então nunca cobrem cards. */}
          <div className="flex items-stretch gap-2">
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 self-center"
              onClick={() => setWeekStart(w => addDaysYmd(w, -7))}
              aria-label="semana anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div
              className={`flex min-w-0 flex-1 gap-3 overflow-x-auto pb-2 transition-opacity ${refreshing ? "opacity-60" : ""}`}
              aria-busy={refreshing || undefined}
            >
              {week.visibleDays.map(day => <DayColumn key={day.date} day={day} cb={cb} />)}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 self-center"
              onClick={() => setWeekStart(w => addDaysYmd(w, 7))}
              aria-label="próxima semana"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <PoolSection tasks={week.pool} cb={cb} />
          <DragOverlay>
            {activeTitle ? (
              <div className="max-w-[260px] rounded-xl border bg-card px-3 py-2 text-sm font-semibold shadow-lg">{activeTitle}</div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <TriageDialog meeting={triageTarget} open={triageTarget !== null} onOpenChange={(o) => { if (!o) setTriageTarget(null); }} />
    </div>
  );
}
