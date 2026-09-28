import { describe, it, expect } from "vitest";
import { computeDrop, dayContainerId, POOL_ID } from "./dnd";
import { placeWeek, type CalendarTask, type CalendarMeeting } from "./placement";

const WEEK = "2026-09-28";
const TODAY = "2026-09-30";
let n = 0;
const task = (p: Partial<CalendarTask>): CalendarTask => ({
  id: `t${++n}`, workspaceId: "w", title: "t", status: "pending", priority: "medium", dueDate: null, startAt: null,
  scheduleMode: "sem_prazo", plannedDate: null, plannedOrder: null, completedAt: null, cancelledAt: null,
  blockedSince: null, isApprovalTask: false, createdAt: `2026-09-01T00:00:${String(n).padStart(2, "0")}.000Z`,
  updatedAt: "2026-09-01T00:00:00.000Z", ...p,
} as CalendarTask);
const meeting = (id: string): CalendarMeeting => ({
  id, workspaceId: "w", mapId: null, title: "m", meetCode: "c", status: "scheduled", failureReason: null, episodeId: null,
  participants: null, occurredAt: "2026-09-30T13:00:00.000Z", durationSeconds: null,
  scheduledStartAt: "2026-09-30T13:00:00.000Z", scheduledEndAt: "2026-09-30T14:00:00.000Z", attendees: null,
  collectEnabled: true, attributionMethod: null, gcalEventId: null, gcalRecurringEventId: null, plannedOrder: null,
} as CalendarMeeting);

function fixture() {
  const a = task({ id: "a", plannedDate: "2026-10-01", plannedOrder: 0 });
  const b = task({ id: "b", plannedDate: "2026-10-01", plannedOrder: 1 });
  const c = task({ id: "c", plannedDate: "2026-10-01", plannedOrder: 2 });
  const d = task({ id: "d", plannedDate: "2026-10-02" });
  const p = task({ id: "p" });
  const week = placeWeek({ tasks: [a, b, c, d, p], meetings: [meeting("m")], events: [], weekStart: WEEK, today: TODAY });
  return week;
}

describe("computeDrop", () => {
  it("reordena dentro da coluna (arrayMove)", () => {
    const r = computeDrop({ week: fixture(), activeKey: "task:a", overId: "task:c", today: TODAY });
    expect(r.ok && r.body).toEqual({ date: "2026-10-01", items: [{ kind: "task", id: "b" }, { kind: "task", id: "c" }, { kind: "task", id: "a" }] });
    expect(r.ok && r.optimistic.tasks).toEqual({ b: { plannedOrder: 0 }, c: { plannedOrder: 1 }, a: { plannedOrder: 2 } });
  });
  it("move para outra coluna antes do card alvo e marca moved", () => {
    const r = computeDrop({ week: fixture(), activeKey: "task:d", overId: "task:b", today: TODAY });
    expect(r.ok && r.body).toEqual({
      date: "2026-10-01",
      items: [{ kind: "task", id: "a" }, { kind: "task", id: "d" }, { kind: "task", id: "b" }, { kind: "task", id: "c" }],
      moved: { kind: "task", id: "d", target: "day" },
    });
    expect(r.ok && r.optimistic.tasks.d).toEqual({ plannedOrder: 1, plannedDate: "2026-10-01" });
  });
  it("soltar no container anexa ao fim; pool → dia funciona", () => {
    const r = computeDrop({ week: fixture(), activeKey: "task:p", overId: dayContainerId("2026-10-02"), today: TODAY });
    expect(r.ok && r.body).toEqual({
      date: "2026-10-02", items: [{ kind: "task", id: "d" }, { kind: "task", id: "p" }], moved: { kind: "task", id: "p", target: "day" },
    });
  });
  it("dia → pool limpa", () => {
    const r = computeDrop({ week: fixture(), activeKey: "task:a", overId: POOL_ID, today: TODAY });
    expect(r.ok && r.body).toEqual({ date: "2026-10-01", items: [], moved: { kind: "task", id: "a", target: "pool" } });
    expect(r.ok && r.optimistic.tasks.a).toEqual({ plannedOrder: null, plannedDate: null });
  });
  it("rejeita coluna passada, reunião mudando de dia e no-op", () => {
    expect(computeDrop({ week: fixture(), activeKey: "task:a", overId: dayContainerId("2026-09-29"), today: TODAY })).toEqual({ ok: false, reason: "past" });
    expect(computeDrop({ week: fixture(), activeKey: "meeting:m", overId: dayContainerId("2026-10-01"), today: TODAY })).toEqual({ ok: false, reason: "meeting-cross-day" });
    expect(computeDrop({ week: fixture(), activeKey: "task:a", overId: "task:a", today: TODAY })).toEqual({ ok: false, reason: "noop" });
    expect(computeDrop({ week: fixture(), activeKey: "task:p", overId: POOL_ID, today: TODAY })).toEqual({ ok: false, reason: "noop" });
  });
});
