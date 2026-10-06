import { describe, it, expect } from "vitest";
import {
  APPLY_GAP_X,
  computeBounds,
  computeOrigin,
  existingBoxes,
  shapeAabb,
} from "../services/planTemplates/apply";
import { NODE_HEIGHT, NODE_WIDTH } from "../lib/collision";
import type { PlanTemplatePayloadV1 } from "../services/planTemplates/types";

const close = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
  expect(a.width).toBeCloseTo(b.width, 6);
  expect(a.height).toBeCloseTo(b.height, 6);
};

describe("shapeAabb", () => {
  it("sem rotação devolve a própria caixa", () => {
    expect(shapeAabb({ type: "rect", x: 10, y: 20, width: 200, height: 100, rotation: 0 })).toEqual({
      x: 10, y: 20, width: 200, height: 100,
    });
  });

  it("90° troca largura e altura em torno do centro", () => {
    close(shapeAabb({ type: "rect", x: 0, y: 0, width: 200, height: 100, rotation: 90 }), {
      x: 50, y: -50, width: 100, height: 200,
    });
  });

  it("45° num quadrado aumenta a caixa pra lado·√2", () => {
    const side = 100 * Math.SQRT2;
    close(shapeAabb({ type: "ellipse", x: 0, y: 0, width: 100, height: 100, rotation: 45 }), {
      x: 50 - side / 2, y: 50 - side / 2, width: side, height: side,
    });
  });

  it("linha usa position + width × height mesmo com rotação", () => {
    expect(shapeAabb({ type: "line", x: 5, y: 6, width: 80, height: 10, rotation: 30 })).toEqual({
      x: 5, y: 6, width: 80, height: 10,
    });
  });
});

describe("computeOrigin", () => {
  it("mapa vazio → (0,0)", () => {
    expect(computeOrigin([])).toEqual({ x: 0, y: 0 });
  });

  it("à direita da caixa envolvente, alinhada ao topo", () => {
    const boxes = existingBoxes({
      cards: [{ positionX: 0, positionY: 100 }, { positionX: 500, positionY: 300 }],
      texts: [],
      shapes: [],
    });
    expect(computeOrigin(boxes)).toEqual({ x: 500 + NODE_WIDTH + APPLY_GAP_X, y: 100 });
  });

  it("mistura de tipos: texto mais alto define o topo, forma rotacionada define a direita", () => {
    const boxes = existingBoxes({
      cards: [{ positionX: 0, positionY: 0 }],
      texts: [{ positionX: 100, positionY: -80, width: 200, height: 80 }],
      shapes: [{ type: "rect", positionX: 300, positionY: 0, width: 200, height: 100, rotation: 90 }],
    });
    // forma: centro (400,50), caixa rotacionada 100×200 → x 350..450, topo -50.
    // Texto em -80 é o topo; a forma define a direita (450).
    const o = computeOrigin(boxes);
    expect(o.x).toBeCloseTo(450 + APPLY_GAP_X, 6);
    expect(o.y).toBe(-80);
  });
});

describe("computeBounds", () => {
  it("caixa absoluta dos elementos criados (cards com caixa nominal)", () => {
    const payload: PlanTemplatePayloadV1 = {
      v: 1,
      cards: [
        { key: "c1", x: 0, y: 0, title: "a", description: null, task: { priority: "medium", checklist: [] } },
        { key: "c2", x: 400, y: 50, title: "b", description: null, task: { priority: "medium", checklist: [] } },
      ],
      connections: [],
      texts: [{ x: 100, y: 400, width: 200, height: 80, fontSize: 14, color: "#000", content: "{}" }],
      shapes: [],
    };
    expect(computeBounds(payload, { x: 1000, y: -20 })).toEqual({
      x: 1000,
      y: -20,
      width: 400 + NODE_WIDTH,
      height: Math.max(50 + NODE_HEIGHT, 480),
    });
  });
});
