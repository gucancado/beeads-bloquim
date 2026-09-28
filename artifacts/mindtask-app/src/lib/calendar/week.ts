/** Datas do calendário: sempre YYYY-MM-DD no fuso local do navegador. */
export function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDaysYmd(ymd: string, n: number): string {
  const d = parseYmd(ymd);
  d.setDate(d.getDate() + n);
  return ymdLocal(d);
}

export function startOfWeekMonday(ymd: string): string {
  const d = parseYmd(ymd);
  const dow = (d.getDay() + 6) % 7; // seg=0 … dom=6
  d.setDate(d.getDate() - dow);
  return ymdLocal(d);
}

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i));
}

/** [from, to) da semana em instantes ISO (meia-noite local). */
export function weekBoundsISO(weekStart: string): { from: string; to: string } {
  return { from: parseYmd(weekStart).toISOString(), to: parseYmd(addDaysYmd(weekStart, 7)).toISOString() };
}

export const WEEKDAY_SHORT = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
