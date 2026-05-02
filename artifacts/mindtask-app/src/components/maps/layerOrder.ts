export const LAYER_SHAPE_RECT = -30;
export const LAYER_SHAPE_LINE = -20;
export const LAYER_TEXT = -10;
export const LAYER_EDGE = 0;
export const LAYER_TASK = 10;

export function shapeNodeZIndex(shapeType: 'line' | 'rect' | 'ellipse'): number {
  return shapeType === 'line' ? LAYER_SHAPE_LINE : LAYER_SHAPE_RECT;
}
