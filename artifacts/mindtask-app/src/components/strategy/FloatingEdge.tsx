import { useCallback } from "react";
import { useStore, getBezierPath, EdgeLabelRenderer, type EdgeProps } from "reactflow";
import { getEdgeAnchor } from "@/components/canvas-base/geometry";

/**
 * Aresta flutuante (§7.2 do Mapa Estratégico): ancora na borda de cada nó na
 * direção do outro e recalcula ao mover (lê posições do store do ReactFlow).
 * Diferente do plano de ação (handles fixos esq/dir).
 */
export function FloatingEdge({ id, source, target, markerEnd, style, data }: EdgeProps) {
  const sourceNode = useStore(useCallback((s) => s.nodeInternals.get(source), [source]));
  const targetNode = useStore(useCallback((s) => s.nodeInternals.get(target), [target]));

  if (!sourceNode || !targetNode || !sourceNode.positionAbsolute || !targetNode.positionAbsolute) {
    return null;
  }

  const sw = sourceNode.width ?? 180;
  const sh = sourceNode.height ?? 60;
  const tw = targetNode.width ?? 180;
  const th = targetNode.height ?? 60;
  const sCenter = { x: sourceNode.positionAbsolute.x + sw / 2, y: sourceNode.positionAbsolute.y + sh / 2 };
  const tCenter = { x: targetNode.positionAbsolute.x + tw / 2, y: targetNode.positionAbsolute.y + th / 2 };

  const sa = getEdgeAnchor({ x: sCenter.x, y: sCenter.y, width: sw, height: sh }, tCenter.x, tCenter.y);
  const ta = getEdgeAnchor({ x: tCenter.x, y: tCenter.y, width: tw, height: th }, sCenter.x, sCenter.y);

  const [path, labelX, labelY] = getBezierPath({
    sourceX: sa.x,
    sourceY: sa.y,
    targetX: ta.x,
    targetY: ta.y,
  });

  const label = (data as { label?: string } | undefined)?.label;

  return (
    <>
      <path id={id} className="react-flow__edge-path" d={path} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium lowercase text-muted-foreground shadow-sm"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all" }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
