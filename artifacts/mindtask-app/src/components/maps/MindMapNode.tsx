import { memo, useRef, useLayoutEffect, useState, useEffect } from 'react';
import { Handle, Position } from 'reactflow';
import { getStatusColorHex } from '@/lib/utils';
import { Maximize2, Calendar, User, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useUpdateCard, useUpdateTaskStatus, useUpdateTaskDetails, useListWorkspaceMembers } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

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
    workspaceId?: string;
    mapId?: string;
    onOpen?: (id: string) => void;
    onAddChild?: (id: string) => void;
    onInlineUpdate?: (cardId: string, patch: Partial<{
      title: string;
      statusVisual: string;
      taskAssigneeName: string | null;
      taskAssigneeAvatarUrl: string | null;
      taskDueDate: string | null;
    }>) => void;
  };
  selected: boolean;
}

const STATUS_OPTIONS = [
  { value: 'pending', label: 'pendente' },
  { value: 'in_progress', label: 'em andamento' },
  { value: 'completed', label: 'concluída' },
  { value: 'blocked', label: 'interrompida' },
];

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
  const hasTask = !!data.taskId;
  const workspaceId = data.workspaceId ?? '';
  const mapId = data.mapId ?? '';

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

  const queryClient = useQueryClient();
  const mapQueryKey = [`/api/workspaces/${workspaceId}/maps/${mapId}`];

  const updateCardMut = useUpdateCard();
  const updateTaskStatusMut = useUpdateTaskStatus();
  const updateTaskDetailsMut = useUpdateTaskDetails();
  const { data: members } = useListWorkspaceMembers(workspaceId, {
    query: { enabled: !!workspaceId && hasTask },
  });

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(data.title);
  const [editingAssignee, setEditingAssignee] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [dueDateValue, setDueDateValue] = useState(
    data.taskDueDate ? data.taskDueDate.split('T')[0] : '',
  );

  useEffect(() => {
    setTitleValue(data.title);
  }, [data.title]);

  useEffect(() => {
    setDueDateValue(data.taskDueDate ? data.taskDueDate.split('T')[0] : '');
  }, [data.taskDueDate]);

  const handleTitleBlur = () => {
    setEditingTitle(false);
    const trimmed = titleValue.trim();
    if (!trimmed || trimmed === data.title) return;
    data.onInlineUpdate?.(id, { title: trimmed });
    updateCardMut.mutate(
      { workspaceId, mapId, cardId: id, data: { title: trimmed } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: mapQueryKey }) },
    );
  };

  const handleStatusChange = (newStatus: string) => {
    setEditingStatus(false);
    if (newStatus === data.statusVisual) return;
    data.onInlineUpdate?.(id, { statusVisual: newStatus });
    if (data.taskId) {
      updateTaskStatusMut.mutate(
        { workspaceId, taskId: data.taskId, data: { status: newStatus as 'pending' | 'in_progress' | 'completed' | 'blocked' } },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: mapQueryKey }) },
      );
    }
  };

  const handleAssigneeChange = (userId: string) => {
    setEditingAssignee(false);
    const member = members?.find(m => m.userId === userId);
    if (!member) return;
    const assigneeName = member.user.name;
    const assigneeAvatar = member.user.avatarUrl ?? null;
    data.onInlineUpdate?.(id, {
      taskAssigneeName: assigneeName,
      taskAssigneeAvatarUrl: assigneeAvatar,
    });
    if (data.taskId) {
      updateTaskDetailsMut.mutate(
        { workspaceId, taskId: data.taskId, data: { assignedTo: userId } },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: mapQueryKey }) },
      );
    }
  };

  const handleDueDateBlur = () => {
    setEditingDueDate(false);
    if (!dueDateValue) {
      if (data.taskDueDate) {
        data.onInlineUpdate?.(id, { taskDueDate: null });
        if (data.taskId) {
          updateTaskDetailsMut.mutate(
            { workspaceId, taskId: data.taskId, data: { dueDate: null } },
            { onSuccess: () => queryClient.invalidateQueries({ queryKey: mapQueryKey }) },
          );
        }
      }
      return;
    }
    const isoDate = new Date(dueDateValue).toISOString();
    if (isoDate === data.taskDueDate) return;
    data.onInlineUpdate?.(id, { taskDueDate: isoDate });
    if (data.taskId) {
      updateTaskDetailsMut.mutate(
        { workspaceId, taskId: data.taskId, data: { dueDate: new Date(dueDateValue) } },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: mapQueryKey }) },
      );
    }
  };

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
          {editingTitle ? (
            <input
              autoFocus
              className="nodrag font-display font-bold text-foreground text-base leading-tight break-words pr-2 bg-transparent border-b border-primary outline-none w-full min-w-0"
              value={titleValue}
              onChange={e => setTitleValue(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } if (e.key === 'Escape') { setTitleValue(data.title); setEditingTitle(false); } }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <h3
              className="font-display font-bold text-foreground text-base leading-tight break-words pr-2 cursor-text hover:bg-muted/30 rounded px-0.5 transition-colors"
              title="Clique para editar o título"
              onClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}
            >
              {data.title}
            </h3>
          )}
          <button
            className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover/node:opacity-100 transition-all hover:scale-110 nodrag"
            style={{
              backgroundColor: `${color.replace(')', ' / 0.12)')}`,
              color,
            }}
            title="Expandir card"
            onClick={(e) => { e.stopPropagation(); data.onOpen?.(id); }}
          >
            <Maximize2 className="w-3.5 h-3.5" />
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

        {/* Assignee & Due Date */}
        {(hasAssignee || hasDueDate || hasTask) ? (
          <div className="mt-3 flex items-center justify-between gap-2">
            {hasTask && editingAssignee ? (
              <div className="relative nodrag flex-shrink-0">
                <select
                  autoFocus
                  className="text-[11px] bg-card border border-border rounded-lg px-2 py-1 outline-none cursor-pointer max-w-[130px]"
                  defaultValue=""
                  onBlur={() => setEditingAssignee(false)}
                  onChange={e => { if (e.target.value) handleAssigneeChange(e.target.value); }}
                  onClick={e => e.stopPropagation()}
                >
                  <option value="">— responsável —</option>
                  {members?.map(m => (
                    <option key={m.userId} value={m.userId}>{m.user.name}</option>
                  ))}
                </select>
              </div>
            ) : hasAssignee ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={`flex items-center cursor-pointer nodrag ${hasTask ? 'hover:ring-2 hover:ring-primary/40 rounded-full transition-all' : 'cursor-default'}`}
                      onClick={(e) => { if (hasTask) { e.stopPropagation(); setEditingAssignee(true); } }}
                      title={hasTask ? 'Clique para alterar responsável' : undefined}
                    >
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
                  <TooltipContent>{data.taskAssigneeName}{hasTask ? ' (clique para editar)' : ''}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : hasTask ? (
              <button
                className="nodrag flex items-center gap-1 text-[11px] text-muted-foreground opacity-0 group-hover/node:opacity-100 hover:text-foreground transition-all"
                title="Adicionar responsável"
                onClick={(e) => { e.stopPropagation(); setEditingAssignee(true); }}
              >
                <div className="w-7 h-7 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted transition-colors">
                  <User className="w-3.5 h-3.5" />
                </div>
              </button>
            ) : null}

            {hasTask && editingDueDate ? (
              <input
                type="date"
                autoFocus
                className="nodrag text-[11px] bg-card border border-border rounded-lg px-2 py-1 outline-none cursor-pointer ml-auto"
                value={dueDateValue}
                onChange={e => setDueDateValue(e.target.value)}
                onBlur={handleDueDateBlur}
                onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } if (e.key === 'Escape') { setDueDateValue(data.taskDueDate ? data.taskDueDate.split('T')[0] : ''); setEditingDueDate(false); } }}
                onClick={e => e.stopPropagation()}
              />
            ) : hasDueDate ? (
              <div
                className={`flex items-center gap-1 text-[11px] font-medium ml-auto cursor-pointer rounded px-1 transition-colors ${isOverdue ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'} ${hasTask ? '' : 'cursor-default'} nodrag`}
                title={hasTask ? 'Clique para editar prazo' : undefined}
                onClick={(e) => { if (hasTask) { e.stopPropagation(); setEditingDueDate(true); } }}
              >
                <Calendar className="w-3 h-3 flex-shrink-0" />
                <span>{dueDateStr}</span>
              </div>
            ) : hasTask ? (
              <button
                className="nodrag flex items-center gap-1 text-[11px] text-muted-foreground opacity-0 group-hover/node:opacity-100 hover:text-foreground transition-all ml-auto"
                title="Adicionar prazo"
                onClick={(e) => { e.stopPropagation(); setEditingDueDate(true); }}
              >
                <Calendar className="w-3 h-3" />
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Status badge */}
        <div className="mt-3 pt-3 border-t flex items-center gap-2 nodrag">
          {hasTask && editingStatus ? (
            <select
              autoFocus
              className="text-[10px] font-semibold tracking-wider bg-card border border-border rounded-lg px-2 py-1 outline-none cursor-pointer lowercase"
              defaultValue={data.statusVisual}
              onBlur={() => setEditingStatus(false)}
              onChange={e => handleStatusChange(e.target.value)}
              onClick={e => e.stopPropagation()}
            >
              {STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : (
            <div
              className={`flex items-center gap-2 ${hasTask ? 'cursor-pointer hover:bg-muted/30 rounded px-1 -mx-1 transition-colors' : 'cursor-default'}`}
              title={hasTask ? 'Clique para alterar status' : undefined}
              onClick={(e) => { if (hasTask) { e.stopPropagation(); setEditingStatus(true); } }}
            >
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="text-[10px] font-semibold tracking-wider text-muted-foreground lowercase">
                {statusLabel(data.statusVisual)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(MindMapNode);
