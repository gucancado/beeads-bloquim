/**
 * Saúde do KR e do Objetivo — Mapa Estratégico §8.1 (v1 manual, ciente de ritmo).
 *
 * Funções puras + testáveis. Limiares e N da suavização são DECISÃO DE PRODUTO
 * PENDENTE — injetados via HealthConfig (default documentado, não cravado).
 */

export type KrHealth = "no_prazo" | "risco" | "fora" | "atingido" | "nao_atingido";
export type ObjectiveHealth = KrHealth | "sem_medicao";

export interface HealthConfig {
  /** razão (progresso_real/esperado) ≥ noPrazo → no_prazo; ≥ risco → risco; senão fora. */
  thresholds: { noPrazo: number; risco: number };
  /** N snapshots consecutivos abaixo da faixa p/ transicionar (anti-ruído). */
  smoothingN: number;
}

/** Provisório (§8.1) — calibrar com uso; NÃO é valor definitivo. */
export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  thresholds: { noPrazo: 0.9, risco: 0.7 },
  smoothingN: 3,
};

const EPSILON = 1e-6;

export interface KrHealthInput {
  targetValue: number;
  currentValue: number;
  baselineValue: number | null;
  direction: "subir" | "descer";
  /** quando o KR foi criado (timestamptz) */
  createdAt: Date | string;
  /** fim efetivo do KR ('YYYY-MM-DD') */
  targetDate: string;
  /** início do ciclo ('YYYY-MM-DD') */
  cycleStartsOn: string;
  /** referência temporal (default: agora) */
  today: Date | string;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Converte data (Date ou 'YYYY-MM-DD') para número de dias inteiros (UTC). */
function toDays(d: Date | string): number {
  let dt: Date;
  if (typeof d === "string") {
    dt = new Date(d.length === 10 ? `${d}T00:00:00Z` : d);
  } else {
    dt = d;
  }
  return Math.floor(dt.getTime() / 86_400_000);
}

export interface KrHealthResult {
  health: KrHealth;
  /** razão progresso real/esperado; null em modo booleano. */
  ratio: number | null;
  progressoReal: number | null;
}

/**
 * Saúde instantânea do KR (um snapshot), §8.1. Auto-normaliza `direction` via
 * baseline/target; modo booleano quando target == baseline.
 */
export function computeKrHealthInstant(input: KrHealthInput, cfg: HealthConfig = DEFAULT_HEALTH_CONFIG): KrHealthResult {
  const baseline = input.baselineValue ?? 0;
  const { targetValue: target, currentValue: current, direction } = input;

  // Modo booleano: sem range mensurável (divisor zero), §8.1.
  if (target === baseline) {
    const atingido = direction === "subir" ? current >= target : current <= target;
    return { health: atingido ? "atingido" : "nao_atingido", ratio: null, progressoReal: null };
  }

  // Progresso real (auto-normaliza direção via sinais de baseline/target).
  const progressoReal = clamp((current - baseline) / (target - baseline), 0, 1);

  // Progresso esperado (ritmo no ciclo).
  const inicio = Math.max(toDays(input.cycleStartsOn), toDays(input.createdAt));
  const fim = toDays(input.targetDate);
  const hoje = toDays(input.today);
  const denom = Math.max(fim - inicio, 1); // piso de 1 dia (ciclo curto / KR no fim)
  const decorridoFrac = clamp((hoje - inicio) / denom, 0, 1);
  const progressoEsperado = decorridoFrac;

  // Início do ciclo: cedo demais para cobrar → no_prazo (mesmo com progresso 0).
  if (progressoEsperado <= EPSILON) {
    return { health: "no_prazo", ratio: Infinity, progressoReal };
  }

  const ratio = progressoReal / Math.max(progressoEsperado, EPSILON);

  let health: KrHealth;
  if (ratio >= cfg.thresholds.noPrazo) health = "no_prazo";
  else if (ratio >= cfg.thresholds.risco) health = "risco";
  else health = "fora";

  return { health, ratio, progressoReal };
}

/** Snapshot guardado em health_readings (array circular dos últimos N). */
export interface HealthReading {
  health: KrHealth;
  ratio: number | null;
  at: string;
}

/** Empurra um snapshot e trima ao tamanho N (array circular, §8.1). */
export function pushReading(readings: HealthReading[], reading: HealthReading, n: number): HealthReading[] {
  const next = [...readings, reading];
  return next.length > n ? next.slice(next.length - n) : next;
}

/**
 * Saúde suavizada (anti-ruído §8.1): a saúde só transiciona após N readings
 * consecutivos concordando num novo estado; um único snapshot ruim não vira.
 */
export function smoothHealth(readings: HealthReading[], cfg: HealthConfig = DEFAULT_HEALTH_CONFIG): KrHealth | null {
  if (readings.length === 0) return null;
  let smoothed = readings[0].health;
  let runHealth: KrHealth | null = null;
  let runLen = 0;
  for (const r of readings) {
    if (r.health === smoothed) {
      runHealth = null;
      runLen = 0;
      continue;
    }
    if (r.health === runHealth) {
      runLen++;
    } else {
      runHealth = r.health;
      runLen = 1;
    }
    if (runLen >= cfg.smoothingN) {
      smoothed = runHealth;
      runHealth = null;
      runLen = 0;
    }
  }
  return smoothed;
}

/** Severidade p/ agregação pior-caso do objetivo (maior = pior). */
const SEVERITY: Record<KrHealth, number> = {
  atingido: 0,
  no_prazo: 1,
  risco: 2,
  nao_atingido: 3,
  fora: 4,
};

/**
 * Saúde do Objetivo = agregação pior-caso dos KRs ligados por aresta `mede`
 * (§8.1). Sem nenhum KR `mede` → `sem_medicao`.
 */
export function aggregateObjectiveHealth(measuringKrHealths: Array<KrHealth | null>): ObjectiveHealth {
  const valid = measuringKrHealths.filter((h): h is KrHealth => h !== null);
  if (valid.length === 0) return "sem_medicao";
  return valid.reduce((worst, h) => (SEVERITY[h] > SEVERITY[worst] ? h : worst), valid[0]);
}
