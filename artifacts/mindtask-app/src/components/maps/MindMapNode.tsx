import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { getStatusColorHex } from '@/lib/utils';
import { CheckSquare, Calendar, User } from 'lucide-react';
import { format } from 'date-fns';

interface MindMapNodeProps {
  data: {
    title: string;
    statusVisual: string;
    taskId?: string | null;
    taskDueDate?: string | null;
    taskAssigneeName?: string | null;
  };
  selected: boolean;
}

function MindMapNode({ data, selected }: MindMapNodeProps) {
  const color = getStatusColorHex(data.statusVisual);
  const isMuted = data.statusVisual === 'no_task';

  const handleCls = [
    'transition-all opacity-0 group-hover/node:opacity-100',
    '!w-4 !h-4 !border-2 !rounded-full !bg-background',
    'hover:!opacity-100 hover:!scale-125',
  ].join(' ');
  const handleStyleLeft  = { borderColor: color, left:  -12 };
  const handleStyleRight = { borderColor: color, right: -12 };

  const dueDateStr = data.taskDueDate
    ? format(new Date(data.taskDueDate), 'dd/MM/yy')
    : null;

  const isOverdue =
    data.taskDueDate &&
    new Date(data.taskDueDate) < new Date() &&
    data.statusVisual !== 'completed';

  return (
    <div
      className={`group/node min-w-[220px] max-w-[280px] bg-card rounded-2xl shadow-lg border-2 transition-all duration-200 ${selected ? 'shadow-xl scale-[1.02]' : ''}`}
      style={{
        borderColor: selected ? color : 'hsl(var(--border))',
        boxShadow: selected
          ? `0 10px 25px -5px ${color.replace(')', ' / 0.3)')}`
          : undefined,
      }}
    >
      <Handle type="target" position={Position.Left}  id="target-left"  className={handleCls} style={handleStyleLeft} />
      <Handle type="target" position={Position.Right} id="target-right" className={handleCls} style={handleStyleRight} />
      <Handle type="source" position={Position.Left}  id="source-left"  className={handleCls} style={handleStyleLeft} />
      <Handle type="source" position={Position.Right} id="source-right" className={handleCls} style={handleStyleRight} />

      <div className="p-4 relative overflow-hidden rounded-xl">
        <div
          className="absolute top-0 left-0 w-full h-1.5 rounded-t-xl"
          style={{ backgroundColor: color, opacity: isMuted ? 0.3 : 1 }}
        />

        <div className="flex items-start justify-between gap-3 mt-2">
          <h3 className="font-display font-bold text-foreground text-base leading-tight break-words pr-2">
            {data.title}
          </h3>
          {data.taskId && (
            <div
              className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center shadow-sm"
              style={{
                backgroundColor: `${color.replace(')', ' / 0.15)')}`,
                color,
              }}
            >
              <CheckSquare className="w-3.5 h-3.5" />
            </div>
          )}
        </div>

        {(dueDateStr || data.taskAssigneeName) && (
          <div className="mt-3 flex flex-col gap-1.5">
            {data.taskAssigneeName && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <User className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{data.taskAssigneeName}</span>
              </div>
            )}
            {dueDateStr && (
              <div className={`flex items-center gap-1.5 text-[11px] font-medium ${isOverdue ? 'text-red-500' : 'text-muted-foreground'}`}>
                <Calendar className="w-3 h-3 flex-shrink-0" />
                <span>{dueDateStr}</span>
              </div>
            )}
          </div>
        )}

        <div className="mt-3 pt-3 border-t flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {data.statusVisual.replace('_', ' ')}
          </span>
        </div>
      </div>
    </div>
  );
}

export default memo(MindMapNode);
