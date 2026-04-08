export function getPriorityColor(p: string) {
  switch (p) {
    case "critical": return "text-slate-900 dark:text-white";
    case "high":     return "text-slate-600 dark:text-slate-300";
    case "medium":   return "text-slate-500 dark:text-slate-400";
    case "low":      return "text-slate-400 dark:text-slate-500";
    default: return "";
  }
}

export function getPriorityStars(p: string) {
  switch (p) {
    case "critical": return 4;
    case "high":     return 3;
    case "medium":   return 2;
    case "low":      return 1;
    default: return 1;
  }
}

export function translatePriority(p: string) {
  switch (p) {
    case "critical": return "máxima";
    case "high":     return "alta";
    case "medium":   return "média";
    case "low":      return "baixa";
    default: return p;
  }
}

export const PRIORITY_OPTIONS = [
  { value: "critical", label: "máxima" },
  { value: "high",     label: "alta" },
  { value: "medium",   label: "média" },
  { value: "low",      label: "baixa" },
] as const;
