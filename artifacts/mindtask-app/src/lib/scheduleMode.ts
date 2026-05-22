export type ScheduleModeValue = "ate" | "entre" | "em" | "sem_prazo" | "urgente";

/**
 * Whether the schedule (mode + dates) is in a saveable state. Used to gate
 * autosave so half-filled "entre" windows or empty "em" dates don't churn
 * the backend with invalid persists.
 *
 * - `ate`         → always saveable (dueDate optional)
 * - `em`          → needs a dueDate
 * - `entre`       → needs both startAt and dueDate
 * - `sem_prazo` / `urgente` → no dates, handled separately by callers
 */
export function canPersistScheduleMode(
  mode: ScheduleModeValue | string,
  startAt: string | null | undefined,
  dueDate: string | null | undefined,
): boolean {
  if (mode === "ate") return true;
  if (mode === "em") return !!dueDate;
  if (mode === "entre") return !!startAt && !!dueDate;
  // sem_prazo / urgente have their own persist path — return false so the
  // generic gate doesn't accidentally trigger a save here.
  return false;
}
