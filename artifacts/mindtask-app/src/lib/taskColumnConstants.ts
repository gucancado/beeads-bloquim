// Keep this list in sync with TASK_COLUMN_KEYS on the api-server preferences route.
// A ordem aqui é o DEFAULT da tabela quando o usuário não tem preferência
// salva (ou quando a saved é incompleta, ver mergeTaskColumnOrder).
//
// "recurrence" foi removida — o ícone de recorrência agora aparece embutido
// no fim da coluna "schedule" (ver TaskListItem.renderScheduleCell).
export const TASK_COLUMN_KEYS = [
  "status",
  "title",
  "schedule",
  "assignee",
  "workspace_map",
  "checklist",
  "comments",
  "attachments",
  "priority",
] as const;

export type TaskColumnKey = (typeof TASK_COLUMN_KEYS)[number];

export const DEFAULT_TASK_COLUMN_ORDER: readonly TaskColumnKey[] = TASK_COLUMN_KEYS;

export const TASK_COLUMN_LABELS: Record<TaskColumnKey, string> = {
  title: "tarefa",
  status: "status",
  assignee: "responsável",
  priority: "prioridade",
  schedule: "prazo",
  checklist: "checklist",
  comments: "comentários",
  attachments: "anexos",
  workspace_map: "local",
};

// Title gets a min width so it doesn't collapse, but no fixed width — it
// grows to fill remaining space in table-auto layout.
export const TASK_COLUMN_WIDTH_CLASS: Record<TaskColumnKey, string> = {
  title: "min-w-[260px]",
  status: "w-[60px]",
  assignee: "w-[52px]",
  priority: "w-[110px]",
  schedule: "w-[230px]",
  checklist: "w-[100px]",
  comments: "w-[80px]",
  attachments: "w-[60px]",
  workspace_map: "w-[170px]",
};

export function isTaskColumnKey(value: string): value is TaskColumnKey {
  return (TASK_COLUMN_KEYS as readonly string[]).includes(value);
}

export function mergeTaskColumnOrder(
  saved: Array<{ columnKey: string; sortOrder: number }>,
): TaskColumnKey[] {
  const validSaved = saved
    .filter((r) => isTaskColumnKey(r.columnKey))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => r.columnKey as TaskColumnKey);
  if (validSaved.length === 0) {
    return [...DEFAULT_TASK_COLUMN_ORDER];
  }
  // Saved order vence. Colunas faltantes (ex.: usuário salvou antes de uma
  // nova coluna ser adicionada) entram no final na ordem do DEFAULT.
  const seen = new Set(validSaved);
  const missing = DEFAULT_TASK_COLUMN_ORDER.filter((k) => !seen.has(k));
  return [...validSaved, ...missing];
}
