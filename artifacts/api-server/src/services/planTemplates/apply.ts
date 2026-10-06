// Funções puras da aplicação de modelo de plano (spec B3). Sem banco.
import { NODE_HEIGHT, NODE_WIDTH, type Box } from "../../lib/collision";
import type { PlanTemplatePayloadV1 } from "./types";

/** D7: folga à direita da caixa envolvente do mapa. */
export const APPLY_GAP_X = 120;

/**
 * Caixa alinhada aos eixos de uma forma rotacionada (graus) em torno do
 * centro. Linhas usam position + width × height (x1..y2 são locais ao nó).
 */
export function shapeAabb(s: {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}): Box {
  if (s.type === "line" || !s.rotation) {
    return { x: s.x, y: s.y, width: s.width, height: s.height };
  }
  const theta = (s.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(theta));
  const sin = Math.abs(Math.sin(theta));
  const w = s.width * cos + s.height * sin;
  const h = s.width * sin + s.height * cos;
  const cx = s.x + s.width / 2;
  const cy = s.y + s.height / 2;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

export function existingBoxes(rows: {
  cards: Array<{ positionX: number; positionY: number }>;
  texts: Array<{ positionX: number; positionY: number; width: number; height: number }>;
  shapes: Array<{
    type: string;
    positionX: number;
    positionY: number;
    width: number;
    height: number;
    rotation: number;
  }>;
}): Box[] {
  return [
    ...rows.cards.map((c) => ({ x: c.positionX, y: c.positionY, width: NODE_WIDTH, height: NODE_HEIGHT })),
    ...rows.texts.map((t) => ({ x: t.positionX, y: t.positionY, width: t.width, height: t.height })),
    ...rows.shapes.map((s) =>
      shapeAabb({ type: s.type, x: s.positionX, y: s.positionY, width: s.width, height: s.height, rotation: s.rotation }),
    ),
  ];
}

/** D7: { maxRight + 120, minTop }; mapa sem elementos → (0,0). */
export function computeOrigin(boxes: Box[]): { x: number; y: number } {
  if (boxes.length === 0) return { x: 0, y: 0 };
  let maxRight = -Infinity;
  let minTop = Infinity;
  for (const b of boxes) {
    if (b.x + b.width > maxRight) maxRight = b.x + b.width;
    if (b.y < minTop) minTop = b.y;
  }
  return { x: maxRight + APPLY_GAP_X, y: minTop };
}

/**
 * Caixa absoluta dos elementos criados: começa na origem; largura/altura =
 * max(x_rel + w) / max(y_rel + h) sobre o payload (cards com a caixa nominal,
 * formas com shapeAabb).
 */
export function computeBounds(payload: PlanTemplatePayloadV1, origin: { x: number; y: number }): Box {
  const rel: Box[] = [
    ...payload.cards.map((c) => ({ x: c.x, y: c.y, width: NODE_WIDTH, height: NODE_HEIGHT })),
    ...payload.texts.map((t) => ({ x: t.x, y: t.y, width: t.width, height: t.height })),
    ...payload.shapes.map((s) => shapeAabb(s)),
  ];
  let width = 0;
  let height = 0;
  for (const b of rel) {
    width = Math.max(width, b.x + b.width);
    height = Math.max(height, b.y + b.height);
  }
  return { x: origin.x, y: origin.y, width, height };
}
