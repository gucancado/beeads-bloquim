// artifacts/api-server/src/lib/collision.ts

/**
 * Dimensões nominais de um card no canvas. O card renderizado pode crescer com
 * o conteúdo, mas layout e detecção de colisão trabalham com a caixa nominal —
 * é o que o servidor consegue saber sem medir o DOM.
 * Espelha NODE_W/NODE_H de mindtask-app/src/pages/maps/canvas.tsx.
 */
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 80;

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };
