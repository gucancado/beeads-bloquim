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

const STRIP_HANDLE_CLS = [
  '!absolute !inset-0 !w-full !h-full',
  '!border-none !bg-transparent !rounded-none !transform-none',
  '!opacity-100 !cursor-crosshair',
].join(' ');

function decisionLabel(decision: string | null): { label: string; cls: string } | null {
  if (!decision || decision === 'pending') return null;
  if (decision === 'approved') return { label: 'aprovado', cls: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900' };
  if (decision === 'rejected') return { label: 'rejeitado', cls: 'text-red-600 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900' };
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
        bgLight: 'bg-blue-50 dark:bg-blue-950/20',
        borderLight: 'border-blue-200 dark:border-blue-800',
        borderSelected: 'border-blue-500 shadow-lg shadow-blue-500/20',
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
        bgLight: 'bg-amber-50 dark:bg-amber-950/20',
        borderLight: 'border-amber-200 dark:border-amber-800',
        borderSelected: 'border-amber-500 shadow-lg shadow-amber-500/20',
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
        bgLight: 'bg-emerald-50 dark:bg-emerald-950/20',
        borderLight: 'border-emerald-200 dark:border-emerald-800',
        borderSelected: 'border-emerald-500 shadow-lg shadow-emerald-500/20',
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
        bgLight: 'bg-slate-50 dark:bg-slate-950/20',
        borderLight: 'border-slate-200 dark:border-slate-800',
        borderSelected: 'border-slate-500 shadow-lg shadow-slate-500/20',
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
        bgLight: 'bg-violet-50 dark:bg-violet-950/20',
        borderLight: 'border-violet-200 dark:border-violet-800',
        borderSelected: 'border-violet-500 shadow-lg shadow-violet-500/20',
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
        className={`group/node relative rounded-full border-2 transition-all duration-200 bg-neutral-100 dark:bg-neutral-800 overflow-hidden ${
          selected
            ? 'border-emerald-500 shadow-lg shadow-emerald-500/20'
            : 'border-emerald-400 dark:border-emerald-600 shadow-md'
        }`}
        style={{ width: 48, height: 48 }}
        onDoubleClick={handleDoubleClick}
      >
        {isTerminal && (
          <button
            className="nodrag nopan absolute -right-11 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center opacity-0 group-hover/node:opacity-100 transition-all duration-150 hover:scale-110 shadow-lg"
            style={{ backgroundColor: '#10b981', color: '#fff' }}
            title="Adicionar card filho"
            onClick={(e) => { e.stopPropagation(); data.onAddChild!(data.cardId!); }}
          >
            <Plus className="w-4 h-4" />
          </button>
        )}

        <div className="absolute left-0 top-0 h-full w-3 z-10">
          <Handle type="target" position={Position.Left} id="target-left" className={STRIP_HANDLE_CLS} isConnectable={false} />
        </div>

        <div className="absolute right-0 top-0 h-full w-3 z-10">
          <Handle type="source" position={Position.Right} id="source-right" className={STRIP_HANDLE_CLS} isConnectable={isTerminal} />
        </div>

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
    );
  }

  return (
    <div
      className={`group/node relative min-w-[160px] max-w-[200px] rounded-2xl border-2 transition-all duration-200 ${colors.bgLight} ${
        selected
          ? colors.borderSelected
          : `${colors.borderLight} shadow-md`
      }`}
      onDoubleClick={handleDoubleClick}
    >
      {/* Add child button — visible on terminal approval nodes */}
      {isTerminal && (
        <button
          className="nodrag nopan absolute -right-11 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center opacity-0 group-hover/node:opacity-100 transition-all duration-150 hover:scale-110 shadow-lg"
          style={{ backgroundColor: colors.hex, color: '#fff' }}
          title="Adicionar card filho"
          onClick={(e) => { e.stopPropagation(); data.onAddChild!(data.cardId!); }}
        >
          <Plus className="w-4 h-4" />
        </button>
      )}

      <div className="absolute left-0 top-0 h-full w-3 z-10 rounded-l-2xl">
        {/* target-left is kept for floating approval-chain edges but not connectable by user drag */}
        <Handle type="target" position={Position.Left} id="target-left" className={STRIP_HANDLE_CLS} isConnectable={false} />
      </div>

      <div className="absolute right-0 top-0 h-full w-3 z-10 rounded-r-2xl">
        {/* source-right is only connectable on the terminal node */}
        <Handle type="source" position={Position.Right} id="source-right" className={STRIP_HANDLE_CLS} isConnectable={isTerminal} />
      </div>

      <div className="px-3 py-2.5 relative overflow-hidden rounded-xl">
        {data.approvalStatus !== 'pending' && (
          <div className={`absolute top-0 left-0 w-full h-1 rounded-t-xl ${colors.stripBg}`} />
        )}

        <div className="mt-1 flex items-center gap-2">
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
