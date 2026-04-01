import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { format } from 'date-fns';
import { CheckSquare, Check, X } from 'lucide-react';

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

function ApprovalNode({ id: _id, data, selected }: ApprovalNodeProps) {
  const handleDoubleClick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (data.onOpen && data.cardId) {
      data.onOpen(data.cardId);
    }
  };
  let dueDateStr: string | null = null;
  if (data.dueDate) {
    try {
      dueDateStr = format(new Date(data.dueDate.slice(0, 10) + 'T00:00:00'), 'dd/MM/yy');
    } catch {
      dueDateStr = null;
    }
  }

  const isOverdue =
    data.dueDate &&
    new Date(data.dueDate.slice(0, 10) + 'T23:59:59') < new Date();

  const decision = decisionLabel(data.approvalDecision);

  return (
    <div
      className={`group/node relative min-w-[160px] max-w-[200px] bg-violet-50 dark:bg-violet-950/20 rounded-2xl border-2 transition-all duration-200 ${
        selected
          ? 'border-violet-500 shadow-lg shadow-violet-500/20'
          : 'border-violet-200 dark:border-violet-800 shadow-md'
      }`}
      onDoubleClick={handleDoubleClick}
    >
      <div className="absolute left-0 top-0 h-full w-3 z-10 rounded-l-2xl">
        <Handle type="target" position={Position.Left} id="target-left" className={STRIP_HANDLE_CLS} />
      </div>

      <div className="absolute right-0 top-0 h-full w-3 z-10 rounded-r-2xl">
        <Handle type="source" position={Position.Right} id="source-right" className={STRIP_HANDLE_CLS} />
      </div>

      <div className="px-3 py-2.5 relative overflow-hidden rounded-xl">
        <div className="absolute top-0 left-0 w-full h-1 rounded-t-xl bg-violet-400 dark:bg-violet-600" />

        <div className="mt-1 flex items-center gap-2">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center overflow-hidden ring-2 ring-violet-300 dark:ring-violet-700">
            {data.approverAvatarUrl ? (
              <img
                src={data.approverAvatarUrl}
                alt={data.approverName ?? ''}
                className="w-full h-full object-cover rounded-full"
              />
            ) : data.approverName ? (
              <span className="text-xs font-bold text-violet-600 dark:text-violet-400">
                {data.approverName.charAt(0).toUpperCase()}
              </span>
            ) : (
              <CheckSquare className="w-4 h-4 text-violet-500" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-violet-800 dark:text-violet-200 truncate">
              {data.approverName ?? 'Aprovador'}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {decision ? (
                <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold border px-1.5 py-0.5 rounded-full lowercase ${decision.cls}`}>
                  {decision.label === 'aprovado' ? <Check className="w-2.5 h-2.5" /> : <X className="w-2.5 h-2.5" />}
                  {decision.label}
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/50 border border-violet-200 dark:border-violet-800 px-1.5 py-0.5 rounded-full lowercase">
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
