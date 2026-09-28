import type { TaskListItemData } from "@/components/tasks/TaskListItem";
import type { Meeting } from "@/components/meetings/useMeetings";
import type { TodayEvent } from "@/hooks/useGoogleCalendar";
import { addDaysYmd, weekDays, ymdLocal } from "./week";

export interface CalendarTask extends TaskListItemData {
  description?: string | null;
  plannedDate: string | null;
  plannedOrder: number | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  approvalStatus?: string | null;
  parentApprovalStatus?: string | null;
}
export type CalendarMeeting = Meeting & { plannedOrder: number | null };
export type CalendarEvent = TodayEvent;

export type ColumnItem =
  | { key: string; kind: "task" | "approval"; id: string; plannedOrder: number | null; task: CalendarTask }
  | { key: string; kind: "meeting"; id: string; plannedOrder: number | null; meeting: CalendarMeeting };

export interface DayColumnModel {
  date: string;
  isToday: boolean;
  isPast: boolean;
  isWeekend: boolean;
  events: CalendarEvent[];
  items: ColumnItem[];
  terminal: CalendarTask[];
}
export interface WeekModel {
  days: DayColumnModel[];
  visibleDays: DayColumnModel[];
  pool: CalendarTask[];
}
export type Anchor = { kind: "day"; date: string } | { kind: "pool" };

const ACTIVE = new Set(["draft", "pending", "in_progress"]);
const TYPE_RANK: Record<ColumnItem["kind"], number> = { approval: 0, meeting: 1, task: 2 };
const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** A API usa kind "task" também para aprovação: a chave de DnD segue a API. */
export function itemKey(kind: "task" | "meeting", id: string): string {
  return `${kind}:${id}`;
}

export function isActiveStatus(status: string): boolean {
  return ACTIVE.has(status);
}

function localDayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : ymdLocal(d);
}

/**
 * Instante mais recente entre `cancelledAt` e `blockedSince` (comparação por
 * timestamp, não por string). A rota de status do canvas nunca escreve
 * `cancelled_at` — só loga atividade — então `cancelledAt` pode ficar stale
 * (bloqueio antigo) enquanto `blockedSince` reflete o bloqueio atual mais
 * recente. Usado tanto para ancorar quanto para ordenar terminais.
 */
function mostRecentIso(a: string | null | undefined, b: string | null | undefined): string | null {
  const ta = a ? new Date(a).getTime() : NaN;
  const tb = b ? new Date(b).getTime() : NaN;
  const aOk = !Number.isNaN(ta);
  const bOk = !Number.isNaN(tb);
  if (aOk && bOk) return ta >= tb ? (a as string) : (b as string);
  if (aOk) return a as string;
  if (bOk) return b as string;
  return null;
}

/** null = não aparece no calendário (terminal sem nenhuma data). */
export function anchorOfTask(t: CalendarTask, today: string): Anchor | null {
  if (t.status === "completed") {
    const d = localDayOf(t.completedAt) ?? localDayOf(t.updatedAt);
    return d ? { kind: "day", date: d } : null;
  }
  if (t.status === "blocked") {
    const d = localDayOf(mostRecentIso(t.cancelledAt, t.blockedSince)) ?? localDayOf(t.updatedAt);
    return d ? { kind: "day", date: d } : null;
  }
  const base = t.plannedDate ?? (t.dueDate ? t.dueDate.slice(0, 10) : null);
  if (!base) return t.scheduleMode === "urgente" ? { kind: "day", date: today } : { kind: "pool" };
  if (base < today) return { kind: "day", date: today };
  return { kind: "day", date: base };
}

export function meetingStart(m: CalendarMeeting): string {
  return m.scheduledStartAt ?? m.occurredAt;
}

/** Dias (YYYY-MM-DD local) cobertos por um evento. `end` é exclusivo. */
export function eventDays(e: CalendarEvent): string[] {
  const days: string[] = [];
  if (e.allDay) {
    const start = e.start.slice(0, 10);
    const endEx = e.end ? e.end.slice(0, 10) : addDaysYmd(start, 1);
    for (let d = start; d < endEx && days.length < 62; d = addDaysYmd(d, 1)) days.push(d);
    return days.length ? days : [start];
  }
  const s = new Date(e.start);
  const en = new Date(e.end || e.start);
  if (Number.isNaN(s.getTime())) return days;
  const first = ymdLocal(s);
  const last = ymdLocal(new Date(Math.max(s.getTime(), en.getTime() - 1)));
  for (let d = first; d <= last && days.length < 62; d = addDaysYmd(d, 1)) days.push(d);
  return days;
}

function taskDue(t: CalendarTask): string | null {
  return t.dueDate ? t.dueDate.slice(0, 10) : null;
}

export function compareColumnItems(a: ColumnItem, b: ColumnItem): number {
  const ao = a.plannedOrder;
  const bo = b.plannedOrder;
  if (ao != null && bo != null && ao !== bo) return ao - bo;
  if (ao != null && bo == null) return -1;
  if (ao == null && bo != null) return 1;
  const tr = TYPE_RANK[a.kind] - TYPE_RANK[b.kind];
  if (tr !== 0) return tr;
  if (a.kind === "meeting" && b.kind === "meeting") {
    const c = meetingStart(a.meeting).localeCompare(meetingStart(b.meeting));
    if (c !== 0) return c;
  } else if (a.kind !== "meeting" && b.kind !== "meeting") {
    const ad = taskDue(a.task);
    const bd = taskDue(b.task);
    if (ad !== bd) {
      if (ad == null) return 1;
      if (bd == null) return -1;
      return ad < bd ? -1 : 1;
    }
    const pr = (PRIORITY_RANK[a.task.priority] ?? 9) - (PRIORITY_RANK[b.task.priority] ?? 9);
    if (pr !== 0) return pr;
    const cr = a.task.createdAt.localeCompare(b.task.createdAt);
    if (cr !== 0) return cr;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Instante usado pra ordenar terminais. Bloqueada usa o mesmo critério de
 * `anchorOfTask` (mais recente entre cancelledAt/blockedSince) — ver a nota
 * em `mostRecentIso`.
 */
function terminalInstant(t: CalendarTask): string {
  return (t.status === "completed" ? t.completedAt : mostRecentIso(t.cancelledAt, t.blockedSince)) ?? t.updatedAt;
}

function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return a.start.localeCompare(b.start);
}

export function placeWeek(input: {
  tasks: CalendarTask[];
  meetings: CalendarMeeting[];
  events: CalendarEvent[];
  weekStart: string;
  today: string;
}): WeekModel {
  const dates = weekDays(input.weekStart);
  const byDate = new Map<string, DayColumnModel>(
    dates.map((date, i) => [date, {
      date, isToday: date === input.today, isPast: date < input.today, isWeekend: i >= 5,
      events: [], items: [], terminal: [],
    }]),
  );
  const pool: CalendarTask[] = [];

  for (const t of input.tasks) {
    const anchor = anchorOfTask(t, input.today);
    if (!anchor) continue;
    if (anchor.kind === "pool") { pool.push(t); continue; }
    const col = byDate.get(anchor.date);
    if (!col) continue;
    if (!isActiveStatus(t.status)) { col.terminal.push(t); continue; }
    col.items.push({
      key: itemKey("task", t.id), kind: t.isApprovalTask ? "approval" : "task",
      id: t.id, plannedOrder: t.plannedOrder, task: t,
    });
  }

  const syncedEventIds = new Set<string>();
  for (const m of input.meetings) {
    if (m.gcalEventId) syncedEventIds.add(m.gcalEventId);
    if (m.status === "canceled") continue;
    const col = byDate.get(ymdLocal(new Date(meetingStart(m))));
    if (!col) continue;
    col.items.push({ key: itemKey("meeting", m.id), kind: "meeting", id: m.id, plannedOrder: m.plannedOrder, meeting: m });
  }

  for (const e of input.events) {
    if (syncedEventIds.has(e.id)) continue;
    for (const d of eventDays(e)) byDate.get(d)?.events.push(e);
  }

  const days = dates.map(d => byDate.get(d)!);
  for (const col of days) {
    col.items.sort(compareColumnItems);
    col.terminal.sort((a, b) => terminalInstant(a).localeCompare(terminalInstant(b)));
    col.events.sort(compareEvents);
  }
  pool.sort((a, b) =>
    ((PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)) || a.createdAt.localeCompare(b.createdAt));

  const hasContent = (c: DayColumnModel) => c.events.length + c.items.length + c.terminal.length > 0;
  const visibleDays = days.filter(c => !c.isWeekend || c.isToday || hasContent(c));
  return { days, visibleDays, pool };
}
