import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger, Calendar } from "@beeads/ui";
import { ptBR } from "date-fns/locale";

function ymdToDate(ymd: string | null | undefined): Date | undefined {
  if (!ymd) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function dateToYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface Props {
  value: string;
  onSelect: (ymd: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
}

/**
 * Popover wrapper around react-day-picker's `<Calendar>`. Selection is
 * explicit (only fires when the user clicks a day) — month navigation
 * arrows never change the selected date, unlike the native `<input
 * type="date">` picker.
 */
export function DatePickerPopover({
  value,
  onSelect,
  min,
  max,
  disabled,
  children,
  align = "start",
}: Props) {
  const [open, setOpen] = React.useState(false);
  const selected = ymdToDate(value);
  const minDate = ymdToDate(min);
  const maxDate = ymdToDate(max);

  const disabledMatcher: { before?: Date; after?: Date } | undefined =
    minDate || maxDate ? { before: minDate, after: maxDate } : undefined;

  return (
    <Popover open={open} onOpenChange={(o) => { if (!disabled) setOpen(o); }}>
      <PopoverTrigger
        disabled={disabled}
        render={(props) =>
          React.cloneElement(children as React.ReactElement, props)
        }
      />
      <PopoverContent
        align={align}
        className="w-auto p-0"
        onClick={(e) => e.stopPropagation()}
        onPointerDownOutside={() => setOpen(false)}
      >
        <Calendar
          mode="single"
          locale={ptBR}
          selected={selected}
          defaultMonth={selected ?? minDate ?? new Date()}
          disabled={disabledMatcher}
          onSelect={(date) => {
            if (!date) return;
            onSelect(dateToYmd(date));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
