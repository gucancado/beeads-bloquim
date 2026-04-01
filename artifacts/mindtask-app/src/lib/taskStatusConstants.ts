export const TASK_STATUS_ORDER = [
  {
    value: 'draft',
    label: 'rascunho',
    dot: 'bg-purple-500',
    color: 'bg-purple-500 text-white border-transparent',
    activeClass: 'bg-purple-50 text-purple-700 border-purple-300 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800',
  },
  {
    value: 'pending',
    label: 'pendente',
    dot: 'bg-blue-500',
    color: 'bg-blue-500 text-white border-transparent',
    activeClass: 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800',
  },
  {
    value: 'in_progress',
    label: 'em andamento',
    dot: 'bg-amber-500',
    color: 'bg-amber-500 text-white border-transparent',
    activeClass: 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
  },
  {
    value: 'completed',
    label: 'concluir',
    dot: 'bg-emerald-500',
    color: 'bg-emerald-500 text-white border-transparent',
    activeClass: 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800',
  },
  {
    value: 'blocked',
    label: 'cancelar',
    dot: 'bg-slate-500',
    color: 'bg-slate-500 text-white border-transparent',
    activeClass: 'bg-slate-50 text-slate-700 border-slate-300 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700',
  },
] as const;

export type TaskStatusValue = typeof TASK_STATUS_ORDER[number]['value'];

export function getStatusOrderEntry(value: string) {
  return TASK_STATUS_ORDER.find(s => s.value === value) as (typeof TASK_STATUS_ORDER[number] | undefined);
}

export function getStatusLabel(value: string): string {
  return getStatusOrderEntry(value)?.label ?? value.replace('_', ' ');
}

export function getStatusDotClass(value: string): string {
  return getStatusOrderEntry(value)?.dot ?? 'bg-gray-400';
}

export function getStatusColorClass(value: string): string {
  return getStatusOrderEntry(value)?.color ?? '';
}

export function getStatusActiveClass(value: string): string {
  return getStatusOrderEntry(value)?.activeClass ?? '';
}
