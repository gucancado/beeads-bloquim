import { Repeat } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RecurrencePanel } from "@/components/tasks/RecurrencePanel";
import type { RecurrenceConfig } from "@/components/tasks/RecurrencePanel";

const RECURRENCE_LABEL: Record<string, string> = {
  daily: "diariamente",
  weekly: "semanalmente",
  monthly: "mensalmente",
  yearly: "anualmente",
  periodic: "periodicamente",
  custom: "personalizado",
};

export function RecurrencePopover({
  disabled,
  open,
  onOpenChange,
  isRecurring,
  value,
  onChange,
}: {
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isRecurring: boolean;
  value: RecurrenceConfig | null;
  onChange: (cfg: RecurrenceConfig | null) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={`h-10 w-10 flex items-center justify-center rounded-xl border transition-all shrink-0 ${
            disabled
              ? "opacity-40 cursor-not-allowed border-border bg-background text-muted-foreground"
              : isRecurring
                ? "border-primary bg-primary/10 text-primary hover:bg-primary/20"
                : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
          }`}
          title={
            disabled
              ? "não é possível ter tarefas recorrentes em um plano"
              : isRecurring && value
                ? `repete ${RECURRENCE_LABEL[value.type]}`
                : "configurar repetição"
          }
        >
          <Repeat className="w-4 h-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto p-0 rounded-xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <RecurrencePanel value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
