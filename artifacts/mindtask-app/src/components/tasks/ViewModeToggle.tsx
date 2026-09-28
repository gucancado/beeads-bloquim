import { CalendarDays, List } from "lucide-react";

export type ViewMode = "lista" | "calendario";

const OPTIONS: { value: ViewMode; label: string; Icon: typeof List }[] = [
  { value: "lista", label: "lista", Icon: List },
  { value: "calendario", label: "calendário", Icon: CalendarDays },
];

export function ViewModeToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div role="radiogroup" aria-label="modo de visualização" className="inline-flex rounded-full border border-border bg-card p-0.5">
      {OPTIONS.map(({ value: v, label, Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm lowercase transition-colors ${
            value === v ? "bg-foreground/10 font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
