import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Plus } from 'lucide-react';

interface ApprovalJoinNodeData {
  parentCardId: string;
  onAddChild?: (cardId: string) => void;
}

function ApprovalJoinNode({ data, selected }: NodeProps<ApprovalJoinNodeData>) {
  return (
    <div
      className="group/join relative flex items-center justify-center w-9 h-9"
      title="Ponto de convergência das aprovações"
    >
      {/* Visual circle — purely decorative; no hover effect, no cursor change.
          Selected state shows an aura ring consistent with other nodes. */}
      <div
        className={[
          'w-9 h-9 rounded-full border-2 transition-all duration-150',
          'bg-gray-100 dark:bg-gray-800',
          selected
            ? 'border-blue-500 dark:border-blue-400 scale-105'
            : 'border-gray-300 dark:border-gray-600',
          'shadow-md',
        ].join(' ')}
        style={{
          boxShadow: selected
            ? '0 0 0 3px rgb(59 130 246 / 0.35), 0 8px 24px -6px rgb(59 130 246 / 0.45)'
            : undefined,
        }}
      />

      {/* Target handle — tiny invisible anchor for incoming approval edges */}
      <Handle
        type="target"
        position={Position.Left}
        id="target-left"
        className="!absolute !left-0 !top-1/2 !-translate-y-1/2 !w-1 !h-1 !rounded-full !border-none !bg-transparent !opacity-0 !transform-none"
        isConnectable={false}
      />

      {/* Invisible source handle for edge anchoring only — no interaction */}
      <Handle
        type="source"
        position={Position.Right}
        id="source-right"
        className="!absolute !right-0 !top-1/2 !-translate-y-1/2 !w-1 !h-1 !rounded-full !border-none !bg-transparent !opacity-0 !transform-none !pointer-events-none"
        isConnectable={false}
      />

      {/* Add child "+" button — floats outside the circle to the right.
          Same pattern as MindMapNode: visual circle (pointer-events-none) with a
          transparent source Handle on top capturing click + drag-to-connect. */}
      <div
        className="nodrag nopan absolute hover:scale-110 transition-transform duration-150"
        style={{ left: 'calc(100% + 1.25rem)', top: 'calc(50% - 24px)' }}
      >
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center opacity-0 group-hover/join:opacity-100 transition-opacity duration-150 shadow-lg pointer-events-none"
          style={{ backgroundColor: '#6b7280', color: '#fff' }}
        >
          <Plus className="w-6 h-6" />
        </div>
        <Handle
          type="source"
          position={Position.Right}
          id="plus-right"
          className="!absolute !inset-0 !w-full !h-full !rounded-full !border-none !bg-transparent !transform-none !opacity-0 !cursor-pointer"
          isConnectable
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            data.onAddChild?.(data.parentCardId);
          }}
        />
      </div>
    </div>
  );
}

export default memo(ApprovalJoinNode);
