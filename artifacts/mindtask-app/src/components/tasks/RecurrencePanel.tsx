import { Trash2, ChevronDown, Check } from "lucide-react";
import { useState, useRef, useEffect } from "react";

export type RecurrenceType = "daily" | "weekly" | "monthly" | "yearly" | "periodic" | "custom";

export interface RecurrenceConfig {
  type: RecurrenceType;
  weekDays?: number[];
  monthlyMode?: "ordinal" | "day";
  ordinalWeek?: number;
  ordinalDay?: number;
  monthDay?: number;
  intervalDays?: number;
  customInterval?: number;
  customUnit?: "day" | "week" | "month" | "year";
  customWeekDays?: number[];
}

interface RecurrencePanelProps {
  value: RecurrenceConfig | null;
  onChange: (config: RecurrenceConfig | null) => void;
}

const WEEK_DAY_LABELS = ["d", "2ª", "3ª", "4ª", "5ª", "6ª", "s"];
const WEEK_DAY_FULL = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const ORDINAL_LABELS = ["1ª", "2ª", "3ª", "4ª", "5ª (última)"];

type RecurrenceTypeOption = {
  value: RecurrenceType;
  label: string;
};

const TYPE_OPTIONS: RecurrenceTypeOption[] = [
  { value: "daily", label: "diariamente" },
  { value: "weekly", label: "semanalmente" },
  { value: "monthly", label: "mensalmente" },
  { value: "yearly", label: "anualmente" },
  { value: "periodic", label: "periodicamente" },
  { value: "custom", label: "personalizado" },
];

const DEFAULT_CONFIG: Record<RecurrenceType, RecurrenceConfig> = {
  daily: { type: "daily" },
  weekly: { type: "weekly", weekDays: [1] },
  monthly: { type: "monthly", monthlyMode: "day", monthDay: 1 },
  yearly: { type: "yearly" },
  periodic: { type: "periodic", intervalDays: 7 },
  custom: { type: "custom", customInterval: 1, customUnit: "day" },
};

function TypeDropdown({ value, onChange }: { value: RecurrenceType; onChange: (t: RecurrenceType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const current = TYPE_OPTIONS.find((o) => o.value === value);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-foreground border border-border rounded-lg px-2.5 py-1 bg-background hover:border-primary/50 transition-colors"
      >
        <span className="lowercase">{current?.label ?? value}</span>
        <ChevronDown className="w-3 h-3 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-xl shadow-lg py-1 min-w-[150px] overflow-hidden">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs lowercase hover:bg-muted transition-colors text-left"
            >
              <span>{opt.label}</span>
              {opt.value === value && <Check className="w-3 h-3 text-primary shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function RecurrencePanel({ value, onChange }: RecurrencePanelProps) {
  const config = value ?? DEFAULT_CONFIG["daily"];

  const handleTypeChange = (type: RecurrenceType) => {
    onChange(DEFAULT_CONFIG[type]);
  };

  const update = (partial: Partial<RecurrenceConfig>) => {
    onChange({ ...config, ...partial });
  };

  const toggleWeekDay = (day: number, fieldKey: "weekDays" | "customWeekDays") => {
    const current = (config[fieldKey] as number[] | undefined) ?? [];
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day];
    update({ [fieldKey]: next.length > 0 ? next : [day] });
  };

  return (
    <div className="p-3 space-y-3">
      {/* Header: "repetir" + type dropdown + trash */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground tracking-wider lowercase shrink-0">repetir</span>
        <TypeDropdown value={config.type} onChange={handleTypeChange} />
        <div className="flex-1" />
        {value && (
          <button
            onClick={() => onChange(null)}
            className="text-muted-foreground hover:text-destructive transition-colors p-0.5 rounded shrink-0"
            title="Remover repetição"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Weekly: day checkboxes */}
      {config.type === "weekly" && (
        <div className="space-y-1">
          <span className="text-[11px] text-muted-foreground lowercase">dias da semana:</span>
          <div className="flex gap-1">
            {WEEK_DAY_LABELS.map((label, idx) => {
              const selected = (config.weekDays ?? []).includes(idx);
              return (
                <button
                  key={idx}
                  onClick={() => toggleWeekDay(idx, "weekDays")}
                  title={WEEK_DAY_FULL[idx]}
                  className={`w-7 h-7 rounded-full text-[11px] font-semibold border transition-all ${
                    selected
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:border-primary/40"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Monthly: mode selector + fields */}
      {config.type === "monthly" && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <button
              onClick={() => update({ monthlyMode: "day", monthDay: config.monthDay ?? 1 })}
              className={`text-[11px] px-2.5 py-0.5 rounded-full border transition-all lowercase ${
                (config.monthlyMode ?? "day") === "day"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/40"
              }`}
            >
              no dia
            </button>
            <button
              onClick={() => update({ monthlyMode: "ordinal", ordinalWeek: config.ordinalWeek ?? 1, ordinalDay: config.ordinalDay ?? 1 })}
              className={`text-[11px] px-2.5 py-0.5 rounded-full border transition-all lowercase ${
                config.monthlyMode === "ordinal"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/40"
              }`}
            >
              na
            </button>
          </div>

          {(config.monthlyMode ?? "day") === "day" ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground lowercase">dia</span>
              <input
                type="number"
                min={1}
                max={31}
                value={config.monthDay ?? 1}
                onChange={(e) => update({ monthDay: Math.max(1, Math.min(31, parseInt(e.target.value) || 1)) })}
                className="w-14 text-xs border border-border rounded-lg px-2 py-0.5 bg-background text-center outline-none focus:border-primary"
              />
              <span className="text-[11px] text-muted-foreground lowercase">do mês</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground lowercase">semana:</span>
                <div className="flex gap-1">
                  {ORDINAL_LABELS.map((label, idx) => {
                    const week = idx + 1;
                    return (
                      <button
                        key={week}
                        onClick={() => update({ ordinalWeek: week })}
                        className={`text-[11px] px-2 py-0.5 rounded-full border transition-all lowercase ${
                          (config.ordinalWeek ?? 1) === week
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground border-border hover:border-primary/40"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground lowercase">dia:</span>
                <div className="flex gap-1">
                  {WEEK_DAY_LABELS.map((label, idx) => (
                    <button
                      key={idx}
                      onClick={() => update({ ordinalDay: idx })}
                      title={WEEK_DAY_FULL[idx]}
                      className={`w-7 h-7 rounded-full text-[11px] font-semibold border transition-all ${
                        (config.ordinalDay ?? 1) === idx
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-primary/40"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Periodic: interval in days */}
      {config.type === "periodic" && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground lowercase">a cada</span>
          <input
            type="number"
            min={1}
            value={config.intervalDays ?? 7}
            onChange={(e) => update({ intervalDays: Math.max(1, parseInt(e.target.value) || 1) })}
            className="w-14 text-xs border border-border rounded-lg px-2 py-0.5 bg-background text-center outline-none focus:border-primary"
          />
          <span className="text-[11px] text-muted-foreground lowercase">dias da conclusão</span>
        </div>
      )}

      {/* Custom: interval + unit + optional week days */}
      {config.type === "custom" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-muted-foreground lowercase">a cada</span>
            <input
              type="number"
              min={1}
              value={config.customInterval ?? 1}
              onChange={(e) => update({ customInterval: Math.max(1, parseInt(e.target.value) || 1) })}
              className="w-14 text-xs border border-border rounded-lg px-2 py-0.5 bg-background text-center outline-none focus:border-primary"
            />
            <div className="flex gap-1">
              {(["day", "week", "month", "year"] as const).map((unit) => {
                const labels = { day: "dia(s)", week: "semana(s)", month: "mês(es)", year: "ano(s)" };
                return (
                  <button
                    key={unit}
                    onClick={() => update({ customUnit: unit })}
                    className={`text-[11px] px-2 py-0.5 rounded-full border transition-all lowercase ${
                      (config.customUnit ?? "day") === unit
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary/40"
                    }`}
                  >
                    {labels[unit]}
                  </button>
                );
              })}
            </div>
          </div>

          {config.customUnit === "week" && (
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground lowercase">dias da semana (opcional):</span>
              <div className="flex gap-1">
                {WEEK_DAY_LABELS.map((label, idx) => {
                  const selected = (config.customWeekDays ?? []).includes(idx);
                  return (
                    <button
                      key={idx}
                      onClick={() => toggleWeekDay(idx, "customWeekDays")}
                      title={WEEK_DAY_FULL[idx]}
                      className={`w-7 h-7 rounded-full text-[11px] font-semibold border transition-all ${
                        selected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-primary/40"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
