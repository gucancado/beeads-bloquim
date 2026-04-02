import { memo, useRef, useLayoutEffect, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position } from 'reactflow';
import { getStatusColorHex } from '@/lib/utils';
import { TASK_STATUS_ORDER, getStatusLabel as getStatusLabelCentralized } from '@/lib/taskStatusConstants';
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
    taskCompletedAt?: string | null;
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
    onEditingChange?: (cardId: string, isEditing: boolean) => void;
    isTerminalNode?: boolean;
  };
  selected: boolean;
}

const STATUS_OPTIONS = TASK_STATUS_ORDER;

function statusLabel(s: string) {
  if (s === 'overdue') return 'vencida';
  if (s === 'no_task') return 'sem tarefa';
  return getStatusLabelCentralized(s);
}


function MindMapNode({ id, data, selected }: MindMapNodeProps) {
  const color = getStatusColorHex(data.statusVisual);
  const isMuted = data.statusVisual === 'no_task';
  const hasTask = !!data.taskId;
  const workspaceId = data.workspaceId ?? '';
  const mapId = data.mapId ?? '';
  const isTerminalNode = data.isTerminalNode !== false;

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

  let dueDateStr: string | null = null;
  if (data.taskDueDate) {
    try {
      dueDateStr = format(new Date(data.taskDueDate.slice(0, 10) + 'T00:00:00'), 'dd/MM/yy');
    } catch {
      dueDateStr = null;
    }
  }

  const isOverdue =
    data.taskDueDate &&
    new Date(data.taskDueDate.slice(0, 10) + 'T23:59:59') < new Date() &&
    data.statusVisual !== 'completed';

  const hasAssignee = !!data.taskAssigneeName;
  const hasDueDate = !!dueDateStr;

  const queryClient = useQueryClient();
  const mapQueryKey = [`/api/workspaces/${workspaceId}/maps/${mapId}`];

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: mapQueryKey });
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}/cards/${id}`] });
    if (data.taskId) {
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks/${data.taskId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks`] });
      queryClient.invalidateQueries({ queryKey: [`task-activities`, workspaceId, data.taskId] });
    }
  }, [queryClient, mapQueryKey, workspaceId, mapId, id, data.taskId]);

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
  const [statusDropdownPos, setStatusDropdownPos] = useState({ top: 0, left: 0 });
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [dueDateValue, setDueDateValue] = useState(
    data.taskDueDate ? data.taskDueDate.split('T')[0] : '',
  );

  useEffect(() => {
    if (!editingStatus) return;
    const close = () => setEditingStatus(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [editingStatus]);

  useEffect(() => {
    setTitleValue(data.title);
  }, [data.title]);

  useEffect(() => {
    setDueDateValue(data.taskDueDate ? data.taskDueDate.split('T')[0] : '');
  }, [data.taskDueDate]);

  const handleTitleBlur = () => {
    setEditingTitle(false);
    data.onEditingChange?.(id, false);
    const trimmed = titleValue.trim();
    if (!trimmed || trimmed === data.title) return;
    data.onInlineUpdate?.(id, { title: trimmed });
    updateCardMut.mutate(
      { workspaceId, mapId, cardId: id, data: { title: trimmed } },
      { onSuccess: invalidateAll },
    );
  };

  const handleStatusChange = (newStatus: string) => {
    setEditingStatus(false);
    if (newStatus === data.statusVisual) return;
    data.onInlineUpdate?.(id, { statusVisual: newStatus });
    if (data.taskId) {
      updateTaskStatusMut.mutate(
        { workspaceId, mapId, cardId: id, data: { status: newStatus as 'pending' | 'in_progress' | 'completed' | 'blocked' | 'draft' } },
        { onSuccess: invalidateAll },
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
        { workspaceId, mapId, cardId: id, data: { assignedTo: userId } },
        { onSuccess: invalidateAll },
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
            { workspaceId, mapId, cardId: id, data: { dueDate: null as any } },
            { onSuccess: invalidateAll },
          );
        }
      }
      return;
    }
    const isoDate = dueDateValue + "T12:00:00.000Z";
    if (data.taskDueDate && data.taskDueDate.slice(0, 10) === dueDateValue) return;
    data.onInlineUpdate?.(id, { taskDueDate: isoDate });
    if (data.taskId) {
      updateTaskDetailsMut.mutate(
        { workspaceId, mapId, cardId: id, data: { dueDate: isoDate } },
        { onSuccess: invalidateAll },
      );
    }
  };

  const isCompleted = data.statusVisual === 'completed';
  const isCancelled = data.statusVisual === 'blocked';
  const isMutedNode = isCompleted || isCancelled;

  if (isMutedNode) {
    let completedDateStr: string | null = null;
    if (isCompleted && data.taskCompletedAt) {
      try {
        completedDateStr = format(new Date(data.taskCompletedAt), 'dd/MM/yyyy');
      } catch {
        completedDateStr = null;
      }
    }
    const mutedHoverBorder = isCompleted ? 'hover:border-emerald-300' : 'hover:border-slate-400';
    const mutedIconColor = isCompleted ? 'group-hover/node:text-emerald-600' : 'group-hover/node:text-slate-500';
    const mutedTextColor = isCompleted ? 'group-hover/node:text-emerald-600' : 'group-hover/node:text-slate-500';
    const statusText = isCompleted
      ? (completedDateStr ? `concluído em ${completedDateStr}` : 'concluído')
      : getStatusLabelCentralized('blocked');
    return (
      <div
        className={`group/node relative min-w-[180px] max-w-[240px] rounded-2xl border-2 transition-all duration-300 hover:shadow-md ${mutedHoverBorder} ${selected ? 'shadow-md scale-[1.02]' : 'shadow-sm'}`}
        style={{
          backgroundColor: '#f3f4f6',
          borderColor: selected ? '#9ca3af' : undefined,
        }}
        onDoubleClick={(e) => { e.stopPropagation(); data.onOpen?.(id); }}
      >
        {/* Add child button — floats outside card to the right */}
        {isTerminalNode && (
          <div
            className="nodrag nopan absolute hover:scale-110 transition-transform duration-150"
            style={{ right: '-4rem', top: 'calc(50% - 24px)' }}
          >
            {/* Visual circle — pointer-events-none so the Handle underneath captures events */}
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center opacity-0 group-hover/node:opacity-100 transition-opacity duration-150 shadow-lg pointer-events-none"
              style={{ backgroundColor: '#7c3aed', color: '#fff' }}
            >
              <Plus className="w-6 h-6" />
            </div>
            {/* Transparent source Handle covering the full button area */}
            <Handle
              type="source"
              position={Position.Right}
              id="plus-right"
              className="!absolute !inset-0 !w-full !h-full !rounded-full !border-none !bg-transparent !transform-none !opacity-0 !cursor-pointer"
              isConnectable
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); data.onAddChild?.(id); }}
            />
          </div>
        )}

        {/* Invisible handles for edge anchoring only — no interaction */}
        <Handle type="target" position={Position.Left} id="target-left" className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-1 !h-1" />
        <Handle type="source" position={Position.Right} id="source-right" className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-1 !h-1" />

        {/* Card content */}
        <div className="px-4 py-3 relative overflow-hidden rounded-xl">
          <div className="flex items-start justify-between gap-2">
            <h3
              className="font-display font-medium text-xs leading-tight break-words pr-1 text-gray-400 transition-all duration-300 group-hover/node:text-gray-700 group-hover/node:opacity-100 group-hover/node:text-sm group-hover/node:font-bold"
              style={{ opacity: 0.7 }}
            >
              {data.title}
            </h3>
            <button
              className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover/node:opacity-100 transition-all hover:scale-110 nodrag"
              style={{ backgroundColor: '#e5e7eb', color: '#9ca3af' }}
              title="Expandir card"
              onClick={(e) => { e.stopPropagation(); data.onOpen?.(id); }}
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          </div>

          <div className="mt-2 flex items-center gap-2">
            {data.taskAssigneeAvatarUrl ? (
              <img
                src={data.taskAssigneeAvatarUrl}
                alt={data.taskAssigneeName ?? ''}
                className="completed-avatar rounded-full object-cover flex-shrink-0 transition-all duration-300"
              />
            ) : data.taskAssigneeName ? (
              <div className="completed-avatar-placeholder rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0 transition-all duration-300">
                <User className={`w-3 h-3 text-gray-400 transition-colors duration-300 ${mutedIconColor}`} />
              </div>
            ) : null}
            <span className={`text-[10px] text-gray-400 transition-colors duration-300 ${mutedTextColor}`}>
              {statusText}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group/node relative min-w-[220px] max-w-[280px] bg-card rounded-2xl shadow-lg border-2 transition-all duration-200 ${selected ? 'shadow-xl scale-[1.02]' : ''}`}
      style={{
        borderColor: selected ? color : 'hsl(var(--border))',
        boxShadow: selected
          ? `0 10px 25px -5px ${color.replace(')', ' / 0.3)')}`
          : undefined,
      }}
      onDoubleClick={(e) => { e.stopPropagation(); data.onOpen?.(id); }}
    >
      {/* Add child button — floats outside card to the right */}
      {isTerminalNode && (
        <div
          className="nodrag nopan absolute hover:scale-110 transition-transform duration-150"
          style={{ right: '-4rem', top: 'calc(50% - 24px)' }}
        >
          {/* Visual circle — pointer-events-none so the Handle underneath captures events */}
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center opacity-0 group-hover/node:opacity-100 transition-opacity duration-150 shadow-lg pointer-events-none"
            style={{ backgroundColor: '#7c3aed', color: '#fff' }}
          >
            <Plus className="w-6 h-6" />
          </div>
          {/* Transparent source Handle covering the full button area */}
          <Handle
            type="source"
            position={Position.Right}
            id="plus-right"
            className="!absolute !inset-0 !w-full !h-full !rounded-full !border-none !bg-transparent !transform-none !opacity-0 !cursor-pointer"
            isConnectable
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); data.onAddChild?.(id); }}
          />
        </div>
      )}

      {/* Invisible handles for edge anchoring only — no interaction */}
      <Handle type="target" position={Position.Left} id="target-left" className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-1 !h-1" />
      <Handle type="source" position={Position.Right} id="source-right" className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-1 !h-1" />

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
              onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } if (e.key === 'Escape') { setTitleValue(data.title); setEditingTitle(false); data.onEditingChange?.(id, false); } }}
              onClick={e => e.stopPropagation()}
              onDoubleClick={e => e.stopPropagation()}
            />
          ) : (
            <h3
              className="font-display font-bold text-foreground text-base leading-tight break-words pr-2 cursor-text hover:bg-muted/30 rounded px-0.5 transition-colors"
              title="Clique para editar o título"
              onClick={(e) => { e.stopPropagation(); setEditingTitle(true); data.onEditingChange?.(id, true); }}
              onDoubleClick={(e) => e.stopPropagation()}
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
                    onClick={(e) => { e.stopPropagation(); setMaxLines(9999); }}
                  >
                    ver mais
                  </button>
                </div>
              </>
            )}
            {!isTruncated && maxLines > 3 && (
              <div className="flex justify-center mt-0.5">
                <button
                  className="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors nodrag"
                  onClick={(e) => { e.stopPropagation(); setMaxLines(3); }}
                >
                  ver menos
                </button>
              </div>
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
                      onDoubleClick={(e) => e.stopPropagation()}
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
                onDoubleClick={(e) => e.stopPropagation()}
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
          <div
            className={`flex items-center gap-2 ${hasTask ? 'cursor-pointer hover:bg-muted/30 rounded px-1 -mx-1 transition-colors' : 'cursor-default'}`}
            title={hasTask ? 'Clique para alterar status' : undefined}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              if (!hasTask) return;
              e.stopPropagation();
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const top = Math.min(rect.bottom + 4, window.innerHeight - 200);
              const left = Math.max(4, Math.min(rect.left, window.innerWidth - 180));
              setStatusDropdownPos({ top, left });
              setEditingStatus(v => !v);
            }}
          >
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-[10px] font-semibold tracking-wider text-muted-foreground lowercase">
              {statusLabel(data.statusVisual)}
            </span>
          </div>
          {editingStatus && createPortal(
            <>
              <div className="fixed inset-0 z-[9998]" onClick={(e) => { e.stopPropagation(); setEditingStatus(false); }} />
              <div className="fixed z-[9999] bg-card border border-border rounded-xl shadow-lg py-1 min-w-[140px]" style={{ top: statusDropdownPos.top, left: statusDropdownPos.left }}>
                {STATUS_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={(e) => { e.stopPropagation(); handleStatusChange(opt.value); }}
                    className={`w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-muted transition-colors flex items-center gap-2 ${data.statusVisual === opt.value ? 'opacity-60' : ''}`}
                  >
                    <span className={`inline-block w-2 h-2 rounded-full ${opt.dot}`} />
                    {opt.label}
                  </button>
                ))}
              </div>
            </>,
            document.body
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(MindMapNode);
