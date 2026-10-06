import { describe, it, expect } from "vitest";
import {
  buildCapture,
  buildPayload,
  normalizePositions,
  remapConnections,
  selectElements,
} from "../services/planTemplates/capture";
import {
  payloadCounts,
  planTemplatePayloadV1Schema,
  type CaptureCardRow,
  type CaptureConnectionRow,
  type CaptureShapeRow,
  type CaptureTextRow,
  type MapSnapshot,
} from "../services/planTemplates/types";

const card = (id: string, over: Partial<CaptureCardRow> = {}): CaptureCardRow => ({
  id,
  positionX: 0,
  positionY: 0,
  title: `card ${id}`,
  description: null,
  taskId: `t-${id}`,
  taskTitle: `task ${id}`,
  taskDescription: null,
  taskPriority: "medium",
  isApprovalTask: false,
  parentTaskId: null,
  checklist: [],
  ...over,
});
const approval = (id: string, parentCardId: string): CaptureCardRow =>
  card(id, { isApprovalTask: true, parentTaskId: `t-${parentCardId}`, taskTitle: "aprovação" });
const conn = (s: string, t: string, sh: string | null = "sh", th: string | null = "th"): CaptureConnectionRow => ({
  sourceCardId: s,
  targetCardId: t,
  sourceHandle: sh,
  targetHandle: th,
});
const text = (id: string, over: Partial<CaptureTextRow> = {}): CaptureTextRow => ({
  id, positionX: 0, positionY: 0, width: 200, height: 80, fontSize: 14, color: "#374151",
  content: '{"type":"doc","content":[{"type":"paragraph"}]}', ...over,
});
const shape = (id: string, over: Partial<CaptureShapeRow> = {}): CaptureShapeRow => ({
  id, type: "rect", positionX: 0, positionY: 0, width: 100, height: 50, rotation: 0, color: "#6366f1",
  filled: false, strokeStyle: "solid", x1: null, y1: null, x2: null, y2: null, ...over,
});
const snap = (over: Partial<MapSnapshot> = {}): MapSnapshot => ({
  cards: [], connections: [], texts: [], shapes: [], ...over,
});

describe("selectElements", () => {
  const s = snap({
    cards: [card("A"), card("B"), approval("AP", "A")],
    texts: [text("T1")],
    shapes: [shape("S1"), shape("IMG", { type: "image" })],
  });

  it("sem seleção pega tudo, exclui aprovações e imagens e conta", () => {
    const r = selectElements(s, {});
    expect(r.cards.map((c) => c.id)).toEqual(["A", "B"]);
    expect(r.texts.map((t) => t.id)).toEqual(["T1"]);
    expect(r.shapes.map((x) => x.id)).toEqual(["S1"]);
    expect(r.skipped).toEqual({ approvals: 1, images: 1 });
  });

  it("com seleção pega só os ids listados e ignora ids desconhecidos", () => {
    const r = selectElements(s, { cardIds: ["B", "AP", "ghost"], shapeIds: ["IMG"] });
    expect(r.cards.map((c) => c.id)).toEqual(["B"]);
    expect(r.texts).toEqual([]);
    expect(r.shapes).toEqual([]);
    expect(r.skipped).toEqual({ approvals: 1, images: 1 });
  });

  it("aprovação fora da seleção não conta", () => {
    const r = selectElements(s, { textElementIds: ["T1"] });
    expect(r.cards).toEqual([]);
    expect(r.texts.map((t) => t.id)).toEqual(["T1"]);
    expect(r.skipped).toEqual({ approvals: 0, images: 0 });
  });
});

describe("remapConnections", () => {
  it("sequencial: conexão que sai do último aprovador vira pai→destino com handles padrão", () => {
    const s = snap({
      cards: [card("A"), approval("AP1", "A"), approval("AP2", "A"), card("B")],
      connections: [conn("AP2", "B", "x", "y")],
    });
    expect(remapConnections(s, new Set(["A", "B"]))).toEqual([
      { sourceCardId: "A", targetCardId: "B", sourceHandle: "source-right", targetHandle: "target-left" },
    ]);
  });

  it("paralelo: conexão que sai do pai é mantida com os handles originais", () => {
    const s = snap({
      cards: [card("A"), approval("AP1", "A"), approval("AP2", "A"), card("B")],
      connections: [conn("A", "B", "source-bottom", "target-top")],
    });
    expect(remapConnections(s, new Set(["A", "B"]))).toEqual([
      { sourceCardId: "A", targetCardId: "B", sourceHandle: "source-bottom", targetHandle: "target-top" },
    ]);
  });

  it("conexão que chega numa aprovação é remapeada pro pai", () => {
    const s = snap({ cards: [card("X"), card("A"), approval("AP", "A")], connections: [conn("X", "AP")] });
    expect(remapConnections(s, new Set(["X", "A"]))).toEqual([
      { sourceCardId: "X", targetCardId: "A", sourceHandle: "source-right", targetHandle: "target-left" },
    ]);
  });

  it("pai fora do conjunto descarta a conexão", () => {
    const s = snap({ cards: [card("A"), approval("AP", "A"), card("B")], connections: [conn("AP", "B")] });
    expect(remapConnections(s, new Set(["B"]))).toEqual([]);
  });

  it("deduplica pares iguais depois do remapeamento (primeira vence)", () => {
    const s = snap({
      cards: [card("A"), approval("AP", "A"), card("B")],
      connections: [conn("A", "B", "orig-s", "orig-t"), conn("AP", "B")],
    });
    expect(remapConnections(s, new Set(["A", "B"]))).toEqual([
      { sourceCardId: "A", targetCardId: "B", sourceHandle: "orig-s", targetHandle: "orig-t" },
    ]);
  });

  it("descarta self-loop gerado pelo remapeamento", () => {
    const s = snap({ cards: [card("A"), approval("AP", "A")], connections: [conn("AP", "A")] });
    expect(remapConnections(s, new Set(["A"]))).toEqual([]);
  });

  it("descarta conexão com ponta fora do mapa", () => {
    const s = snap({ cards: [card("A")], connections: [conn("A", "ghost")] });
    expect(remapConnections(s, new Set(["A"]))).toEqual([]);
  });

  it("descarta aprovação cujo pai não tem card no mapa", () => {
    const s = snap({ cards: [card("B"), approval("AP", "NOPE")], connections: [conn("AP", "B")] });
    expect(remapConnections(s, new Set(["B"]))).toEqual([]);
  });
});

describe("normalizePositions", () => {
  it("mínimo sobre todos os pontos; vazio vira (0,0)", () => {
    expect(normalizePositions([{ positionX: 10, positionY: -5 }, { positionX: -30, positionY: 40 }])).toEqual({
      minX: -30,
      minY: -5,
    });
    expect(normalizePositions([])).toEqual({ minX: 0, minY: 0 });
  });
});

describe("buildPayload / buildCapture", () => {
  it("monta payload v1 válido com posições relativas, chaves e fallbacks", () => {
    const s = snap({
      cards: [
        card("A", {
          positionX: 100, positionY: 200, taskTitle: "Tarefa A", title: "card A",
          description: "desc do card", taskDescription: null, taskPriority: "high",
          checklist: [{ text: "um", order: 0 }, { text: "dois", order: 1 }],
        }),
        card("LEG", {
          positionX: 400, positionY: 260, taskId: null, taskTitle: null, taskPriority: null,
          title: "legado", description: "d",
        }),
      ],
      connections: [conn("A", "LEG")],
      texts: [text("T", { positionX: 50, positionY: 300 })],
      shapes: [shape("L", { type: "line", positionX: 90, positionY: 150, x1: 0, y1: 0, x2: 80, y2: 10 })],
    });
    const r = buildCapture(s, {});
    expect(r).not.toBeNull();
    const p = r!.payload;
    expect(planTemplatePayloadV1Schema.safeParse(p).success).toBe(true);
    expect(p.v).toBe(1);
    // minX = 50 (texto), minY = 150 (linha)
    expect(p.cards[0]).toEqual({
      key: "c1", x: 50, y: 50, title: "Tarefa A", description: "desc do card",
      task: { priority: "high", checklist: [{ text: "um", order: 0 }, { text: "dois", order: 1 }] },
    });
    expect(p.cards[1]).toMatchObject({
      key: "c2", x: 350, y: 110, title: "legado", description: "d",
      task: { priority: "medium", checklist: [] },
    });
    expect(p.connections).toEqual([{ sourceKey: "c1", targetKey: "c2", sourceHandle: "sh", targetHandle: "th" }]);
    expect(p.texts[0]).toMatchObject({ x: 0, y: 150, width: 200, height: 80 });
    expect(p.shapes[0]).toMatchObject({ type: "line", x: 40, y: 0, x1: 0, y1: 0, x2: 80, y2: 10 });
    expect(r!.skipped).toEqual({ approvals: 0, images: 0 });
    expect(payloadCounts(p)).toEqual({ cards: 2, connections: 1, texts: 1, shapes: 1 });
  });

  it("buildPayload usa o offset recebido", () => {
    const sel = selectElements(snap({ cards: [card("A", { positionX: 10, positionY: 20 })] }), {});
    const p = buildPayload(sel, [], { minX: 10, minY: 20 });
    expect(p.cards[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("conjunto vazio (só aprovação/imagem selecionada) devolve null", () => {
    const s = snap({ cards: [card("A"), approval("AP", "A")], shapes: [shape("IMG", { type: "image" })] });
    expect(buildCapture(s, { cardIds: ["AP"], shapeIds: ["IMG"] })).toBeNull();
    expect(buildCapture(snap(), {})).toBeNull();
  });

  it("forma com strokeStyle desconhecido vira solid", () => {
    const r = buildCapture(snap({ shapes: [shape("S", { strokeStyle: "dotted" })] }), {});
    expect(r!.payload.shapes[0].strokeStyle).toBe("solid");
  });
});

describe("payloadCounts", () => {
  it("é tolerante a payload malformado", () => {
    expect(payloadCounts(null)).toEqual({ cards: 0, connections: 0, texts: 0, shapes: 0 });
    expect(payloadCounts({ v: 2, cards: "x" })).toEqual({ cards: 0, connections: 0, texts: 0, shapes: 0 });
  });
});
