import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Plus } from 'lucide-react';
import ApprovalCardBody, { getApprovalStatusColors, type ApprovalCardData } from './ApprovalCardBody';

interface ApprovalNodeProps {
  id: string;
  data: ApprovalCardData & {
    cardId?: string;
    onOpen?: (cardId: string) => void;
    onAddChild?: (cardId: string) => void;
    terminalParentCardId?: string;
  };
  selected: boolean;
}

const ANCHOR_HANDLE_CLS = '!opacity-0 !pointer-events-none !border-none !bg-transparent !w-1 !h-1';
const PLUS_HANDLE_CLS = '!absolute !inset-0 !w-full !h-full !rounded-full !border-none !bg-transparent !transform-none !opacity-0 !cursor-pointer';

function ApprovalNode({ data, selected }: ApprovalNodeProps) {
  const isTerminal = !!(data.onAddChild && data.terminalParentCardId);
  const plusColor = data.allSiblingsApproved ? '#10b981' : getApprovalStatusColors(data.approvalStatus).hex;
  const plusPos = { right: '-2.75rem', top: 'calc(50% - 1rem)', width: '2rem', height: '2rem' };
  return (
    <ApprovalCardBody
      data={data}
      selected={selected}
      onOpen={data.onOpen && data.cardId ? () => data.onOpen!(data.cardId!) : undefined}
    >
      {isTerminal && (
        <div
          className={`nodrag nopan absolute opacity-0 group-hover/node:opacity-100 transition-all duration-150 hover:scale-110${data.allSiblingsApproved ? ' z-10' : ''}`}
          style={plusPos}
        >
          <button
            className="w-full h-full rounded-full flex items-center justify-center shadow-lg pointer-events-none"
            style={{ backgroundColor: plusColor, color: '#fff' }}
            title="Adicionar card filho"
          >
            <Plus className="w-4 h-4" />
          </button>
          <Handle
            type="source"
            position={Position.Right}
            id="plus-right"
            className={PLUS_HANDLE_CLS}
            isConnectable
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); data.onAddChild!(data.cardId!); }}
          />
        </div>
      )}
      <Handle type="target" position={Position.Left} id="target-left" className={ANCHOR_HANDLE_CLS} isConnectable={false} />
      <Handle type="source" position={Position.Right} id="source-right" className={ANCHOR_HANDLE_CLS} isConnectable={false} />
    </ApprovalCardBody>
  );
}

export default memo(ApprovalNode);
