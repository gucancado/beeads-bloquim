/**
 * Pure canvas geometry helpers shared by the action and strategy canvases.
 *
 * Extracted verbatim from pages/maps/canvas.tsx (Fase 1, Fatia A do Mapa
 * Estratégico). Behavior is frozen by geometry.test.ts — do not change the math
 * without updating the characterization tests.
 */

/**
 * Sample N points along a cubic bezier curve.
 */
export function sampleBezier(
  p0x: number, p0y: number,
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number,
  samples: number,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const mt = 1 - t;
    const x = mt * mt * mt * p0x + 3 * mt * mt * t * p1x + 3 * mt * t * t * p2x + t * t * t * p3x;
    const y = mt * mt * mt * p0y + 3 * mt * mt * t * p1y + 3 * mt * t * t * p2y + t * t * t * p3y;
    pts.push([x, y]);
  }
  return pts;
}

/**
 * Check if a bezier edge (defined by source/target positions) intersects the bounding box of a node.
 * Uses ReactFlow's default bezier control point offset heuristic.
 */
export function edgeIntersectsNodeBBox(
  sourceX: number, sourceY: number,
  targetX: number, targetY: number,
  nodeCenterX: number, nodeCenterY: number,
  nodeWidth: number, nodeHeight: number,
): boolean {
  // Default bezier: source handle points right, target handle points left
  const offset = Math.abs(targetX - sourceX) * 0.5;
  const cp1x = sourceX + offset;
  const cp1y = sourceY;
  const cp2x = targetX - offset;
  const cp2y = targetY;

  const halfW = nodeWidth / 2;
  const halfH = nodeHeight / 2;
  const minX = nodeCenterX - halfW;
  const maxX = nodeCenterX + halfW;
  const minY = nodeCenterY - halfH;
  const maxY = nodeCenterY + halfH;

  const pts = sampleBezier(sourceX, sourceY, cp1x, cp1y, cp2x, cp2y, targetX, targetY, 40);
  for (const [px, py] of pts) {
    if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
      return true;
    }
  }
  return false;
}
