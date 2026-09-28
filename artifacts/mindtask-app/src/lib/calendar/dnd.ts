import type { ColumnItem, WeekModel } from "./placement";

export const POOL_ID = "pool";
export const dayContainerId = (date: string) => `day:${date}`;

export interface ReorderBody {
  date: string;
  items: { kind: "task" | "meeting"; id: string }[];
  moved?: { kind: "task"; id: string; target: "day" | "pool" };
}
export interface OptimisticPatch {
  tasks: Record<string, { plannedOrder: number | null; plannedDate?: string | null }>;
  meetings: Record<string, { plannedOrder: number | null }>;
}
export type DropResult =
  | { ok: false; reason: "noop" | "past" | "meeting-cross-day" | "invalid" }
  | { ok: true; body: ReorderBody; optimistic: OptimisticPatch };

type Loc = { container: "pool" } | { container: "day"; date: string; index: number };

function locate(week: WeekModel, key: string): Loc | null {
  for (const d of week.days) {
    const index = d.items.findIndex(i => i.key === key);
    if (index >= 0) return { container: "day", date: d.date, index };
  }
  if (week.pool.some(t => `task:${t.id}` === key)) return { container: "pool" };
  return null;
}

const apiKind = (i: ColumnItem): "task" | "meeting" => (i.kind === "meeting" ? "meeting" : "task");

/** Traduz um drop do dnd-kit na chamada de reorder + patch otimista. Puro. */
export function computeDrop(input: { week: WeekModel; activeKey: string; overId: string; today: string }): DropResult {
  const { week, activeKey, overId, today } = input;
  const source = locate(week, activeKey);
  if (!source) return { ok: false, reason: "invalid" };
  const [kind, id] = activeKey.split(":") as ["task" | "meeting", string];

  let target: Loc | null;
  if (overId === POOL_ID) target = { container: "pool" };
  else if (overId.startsWith("day:")) {
    const date = overId.slice(4);
    const col = week.days.find(d => d.date === date);
    target = col ? { container: "day", date, index: col.items.length } : null;
  } else target = locate(week, overId);
  if (!target) return { ok: false, reason: "invalid" };

  if (kind === "meeting") {
    if (target.container === "pool" || source.container === "pool" || target.date !== source.date) {
      return { ok: false, reason: "meeting-cross-day" };
    }
  }

  if (target.container === "pool") {
    if (source.container === "pool") return { ok: false, reason: "noop" };
    return {
      ok: true,
      body: { date: source.date, items: [], moved: { kind: "task", id, target: "pool" } },
      optimistic: { tasks: { [id]: { plannedOrder: null, plannedDate: null } }, meetings: {} },
    };
  }

  if (target.date < today) return { ok: false, reason: "past" };
  const col = week.days.find(d => d.date === target.date)!;
  const sameColumn = source.container === "day" && source.date === target.date;
  let ordered: ColumnItem[];
  if (sameColumn) {
    if (source.index === target.index || (overId.startsWith("day:") && source.index === col.items.length - 1)) {
      return { ok: false, reason: "noop" };
    }
    ordered = col.items.slice();
    const [moving] = ordered.splice(source.index, 1);
    const to = overId.startsWith("day:") ? ordered.length : target.index;
    ordered.splice(to, 0, moving);
  } else {
    const moving: ColumnItem = source.container === "pool"
      ? { key: activeKey, kind: "task", id, plannedOrder: null, task: week.pool.find(t => t.id === id)! }
      : week.days.find(d => d.date === source.date)!.items[source.index];
    ordered = col.items.slice();
    ordered.splice(target.index, 0, moving);
  }

  const optimistic: OptimisticPatch = { tasks: {}, meetings: {} };
  ordered.forEach((item, i) => {
    if (item.kind === "meeting") optimistic.meetings[item.id] = { plannedOrder: i };
    else optimistic.tasks[item.id] = { plannedOrder: i };
  });
  const body: ReorderBody = { date: target.date, items: ordered.map(i => ({ kind: apiKind(i), id: i.id })) };
  if (!sameColumn) {
    body.moved = { kind: "task", id, target: "day" };
    optimistic.tasks[id] = { plannedOrder: optimistic.tasks[id].plannedOrder, plannedDate: target.date };
  }
  return { ok: true, body, optimistic };
}
