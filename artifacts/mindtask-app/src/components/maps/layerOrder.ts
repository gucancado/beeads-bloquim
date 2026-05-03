export const LAYER_SHAPE_RECT = -30;
export const LAYER_SHAPE_IMAGE = -25;
export const LAYER_SHAPE_LINE = -20;
export const LAYER_TEXT = -10;
export const LAYER_EDGE = 0;
export const LAYER_TASK = 10;

export type ShapeKind = 'line' | 'rect' | 'ellipse' | 'image';

export function shapeNodeZIndex(shapeType: ShapeKind): number {
  if (shapeType === 'line') return LAYER_SHAPE_LINE;
  if (shapeType === 'image') return LAYER_SHAPE_IMAGE;
  return LAYER_SHAPE_RECT;
}
