import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { CheckSquare, Check, X, Plus } from 'lucide-react';
import { getStatusColorHex, formatDueDate } from '@/lib/utils';

interface ApprovalNodeProps {
  id: string;
  data: {
    approverName: string | null;
    approverAvatarUrl: string | null;
    approvalStatus: string | null;
    approvalDecision: string | null;
    dueDate: string | null;
    taskTitle: string;
    cardId?: string;
    onOpen?: (cardId: string) => void;
    onAddChild?: (cardId: string) => void;
    terminalParentCardId?: string;
    allSiblingsApproved?: boolean;
  };
  selected: boolean;
}

const ANCHOR_HANDLE_CLS = '!opacity-0 !pointer-events-none !border-none !bg-transparent !w-1 !h-1';
const PLUS_HANDLE_CLS = '!absolute !inset-0 !w-full !h-full !rounded-full !border-none !bg-transparent !transform-none !opacity-0 !cursor-pointer';

function decisionLabel(decision: string | null): { label: string; cls: string } | null {
  if (!decision || decision === 'pending') return null;
  if (decision === 'approved') return { label: 'aprovado', cls: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-900' };
  if (decision === 'rejected') return { label: 'rejeitado', cls: 'text-red-600 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-900' };
  return null;
}

interface ApprovalColors {
  hex: string;
  bgLight: string;
  borderLight: string;
  borderSelected: string;
  ringLight: string;
  textColor: string;
  stripBg: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  avatarInitialColor: string;
}

function getApprovalStatusColors(status: string | null): ApprovalColors {
  const s = status ?? 'draft';

  switch (s) {
    case 'pending':
      return {
        hex: getStatusColorHex('pending'),
        bgLight: 'bg-blue-50 dark:bg-blue-950',
        borderLight: 'border-blue-200 dark:border-blue-800',
        borderSelected: 'border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.35),0_8px_32px_-4px_rgba(59,130,246,0.55)]',
        ringLight: 'ring-blue-300 dark:ring-blue-700',
        textColor: 'text-blue-800 dark:text-blue-200',
        stripBg: 'bg-blue-400 dark:bg-blue-600',
        badgeBg: 'bg-blue-100 dark:bg-blue-900/50',
        badgeBorder: 'border-blue-200 dark:border-blue-800',
        badgeText: 'text-blue-600 dark:text-blue-400',
        avatarInitialColor: 'text-blue-600 dark:text-blue-400',
      };
    case 'in_progress':
      return {
        hex: getStatusColorHex('in_progress'),
        bgLight: 'bg-amber-50 dark:bg-amber-950',
        borderLight: 'border-amber-200 dark:border-amber-800',
        borderSelected: 'border-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.35),0_8px_32px_-4px_rgba(245,158,11,0.55)]',
        ringLight: 'ring-amber-300 dark:ring-amber-700',
        textColor: 'text-amber-800 dark:text-amber-200',
        stripBg: 'bg-amber-400 dark:bg-amber-600',
        badgeBg: 'bg-amber-100 dark:bg-amber-900/50',
        badgeBorder: 'border-amber-200 dark:border-amber-800',
        badgeText: 'text-amber-600 dark:text-amber-400',
        avatarInitialColor: 'text-amber-600 dark:text-amber-400',
      };
    case 'completed':
      return {
        hex: getStatusColorHex('completed'),
        bgLight: 'bg-emerald-50 dark:bg-emerald-950',
        borderLight: 'border-emerald-200 dark:border-emerald-800',
        borderSelected: 'border-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.35),0_8px_32px_-4px_rgba(16,185,129,0.55)]',
        ringLight: 'ring-emerald-300 dark:ring-emerald-700',
        textColor: 'text-emerald-800 dark:text-emerald-200',
        stripBg: 'bg-emerald-400 dark:bg-emerald-600',
        badgeBg: 'bg-emerald-100 dark:bg-emerald-900/50',
        badgeBorder: 'border-emerald-200 dark:border-emerald-800',
        badgeText: 'text-emerald-600 dark:text-emerald-400',
        avatarInitialColor: 'text-emerald-600 dark:text-emerald-400',
      };
    case 'cancelled':
      return {
        hex: getStatusColorHex('blocked'),
        bgLight: 'bg-slate-50 dark:bg-slate-950',
        borderLight: 'border-slate-200 dark:border-slate-800',
        borderSelected: 'border-slate-500 shadow-[0_0_0_3px_rgba(100,116,139,0.35),0_8px_32px_-4px_rgba(100,116,139,0.55)]',
        ringLight: 'ring-slate-300 dark:ring-slate-700',
        textColor: 'text-slate-700 dark:text-slate-300',
        stripBg: 'bg-slate-400 dark:bg-slate-600',
        badgeBg: 'bg-slate-100 dark:bg-slate-900/50',
        badgeBorder: 'border-slate-200 dark:border-slate-800',
        badgeText: 'text-slate-500 dark:text-slate-400',
        avatarInitialColor: 'text-slate-500 dark:text-slate-400',
      };
    case 'draft':
    default:
      return {
        hex: getStatusColorHex('draft'),
        bgLight: 'bg-violet-50 dark:bg-violet-950',
        borderLight: 'border-violet-200 dark:border-violet-800',
        borderSelected: 'border-violet-500 shadow-[0_0_0_3px_rgba(139,92,246,0.35),0_8px_32px_-4px_rgba(139,92,246,0.55)]',
        ringLight: 'ring-violet-300 dark:ring-violet-700',
        textColor: 'text-violet-800 dark:text-violet-200',
        stripBg: 'bg-violet-400 dark:bg-violet-600',
        badgeBg: 'bg-violet-100 dark:bg-violet-900/50',
        badgeBorder: 'border-violet-200 dark:border-violet-800',
        badgeText: 'text-violet-600 dark:text-violet-400',
        avatarInitialColor: 'text-violet-600 dark:text-violet-400',
      };
  }
}

function ApprovalNode({ id: _id, data, selected }: ApprovalNodeProps) {
  const colors = getApprovalStatusColors(data.approvalStatus);

  const handleDoubleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (data.onOpen && data.cardId) {
      data.onOpen(data.cardId);
    }
  };
  let dueDateStr: string | null = null;
  if (data.dueDate) {
    try {
      dueDateStr = formatDueDate(data.dueDate);
    } catch {
      dueDateStr = null;
    }
  }

  const isOverdue =
    data.dueDate &&
    new Date(data.dueDate.slice(0, 10) + 'T23:59:59') < new Date();

  const decision = decisionLabel(data.approvalDecision);

  const isTerminal = !!(data.onAddChild && data.terminalParentCardId);

  if (data.allSiblingsApproved) {
    return (
      <div
        className="group/node relative"
        style={{ width: 48, height: 48 }}
        onDoubleClick={handleDoubleClick}
      >
        {isTerminal && (
          <div
            className="nodrag nopan absolute opacity-0 group-hover/node:opacity-100 transition-all duration-150 hover:scale-110 z-10"
            style={{ right: '-2.75rem', top: 'calc(50% - 1rem)', width: '2rem', height: '2rem' }}
          >
            <button
              className="w-full h-full rounded-full flex items-center justify-center shadow-lg pointer-events-none"
              style={{ backgroundColor: '#10b981', color: '#fff' }}
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

        <div
          className={`w-full h-full rounded-full overflow-hidden bg-neutral-100 dark:bg-neutral-800 transition-all duration-200 ${
            selected
              ? 'border-[3px] border-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.35),0_8px_32px_-4px_rgba(16,185,129,0.55)]'
              : 'border-2 border-emerald-400 dark:border-emerald-600 shadow-md'
          }`}
        >
          <div className="w-full h-full flex items-center justify-center" style={{ filter: 'grayscale(100%)' }}>
            {data.approverAvatarUrl ? (
              <img
                src={data.approverAvatarUrl}
                alt={data.approverName ?? ''}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className={`text-xs font-bold ${colors.avatarInitialColor}`}>
                {data.approverName ? data.approverName.charAt(0).toUpperCase() : '?'}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group/node relative min-w-[160px] max-w-[200px] rounded-2xl transition-all duration-200 ${colors.bgLight} ${
        selected
          ? `border-[3px] ${colors.borderSelected}`
          : `border-2 ${colors.borderLight} shadow-md`
      }`}
      onDoubleClick={handleDoubleClick}
    >
      {/* Add child button — visible on terminal approval nodes */}
      {isTerminal && (
        <div
          className="nodrag nopan absolute opacity-0 group-hover/node:opacity-100 transition-all duration-150 hover:scale-110"
          style={{ right: '-2.75rem', top: 'calc(50% - 1rem)', width: '2rem', height: '2rem' }}
        >
          <button
            className="w-full h-full rounded-full flex items-center justify-center shadow-lg pointer-events-none"
            style={{ backgroundColor: colors.hex, color: '#fff' }}
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

      {/* target-left / source-right are kept as anchors for approval-chain edges, not user-draggable */}
      <Handle type="target" position={Position.Left} id="target-left" className={ANCHOR_HANDLE_CLS} isConnectable={false} />
      <Handle type="source" position={Position.Right} id="source-right" className={ANCHOR_HANDLE_CLS} isConnectable={false} />

      <div className="px-3 py-2.5 relative overflow-hidden rounded-xl">
        {data.approvalStatus !== 'pending' && (
          <div className={`absolute top-0 left-0 w-full h-1 rounded-t-xl ${colors.stripBg}`} />
        )}

        <div className="mt-1 min-w-0">
          <p className={`text-[11px] font-semibold truncate ${colors.textColor}`} title={data.taskTitle}>
            {data.taskTitle}
          </p>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center overflow-hidden ring-2 ${colors.bgLight} ${colors.ringLight}`}>
            {data.approverAvatarUrl ? (
              <img
                src={data.approverAvatarUrl}
                alt={data.approverName ?? ''}
                className="w-full h-full object-cover rounded-full"
              />
            ) : data.approverName ? (
              <span className={`text-xs font-bold ${colors.avatarInitialColor}`}>
                {data.approverName.charAt(0).toUpperCase()}
              </span>
            ) : (
              <CheckSquare className={`w-4 h-4 ${colors.avatarInitialColor}`} />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className={`text-xs font-semibold truncate ${colors.textColor}`}>
              {data.approverName ?? 'Aprovador'}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {decision ? (
                <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold border px-1.5 py-0.5 rounded-full lowercase ${decision.cls}`}>
                  {decision.label === 'aprovado' ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
                  {decision.label}
                </span>
              ) : (
                <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold border px-1.5 py-0.5 rounded-full lowercase ${colors.badgeText} ${colors.badgeBg} ${colors.badgeBorder}`}>
                  aprovação
                </span>
              )}
            </div>
          </div>
        </div>

        {dueDateStr && (
          <div className={`mt-2 text-[10px] font-medium flex items-center gap-1 ${isOverdue ? 'text-red-500' : 'text-muted-foreground'}`}>
            <span>{isOverdue ? '⚠' : '📅'}</span>
            <span>{dueDateStr}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ApprovalNode);
