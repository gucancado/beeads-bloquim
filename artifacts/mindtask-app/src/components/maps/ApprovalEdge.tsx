import { memo } from 'react';
import { EdgeProps, getBezierPath, useStore, Position } from 'reactflow';

function getNodeCenter(node: { positionAbsolute?: { x: number; y: number } | null; width?: number | null; height?: number | null } | undefined) {
  if (!node?.positionAbsolute) return null;
  return {
    x: node.positionAbsolute.x + (node.width ?? 0),
    y: node.positionAbsolute.y + (node.height ?? 0) / 2,
  };
}

function getNodeLeftCenter(node: { positionAbsolute?: { x: number; y: number } | null; width?: number | null; height?: number | null } | undefined) {
  if (!node?.positionAbsolute) return null;
  return {
    x: node.positionAbsolute.x,
    y: node.positionAbsolute.y + (node.height ?? 0) / 2,
  };
}

function ApprovalEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
}: EdgeProps) {
  const sourceNode = useStore(s => s.nodeInternals.get(source));
  const targetNode = useStore(s => s.nodeInternals.get(target));

  const src = getNodeCenter(sourceNode) ?? { x: sourceX, y: sourceY };
  const tgt = getNodeLeftCenter(targetNode) ?? { x: targetX, y: targetY };

  const [edgePath] = getBezierPath({
    sourceX: src.x,
    sourceY: src.y,
    sourcePosition: Position.Right,
    targetX: tgt.x,
    targetY: tgt.y,
    targetPosition: Position.Left,
  });

  const effectiveStyle = {
    ...style,
  };

  return (
    <>
      <path
        d={edgePath}
        fill="none"
        strokeWidth={20}
        stroke="transparent"
        strokeLinecap="round"
      />
      <path
        id={id}
        d={edgePath}
        fill="none"
        markerEnd={markerEnd}
        style={effectiveStyle}
        strokeLinecap="round"
        className="react-flow__edge-path"
      />
    </>
  );
}

export default memo(ApprovalEdge);
