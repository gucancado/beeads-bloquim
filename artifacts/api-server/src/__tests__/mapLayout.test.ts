// artifacts/api-server/src/__tests__/mapLayout.test.ts
import { describe, it, expect } from "vitest";
import { computeLayout, buildLayoutEdges } from "../services/mapLayoutService";
import { NODE_WIDTH, NODE_HEIGHT } from "../lib/collision";

// Valores conferidos rodando o dagre de verdade com os defaults deste módulo
// (rankdir=LR, ranksep=120, nodesep=48, nó 200x80): as colunas ficam 320 apart
// (200 de largura + 120 de ranksep).
describe("computeLayout", () => {
  it("mapa vazio devolve mapa vazio", () => {
    expect(computeLayout([], []).size).toBe(0);
  });

  it("cadeia linear a→b→c vira 3 colunas na mesma linha", () => {
    const pos = computeLayout(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [{ source: "a", target: "b" }, { source: "b", target: "c" }],
    );
    expect(pos.get("a")).toEqual({ x: 0, y: 0 });
    expect(pos.get("b")).toEqual({ x: 320, y: 0 });
    expect(pos.get("c")).toEqual({ x: 640, y: 0 });
  });

  it("diamante: 3 ranks, e os dois nós do meio não se sobrepõem", () => {
    const pos = computeLayout(
      [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      [
        { source: "a", target: "b" },
        { source: "a", target: "c" },
        { source: "b", target: "d" },
        { source: "c", target: "d" },
      ],
    );
    expect(pos.get("a")!.x).toBe(0);
    expect(pos.get("b")!.x).toBe(320);
    expect(pos.get("c")!.x).toBe(320);
    expect(pos.get("d")!.x).toBe(640);
    // b e c dividem a coluna → precisam estar separados verticalmente
    expect(Math.abs(pos.get("b")!.y - pos.get("c")!.y)).toBeGreaterThanOrEqual(NODE_HEIGHT);
  });

  it("irmãos num fan-out ficam separados o bastante pra cards reais não sobreporem", () => {
    // Regressão: com NODE_HEIGHT=80 (subestimado), o dagre separava irmãos por
    // 80+48=128px, mas o card renderizado mede ~175px de altura → sobrepunham
    // ~47px no canvas (medido em 2026-07-16). O limiar aqui é ABSOLUTO (a altura
    // real do card), decoplado de NODE_HEIGHT de propósito, pra pegar
    // sub-espaçamento mesmo que a constante mude.
    const REAL_CARD_HEIGHT = 175;
    const pos = computeLayout(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [
        { source: "a", target: "b" },
        { source: "a", target: "c" },
      ],
    );
    // b e c são irmãos (filhos de a) → mesma coluna.
    expect(pos.get("b")!.x).toBe(pos.get("c")!.x);
    const dy = Math.abs(pos.get("b")!.y - pos.get("c")!.y);
    expect(dy).toBeGreaterThanOrEqual(REAL_CARD_HEIGHT);
  });

  it("é determinístico: mesma entrada → mesma saída", () => {
    const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const edges = [{ source: "a", target: "b" }, { source: "b", target: "c" }];
    expect([...computeLayout(nodes, edges)]).toEqual([...computeLayout(nodes, edges)]);
  });

  it("normaliza pro canto: menor x e menor y são 0", () => {
    const pos = computeLayout(
      [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      [
        { source: "a", target: "b" },
        { source: "a", target: "c" },
        { source: "b", target: "d" },
        { source: "c", target: "d" },
      ],
    );
    expect(Math.min(...[...pos.values()].map((p) => p.x))).toBe(0);
    expect(Math.min(...[...pos.values()].map((p) => p.y))).toBe(0);
  });

  it("nós isolados vão pra uma grade e não se sobrepõem", () => {
    const pos = computeLayout([{ id: "x" }, { id: "y" }, { id: "z" }], []);
    expect(pos.size).toBe(3);
    const pts = [...pos.values()];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const apart =
          Math.abs(pts[i].x - pts[j].x) >= NODE_WIDTH ||
          Math.abs(pts[i].y - pts[j].y) >= NODE_HEIGHT;
        expect(apart).toBe(true);
      }
    }
  });

  it("nós isolados ficam abaixo do grafo conectado, sem colidir com ele", () => {
    const pos = computeLayout(
      [{ id: "a" }, { id: "b" }, { id: "solto" }],
      [{ source: "a", target: "b" }],
    );
    const graphBottom = Math.max(pos.get("a")!.y, pos.get("b")!.y) + NODE_HEIGHT;
    expect(pos.get("solto")!.y).toBeGreaterThanOrEqual(graphBottom);
  });

  it("ignora arestas que apontam pra nó desconhecido e self-loops", () => {
    const pos = computeLayout(
      [{ id: "a" }, { id: "b" }],
      [
        { source: "a", target: "fantasma" },
        { source: "b", target: "b" },
        { source: "a", target: "b" },
      ],
    );
    expect(pos.get("a")).toEqual({ x: 0, y: 0 });
    expect(pos.get("b")).toEqual({ x: 320, y: 0 });
  });

  it("tolera ciclo sem quebrar (aciclicidade é responsabilidade do MCP, não daqui)", () => {
    const pos = computeLayout(
      [{ id: "a" }, { id: "b" }],
      [{ source: "a", target: "b" }, { source: "b", target: "a" }],
    );
    expect(pos.size).toBe(2);
  });
});

describe("buildLayoutEdges", () => {
  // Espelha o caso real do mapa Clínica CBV / AÇÃO CO2 (2026-07-16):
  //   Conferir → EDITAR ; EDITAR tem uma aprovação ; aprovação → Subir.
  // A aprovação é satélite (fora do dagre), mas está no meio do fluxo. Sem
  // rotear, a aresta "aprovação → Subir" era descartada e o Subir virava um
  // nó isolado, jogado na grade de sobras com uma linha cruzando o mapa.
  const cards = [
    { id: "conferir", taskId: "t-conf", isApprovalTask: false, parentTaskId: null },
    { id: "editar", taskId: "t-edit", isApprovalTask: false, parentTaskId: null },
    { id: "aprov", taskId: "t-aprov", isApprovalTask: true, parentTaskId: "t-edit" },
    { id: "subir", taskId: "t-subir", isApprovalTask: false, parentTaskId: null },
  ];

  it("roteia aresta que SAI de card de aprovação pro card do pai", () => {
    const edges = buildLayoutEdges(cards, [
      { source: "conferir", target: "editar" },
      { source: "aprov", target: "subir" },
    ]);
    // aprov → subir vira editar → subir; conferir → editar intacta.
    expect(edges).toContainEqual({ source: "conferir", target: "editar" });
    expect(edges).toContainEqual({ source: "editar", target: "subir" });
    expect(edges).toHaveLength(2);
  });

  it("com o roteamento, a cadeia inteira vira 3 colunas (Subir deixa de ser isolado)", () => {
    const edges = buildLayoutEdges(cards, [
      { source: "conferir", target: "editar" },
      { source: "aprov", target: "subir" },
    ]);
    const pos = computeLayout(
      cards.filter((c) => !c.isApprovalTask).map((c) => ({ id: c.id })),
      edges,
    );
    expect(pos.get("conferir")!.x).toBe(0);
    expect(pos.get("editar")!.x).toBe(320);
    expect(pos.get("subir")!.x).toBe(640);
    // todos na mesma linha (cadeia linear) → Subir não caiu na grade de isolados.
    expect(pos.get("subir")!.y).toBe(pos.get("conferir")!.y);
  });

  it("roteia aresta que CHEGA num card de aprovação pro card do pai", () => {
    const edges = buildLayoutEdges(cards, [{ source: "conferir", target: "aprov" }]);
    expect(edges).toEqual([{ source: "conferir", target: "editar" }]);
  });

  it("arestas entre cards normais passam intactas", () => {
    const edges = buildLayoutEdges(cards, [{ source: "conferir", target: "editar" }]);
    expect(edges).toEqual([{ source: "conferir", target: "editar" }]);
  });

  it("descarta aresta de aprovação sem pai resolvível", () => {
    const orphan = [{ id: "aprovSemPai", taskId: "t-x", isApprovalTask: true, parentTaskId: null }, { id: "z", taskId: "t-z", isApprovalTask: false, parentTaskId: null }];
    expect(buildLayoutEdges(orphan, [{ source: "aprovSemPai", target: "z" }])).toEqual([]);
  });

  it("colapsa auto-loop: aprovação → seu próprio pai vira pai → pai e é descartada", () => {
    expect(buildLayoutEdges(cards, [{ source: "aprov", target: "editar" }])).toEqual([]);
  });

  it("deduplica arestas que colapsam pro mesmo par", () => {
    const two = [
      ...cards,
      { id: "aprov2", taskId: "t-aprov2", isApprovalTask: true, parentTaskId: "t-edit" },
    ];
    // aprov → subir e aprov2 → subir colapsam ambas pra editar → subir.
    const edges = buildLayoutEdges(two, [
      { source: "aprov", target: "subir" },
      { source: "aprov2", target: "subir" },
    ]);
    expect(edges).toEqual([{ source: "editar", target: "subir" }]);
  });
});
