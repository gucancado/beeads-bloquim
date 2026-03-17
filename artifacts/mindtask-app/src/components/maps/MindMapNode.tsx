import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { getStatusColorHex } from '@/lib/utils';
import { CheckSquare } from 'lucide-react';

interface MindMapNodeProps {
  data: {
    title: string;
    description?: string;
    statusVisual: string;
    taskId?: string | null;
  };
  selected: boolean;
}

function MindMapNode({ data, selected }: MindMapNodeProps) {
  const color = getStatusColorHex(data.statusVisual);
  const isMuted = data.statusVisual === 'no_task';

  const handleCls = 'transition-opacity opacity-0 group-hover/node:opacity-100 !w-3 !h-3 !border-2 !bg-background hover:!opacity-100 hover:!scale-125';
  const handleStyle = { borderColor: color };

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
      {/* Target handles — receive connections from other nodes */}
      <Handle type="target" position={Position.Top}    id="target-top"    className={handleCls} style={handleStyle} />
      <Handle type="target" position={Position.Bottom} id="target-bottom" className={handleCls} style={handleStyle} />
      <Handle type="target" position={Position.Left}   id="target-left"   className={handleCls} style={handleStyle} />
      <Handle type="target" position={Position.Right}  id="target-right"  className={handleCls} style={handleStyle} />

      {/* Source handles — initiate connections to other nodes */}
      <Handle type="source" position={Position.Top}    id="source-top"    className={handleCls} style={handleStyle} />
      <Handle type="source" position={Position.Bottom} id="source-bottom" className={handleCls} style={handleStyle} />
      <Handle type="source" position={Position.Left}   id="source-left"   className={handleCls} style={handleStyle} />
      <Handle type="source" position={Position.Right}  id="source-right"  className={handleCls} style={handleStyle} />

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

        {data.description && (
          <p className="mt-2 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {data.description}
          </p>
        )}

        <div className="mt-4 pt-3 border-t flex items-center gap-2">
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
