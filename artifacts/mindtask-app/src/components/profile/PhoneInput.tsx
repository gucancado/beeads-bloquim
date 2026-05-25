import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Input } from "@beeads/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@beeads/ui";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface Country {
  iso: string;
  name: string;
  dial: string;
  flag: string;
}

// iso → unicode regional indicator pair, e.g. "BR" → "🇧🇷".
function flagFromIso(iso: string): string {
  return String.fromCodePoint(
    ...iso.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

const RAW_COUNTRIES: Array<[string, string, string]> = [
  ["BR", "Brasil", "55"],
  ["PT", "Portugal", "351"],
  ["US", "Estados Unidos", "1"],
  ["CA", "Canadá", "1"],
  ["MX", "México", "52"],
  ["AR", "Argentina", "54"],
  ["CL", "Chile", "56"],
  ["CO", "Colômbia", "57"],
  ["PE", "Peru", "51"],
  ["UY", "Uruguai", "598"],
  ["PY", "Paraguai", "595"],
  ["BO", "Bolívia", "591"],
  ["EC", "Equador", "593"],
  ["VE", "Venezuela", "58"],
  ["ES", "Espanha", "34"],
  ["FR", "França", "33"],
  ["IT", "Itália", "39"],
  ["DE", "Alemanha", "49"],
  ["GB", "Reino Unido", "44"],
  ["IE", "Irlanda", "353"],
  ["NL", "Países Baixos", "31"],
  ["BE", "Bélgica", "32"],
  ["CH", "Suíça", "41"],
  ["AT", "Áustria", "43"],
  ["SE", "Suécia", "46"],
  ["NO", "Noruega", "47"],
  ["DK", "Dinamarca", "45"],
  ["FI", "Finlândia", "358"],
  ["PL", "Polônia", "48"],
  ["CZ", "Tchéquia", "420"],
  ["GR", "Grécia", "30"],
  ["RO", "Romênia", "40"],
  ["RU", "Rússia", "7"],
  ["UA", "Ucrânia", "380"],
  ["TR", "Turquia", "90"],
  ["IL", "Israel", "972"],
  ["AE", "Emirados Árabes Unidos", "971"],
  ["SA", "Arábia Saudita", "966"],
  ["EG", "Egito", "20"],
  ["MA", "Marrocos", "212"],
  ["ZA", "África do Sul", "27"],
  ["NG", "Nigéria", "234"],
  ["KE", "Quênia", "254"],
  ["AO", "Angola", "244"],
  ["MZ", "Moçambique", "258"],
  ["CV", "Cabo Verde", "238"],
  ["CN", "China", "86"],
  ["JP", "Japão", "81"],
  ["KR", "Coreia do Sul", "82"],
  ["IN", "Índia", "91"],
  ["PK", "Paquistão", "92"],
  ["ID", "Indonésia", "62"],
  ["TH", "Tailândia", "66"],
  ["VN", "Vietnã", "84"],
  ["PH", "Filipinas", "63"],
  ["MY", "Malásia", "60"],
  ["SG", "Singapura", "65"],
  ["AU", "Austrália", "61"],
  ["NZ", "Nova Zelândia", "64"],
];

export const COUNTRIES: Country[] = RAW_COUNTRIES.map(([iso, name, dial]) => ({
  iso,
  name,
  dial,
  flag: flagFromIso(iso),
}));

const DEFAULT_COUNTRY = COUNTRIES.find((c) => c.iso === "BR")!;

// Match the country by longest dial-code prefix on the stored value's digits.
function parseStored(value: string | null | undefined): {
  country: Country;
  local: string;
} {
  if (!value) return { country: DEFAULT_COUNTRY, local: "" };
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return { country: DEFAULT_COUNTRY, local: "" };
  const match = [...COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => digits.startsWith(c.dial));
  if (!match) return { country: DEFAULT_COUNTRY, local: value };
  // Preserve original formatting of the local part by stripping the leading
  // `+dial` (and any surrounding whitespace) from the displayed string.
  const stripped = value.replace(/^\s*\+?\s*/, "").replace(new RegExp(`^${match.dial}\\s*`), "");
  return { country: match, local: stripped };
}

export interface PhoneInputProps {
  value: string | null | undefined;
  onCommit: (next: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function PhoneInput({ value, onCommit, disabled, placeholder }: PhoneInputProps) {
  const parsed = useMemo(() => parseStored(value), [value]);

  const [country, setCountry] = useState<Country>(parsed.country);
  const [local, setLocal] = useState<string>(parsed.local);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-sync whenever the upstream value changes (e.g. after a successful save).
  useEffect(() => {
    setCountry(parsed.country);
    setLocal(parsed.local);
  }, [parsed.country, parsed.local]);

  const commit = (nextCountry: Country, nextLocal: string) => {
    const digits = nextLocal.replace(/[^\d]/g, "");
    const composed = digits ? `+${nextCountry.dial} ${nextLocal.trim()}` : null;
    if (composed === (value ?? null)) return;
    onCommit(composed);
  };

  const handlePickCountry = (next: Country) => {
    setCountry(next);
    setOpen(false);
    commit(next, local);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
    if (e.key === "Escape") {
      setLocal(parsed.local);
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="flex items-stretch gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border bg-background px-3 text-sm",
              "hover:bg-accent/30 transition-colors disabled:opacity-50",
            )}
            title={`${country.name} (+${country.dial})`}
          >
            <span>+{country.dial}</span>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-72" align="start">
          <Command>
            <CommandInput placeholder="Buscar país..." />
            <CommandList>
              <CommandEmpty>Nenhum país encontrado.</CommandEmpty>
              <CommandGroup>
                {COUNTRIES.map((c) => (
                  <CommandItem
                    key={c.iso}
                    value={`${c.name} +${c.dial} ${c.iso}`}
                    onSelect={() => handlePickCountry(c)}
                  >
                    <span className="text-lg leading-none mr-2">{c.flag}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-muted-foreground text-xs mr-2">+{c.dial}</span>
                    {c.iso === country.iso && <Check className="w-3.5 h-3.5" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Input
        ref={inputRef}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => commit(country, local)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className="rounded-xl bg-background flex-1"
        placeholder={placeholder ?? "telefone com ddd"}
        inputMode="tel"
        autoComplete="tel-national"
      />
    </div>
  );
}
