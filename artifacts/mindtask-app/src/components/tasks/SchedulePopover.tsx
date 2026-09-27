// Popover de configuração de prazo usado pela célula de prazo das listas
// (TaskListItem). Abre colado ao texto do prazo e mostra o campo "modalidade
// de prazo" + 1 calendário (fazer até / fazer em) ou 2 (fazer entre), cada um
// com os atalhos "hoje" e "amanhã". Cada escolha dispara o callback na hora
// (autosave); o popover fica aberto até clique fora ou Esc.
import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger, Calendar } from "@beeads/ui";
import { ptBR } from "date-fns/locale";
import { ScheduleModeDropdown, ScheduleModeOptionList } from "@/components/tasks/ScheduleModeDropdown";
import type { ScheduleModeValue } from "@/lib/scheduleMode";

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

function todayPlus(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return dateToYmd(d);
}

interface CalendarBlockProps {
  /** Rótulo acima do calendário ("início" / "fim"); omitido no modo de data única. */
  label?: string;
  /** Marcador pra testes e estilos: qual data este calendário edita. */
  calendar: "start" | "due";
  value: string;
  min?: string;
  max?: string;
  onSelect: (ymd: string) => void;
}

function CalendarBlock({ label, calendar, value, min, max, onSelect }: CalendarBlockProps) {
  const selected = ymdToDate(value);
  const minDate = ymdToDate(min);
  const maxDate = ymdToDate(max);
  const disabled =
    minDate && maxDate ? { before: minDate, after: maxDate }
    : minDate ? { before: minDate }
    : maxDate ? { after: maxDate }
    : undefined;

  return (
    <div data-calendar={calendar} className="flex flex-col items-center gap-1">
      {label && <span className="text-[11px] text-muted-foreground lowercase">{label}</span>}
      {/* `relative`: as setas de mês do Calendar são `absolute` e, sem isto, os
          dois calendários de "entre" ancoram no popover e se sobrepõem. O
          padding lateral dá espaço pras setas não cobrirem dom/sab. */}
      <div className="relative px-7">
        <Calendar
          mode="single"
          locale={ptBR}
          selected={selected}
          defaultMonth={selected ?? minDate ?? new Date()}
          disabled={disabled}
          onSelect={(date) => {
            if (date) onSelect(dateToYmd(date));
          }}
        />
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onSelect(todayPlus(0))}
          className="rounded-full border border-input px-2.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          hoje
        </button>
        <button
          type="button"
          onClick={() => onSelect(todayPlus(1))}
          className="rounded-full border border-input px-2.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          amanhã
        </button>
      </div>
    </div>
  );
}

interface Props {
  mode: ScheduleModeValue;
  /** ISO ou null, como vem da API. */
  startAt?: string | null;
  dueDate?: string | null;
  onModeChange: (next: ScheduleModeValue) => void;
  onStartAtSelect: (ymd: string) => void;
  onDueDateSelect: (ymd: string) => void;
  /**
   * Avisa o dono da linha que a configuração começou/terminou — ele usa isso
   * pra segurar o refetch da lista enquanto o popover está aberto.
   */
  onOpenChange?: (open: boolean) => void;
  /** Elemento que dispara o popover (o texto do prazo na linha). */
  children: React.ReactElement;
}

export function SchedulePopover({
  mode,
  startAt,
  dueDate,
  onModeChange,
  onStartAtSelect,
  onDueDateSelect,
  onOpenChange,
  children,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const start = startAt ? startAt.slice(0, 10) : "";
  const due = dueDate ? dueDate.slice(0, 10) : "";
  const hasDates = mode === "ate" || mode === "em" || mode === "entre";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger render={(props) => React.cloneElement(children, props)} />
      <PopoverContent
        align="start"
        data-schedule-popover=""
        className={hasDates ? "w-auto p-3 rounded-xl" : "w-auto p-1 rounded-xl min-w-[140px]"}
        onClick={(e) => e.stopPropagation()}
      >
        {hasDates ? (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="lowercase">modalidade de prazo</span>
              <ScheduleModeDropdown value={mode} onChange={onModeChange} />
            </div>
            <div className="mt-2 flex items-start gap-3">
              {mode === "entre" && (
                <CalendarBlock label="início" calendar="start" value={start} max={due || undefined} onSelect={onStartAtSelect} />
              )}
              <CalendarBlock
                label={mode === "entre" ? "fim" : undefined}
                calendar="due"
                value={due}
                min={mode === "entre" ? start || undefined : undefined}
                onSelect={onDueDateSelect}
              />
            </div>
          </>
        ) : (
          // Urgente e sem prazo não têm data: o popover É a lista de
          // modalidades, sem a caixa de seleção intermediária.
          <ScheduleModeOptionList value={mode} onChange={onModeChange} />
        )}
      </PopoverContent>
    </Popover>
  );
}
