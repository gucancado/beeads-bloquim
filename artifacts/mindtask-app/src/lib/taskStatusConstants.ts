import type { LucideIcon } from 'lucide-react';
import { Pencil, Clock, Play, Check, X } from 'lucide-react';

export interface TaskStatusEntry {
  value: 'draft' | 'pending' | 'in_progress' | 'completed' | 'blocked';
  label: string;
  labelPlural: string;
  menuLabel: string;
  icon: LucideIcon;
  dot: string;
  color: string;
  activeClass: string;
}

export const TASK_STATUS_ORDER: readonly TaskStatusEntry[] = [
  {
    value: 'draft',
    label: 'em rascunho',
    labelPlural: 'em rascunho',
    menuLabel: 'rascunho',
    icon: Pencil,
    dot: 'bg-purple-500',
    color: 'bg-purple-500 text-white border-transparent',
    activeClass: 'bg-purple-50 text-purple-700 border-purple-300 hover:bg-purple-100 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800 dark:hover:bg-purple-950/60',
  },
  {
    value: 'pending',
    label: 'pronta e aguardando',
    labelPlural: 'prontas e aguardando',
    menuLabel: 'pronta e aguardando',
    icon: Clock,
    dot: 'bg-blue-500',
    color: 'bg-blue-500 text-white border-transparent',
    activeClass: 'bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800 dark:hover:bg-blue-950/60',
  },
  {
    value: 'in_progress',
    label: 'pronta para fazer',
    labelPlural: 'prontas para fazer',
    menuLabel: 'pronta para fazer',
    icon: Play,
    dot: 'bg-amber-500',
    color: 'bg-amber-500 text-white border-transparent',
    activeClass: 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-950/60',
  },
  {
    value: 'completed',
    label: 'concluída',
    labelPlural: 'concluídas',
    menuLabel: 'concluir',
    icon: Check,
    dot: 'bg-emerald-500',
    color: 'bg-emerald-500 text-white border-transparent',
    activeClass: 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950/60',
  },
  {
    value: 'blocked',
    label: 'cancelada',
    labelPlural: 'canceladas',
    menuLabel: 'cancelar',
    icon: X,
    dot: 'bg-slate-500',
    color: 'bg-slate-500 text-white border-transparent',
    activeClass: 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700 dark:hover:bg-slate-800/60',
  },
];

export type TaskStatusValue = TaskStatusEntry['value'];

export function getStatusOrderEntry(value: string): TaskStatusEntry | undefined {
  return TASK_STATUS_ORDER.find(s => s.value === value);
}

export function getStatusLabel(value: string): string {
  return getStatusOrderEntry(value)?.label ?? value.replace('_', ' ');
}

export function getStatusLabelPlural(value: string): string {
  return getStatusOrderEntry(value)?.labelPlural ?? value.replace('_', ' ');
}

export function getStatusMenuLabel(value: string): string {
  return getStatusOrderEntry(value)?.menuLabel ?? getStatusLabel(value);
}

export function getStatusIcon(value: string): LucideIcon | null {
  return getStatusOrderEntry(value)?.icon ?? null;
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
