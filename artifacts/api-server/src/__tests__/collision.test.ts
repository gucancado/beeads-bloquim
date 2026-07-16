// artifacts/api-server/src/__tests__/collision.test.ts
import { describe, it, expect } from "vitest";
import { boxesOverlap, findFreeSlot, NODE_WIDTH, NODE_HEIGHT } from "../lib/collision";

const SIZE = { width: NODE_WIDTH, height: NODE_HEIGHT };

describe("boxesOverlap", () => {
  const a = { x: 0, y: 0, width: 200, height: 80 };

  it("caixas idênticas se sobrepõem", () => {
    expect(boxesOverlap(a, { ...a })).toBe(true);
  });

  it("caixas bem separadas não se sobrepõem", () => {
    expect(boxesOverlap(a, { x: 1000, y: 1000, width: 200, height: 80 })).toBe(false);
  });

  it("encostadas sem gap não se sobrepõem", () => {
    expect(boxesOverlap(a, { x: 200, y: 0, width: 200, height: 80 })).toBe(false);
  });

  it("encostadas COM gap contam como sobrepostas", () => {
    expect(boxesOverlap(a, { x: 200, y: 0, width: 200, height: 80 }, 24)).toBe(true);
  });
});

describe("findFreeSlot", () => {
  it("sem nada ocupado devolve o ponto pedido", () => {
    expect(findFreeSlot({ x: 50, y: 60 }, SIZE, [])).toEqual({ x: 50, y: 60 });
  });

  it("ponto pedido livre devolve o próprio ponto", () => {
    const occupied = [{ x: 1000, y: 1000, width: NODE_WIDTH, height: NODE_HEIGHT }];
    expect(findFreeSlot({ x: 0, y: 0 }, SIZE, occupied)).toEqual({ x: 0, y: 0 });
  });

  it("ponto ocupado desloca pro vizinho livre mais próximo", () => {
    const occupied = [{ x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT }];
    // gap 24 → stepX = 200+24 = 224, stepY = 320+24 = 344. O vizinho mais PRÓXIMO
    // é o horizontal (224 < 344), então desloca pra direita.
    expect(findFreeSlot({ x: 0, y: 0 }, SIZE, occupied)).toEqual({ x: 224, y: 0 });
  });

  it("resultado nunca sobrepõe o que já está ocupado", () => {
    const occupied = [
      { x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT },
      { x: 0, y: 104, width: NODE_WIDTH, height: NODE_HEIGHT },
      { x: 0, y: -104, width: NODE_WIDTH, height: NODE_HEIGHT },
    ];
    const slot = findFreeSlot({ x: 0, y: 0 }, SIZE, occupied);
    const box = { x: slot.x, y: slot.y, width: NODE_WIDTH, height: NODE_HEIGHT };
    for (const o of occupied) expect(boxesOverlap(box, o, 24)).toBe(false);
  });

  it("é determinístico", () => {
    const occupied = [{ x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT }];
    expect(findFreeSlot({ x: 0, y: 0 }, SIZE, occupied)).toEqual(
      findFreeSlot({ x: 0, y: 0 }, SIZE, occupied),
    );
  });

  it("sem vaga dentro do limite de anéis, degrada pro ponto pedido", () => {
    const occupied = [{ x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT }];
    expect(findFreeSlot({ x: 0, y: 0 }, SIZE, occupied, { maxRings: 0 })).toEqual({ x: 0, y: 0 });
  });
});
