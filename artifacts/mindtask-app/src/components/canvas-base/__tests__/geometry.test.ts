import { describe, it, expect } from "vitest";
import { sampleBezier, edgeIntersectsNodeBBox, getEdgeAnchor } from "../geometry";

describe("getEdgeAnchor — floating edge (§7.2)", () => {
  const node = { x: 0, y: 0, width: 100, height: 60 }; // w2=50, h2=30

  it("alvo à direita → âncora na borda direita", () => {
    expect(getEdgeAnchor(node, 500, 0)).toEqual({ x: 50, y: 0 });
  });
  it("alvo abaixo → âncora na borda inferior", () => {
    expect(getEdgeAnchor(node, 0, 500)).toEqual({ x: 0, y: 30 });
  });
  it("alvo à esquerda → âncora na borda esquerda", () => {
    expect(getEdgeAnchor(node, -500, 0)).toEqual({ x: -50, y: 0 });
  });
  it("diagonal: cruza a borda mais próxima (top/bottom quando h2<dx-scaled)", () => {
    // dx=100,dy=100 → scaleX=0.5, scaleY=0.3 → scale 0.3 → (30,30) borda inferior
    expect(getEdgeAnchor(node, 100, 100)).toEqual({ x: 30, y: 30 });
  });
  it("self-loop / alvo no centro → devolve o centro", () => {
    expect(getEdgeAnchor(node, 0, 0)).toEqual({ x: 0, y: 0 });
  });
  it("simetria: âncoras de A→B e B→A apontam uma para a outra (eixo horizontal)", () => {
    const a = { x: 0, y: 0, width: 100, height: 60 };
    const b = { x: 300, y: 0, width: 100, height: 60 };
    const ab = getEdgeAnchor(a, b.x, b.y); // borda direita de A
    const ba = getEdgeAnchor(b, a.x, a.y); // borda esquerda de B
    expect(ab).toEqual({ x: 50, y: 0 });
    expect(ba).toEqual({ x: 250, y: 0 });
    expect(ab.x).toBeLessThan(ba.x); // não se cruzam
  });
  it("par grande/pequeno: escala pela meia-dimensão de cada nó", () => {
    const big = { x: 0, y: 0, width: 400, height: 400 };
    expect(getEdgeAnchor(big, 1000, 0)).toEqual({ x: 200, y: 0 });
  });
});

describe("sampleBezier (characterization)", () => {
  it("returns samples+1 points", () => {
    const pts = sampleBezier(0, 0, 1, 1, 2, 2, 3, 3, 40);
    expect(pts).toHaveLength(41);
  });

  it("always includes the exact endpoints at t=0 and t=1", () => {
    const pts = sampleBezier(5, 7, 11, 13, 17, 19, 23, 29, 10);
    expect(pts[0]).toEqual([5, 7]);
    expect(pts[pts.length - 1]).toEqual([23, 29]);
  });

  it("on equally-spaced collinear control points it is the straight-line param", () => {
    // p0=0,p1=10,p2=20,p3=30 → x(t)=30t, y=0
    const pts = sampleBezier(0, 0, 10, 0, 20, 0, 30, 0, 3);
    expect(pts.map(([x]) => x)).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(10, 6),
      expect.closeTo(20, 6),
      expect.closeTo(30, 6),
    ]);
    for (const [, y] of pts) expect(y).toBeCloseTo(0, 6);
  });
});

describe("edgeIntersectsNodeBBox (characterization)", () => {
  it("true when the node sits on the straight horizontal edge path", () => {
    // source→target horizontal at y=0; node centered at midpoint
    expect(
      edgeIntersectsNodeBBox(0, 0, 100, 0, /*center*/ 50, 0, /*w*/ 20, /*h*/ 20),
    ).toBe(true);
  });

  it("true when the node bbox covers the source endpoint", () => {
    expect(
      edgeIntersectsNodeBBox(0, 0, 100, 0, 0, 0, 20, 20),
    ).toBe(true);
  });

  it("false when the node is far off the edge path", () => {
    expect(
      edgeIntersectsNodeBBox(0, 0, 100, 0, 50, 500, 20, 20),
    ).toBe(false);
  });
});
