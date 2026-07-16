// artifacts/api-server/src/__tests__/mapLayout.test.ts
import { describe, it, expect } from "vitest";
import { computeLayout, buildApprovalLayoutGraph } from "../services/mapLayoutService";
import { NODE_WIDTH, NODE_HEIGHT } from "../lib/collision";

// Valores conferidos rodando o dagre de verdade com os defaults deste módulo
// (rankdir=LR, ranksep=240, nodesep=48, nó 200 de largura): as colunas ficam
// 440 apart (200 de largura + 240 de ranksep).
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
    expect(pos.get("b")).toEqual({ x: 440, y: 0 });
    expect(pos.get("c")).toEqual({ x: 880, y: 0 });
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
    expect(pos.get("b")!.x).toBe(440);
    expect(pos.get("c")!.x).toBe(440);
    expect(pos.get("d")!.x).toBe(880);
    // b e c dividem a coluna → precisam estar separados verticalmente
    expect(Math.abs(pos.get("b")!.y - pos.get("c")!.y)).toBeGreaterThanOrEqual(NODE_HEIGHT);
  });

  it("irmãos num fan-out ficam separados o bastante pra cards reais não sobreporem", () => {
    // Regressão: o dagre separa irmãos por altura+nodesep; se a altura assumida
    // subestima o card renderizado, irmãos empilhados se sobrepõem. Já aconteceu
    // com 80 (card 175px) e com 200 (card COM DESCRIÇÃO 254px, medido em
    // 2026-07-16). O limiar aqui é ABSOLUTO (a altura real de um card descritivo),
    // decoplado de NODE_HEIGHT de propósito, pra pegar sub-espaçamento mesmo que
    // a constante mude.
    const REAL_CARD_HEIGHT = 254;
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
    expect(pos.get("b")).toEqual({ x: 440, y: 0 });
  });

  it("tolera ciclo sem quebrar (aciclicidade é responsabilidade do MCP, não daqui)", () => {
    const pos = computeLayout(
      [{ id: "a" }, { id: "b" }],
      [{ source: "a", target: "b" }, { source: "b", target: "a" }],
    );
    expect(pos.size).toBe(2);
  });
});

describe("buildApprovalLayoutGraph", () => {
  // Caso real do mapa Clínica CBV / AÇÃO CO2 (2026-07-16):
  //   Conferir → EDITAR ; EDITAR tem uma aprovação ; aprovação → Subir.
  // A aprovação é um WAYPOINT do fluxo: precisa participar do layout como nó,
  // com aresta derivada EDITAR → aprovação, pra ganhar espaço próprio na cadeia
  // (senão ficava sobreposta ao Subir).
  const cards = [
    { id: "conferir", taskId: "t-conf", isApprovalTask: false, parentTaskId: null },
    { id: "editar", taskId: "t-edit", isApprovalTask: false, parentTaskId: null },
    { id: "aprov", taskId: "t-aprov", isApprovalTask: true, parentTaskId: "t-edit" },
    { id: "subir", taskId: "t-subir", isApprovalTask: false, parentTaskId: null },
  ];

  it("inclui todos os cards como nós; aprovação com caixa menor", () => {
    const { nodes } = buildApprovalLayoutGraph(cards, []);
    expect(nodes).toHaveLength(4);
    const aprov = nodes.find((n) => n.id === "aprov")!;
    expect(aprov.width).toBeGreaterThan(0);
    expect(aprov.height).toBeGreaterThan(0);
    expect(aprov.width! < 200 && aprov.height! < 200).toBe(true);
    // cards normais usam o default (sem width/height explícito)
    expect(nodes.find((n) => n.id === "editar")!.width).toBeUndefined();
  });

  it("deriva a aresta pai → aprovação e mantém as conexões persistidas", () => {
    const { edges } = buildApprovalLayoutGraph(cards, [
      { source: "conferir", target: "editar" },
      { source: "aprov", target: "subir" },
    ]);
    expect(edges).toContainEqual({ source: "conferir", target: "editar" }); // persistida
    expect(edges).toContainEqual({ source: "editar", target: "aprov" }); // derivada pai→aprovação
    expect(edges).toContainEqual({ source: "aprov", target: "subir" }); // persistida
    expect(edges).toHaveLength(3);
  });

  it("a cadeia inteira vira 4 colunas em ordem (Subir depois da aprovação, mesma linha)", () => {
    const { nodes, edges } = buildApprovalLayoutGraph(cards, [
      { source: "conferir", target: "editar" },
      { source: "aprov", target: "subir" },
    ]);
    const pos = computeLayout(nodes, edges);
    // Conferir → EDITAR → aprovação → Subir, x estritamente crescente.
    expect(pos.get("conferir")!.x).toBeLessThan(pos.get("editar")!.x);
    expect(pos.get("editar")!.x).toBeLessThan(pos.get("aprov")!.x);
    expect(pos.get("aprov")!.x).toBeLessThan(pos.get("subir")!.x);
    // cadeia linear → todos na mesma linha; Subir não isolado.
    expect(pos.get("subir")!.y).toBe(pos.get("conferir")!.y);
  });

  it("sequencial: encadeia aprovações por approvalOrder (pai → a1 → a2)", () => {
    // approvalMode fica no card PAI (p); a query traz isso no card do pai.
    const seq = [
      { id: "p", taskId: "t-p", isApprovalTask: false, parentTaskId: null, approvalMode: "sequential" },
      { id: "a1", taskId: "t-a1", isApprovalTask: true, parentTaskId: "t-p", approvalOrder: 0 },
      { id: "a2", taskId: "t-a2", isApprovalTask: true, parentTaskId: "t-p", approvalOrder: 1 },
    ];
    const { edges } = buildApprovalLayoutGraph(seq, []);
    expect(edges).toContainEqual({ source: "p", target: "a1" });
    expect(edges).toContainEqual({ source: "a1", target: "a2" });
    expect(edges).toHaveLength(2);
  });

  it("paralelo: fan-out do pai pra cada aprovação (pai → a1, pai → a2)", () => {
    const par = [
      { id: "p", taskId: "t-p", isApprovalTask: false, parentTaskId: null, approvalMode: "parallel" },
      { id: "a1", taskId: "t-a1", isApprovalTask: true, parentTaskId: "t-p", approvalOrder: 0 },
      { id: "a2", taskId: "t-a2", isApprovalTask: true, parentTaskId: "t-p", approvalOrder: 1 },
    ];
    const { edges } = buildApprovalLayoutGraph(par, []);
    expect(edges).toContainEqual({ source: "p", target: "a1" });
    expect(edges).toContainEqual({ source: "p", target: "a2" });
    expect(edges).toHaveLength(2);
  });

  it("ignora aprovação sem pai resolvível e conexões pra fora do mapa; sem self-loop", () => {
    const orphan = [
      { id: "aprovSemPai", taskId: "t-x", isApprovalTask: true, parentTaskId: null },
      { id: "z", taskId: "t-z", isApprovalTask: false, parentTaskId: null },
    ];
    const { edges } = buildApprovalLayoutGraph(orphan, [
      { source: "z", target: "fantasma" }, // fora do mapa
      { source: "z", target: "z" }, // self-loop
    ]);
    expect(edges).toEqual([]);
  });

  it("dedup: conexão persistida igual à derivada não duplica", () => {
    // se já existir uma conexão persistida editar→aprov, não vira aresta dupla.
    const { edges } = buildApprovalLayoutGraph(cards, [{ source: "editar", target: "aprov" }]);
    expect(edges.filter((e) => e.source === "editar" && e.target === "aprov")).toHaveLength(1);
  });
});
