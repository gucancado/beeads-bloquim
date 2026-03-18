import { memo, useCallback } from 'react';
import { EdgeProps, getBezierPath, EdgeLabelRenderer, useReactFlow } from 'reactflow';
import { X } from 'lucide-react';

function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd,
  style,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const onDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      deleteElements({ edges: [{ id }] });
    },
    [id, deleteElements],
  );

  return (
    <>
      {/* Wide transparent hit area for easier clicking */}
      <path
        d={edgePath}
        fill="none"
        strokeWidth={20}
        stroke="transparent"
        strokeLinecap="round"
      />
      {/* Visible edge */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        markerEnd={markerEnd}
        style={style}
        strokeLinecap="round"
        className="react-flow__edge-path"
      />

      {selected && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <button
              onClick={onDelete}
              className="flex items-center justify-center w-5 h-5 rounded-full bg-destructive text-destructive-foreground shadow-lg hover:scale-125 transition-transform border-2 border-background"
              title="Remover ligação"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(DeletableEdge);
