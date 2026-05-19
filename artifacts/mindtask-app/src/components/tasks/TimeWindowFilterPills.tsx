import type { TimeWindow } from "@/lib/groupTasksByDeadline";
import { ateSextaLabel } from "@/lib/groupTasksByDeadline";

interface Props {
  value: TimeWindow;
  onChange: (next: TimeWindow) => void;
  /** Now override pra testes; default = new Date() no render. */
  now?: Date;
}

// Pills de filtro de janela de prazo. Render na mesma linha do status filter,
// à direita, separado por um gap maior. Single-select, mutuamente exclusivo
// com ele mesmo (mas combina com status + assignee).
//
// O botão "até sexta" é oculto na sexta-feira (não faz sentido — já é o fim
// do range). Na quinta-feira o label vira "amanhã" pra ficar mais imediato.
export function TimeWindowFilterPills({ value, onChange, now }: Props) {
  const ateSexta = ateSextaLabel(now);

  type Opt = { value: TimeWindow; label: string };
  const options: Opt[] = [
    { value: "hoje", label: "hoje" },
    ...(ateSexta ? [{ value: "ate_sexta" as const, label: ateSexta }] : []),
    { value: "proxima_semana", label: "próxima semana" },
    { value: "sem_prazo", label: "sem prazo" },
    { value: "todas", label: "todas" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtro de janela de prazo">
      {options.map(opt => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={isActive}
            title={opt.label}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold border transition-all duration-150 cursor-pointer lowercase ${
              isActive
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:border-slate-400 dark:hover:border-slate-600"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
