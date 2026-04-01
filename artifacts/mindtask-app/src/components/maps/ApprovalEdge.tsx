import { memo } from 'react';
import { EdgeProps, getBezierPath } from 'reactflow';

function ApprovalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const effectiveStyle = {
    ...style,
    strokeDasharray: '6 3',
    stroke: '#8b5cf6',
    strokeWidth: 2,
    opacity: 0.7,
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
