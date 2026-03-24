import { memo, useRef, useLayoutEffect, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { getStatusColorHex } from '@/lib/utils';
import { Pencil, Calendar, User, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent?.trim() || '';
}

interface MindMapNodeProps {
  id: string;
  data: {
    title: string;
    statusVisual: string;
    taskId?: string | null;
    taskDueDate?: string | null;
    taskAssigneeName?: string | null;
    taskAssigneeAvatarUrl?: string | null;
    taskDescription?: string | null;
    onOpen?: (id: string) => void;
    onAddChild?: (id: string) => void;
  };
  selected: boolean;
}

function statusLabel(s: string) {
  switch (s) {
    case 'pending': return 'pendente';
    case 'in_progress': return 'em andamento';
    case 'completed': return 'concluída';
    case 'overdue': return 'vencida';
    case 'blocked': return 'interrompida';
    case 'no_task': return 'sem tarefa';
    default: return s.replace('_', ' ');
  }
}

const STRIP_HANDLE_CLS = [
  '!absolute !inset-0 !w-full !h-full',
  '!border-none !bg-transparent !rounded-none !transform-none',
  '!opacity-100 !cursor-crosshair',
].join(' ');

function MindMapNode({ id, data, selected }: MindMapNodeProps) {
  const color = getStatusColorHex(data.statusVisual);
  const isMuted = data.statusVisual === 'no_task';
  const descRef = useRef<HTMLParagraphElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [maxLines, setMaxLines] = useState(3);
  const plainDescription = data.taskDescription ? stripHtml(data.taskDescription) : '';

  useLayoutEffect(() => {
    setMaxLines(3);
  }, [plainDescription]);

  useLayoutEffect(() => {
    const el = descRef.current;
    if (!el) return;
    setIsTruncated(el.scrollHeight > el.clientHeight + 1);
  }, [plainDescription, maxLines]);

  const dueDateStr = data.taskDueDate
    ? format(new Date(data.taskDueDate), 'dd/MM/yy')
    : null;

  const isOverdue =
    data.taskDueDate &&
    new Date(data.taskDueDate) < new Date() &&
    data.statusVisual !== 'completed';

  const hasAssignee = !!data.taskAssigneeName;
  const hasDueDate = !!dueDateStr;

  return (
    <div
      className={`group/node relative min-w-[220px] max-w-[280px] bg-card rounded-2xl shadow-lg border-2 transition-all duration-200 ${selected ? 'shadow-xl scale-[1.02]' : ''}`}
      style={{
        borderColor: selected ? color : 'hsl(var(--border))',
        boxShadow: selected
          ? `0 10px 25px -5px ${color.replace(')', ' / 0.3)')}`
          : undefined,
      }}
    >
      {/* Add child button — floats to the right, outside the card */}
      <button
        className="nodrag nopan absolute -right-11 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center opacity-0 group-hover/node:opacity-100 transition-all duration-150 hover:scale-110 shadow-lg"
        style={{ backgroundColor: color, color: '#fff' }}
        title="Adicionar card filho"
        onClick={(e) => { e.stopPropagation(); data.onAddChild?.(id); }}
      >
        <Plus className="w-4 h-4" />
      </button>

      {/* Left connection strip */}
      <div className="group/strip-l absolute left-0 top-0 h-full w-3 z-10 rounded-l-2xl">
        <div
          className="absolute inset-0 rounded-l-2xl opacity-0 group-hover/strip-l:opacity-30 transition-opacity duration-150 pointer-events-none"
          style={{ backgroundColor: color }}
        />
        <Handle type="target" position={Position.Left} id="target-left" className={STRIP_HANDLE_CLS} />
        <Handle type="source" position={Position.Left} id="source-left" className={STRIP_HANDLE_CLS} />
      </div>

      {/* Right connection strip */}
      <div className="group/strip-r absolute right-0 top-0 h-full w-3 z-10 rounded-r-2xl">
        <div
          className="absolute inset-0 rounded-r-2xl opacity-0 group-hover/strip-r:opacity-30 transition-opacity duration-150 pointer-events-none"
          style={{ backgroundColor: color }}
        />
        <Handle type="target" position={Position.Right} id="target-right" className={STRIP_HANDLE_CLS} />
        <Handle type="source" position={Position.Right} id="source-right" className={STRIP_HANDLE_CLS} />
      </div>

      {/* Card content */}
      <div className="px-5 py-4 relative overflow-hidden rounded-xl">
        <div
          className="absolute top-0 left-0 w-full h-1.5 rounded-t-xl"
          style={{ backgroundColor: color, opacity: isMuted ? 0.3 : 1 }}
        />

        <div className="flex items-start justify-between gap-3 mt-2">
          <h3 className="font-display font-bold text-foreground text-base leading-tight break-words pr-2">
            {data.title}
          </h3>
          <button
            className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover/node:opacity-100 transition-all hover:scale-110 nodrag"
            style={{
              backgroundColor: `${color.replace(')', ' / 0.12)')}`,
              color,
            }}
            title="Editar card"
            onClick={(e) => { e.stopPropagation(); data.onOpen?.(id); }}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>

        {plainDescription && (
          <div className="mt-2 relative nodrag">
            <p
              ref={descRef}
              className="text-[11px] text-muted-foreground leading-relaxed break-words overflow-hidden"
              style={{
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: maxLines,
              }}
            >
              {plainDescription}
            </p>
            {isTruncated && (
              <>
                <div
                  className="absolute left-0 w-full h-6 pointer-events-none"
                  style={{
                    bottom: '20px',
                    background: 'linear-gradient(to bottom, transparent, hsl(var(--card)))',
                  }}
                />
                <div className="flex justify-center mt-0.5">
                  <button
                    className="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors nodrag"
                    onClick={(e) => { e.stopPropagation(); setMaxLines(prev => prev + 10); }}
                  >
                    ver mais
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {(hasAssignee || hasDueDate) && (
          <div className="mt-3 flex items-center justify-between gap-2">
            {hasAssignee && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center cursor-default nodrag">
                      {data.taskAssigneeAvatarUrl ? (
                        <img
                          src={data.taskAssigneeAvatarUrl}
                          alt={data.taskAssigneeName ?? ''}
                          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          <User className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>{data.taskAssigneeName}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {hasDueDate && (
              <div className={`flex items-center gap-1 text-[11px] font-medium ml-auto ${isOverdue ? 'text-red-500' : 'text-muted-foreground'}`}>
                <Calendar className="w-3 h-3 flex-shrink-0" />
                <span>{dueDateStr}</span>
              </div>
            )}
          </div>
        )}

        <div className="mt-3 pt-3 border-t flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-[10px] font-semibold tracking-wider text-muted-foreground lowercase">
            {statusLabel(data.statusVisual)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default memo(MindMapNode);
