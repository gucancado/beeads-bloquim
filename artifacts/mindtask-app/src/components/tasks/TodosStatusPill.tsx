import { TODOS_FILTER_OPTION } from "@/lib/taskStatusConstants";

interface Props {
  active: boolean;
  onSelect: () => void;
}

// Pill de filtro de status "todos" (tudo menos cancelada). Compartilhada
// entre /my-tasks e a aba de tarefas do workspace — mesma marcação/classes/
// aria nas duas telas.
export function TodosStatusPill({ active, onSelect }: Props) {
  return (
    <button
      onClick={onSelect}
      title={TODOS_FILTER_OPTION.label}
      aria-label={TODOS_FILTER_OPTION.label}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold border transition-all duration-150 cursor-pointer ${
        active
          ? TODOS_FILTER_OPTION.activeClass
          : "bg-card text-muted-foreground border-border hover:border-slate-400 dark:hover:border-slate-600"
      }`}
    >
      <TODOS_FILTER_OPTION.icon className="w-3.5 h-3.5" />
      <span>todos</span>
    </button>
  );
}
