import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getPriorityColor, getPriorityStars, translatePriority, PRIORITY_OPTIONS } from "./priorityUtils";

interface PriorityBadgeProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Optional container to portal the popup into — used when nested inside a Radix Dialog. */
  portalContainer?: HTMLElement | null;
}

export function PriorityBadge({ value, onChange, disabled, portalContainer, allowEmpty }: PriorityBadgeProps & { allowEmpty?: boolean }) {
  const [open, setOpen] = useState(false);

  const handleSelect = (val: string) => {
    setOpen(false);
    onChange(val);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { if (!disabled) setOpen(o); }}>
      <PopoverTrigger asChild>
        <Badge
          variant="outline"
          className={`px-1 py-0 text-sm border-0 bg-transparent shadow-none cursor-pointer select-none transition-opacity leading-none ${value ? getPriorityColor(value) : "text-muted-foreground/40"} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
          title={value ? `prioridade ${translatePriority(value)}` : "prioridade vazia"}
          aria-disabled={disabled || undefined}
        >
          {value ? "★".repeat(getPriorityStars(value)) : "☆☆☆☆"}
        </Badge>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        container={portalContainer}
        className="p-1 rounded-xl min-w-[140px]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {PRIORITY_OPTIONS.map(opt => {
          const isCurrent = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleSelect(opt.value)}
              className={`w-full text-left px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-2 rounded-md hover:bg-muted/60 ${isCurrent ? "bg-muted/30" : ""}`}
              aria-pressed={isCurrent}
            >
              <span className={`inline-block w-[4em] shrink-0 text-right text-xs leading-none ${getPriorityColor(opt.value)}`}>
                {"★".repeat(getPriorityStars(opt.value))}
              </span>
              {opt.label}
            </button>
          );
        })}
        {allowEmpty && (
          <button
            type="button"
            onClick={() => handleSelect("")}
            className={`w-full text-left px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-2 rounded-md hover:bg-muted/60 ${!value ? "bg-muted/30" : ""}`}
            aria-pressed={!value}
          >
            <span className="inline-block w-[4em] shrink-0 text-right text-xs leading-none text-muted-foreground/40">
              ☆☆☆☆
            </span>
            vazio
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
