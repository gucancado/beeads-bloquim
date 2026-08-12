import { describe, it, expect } from "vitest";
import {
  computeKrHealthInstant,
  smoothHealth,
  pushReading,
  aggregateObjectiveHealth,
  DEFAULT_HEALTH_CONFIG,
  type KrHealthInput,
  type HealthReading,
} from "../services/strategyHealth";

const cfg = DEFAULT_HEALTH_CONFIG;

// ciclo de 10 dias; hoje no dia 5 (50% decorrido)
function baseInput(over: Partial<KrHealthInput> = {}): KrHealthInput {
  return {
    targetValue: 100,
    currentValue: 50,
    baselineValue: 0,
    direction: "subir",
    createdAt: "2026-01-01",
    cycleStartsOn: "2026-01-01",
    targetDate: "2026-01-11",
    today: "2026-01-06",
    ...over,
  };
}

describe("computeKrHealthInstant — ritmo (§8.1)", () => {
  it("progresso no ritmo → no_prazo (ratio ~1)", () => {
    const r = computeKrHealthInstant(baseInput(), cfg);
    expect(r.progressoReal).toBeCloseTo(0.5, 6);
    expect(r.ratio).toBeCloseTo(1.0, 6);
    expect(r.health).toBe("no_prazo");
  });

  it("atrás do ritmo → risco (0.7–0.9)", () => {
    const r = computeKrHealthInstant(baseInput({ currentValue: 40 }), cfg); // real 0.4 / esp 0.5 = 0.8
    expect(r.health).toBe("risco");
  });

  it("muito atrás → fora (<0.7)", () => {
    const r = computeKrHealthInstant(baseInput({ currentValue: 20 }), cfg); // 0.2/0.5 = 0.4
    expect(r.health).toBe("fora");
  });

  it("over-target clampa progresso a 1 (teto no_prazo, sem >1)", () => {
    const r = computeKrHealthInstant(baseInput({ currentValue: 150 }), cfg);
    expect(r.progressoReal).toBe(1);
    expect(r.health).toBe("no_prazo");
  });

  it("início do ciclo → no_prazo mesmo com progresso 0 (cedo p/ cobrar)", () => {
    const r = computeKrHealthInstant(baseInput({ currentValue: 0, today: "2026-01-01" }), cfg);
    expect(r.health).toBe("no_prazo");
  });

  it("ciclo de 1 dia: piso de 1 dia no denominador, sem divisão por zero", () => {
    const r = computeKrHealthInstant(
      baseInput({ cycleStartsOn: "2026-01-01", targetDate: "2026-01-01", createdAt: "2026-01-01", today: "2026-01-01", currentValue: 0 }),
      cfg,
    );
    expect(Number.isFinite(r.progressoReal!)).toBe(true);
    expect(r.health).toBe("no_prazo"); // decorrido 0 → cedo
  });

  it("KR criado perto do fim: inicio = max(starts_on, created_at)", () => {
    // ciclo começou em jan/01 mas KR criado em jan/10; target jan/11; hoje jan/11
    const r = computeKrHealthInstant(
      baseInput({ createdAt: "2026-01-10", targetDate: "2026-01-11", today: "2026-01-11", currentValue: 100 }),
      cfg,
    );
    expect(r.progressoReal).toBe(1);
    expect(r.health).toBe("no_prazo");
  });

  it("direction 'descer' (target < baseline) auto-normaliza", () => {
    const r = computeKrHealthInstant(
      baseInput({ baselineValue: 100, targetValue: 0, currentValue: 50, direction: "descer" }),
      cfg,
    ); // real = (50-100)/(0-100) = 0.5; esp 0.5 → ratio 1
    expect(r.progressoReal).toBeCloseTo(0.5, 6);
    expect(r.health).toBe("no_prazo");
  });
});

describe("computeKrHealthInstant — modo booleano (target == baseline)", () => {
  it("subir: current ≥ target → atingido", () => {
    const r = computeKrHealthInstant(baseInput({ baselineValue: 10, targetValue: 10, currentValue: 10, direction: "subir" }), cfg);
    expect(r.ratio).toBeNull();
    expect(r.health).toBe("atingido");
  });
  it("subir: current < target → nao_atingido", () => {
    const r = computeKrHealthInstant(baseInput({ baselineValue: 10, targetValue: 10, currentValue: 5, direction: "subir" }), cfg);
    expect(r.health).toBe("nao_atingido");
  });
  it("descer: current ≤ target → atingido", () => {
    const r = computeKrHealthInstant(baseInput({ baselineValue: 10, targetValue: 10, currentValue: 8, direction: "descer" }), cfg);
    expect(r.health).toBe("atingido");
  });
});

describe("smoothHealth — anti-ruído (§8.1, N consecutivos)", () => {
  const mk = (h: any): HealthReading => ({ health: h, ratio: null, at: "x" });

  it("um snapshot ruim NÃO transiciona (continua na faixa anterior)", () => {
    const readings = [mk("no_prazo"), mk("no_prazo"), mk("fora")];
    expect(smoothHealth(readings, cfg)).toBe("no_prazo");
  });

  it("N snapshots ruins consecutivos transicionam", () => {
    const readings = [mk("no_prazo"), mk("fora"), mk("fora"), mk("fora")]; // N=3
    expect(smoothHealth(readings, cfg)).toBe("fora");
  });

  it("ruído alternado não transiciona", () => {
    const readings = [mk("no_prazo"), mk("fora"), mk("no_prazo"), mk("fora"), mk("no_prazo")];
    expect(smoothHealth(readings, cfg)).toBe("no_prazo");
  });
});

describe("pushReading — array circular trim a N", () => {
  it("trima ao tamanho N", () => {
    let r: HealthReading[] = [];
    for (let i = 0; i < 5; i++) r = pushReading(r, { health: "no_prazo", ratio: null, at: String(i) }, 3);
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.at)).toEqual(["2", "3", "4"]);
  });
});

describe("aggregateObjectiveHealth — pior-caso por `mede` (§8.1)", () => {
  it("sem nenhum KR mede → sem_medicao", () => {
    expect(aggregateObjectiveHealth([])).toBe("sem_medicao");
  });
  it("pior-caso: fora domina no_prazo", () => {
    expect(aggregateObjectiveHealth(["no_prazo", "fora", "risco"])).toBe("fora");
  });
  it("KR sem health (null) é ignorado; resto agrega", () => {
    expect(aggregateObjectiveHealth([null, "risco", "no_prazo"])).toBe("risco");
  });
  it("só atingidos → atingido", () => {
    expect(aggregateObjectiveHealth(["atingido", "atingido"])).toBe("atingido");
  });
});
