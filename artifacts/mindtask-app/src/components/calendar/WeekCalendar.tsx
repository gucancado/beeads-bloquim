import { useMemo, useState } from "react";
import { DndContext, DragOverlay, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
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
import { computeDrop, dayContainerId, POOL_ID } from "@/lib/calendar/dnd";
import { placeWeek, type CalendarTask, type WeekModel } from "@/lib/calendar/placement";
import { CalendarPointerSensor } from "@/lib/calendar/sensor";
import { calendarCollision } from "@/lib/calendar/collision";
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

/** Aviso quando soltar no pool não tira a tarefa do dia (prazo ou urgente). */
function stickyReasonOf(week: WeekModel, taskId: string): string | null {
  for (const d of week.days) {
    for (const it of d.items) {
      if (it.kind === "meeting" || it.id !== taskId) continue;
      if (it.task.scheduleMode === "urgente") return "tarefa urgente continua em hoje";
      if (it.task.dueDate && d.isToday && it.task.dueDate.slice(0, 10) < d.date) return "tarefa atrasada continua em hoje";
      if (it.task.dueDate) return "tarefa com prazo continua no dia do prazo";
      return null;
    }
  }
  return null;
}

export function WeekCalendar({ scope, status, assignees, membersFor, extraInvalidateKeys, onOpenTask }: WeekCalendarProps) {
  const today = ymdLocal(new Date());
  const currentWeek = startOfWeekMonday(today);
  const [weekStart, setWeekStart] = useState(currentWeek);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [overContainer, setOverContainer] = useState<string | null>(null);
  const [triageTarget, setTriageTarget] = useState<Meeting | null>(null);
  const { toast } = useToast();

  const tasksQ = useCalendarTasks(scope, weekStart, status, assignees);
  const meetingsQ = useCalendarMeetings(scope, weekStart);
  const { data: gcal } = useGoogleCalendarStatus();
  const { from, to } = weekBoundsISO(weekStart);
  // Query desabilitada ainda devolve o cache: sem o gate aqui, os eventos do
  // Google seguiriam na tela depois de tirar "eu" do filtro. Filtro vazio =
  // todo mundo (inclui "eu").
  const eventsOn = !!gcal?.connected && (assignees.length === 0 || assignees.includes("me"));
  const eventsQ = useRangeEvents(from, to, eventsOn);

  const week = useMemo(() => placeWeek({
    tasks: tasksQ.data ?? [],
    meetings: meetingsQ.data ?? [],
    events: eventsOn ? eventsQ.data?.events ?? [] : [],
    weekStart,
    today,
  }), [tasksQ.data, meetingsQ.data, eventsQ.data, eventsOn, weekStart, today]);

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

  // Semana em troca: o modelo ainda é o da semana anterior e o reorder mandaria
  // a lista de coluna errada. Drop é ignorado até os dados novos chegarem.
  const stale = tasksQ.isPlaceholderData || meetingsQ.isPlaceholderData;

  const onDragStart = (e: DragStartEvent) => setActiveKey(String(e.active.id));
  const onDragOver = (e: DragOverEvent) => {
    const over = e.over;
    if (!over) { setOverContainer(null); return; }
    const id = String(over.id);
    const sortable = (over.data.current as { sortable?: { containerId?: string | number } } | undefined)?.sortable;
    if (id === POOL_ID || id.startsWith("day:")) setOverContainer(id);
    else setOverContainer(sortable?.containerId != null ? String(sortable.containerId) : null);
  };
  const endDrag = () => { setActiveKey(null); setOverContainer(null); };
  const onDragEnd = (e: DragEndEvent) => {
    endDrag();
    if (!e.over || stale) return;
    const result = computeDrop({ week, activeKey: String(e.active.id), overId: String(e.over.id), today });
    if (result.ok) {
      const moved = result.body.moved;
      // Soltar no pool só limpa a data pretendida: com prazo (ou urgente) a
      // tarefa continua ancorada num dia. Avisar em vez de parecer que falhou.
      const stays = moved?.target === "pool" ? stickyReasonOf(week, moved.id) : null;
      reorder.mutate({ body: result.body, optimistic: result.optimistic }, {
        onSuccess: () => { if (stays) toast({ title: stays }); },
      });
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
  const refreshing = stale;

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
        <DndContext sensors={sensors} collisionDetection={calendarCollision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={endDrag}>
          {/* Setas nas laterais do calendário (pedido do produto). Ficam fora da
              área com scroll horizontal, então nunca cobrem cards. */}
          <div className="flex items-stretch gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 shrink-0 self-center p-0"
              onClick={() => setWeekStart(w => addDaysYmd(w, -7))}
              aria-label="semana anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div
              className={`flex min-w-0 flex-1 gap-2 overflow-x-auto pb-2 transition-opacity ${refreshing ? "opacity-60" : ""}`}
              aria-busy={refreshing || undefined}
            >
              {week.visibleDays.map(day => (
                <DayColumn key={day.date} day={day} cb={cb} isOver={overContainer === dayContainerId(day.date)} />
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 shrink-0 self-center p-0"
              onClick={() => setWeekStart(w => addDaysYmd(w, 7))}
              aria-label="próxima semana"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <PoolSection tasks={week.pool} cb={cb} isOver={overContainer === POOL_ID} />
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
