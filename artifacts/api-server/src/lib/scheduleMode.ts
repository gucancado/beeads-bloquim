import { parseDateNoon } from "../services/taskVisualSyncService";
import { getTodayLocal } from "./overdue";

export type ScheduleMode = "ate" | "entre" | "em" | "sem_prazo";

export interface ScheduleInput {
  scheduleMode?: ScheduleMode | null;
  startAt?: string | null;
  dueDate?: string | null;
}

export interface ResolvedSchedule {
  scheduleMode: ScheduleMode;
  startAt: Date | null;
  dueDate: Date | null;
}

export interface ScheduleResolveResult {
  ok: true;
  value: ResolvedSchedule;
}

export interface ScheduleResolveError {
  ok: false;
  error: string;
}

/**
 * Normalizes a (scheduleMode, startAt, dueDate) triple coming off the wire.
 * Returns the canonical Date values to persist, or an error message.
 *
 *   - "ate":       uses dueDate only; startAt is forced to null.
 *   - "entre":     needs both startAt and dueDate, with startAt <= dueDate.
 *   - "em":        needs a single date (we accept it from either field) and
 *                  persists startAt = dueDate.
 *   - "sem_prazo": no deadline — startAt and dueDate are both forced to null.
 *
 * Missing fields fall back to the provided `current` values so partial PATCHes
 * preserve unrelated state.
 */
export function resolveSchedule(
  input: ScheduleInput,
  current: { scheduleMode: ScheduleMode; startAt: Date | null; dueDate: Date | null },
): ScheduleResolveResult | ScheduleResolveError {
  const mode: ScheduleMode = (input.scheduleMode ?? current.scheduleMode) as ScheduleMode;

  const newStart = "startAt" in input ? parseDateNoon(input.startAt ?? null) : current.startAt;
  const newDue = "dueDate" in input ? parseDateNoon(input.dueDate ?? null) : current.dueDate;

  if (mode === "sem_prazo") {
    return { ok: true, value: { scheduleMode: "sem_prazo", startAt: null, dueDate: null } };
  }

  if (mode === "ate") {
    return { ok: true, value: { scheduleMode: "ate", startAt: null, dueDate: newDue ?? null } };
  }

  if (mode === "em") {
    const single = newDue ?? newStart ?? null;
    if (!single) {
      return { ok: false, error: "modalidade 'em' requer uma data" };
    }
    return { ok: true, value: { scheduleMode: "em", startAt: single, dueDate: single } };
  }

  // "entre"
  if (!newStart || !newDue) {
    return { ok: false, error: "modalidade 'entre' requer início e fim" };
  }
  if (newStart.getTime() > newDue.getTime()) {
    return { ok: false, error: "startAt deve ser anterior ou igual a dueDate" };
  }
  return { ok: true, value: { scheduleMode: "entre", startAt: newStart, dueDate: newDue } };
}

/**
 * Whether a task is currently eligible for auto-activation based on its
 * schedule modality.
 *
 *   - `ate` (legacy): always eligible — overdue tasks are still allowed
 *     to advance through the dependency cascade. The dueDate only drives
 *     overdue marking, not the cascade itself.
 *   - `entre`: requires both `startAt` and `dueDate`. Today must satisfy
 *     `startAt <= today <= dueDate`. Missing bounds → not eligible (we
 *     refuse to silently activate work whose window is undefined).
 *   - `em`:    requires `dueDate` (startAt is mirrored to it). Today must
 *     equal that date. Missing date → not eligible.
 */
export function isWithinScheduleWindow(
  scheduleMode: ScheduleMode | null | undefined,
  startAt: Date | string | null | undefined,
  dueDate: Date | string | null | undefined,
): boolean {
  const mode: ScheduleMode = (scheduleMode ?? "ate") as ScheduleMode;
  if (mode === "ate" || mode === "sem_prazo") return true;

  const today = getTodayLocal();
  if (mode === "em") {
    if (!dueDate) return false;
    const due = new Date(dueDate);
    due.setUTCHours(0, 0, 0, 0);
    return due.getTime() === today.getTime();
  }

  // "entre"
  if (!startAt || !dueDate) return false;
  const start = new Date(startAt);
  start.setUTCHours(0, 0, 0, 0);
  if (start > today) return false;
  const due = new Date(dueDate);
  due.setUTCHours(0, 0, 0, 0);
  if (due < today) return false;
  return true;
}
