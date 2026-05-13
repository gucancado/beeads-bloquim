// Pool de saudações do landing pós-login (/my-tasks).
//
// Camada 1: pool estático filtrado por janela horária + dia da semana.
// Camada 2: regras contextuais (tarefas atrasadas, vencem hoje, primeira
// sessão, ausência longa). A Camada 2 dispara com probabilidade
// `contextualChance` (default 35%); o resto cai na Camada 1.
//
// Convenções:
// - Tudo em pt-BR, lowercase militante (o app inteiro é assim).
// - Sem deps externas, lib pura, RNG injetável pra testes.

export type DayOfWeek = "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";

/** Janela [start, end) em horas locais 0–24. Pode cruzar meia-noite. */
export type TimeRange = readonly [number, number];

export interface StaticGreeting {
  /** Slug estável usado em telemetria. Não muda quando o pool é reordenado. */
  id: string;
  /** Texto com {name} como placeholder do primeiro nome. */
  text: string;
  /** Dias elegíveis. Array vazio = qualquer dia. */
  days: readonly DayOfWeek[];
  timeranges: TimeRange;
}

export interface UserContext {
  firstName: string;
  tasksDueToday?: number;
  overdueTasks?: number;
  /** Última visita anterior em ms (Date.now()). Undefined = primeira visita. */
  lastVisitAt?: number;
  /** Conta criada há menos de 24h. */
  isFirstSession?: boolean;
}

export interface ResolvedGreeting {
  text: string;
  layer: "static" | "contextual";
  ruleId: string;
}

const MORNING: TimeRange = [5, 12];
const AFTERNOON: TimeRange = [12, 18];
const EVENING: TimeRange = [18, 23];
const LATE_NIGHT: TimeRange = [23, 5];

export const STATIC_GREETINGS: readonly StaticGreeting[] = [
  // manhã, qualquer dia
  { id: "morning-bom-dia",            text: "bom dia, {name}",                       days: [],            timeranges: MORNING },
  { id: "morning-cafe",               text: "café e bloquim, {name}?",                days: [],            timeranges: MORNING },
  { id: "morning-atacar",             text: "pronto pra atacar o dia, {name}?",       days: [],            timeranges: MORNING },
  { id: "morning-produtiva",          text: "manhã produtiva pela frente, {name}?",   days: [],            timeranges: MORNING },
  { id: "morning-de-volta",           text: "de volta, {name}",                       days: [],            timeranges: MORNING },

  // manhã, dias úteis específicos
  { id: "morning-segundou",           text: "segundou, {name}",                       days: ["Mon"],       timeranges: MORNING },
  { id: "morning-mon-bora",           text: "feliz segunda, {name} — bora?",          days: ["Mon"],       timeranges: MORNING },
  { id: "morning-tue",                text: "terça com tudo, {name}",                 days: ["Tue"],       timeranges: MORNING },
  { id: "morning-wed-meio",           text: "meio da semana, {name}",                 days: ["Wed"],       timeranges: MORNING },
  { id: "morning-wed-ritmo",          text: "quarta-feira, {name} — no ritmo",        days: ["Wed"],       timeranges: MORNING },
  { id: "morning-thu",                text: "quinta-feira, {name}. quase lá",         days: ["Thu"],       timeranges: MORNING },
  { id: "morning-fri-sextou",         text: "sextou cedo, {name}",                    days: ["Fri"],       timeranges: MORNING },
  { id: "morning-fri-sensacao",       text: "aquela sensação de sexta, {name}",       days: ["Fri"],       timeranges: MORNING },

  // manhã, fim de semana
  { id: "morning-sat",                text: "bom dia de sábado, {name}",              days: ["Sat"],       timeranges: MORNING },
  { id: "morning-sat-sabadou",        text: "sabadou, {name}",                        days: ["Sat"],       timeranges: MORNING },
  { id: "morning-sun-domingou",       text: "domingou, {name}",                       days: ["Sun"],       timeranges: MORNING },
  { id: "morning-sun-sessao",         text: "sessão de domingo, {name}?",             days: ["Sun"],       timeranges: MORNING },
  { id: "morning-weekend-mente",      text: "o que você tem em mente, {name}?",       days: ["Sat", "Sun"], timeranges: MORNING },

  // tarde
  { id: "afternoon-boa-tarde",        text: "boa tarde, {name}",                      days: [],            timeranges: AFTERNOON },
  { id: "afternoon-como-dia",         text: "como está o dia, {name}?",               days: [],            timeranges: AFTERNOON },
  { id: "afternoon-de-volta",         text: "de volta ao bloquim, {name}",            days: [],            timeranges: AFTERNOON },
  { id: "afternoon-voltou",           text: "{name} voltou",                          days: [],            timeranges: AFTERNOON },
  { id: "afternoon-continuando",      text: "continuando de onde parou, {name}?",     days: [],            timeranges: AFTERNOON },
  { id: "afternoon-fri-sextou",       text: "sextou, {name}",                         days: ["Fri"],       timeranges: AFTERNOON },

  // noite
  { id: "evening-boa-noite",          text: "boa noite, {name}",                      days: [],            timeranges: EVENING },
  { id: "evening-como-foi",           text: "como foi o dia, {name}?",                days: [],            timeranges: EVENING },
  { id: "evening-fechando",           text: "fechando o dia, {name}?",                days: [],            timeranges: EVENING },
  { id: "evening-ultima-volta",       text: "última volta do dia, {name}",            days: [],            timeranges: EVENING },

  // madrugada
  { id: "latenight-acordado",         text: "ainda acordado, {name}?",                days: [],            timeranges: LATE_NIGHT },
  { id: "latenight-coruja",           text: "olá, coruja",                             days: [],            timeranges: LATE_NIGHT },
  { id: "latenight-ocupando",         text: "o que está te ocupando essa hora?",      days: [],            timeranges: LATE_NIGHT },
  { id: "latenight-modo",             text: "modo madrugada, {name}",                 days: [],            timeranges: LATE_NIGHT },
];

interface ContextualRule {
  id: string;
  /** Probabilidade [0,1] de aplicar a regra quando ela é elegível. */
  weight: number;
  build: (ctx: UserContext) => string | null;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const CONTEXTUAL_RULES: readonly ContextualRule[] = [
  {
    id: "first-session",
    weight: 1.0,
    build: (ctx) =>
      ctx.isFirstSession ? `vamos organizar essa cabeça, ${ctx.firstName}?` : null,
  },
  {
    id: "overdue-tasks",
    weight: 0.7,
    build: (ctx) => {
      const n = ctx.overdueTasks ?? 0;
      if (n <= 0) return null;
      if (n === 1) return `uma tarefa atrasada esperando, ${ctx.firstName}`;
      return `${n} tarefas atrasadas pra resolver, ${ctx.firstName}`;
    },
  },
  {
    id: "due-today",
    weight: 0.5,
    build: (ctx) => {
      const n = ctx.tasksDueToday ?? 0;
      if (n <= 0) return null;
      if (n === 1) return `uma tarefa vence hoje, ${ctx.firstName}`;
      return `${n} tarefas pra hoje, ${ctx.firstName}`;
    },
  },
  {
    id: "long-absence",
    weight: 0.8,
    build: (ctx) => {
      if (!ctx.lastVisitAt) return null;
      const elapsed = Date.now() - ctx.lastVisitAt;
      return elapsed > SEVEN_DAYS_MS
        ? `faz tempo, ${ctx.firstName}. bem-vindo de volta`
        : null;
    },
  },
];

const DAY_INDEX: readonly DayOfWeek[] = [
  "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
];

export function isHourInRange(hour: number, [start, end]: TimeRange): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  // janela cruza meia-noite, ex.: [23, 5]
  return hour >= start || hour < end;
}

export function filterEligible(
  greetings: readonly StaticGreeting[],
  now: Date,
): StaticGreeting[] {
  const hour = now.getHours();
  const day = DAY_INDEX[now.getDay()];
  return greetings.filter((g) => {
    const dayOk = g.days.length === 0 || g.days.includes(day);
    const hourOk = isHourInRange(hour, g.timeranges);
    return dayOk && hourOk;
  });
}

export function pickContextualGreeting(
  ctx: UserContext,
  rng: () => number = Math.random,
): ResolvedGreeting | null {
  for (const rule of CONTEXTUAL_RULES) {
    const text = rule.build(ctx);
    if (text && rng() < rule.weight) {
      return { text, layer: "contextual", ruleId: rule.id };
    }
  }
  return null;
}

export function pickStaticGreeting(
  ctx: UserContext,
  now: Date = new Date(),
  rng: () => number = Math.random,
): ResolvedGreeting {
  const eligible = filterEligible(STATIC_GREETINGS, now);

  if (eligible.length === 0) {
    return {
      text: `olá, ${ctx.firstName}`,
      layer: "static",
      ruleId: "fallback",
    };
  }

  const pick = eligible[Math.floor(rng() * eligible.length)];
  return {
    text: pick.text.replace("{name}", ctx.firstName),
    layer: "static",
    ruleId: pick.id,
  };
}

/**
 * Resolve uma saudação para o usuário.
 *
 * `contextualChance` (default 35%) é a probabilidade de tentar Camada 2 primeiro.
 * Se a Camada 2 não disparar (regra não elegível OU dado weight gate), cai pra Camada 1.
 */
export function pickGreeting(
  ctx: UserContext,
  options: {
    now?: Date;
    rng?: () => number;
    contextualChance?: number;
  } = {},
): ResolvedGreeting {
  const { now = new Date(), rng = Math.random, contextualChance = 0.35 } = options;

  if (rng() < contextualChance) {
    const contextual = pickContextualGreeting(ctx, rng);
    if (contextual) return contextual;
  }

  return pickStaticGreeting(ctx, now, rng);
}

/** Deriva o primeiro nome a partir de `users.name` (que é nome completo). */
export function deriveFirstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}
