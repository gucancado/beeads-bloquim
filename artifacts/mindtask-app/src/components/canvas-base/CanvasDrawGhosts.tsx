/**
 * Overlays "fantasma" (preview) de desenho do canvas — genéricos, compartilhados
 * pelos modos action e strategy (Fase 1, Fatia C do Mapa Estratégico).
 * Apresentacional puro: o ghost de texto (posição do clique) e o ghost de forma
 * sendo desenhada (rect/ellipse/line). cardGhost/altDrag (específicos do action)
 * permanecem no canvas.tsx por enquanto.
 */
export type TextGhost = { x: number; y: number } | null;
export type ShapeGhost = {
  x: number;
  y: number;
  w: number;
  h: number;
  rawAbsW?: number;
  rawAbsH?: number;
  dxSign?: number;
  dySign?: number;
} | null;
export type ShapeTool = "line" | "rect" | "ellipse" | null;

export function CanvasDrawGhosts({
  textGhost,
  shapeGhost,
  shapeTool,
}: {
  textGhost: TextGhost;
  shapeGhost: ShapeGhost;
  shapeTool: ShapeTool;
}) {
  return (
    <>
      {textGhost && (
        <div
          className="pointer-events-none fixed z-overlay border-2 border-dashed border-blue-400 bg-blue-50/70 dark:bg-blue-950/50 rounded-lg"
          style={{ left: textGhost.x - 100, top: textGhost.y - 40, width: 200, height: 80 }}
        />
      )}

      {shapeGhost && (shapeGhost.w > 2 || (shapeTool === "line" && shapeGhost.h > 2)) && (
        <div className="pointer-events-none fixed z-overlay-backdrop" style={{ left: shapeGhost.x, top: shapeGhost.y, width: Math.max(shapeGhost.w, shapeTool === "line" ? 1 : 0), height: Math.max(shapeGhost.h, 4) }}>
          <svg width={Math.max(shapeGhost.w, shapeTool === "line" ? 1 : 0)} height={Math.max(shapeGhost.h, 4)} style={{ overflow: "visible" }}>
            {shapeTool === "rect" && (
              <rect x={1} y={1} width={shapeGhost.w - 2} height={Math.max(shapeGhost.h - 2, 2)} rx={4} stroke="#6366f1" strokeWidth={2} strokeDasharray="6 4" fill="#6366f120" />
            )}
            {shapeTool === "ellipse" && (
              <ellipse cx={shapeGhost.w / 2} cy={Math.max(shapeGhost.h, 4) / 2} rx={shapeGhost.w / 2 - 1} ry={Math.max(shapeGhost.h, 4) / 2 - 1} stroke="#6366f1" strokeWidth={2} strokeDasharray="6 4" fill="#6366f120" />
            )}
            {shapeTool === "line" && (() => {
              const gw = Math.max(shapeGhost.rawAbsW ?? shapeGhost.w, 1);
              const rawH = shapeGhost.rawAbsH ?? shapeGhost.h;
              const gDxSign = shapeGhost.dxSign ?? 1;
              const gDySign = shapeGhost.dySign ?? 1;
              const lx1 = gDxSign > 0 ? 0 : gDxSign < 0 ? gw : 0;
              const lx2 = gDxSign > 0 ? gw : gDxSign < 0 ? 0 : 0;
              const ly1 = gDySign > 0 ? 0 : gDySign < 0 ? rawH : 0;
              const ly2 = gDySign > 0 ? rawH : gDySign < 0 ? 0 : 0;
              return <line x1={lx1} y1={ly1} x2={lx2} y2={ly2} stroke="#6366f1" strokeWidth={2} strokeLinecap="round" strokeDasharray="6 4" />;
            })()}
          </svg>
        </div>
      )}
    </>
  );
}
