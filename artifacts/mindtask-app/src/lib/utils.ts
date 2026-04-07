import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { differenceInCalendarDays, format } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getStatusColor(status: string) {
  switch (status) {
    case 'pending': return 'bg-blue-500 text-white';
    case 'in_progress': return 'bg-amber-500 text-white';
    case 'completed': return 'bg-emerald-500 text-white';
    case 'overdue': return 'bg-red-500 text-white';
    case 'blocked': return 'bg-slate-500 text-white';
    case 'draft': return 'bg-purple-500 text-white';
    case 'no_task': return 'bg-slate-400 text-white';
    default: return 'bg-slate-400 text-white';
  }
}

export function getStatusColorHex(status: string) {
  switch (status) {
    case 'pending': return 'hsl(221 83% 53%)';
    case 'in_progress': return 'hsl(38 92% 50%)';
    case 'completed': return 'hsl(142 71% 45%)';
    case 'overdue': return 'hsl(0 84% 60%)';
    case 'blocked': return 'hsl(215 16% 47%)';
    case 'draft': return 'hsl(270 60% 55%)';
    case 'no_task': return 'hsl(215 16% 47%)';
    default: return 'hsl(215 16% 47%)';
  }
}

const WEEKDAY_NAMES_PT = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function formatDueDate(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(dateStr.slice(0, 10) + "T00:00:00");
  const diff = differenceInCalendarDays(date, today);
  if (diff === 0) return "hoje";
  if (diff === -1) return "ontem";
  if (diff === 1) return "amanhã";
  if (diff > 1 && diff <= 6) return WEEKDAY_NAMES_PT[date.getDay()];
  if (date.getFullYear() === today.getFullYear()) return format(date, "dd/MM");
  return format(date, "dd/MM/yyyy");
}
