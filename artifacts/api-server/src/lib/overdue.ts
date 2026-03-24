const APP_TIMEZONE = "America/Sao_Paulo";

export function getTodayLocal(): Date {
  const now = new Date();
  const parts = now
    .toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE })
    .split("-");
  return new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
}

export function computeOverdue(
  dueDate: Date | string | null | undefined,
  status: string,
): boolean {
  if (status === "completed") return false;
  if (!dueDate) return false;
  const today = getTodayLocal();
  const due = new Date(dueDate);
  due.setUTCHours(0, 0, 0, 0);
  return due < today;
}
