import { describe, it, expect } from "vitest";
import { anchorOfTask, eventDays, placeWeek, type CalendarTask, type CalendarMeeting, type CalendarEvent } from "./placement";

const WEEK = "2026-09-28"; // seg
const TODAY = "2026-09-30"; // qua

let seq = 0;
function task(p: Partial<CalendarTask>): CalendarTask {
  seq += 1;
  return {
    id: p.id ?? `t${seq}`, workspaceId: "w", title: p.title ?? `t${seq}`, status: "pending", priority: "medium",
    dueDate: null, startAt: null, scheduleMode: "sem_prazo", plannedDate: null, plannedOrder: null,
    completedAt: null, cancelledAt: null, blockedSince: null, isApprovalTask: false,
    createdAt: `2026-09-01T10:00:${String(seq).padStart(2, "0")}.000Z`, updatedAt: "2026-09-01T10:00:00.000Z",
    ...p,
  } as CalendarTask;
}
function meeting(p: Partial<CalendarMeeting>): CalendarMeeting {
  return {
    id: p.id ?? "m1", workspaceId: "w", mapId: null, title: "reunião", meetCode: "abc", status: "scheduled",
    failureReason: null, episodeId: null, participants: null, occurredAt: "2026-09-30T13:00:00.000Z", durationSeconds: null,
    scheduledStartAt: "2026-09-30T13:00:00.000Z", scheduledEndAt: "2026-09-30T14:00:00.000Z", attendees: null,
    collectEnabled: true, attributionMethod: null, gcalEventId: null, gcalRecurringEventId: null, plannedOrder: null,
    ...p,
  } as CalendarMeeting;
}
const localIso = (ymd: string, h = 12) => new Date(`${ymd}T${String(h).padStart(2, "0")}:00:00`).toISOString();

describe("anchorOfTask", () => {
  it("concluída ancora no dia (local) da conclusão; cancelada no cancelamento", () => {
    expect(anchorOfTask(task({ status: "completed", completedAt: localIso("2026-09-29") }), TODAY)).toEqual({ kind: "day", date: "2026-09-29" });
    expect(anchorOfTask(task({ status: "blocked", cancelledAt: null, blockedSince: localIso("2026-09-28") }), TODAY)).toEqual({ kind: "day", date: "2026-09-28" });
    expect(anchorOfTask(task({ status: "completed", completedAt: null, updatedAt: localIso("2026-09-29") }), TODAY)).toEqual({ kind: "day", date: "2026-09-29" });
  });
  it("bloqueada ancora no MAIS RECENTE entre cancelledAt e blockedSince (cancelledAt pode ficar stale — a rota do canvas não escreve cancelled_at)", () => {
    expect(anchorOfTask(task({ status: "blocked", cancelledAt: localIso("2026-09-20"), blockedSince: localIso("2026-09-29") }), TODAY)).toEqual({ kind: "day", date: "2026-09-29" });
  });
  it("data pretendida vence o prazo; prazo sem pretendida; entre usa o prazo máximo", () => {
    expect(anchorOfTask(task({ plannedDate: "2026-10-02", dueDate: "2026-10-01T12:00:00.000Z" }), TODAY)).toEqual({ kind: "day", date: "2026-10-02" });
    expect(anchorOfTask(task({ dueDate: "2026-10-01T12:00:00.000Z", scheduleMode: "ate" }), TODAY)).toEqual({ kind: "day", date: "2026-10-01" });
    expect(anchorOfTask(task({ scheduleMode: "entre", startAt: "2026-09-29T12:00:00.000Z", dueDate: "2026-10-02T12:00:00.000Z" }), TODAY)).toEqual({ kind: "day", date: "2026-10-02" });
  });
  it("atrasada e urgente sem data vão para hoje; sem nada vai para o pool", () => {
    expect(anchorOfTask(task({ dueDate: "2026-09-20T12:00:00.000Z" }), TODAY)).toEqual({ kind: "day", date: TODAY });
    expect(anchorOfTask(task({ plannedDate: "2026-09-29" }), TODAY)).toEqual({ kind: "day", date: TODAY });
    expect(anchorOfTask(task({ scheduleMode: "urgente" }), TODAY)).toEqual({ kind: "day", date: TODAY });
    expect(anchorOfTask(task({}), TODAY)).toEqual({ kind: "pool" });
  });
  it("prazo em semana futura ancora lá", () => {
    expect(anchorOfTask(task({ dueDate: "2026-10-14T12:00:00.000Z" }), TODAY)).toEqual({ kind: "day", date: "2026-10-14" });
  });
});

describe("eventDays", () => {
  it("dia inteiro usa end exclusivo", () => {
    const e = { allDay: true, start: "2026-09-29", end: "2026-10-01" } as CalendarEvent;
    expect(eventDays(e)).toEqual(["2026-09-29", "2026-09-30"]);
  });
  it("evento que cruza meia-noite aparece nos dois dias; terminar à meia-noite não conta o dia seguinte", () => {
    const cross = { allDay: false, start: localIso("2026-09-29", 22), end: localIso("2026-09-30", 1) } as CalendarEvent;
    expect(eventDays(cross)).toEqual(["2026-09-29", "2026-09-30"]);
    const midnight = { allDay: false, start: localIso("2026-09-29", 23), end: new Date("2026-09-30T00:00:00").toISOString() } as CalendarEvent;
    expect(eventDays(midnight)).toEqual(["2026-09-29"]);
  });
});

describe("placeWeek", () => {
  it("ordem padrão: aprovação → reunião → tarefa; ordenados primeiro; terminais à parte", () => {
    const approval = task({ id: "ap", isApprovalTask: true, plannedDate: TODAY });
    const plain = task({ id: "pl", plannedDate: TODAY });
    const pinned = task({ id: "pin", plannedDate: TODAY, plannedOrder: 0 });
    const done = task({ id: "dn", status: "completed", completedAt: localIso(TODAY) });
    const m = meeting({ id: "mt" });
    const w = placeWeek({ tasks: [plain, approval, done, pinned], meetings: [m], events: [], weekStart: WEEK, today: TODAY });
    const wed = w.days.find(d => d.date === TODAY)!;
    expect(wed.items.map(i => i.key)).toEqual(["task:pin", "task:ap", "meeting:mt", "task:pl"]);
    expect(wed.terminal.map(t => t.id)).toEqual(["dn"]);
    expect(wed.isToday).toBe(true);
  });
  it("fim de semana só com conteúdo ou se hoje cair nele", () => {
    const w1 = placeWeek({ tasks: [], meetings: [], events: [], weekStart: WEEK, today: TODAY });
    expect(w1.visibleDays.map(d => d.date)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    const w2 = placeWeek({ tasks: [task({ plannedDate: "2026-10-04" })], meetings: [], events: [], weekStart: WEEK, today: TODAY });
    expect(w2.visibleDays.map(d => d.date)).toContain("2026-10-04");
    expect(w2.visibleDays.map(d => d.date)).not.toContain("2026-10-03");
    const w3 = placeWeek({ tasks: [], meetings: [], events: [], weekStart: WEEK, today: "2026-10-03" });
    expect(w3.visibleDays.map(d => d.date)).toContain("2026-10-03");
  });
  it("semana passada não recebe ativas; pool independe da semana; reunião cancelada some; evento de reunião é deduplicado", () => {
    const late = task({ id: "late", dueDate: "2026-09-22T12:00:00.000Z" });
    const loose = task({ id: "loose" });
    const past = placeWeek({ tasks: [late, loose], meetings: [], events: [], weekStart: "2026-09-21", today: TODAY });
    expect(past.days.flatMap(d => d.items)).toEqual([]);
    expect(past.pool.map(t => t.id)).toEqual(["loose"]);
    expect(past.days.every(d => d.isPast)).toBe(true);

    const ev = { id: "g1", allDay: false, start: localIso(TODAY, 9), end: localIso(TODAY, 10), title: "x" } as CalendarEvent;
    const synced = meeting({ id: "m2", gcalEventId: "g1" });
    const cancelled = meeting({ id: "m3", status: "canceled" });
    const cur = placeWeek({ tasks: [], meetings: [synced, cancelled], events: [ev], weekStart: WEEK, today: TODAY });
    const wed = cur.days.find(d => d.date === TODAY)!;
    expect(wed.events).toEqual([]);
    expect(wed.items.map(i => i.key)).toEqual(["meeting:m2"]);
  });
});
