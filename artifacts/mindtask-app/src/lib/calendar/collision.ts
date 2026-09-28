import { closestCorners, type ClientRect, type CollisionDetection } from "@dnd-kit/core";
import { POOL_ID } from "./dnd";

const isContainer = (id: string) => id === POOL_ID || id.startsWith("day:");

/** Distância do ponto ao retângulo (0 = dentro). */
function pointToRect(p: { x: number; y: number }, r: ClientRect): number {
  const dx = Math.max(r.left - p.x, 0, p.x - r.right);
  const dy = Math.max(r.top - p.y, 0, p.y - r.bottom);
  return Math.hypot(dx, dy);
}

/**
 * O CONTÊINER (dia ou pool) é o mais próximo do PONTEIRO (o que está sob ele,
 * ou o mais perto quando o ponteiro está no vão entre colunas/na borda); dentro
 * dele, a posição sai do closestCorners de sempre. Só closestCorners usa o
 * retângulo do card arrastado: um card do pool (mais largo que a coluna) pego
 * pela borda esquerda e solto no meio de um dia caía no dia seguinte.
 */
export const calendarCollision: CollisionDetection = (args) => {
  const p = args.pointerCoordinates;
  if (!p) return closestCorners(args);
  let best: { id: string; d: number } | null = null;
  for (const c of args.droppableContainers) {
    const id = String(c.id);
    if (!isContainer(id)) continue;
    const r = args.droppableRects.get(c.id);
    if (!r) continue;
    const d = pointToRect(p, r);
    if (!best || d < best.d) best = { id, d };
  }
  if (!best) return closestCorners(args);
  const containerId = best.id;
  const scoped = args.droppableContainers.filter(c =>
    String(c.id) === containerId
    || (c.data.current as { sortable?: { containerId?: unknown } } | undefined)?.sortable?.containerId === containerId,
  );
  return closestCorners({ ...args, droppableContainers: scoped });
};
