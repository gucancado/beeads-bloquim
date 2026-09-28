import { describe, expect, it } from "vitest";
import { closestCorners, type ClientRect } from "@dnd-kit/core";
import { calendarCollision } from "./collision";

const rect = (left: number, top: number, width: number, height: number): ClientRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height });

type Drop = { id: string; rect: ClientRect; containerId?: string };

function run(fn: typeof calendarCollision, drops: Drop[], collisionRect: ClientRect, pointer: { x: number; y: number } | null) {
  const droppableContainers = drops.map(d => ({
    id: d.id, key: d.id, disabled: false, node: { current: null }, rect: { current: d.rect },
    data: { current: d.containerId ? { sortable: { containerId: d.containerId } } : undefined },
  }));
  const droppableRects = new Map(drops.map(d => [d.id, d.rect]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return fn({ active: { id: "task:x" } as any, collisionRect, droppableRects, droppableContainers: droppableContainers as any, pointerCoordinates: pointer })[0]?.id;
}

// Geometria medida no build a 1600px (workspace): colunas de 210px, card do pool de 272px.
const cols: Drop[] = [
  { id: "day:2026-09-29", rect: rect(622, 288, 210, 239) },
  { id: "day:2026-09-30", rect: rect(839, 288, 210, 239) },
  { id: "pool", rect: rect(368, 600, 1152, 200) },
];
// Card pego pela borda esquerda (8px) e solto no meio de terça.
const pointer = { x: 726, y: 515 };
const dragged = rect(718, 509, 272, 173);

describe("calendarCollision", () => {
  it("card largo pego pela borda cai no dia sob o ponteiro (closestCorners puro erra para o dia seguinte)", () => {
    expect(run(closestCorners, cols, dragged, pointer)).toBe("day:2026-09-30");
    expect(run(calendarCollision, cols, dragged, pointer)).toBe("day:2026-09-29");
  });

  it("dentro do dia, a posição ainda vem dos itens da coluna", () => {
    const withItems: Drop[] = [
      ...cols,
      { id: "task:a", rect: rect(630, 330, 194, 90), containerId: "day:2026-09-29" },
      { id: "task:b", rect: rect(630, 430, 194, 90), containerId: "day:2026-09-29" },
      { id: "task:c", rect: rect(847, 330, 194, 90), containerId: "day:2026-09-30" },
    ];
    expect(run(calendarCollision, withItems, rect(640, 325, 190, 90), { x: 648, y: 331 })).toBe("task:a");
  });

  it("ponteiro logo fora da coluna (vão entre colunas, borda de baixo) escolhe o dia mais próximo do ponteiro", () => {
    expect(run(calendarCollision, cols, dragged, { x: 834, y: 515 })).toBe("day:2026-09-29");
    expect(run(calendarCollision, cols, dragged, { x: 726, y: 530 })).toBe("day:2026-09-29");
  });

  it("sem ponteiro volta ao closestCorners", () => {
    expect(run(calendarCollision, cols, dragged, null)).toBe(run(closestCorners, cols, dragged, null));
  });
});
