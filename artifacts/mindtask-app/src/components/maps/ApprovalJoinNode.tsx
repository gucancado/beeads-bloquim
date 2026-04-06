import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Plus } from 'lucide-react';

interface ApprovalJoinNodeProps {
  data: {
    parentCardId: string;
    onAddChild?: (cardId: string) => void;
  };
}

function ApprovalJoinNode({ data }: ApprovalJoinNodeProps) {
  return (
    <div
      className={[
        'group/join relative flex items-center justify-center',
        'w-9 h-9 rounded-full border-2 transition-all duration-200',
        'bg-gray-100 dark:bg-gray-800',
        'border-gray-300 dark:border-gray-600',
        'hover:border-gray-500 dark:hover:border-gray-400',
        'shadow-md hover:shadow-lg',
        'cursor-pointer',
      ].join(' ')}
      title="Ponto de convergência das aprovações"
    >
      {/* Target handle — tiny invisible anchor for incoming approval edges */}
      <Handle
        type="target"
        position={Position.Left}
        id="target-left"
        className="!absolute !left-0 !top-1/2 !-translate-y-1/2 !w-1 !h-1 !rounded-full !border-none !bg-transparent !opacity-0 !transform-none"
        isConnectable={false}
      />

      {/* Source handle — covers the full circle for drag-to-connect and click */}
      <Handle
        type="source"
        position={Position.Right}
        id="source-right"
        className="!absolute !inset-0 !w-full !h-full !rounded-full !border-none !bg-transparent !transform-none !opacity-0 !cursor-pointer"
        isConnectable={true}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          data.onAddChild?.(data.parentCardId);
        }}
      />

      {/* "+" icon — appears on hover, pointer-events none so Handle receives mouse events */}
      <Plus
        className="w-4 h-4 text-gray-500 dark:text-gray-400 opacity-0 group-hover/join:opacity-100 transition-opacity duration-150 pointer-events-none relative z-10"
      />
    </div>
  );
}

export default memo(ApprovalJoinNode);
