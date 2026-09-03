// Dropdown da modalidade de prazo (urgente / fazer até / entre / em / sem
// prazo). Compartilhado pelo modal de detalhe e pelo popover de prazo das
// listas, pra manter o mesmo vocabulário e a mesma ordem.
import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@beeads/ui";
import type { ScheduleModeValue } from "@/lib/scheduleMode";

// "urgente" comes first because the lists sort by it as the primary key —
// keeping the dropdown order matched to the sort order makes the UI legible.
export const SCHEDULE_MODE_OPTIONS: { value: ScheduleModeValue; label: string }[] = [
  { value: "urgente", label: "urgente" },
  { value: "ate", label: "fazer até" },
  { value: "entre", label: "fazer entre" },
  { value: "em", label: "fazer em" },
  { value: "sem_prazo", label: "sem prazo" },
];

export function ScheduleModeDropdown({
  value,
  onChange,
}: {
  value: ScheduleModeValue;
  onChange: (next: ScheduleModeValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = SCHEDULE_MODE_OPTIONS.find(o => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={(props) => (
        <button
          {...props}
          type="button"
          className="flex items-center gap-1 text-xs font-medium text-foreground border border-border rounded-lg px-2.5 py-1 bg-background hover:border-primary/50 transition-colors"
        >
          <span className="lowercase">{current?.label ?? value}</span>
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        </button>
      )} />
      <PopoverContent align="start" className="p-1 rounded-xl min-w-[140px]">
        {SCHEDULE_MODE_OPTIONS.map(opt => {
          const isCurrent = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs lowercase rounded-md hover:bg-muted/60 transition-colors text-left ${isCurrent ? "bg-muted/30" : ""}`}
              aria-pressed={isCurrent}
            >
              <span>{opt.label}</span>
              {isCurrent && <Check className="w-3 h-3 text-primary shrink-0" />}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
