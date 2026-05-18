import type { RecurrenceConfig } from "@workspace/db/schema";
import { getTodayLocal } from "./overdue";

/**
 * Add months to a date, clamping day-of-month to prevent rollover.
 * e.g. Jan 31 + 1 month -> Feb 28 (not Mar 2/3)
 */
function addMonthsToDay(year: number, month: number, day: number, months: number): Date {
  const totalMonths = year * 12 + month + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return new Date(Date.UTC(targetYear, targetMonth, clampedDay, 12, 0, 0));
}

/**
 * Add years to a date, clamping Feb 29 to Feb 28 on non-leap years.
 */
function addYearsToDate(base: Date, years: number): Date {
  const targetYear = base.getUTCFullYear() + years;
  const month = base.getUTCMonth();
  const day = base.getUTCDate();
  const daysInTargetMonth = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return new Date(Date.UTC(targetYear, month, clampedDay, 12, 0, 0));
}

export function calculateNextDueDate(
  currentDueDate: Date | null,
  recurrenceConfig: RecurrenceConfig,
  completedAt: Date,
): Date | null {
  const base = currentDueDate ?? completedAt;

  switch (recurrenceConfig.type) {
    case "daily": {
      const next = new Date(base);
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
    }

    case "weekly": {
      const weekDays = recurrenceConfig.weekDays;
      if (!weekDays || weekDays.length === 0) {
        const next = new Date(base);
        next.setUTCDate(next.getUTCDate() + 7);
        return next;
      }
      const sortedDays = [...weekDays].sort((a, b) => a - b);
      const baseDay = base.getUTCDay();
      const nextDay = sortedDays.find(d => d > baseDay) ?? sortedDays[0];
      const diff = nextDay > baseDay
        ? nextDay - baseDay
        : 7 - baseDay + nextDay;
      const next = new Date(base);
      next.setUTCDate(next.getUTCDate() + diff);
      return next;
    }

    case "monthly": {
      const mode = recurrenceConfig.monthlyMode ?? "day";
      if (mode === "day") {
        // Use the configured monthDay (or base day), add one month with proper clamping
        const day = recurrenceConfig.monthDay ?? base.getUTCDate();
        return addMonthsToDay(base.getUTCFullYear(), base.getUTCMonth(), day, 1);
      } else {
        // Ordinal weekday: e.g. "3rd Tuesday" or "last Friday"
        const ordinalWeek = recurrenceConfig.ordinalWeek ?? 1;
        const ordinalDay = recurrenceConfig.ordinalDay ?? 1;
        const nextMonth = base.getUTCMonth() + 1;
        const targetYear = nextMonth > 11
          ? base.getUTCFullYear() + 1
          : base.getUTCFullYear();
        const targetMonth = nextMonth % 12;
        return getNthDayOfMonth(targetYear, targetMonth, ordinalWeek, ordinalDay);
      }
    }

    case "yearly": {
      return addYearsToDate(base, 1);
    }

    case "periodic": {
      const intervalDays = recurrenceConfig.intervalDays ?? 7;
      const next = new Date(completedAt);
      next.setUTCDate(next.getUTCDate() + intervalDays);
      return next;
    }

    case "custom": {
      const interval = recurrenceConfig.customInterval ?? 1;
      const unit = recurrenceConfig.customUnit ?? "day";
      if (unit === "day") {
        const next = new Date(base);
        next.setUTCDate(next.getUTCDate() + interval);
        return next;
      } else if (unit === "week") {
        const customWeekDays = recurrenceConfig.customWeekDays;
        if (customWeekDays && customWeekDays.length > 0) {
          const sortedDays = [...customWeekDays].sort((a, b) => a - b);
          const baseDay = base.getUTCDay();
          const nextDay = sortedDays.find(d => d > baseDay) ?? sortedDays[0];
          const diff = nextDay > baseDay
            ? nextDay - baseDay
            : interval * 7 - baseDay + nextDay;
          const next = new Date(base);
          next.setUTCDate(next.getUTCDate() + diff);
          return next;
        } else {
          const next = new Date(base);
          next.setUTCDate(next.getUTCDate() + interval * 7);
          return next;
        }
      } else if (unit === "month") {
        return addMonthsToDay(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), interval);
      } else if (unit === "year") {
        return addYearsToDate(base, interval);
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * Fast-forward `calculateNextDueDate` until the result is today or future.
 *
 * Used by the recurring-task duplication path so we never create a duplicated
 * occurrence that is already overdue at birth — if the original task was
 * completed weeks late, we skip past the missed occurrences and land on the
 * next real one.
 *
 * Returns `null` when:
 *   - the underlying `calculateNextDueDate` returns null (invalid type);
 *   - iterations stagnate (e.g. `periodic` ignores `currentDueDate`, so a
 *     past `completedAt + intervalDays` would loop forever) — caller treats
 *     this as "give up the schedule, fall back to sem_prazo";
 *   - the cap of 1000 iterations is reached.
 */
export function calculateNextDueDateInFuture(
  currentDueDate: Date | null,
  recurrenceConfig: RecurrenceConfig,
  completedAt: Date,
): Date | null {
  const today = getTodayLocal();
  const MAX_ITERATIONS = 1000;

  let result = calculateNextDueDate(currentDueDate, recurrenceConfig, completedAt);
  if (!result) return null;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const probe = new Date(result);
    probe.setUTCHours(0, 0, 0, 0);
    if (probe.getTime() >= today.getTime()) return result;

    const next = calculateNextDueDate(result, recurrenceConfig, completedAt);
    if (!next) return null;
    if (next.getTime() <= result.getTime()) return null;
    result = next;
  }
  return null;
}

/**
 * Get the Nth occurrence of a weekday in a month.
 * If week=5, returns the LAST occurrence of that weekday in the month
 * (which may be the 4th or 5th occurrence).
 */
function getNthDayOfMonth(year: number, month: number, week: number, dayOfWeek: number): Date {
  if (week === 5) {
    // Last occurrence: start from last day of month and go backwards
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    const lastDayOfWeek = lastDay.getUTCDay();
    let diff = lastDayOfWeek - dayOfWeek;
    if (diff < 0) diff += 7;
    const day = lastDay.getUTCDate() - diff;
    return new Date(Date.UTC(year, month, day, 12, 0, 0));
  }
  // Nth occurrence (1-4): find first occurrence, then jump (week-1)*7 days
  const firstDay = new Date(Date.UTC(year, month, 1));
  const firstDayOfWeek = firstDay.getUTCDay();
  let diff = dayOfWeek - firstDayOfWeek;
  if (diff < 0) diff += 7;
  const day = 1 + diff + (week - 1) * 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  // If week=4 but month has only 4 occurrences and result overflows, clamp to last
  const clampedDay = Math.min(day, daysInMonth);
  return new Date(Date.UTC(year, month, clampedDay, 12, 0, 0));
}
