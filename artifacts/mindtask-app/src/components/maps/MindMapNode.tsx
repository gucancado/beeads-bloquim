import { memo, useRef, useLayoutEffect, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position } from 'reactflow';
import { getStatusColorHex, formatDueDate } from '@/lib/utils';
import { TASK_STATUS_ORDER, getStatusLabel as getStatusLabelCentralized } from '@/lib/taskStatusConstants';
import { Maximize2, Calendar, User, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useUpdateCard, useUpdateTaskStatus, useUpdateTaskDetails, useListWorkspaceMembers } from '@workspace/api-client-react';
import { AssigneeAvatarPicker } from '@/components/tasks/AssigneeAvatarPicker';
import { useQueryClient } from '@tanstack/react-query';

function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent?.trim() || '';
}

interface NodeColors {
  hex: string;
  bgLight: string;
  borderNormal: string;
  borderSelected: string;
  shadowSelected: string;
  hoverBorder: string;
}

function getNodeColors(status: string): NodeColors {
  switch (status) {
    case 'pending':
      return {
        hex: getStatusColorHex('pending'),
        bgLight: 'bg-blue-50 dark:bg-blue-950/20',
        borderNormal: 'border-blue-200 dark:border-blue-800',
        borderSelected: 'border-blue-500',
        shadowSelected: `0 0 0 3px ${getStatusColorHex('pending').replace(')', ' / 0.35)')}, 0 8px 32px -4px ${getStatusColorHex('pending').replace(')', ' / 0.55)')}`,
        hoverBorder: 'hover:border-blue-300 dark:hover:border-blue-700',
      };
    case 'in_progress':
      return {
        hex: getStatusColorHex('in_progress'),
        bgLight: 'bg-amber-50 dark:bg-amber-950/20',
        borderNormal: 'border-amber-200 dark:border-amber-800',
        borderSelected: 'border-amber-500',
        shadowSelected: `0 0 0 3px ${getStatusColorHex('in_progress').replace(')', ' / 0.35)')}, 0 8px 32px -4px ${getStatusColorHex('in_progress').replace(')', ' / 0.55)')}`,
        hoverBorder: 'hover:border-amber-300 dark:hover:border-amber-700',
      };
    case 'completed':
      return {
        hex: getStatusColorHex('completed'),
        bgLight: 'bg-emerald-50 dark:bg-emerald-950/20',
        borderNormal: 'border-emerald-200 dark:border-emerald-800',
        borderSelected: 'border-emerald-500',
        shadowSelected: `0 0 0 3px ${getStatusColorHex('completed').replace(')', ' / 0.35)')}, 0 8px 32px -4px ${getStatusColorHex('completed').replace(')', ' / 0.55)')}`,
        hoverBorder: 'hover:border-emerald-300 dark:hover:border-emerald-700',
      };
    case 'blocked':
      return {
        hex: getStatusColorHex('blocked'),
        bgLight: 'bg-slate-50 dark:bg-slate-950/20',
        borderNormal: 'border-slate-200 dark:border-slate-700',
        borderSelected: 'border-slate-400',
        shadowSelected: `0 0 0 3px ${getStatusColorHex('blocked').replace(')', ' / 0.35)')}, 0 8px 32px -4px ${getStatusColorHex('blocked').replace(')', ' / 0.55)')}`,
        hoverBorder: 'hover:border-slate-400 dark:hover:border-slate-500',
      };
    case 'overdue':
      return {
        hex: getStatusColorHex('overdue'),
        bgLight: 'bg-red-50 dark:bg-red-950/20',
        borderNormal: 'border-red-200 dark:border-red-800',
        borderSelected: 'border-red-500',
        shadowSelected: `0 0 0 3px ${getStatusColorHex('overdue').replace(')', ' / 0.35)')}, 0 8px 32px -4px ${getStatusColorHex('overdue').replace(')', ' / 0.55)')}`,
        hoverBorder: 'hover:border-red-300 dark:hover:border-red-700',
      };
    case 'draft':
      return {
        hex: getStatusColorHex('draft'),
        bgLight: 'bg-purple-50 dark:bg-purple-950/20',
        borderNormal: 'border-purple-200 dark:border-purple-800',
        borderSelected: 'border-purple-500',
        shadowSelected: `0 0 0 3px ${getStatusColorHex('draft').replace(')', ' / 0.35)')}, 0 8px 32px -4px ${getStatusColorHex('draft').replace(')', ' / 0.55)')}`,
        hoverBorder: 'hover:border-purple-300 dark:hover:border-purple-700',
      };
    default:
      return {
        hex: getStatusColorHex('no_task'),
        bgLight: 'bg-slate-50 dark:bg-slate-950/20',
        borderNormal: 'border-slate-200 dark:border-slate-700',
        borderSelected: 'border-slate-400',
        shadowSelected: `0 0 0 3px ${getStatusColorHex('no_task').replace(')', ' / 0.35)')}, 0 8px 32px -4px ${getStatusColorHex('no_task').replace(')', ' / 0.55)')}`,
        hoverBorder: 'hover:border-slate-300 dark:hover:border-slate-600',
      };
  }
}

interface MindMapNodeProps {
  id: string;
  data: {
    title: string;
    statusVisual: string;
    taskId?: string | null;
    taskDueDate?: string | null;
    taskAssigneeName?: string | null;
    taskAssigneeId?: string | null;
    taskAssigneeAvatarUrl?: string | null;
    taskDescription?: string | null;
    taskCompletedAt?: string | null;
    taskParentApprovalStatus?: string | null;
    workspaceId?: string;
    mapId?: string;
    onOpen?: (id: string) => void;
    onAddChild?: (id: string) => void;
    onInlineUpdate?: (cardId: string, patch: Partial<{
      title: string;
      statusVisual: string;
      taskAssigneeName: string | null;
      taskAssigneeId: string | null;
      taskAssigneeAvatarUrl: string | null;
      taskDueDate: string | null;
    }>) => void;
    onEditingChange?: (cardId: string, isEditing: boolean) => void;
    onAutoFocusDone?: (cardId: string) => void;
    isTerminalNode?: boolean;
    autoFocusTitle?: boolean;
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
  const nodeColors = getNodeColors(data.statusVisual);
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
      dueDateStr = formatDueDate(data.taskDueDate);
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

  const titleInputRef = useRef<HTMLInputElement>(null);

  const shouldSelectOnEdit = useRef(false);

  useEffect(() => {
    if (!data.autoFocusTitle) return;
    shouldSelectOnEdit.current = true;
    setEditingTitle(true);
    data.onEditingChange?.(id, true);
  }, [data.autoFocusTitle]);

  useEffect(() => {
    if (!editingTitle || !shouldSelectOnEdit.current) return;
    shouldSelectOnEdit.current = false;
    const capturedId = id;
    const capturedOnDone = data.onAutoFocusDone;
    const raf = requestAnimationFrame(() => {
      const el = titleInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
      capturedOnDone?.(capturedId);
    });
    return () => cancelAnimationFrame(raf);
  }, [editingTitle]);

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
    if (userId === 'unassigned') {
      data.onInlineUpdate?.(id, {
        taskAssigneeName: null,
        taskAssigneeId: null,
        taskAssigneeAvatarUrl: null,
      });
      if (data.taskId) {
        updateTaskDetailsMut.mutate(
          { workspaceId, mapId, cardId: id, data: { assignedTo: null } },
          { onSuccess: invalidateAll },
        );
      }
      return;
    }
    const member = members?.find(m => m.userId === userId);
    if (!member) return;
    const assigneeName = member.user.name;
    const assigneeAvatar = member.user.avatarUrl ?? null;
    data.onInlineUpdate?.(id, {
      taskAssigneeName: assigneeName,
      taskAssigneeId: userId,
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
    const mutedIconColor = isCompleted ? 'group-hover/node:text-emerald-600' : 'group-hover/node:text-slate-500';
    const mutedTextColor = isCompleted ? 'group-hover/node:text-emerald-600' : 'group-hover/node:text-slate-500';
    const statusText = isCompleted
      ? (completedDateStr ? `concluído em ${completedDateStr}` : 'concluído')
      : getStatusLabelCentralized('blocked');
    return (
      <div
        className={`group/node relative min-w-[180px] max-w-[240px] rounded-2xl transition-all duration-300 hover:shadow-md ${nodeColors.hoverBorder} ${nodeColors.bgLight} ${selected ? `border-[3px] scale-[1.02] ${nodeColors.borderSelected}` : `border-2 ${nodeColors.borderNormal}`}`}
        style={selected ? { boxShadow: nodeColors.shadowSelected } : undefined}
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
              style={{ backgroundColor: nodeColors.hex, color: '#fff' }}
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
              className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover/node:opacity-100 transition-all hover:scale-110 nodrag cursor-pointer"
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
                <span className={`text-[10px] font-bold text-gray-500 transition-colors duration-300 ${mutedTextColor}`}>
                  {data.taskAssigneeName.charAt(0).toUpperCase()}
                </span>
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
      className={`group/node relative min-w-[220px] max-w-[280px] rounded-2xl shadow-lg transition-all duration-200 ${nodeColors.bgLight} ${selected ? `border-[3px] scale-[1.02] ${nodeColors.borderSelected}` : `border-2 ${nodeColors.borderNormal}`}`}
      style={{
        boxShadow: selected ? nodeColors.shadowSelected : undefined,
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
            style={{ backgroundColor: nodeColors.hex, color: '#fff' }}
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
        {data.statusVisual !== 'pending' && (
          <div
            className="absolute top-0 left-0 w-full h-1.5 rounded-t-xl"
            style={{ backgroundColor: color, opacity: isMuted ? 0.3 : 1 }}
          />
        )}

        <div className="flex items-start justify-between gap-3 mt-2">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              autoFocus
              autoCapitalize="none"
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
            className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover/node:opacity-100 transition-all hover:scale-110 nodrag cursor-pointer"
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
            {hasTask ? (
              <div
                className="nodrag flex-shrink-0"
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <AssigneeAvatarPicker
                  assignedTo={data.taskAssigneeId ?? ''}
                  members={members}
                  onSelect={handleAssigneeChange}
                />
              </div>
            ) : hasAssignee ? (
              <div className="flex items-center flex-shrink-0 nodrag">
                {data.taskAssigneeAvatarUrl ? (
                  <img
                    src={data.taskAssigneeAvatarUrl}
                    alt={data.taskAssigneeName ?? ''}
                    className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-muted-foreground">
                      {data.taskAssigneeName!.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
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
          <div className="flex flex-col gap-1">
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
            {data.taskParentApprovalStatus && (
              <div className={`flex items-center gap-1.5 px-1 ${
                data.taskParentApprovalStatus === 'approved' ? 'text-emerald-600 dark:text-emerald-400' :
                data.taskParentApprovalStatus === 'rejected' ? 'text-red-500 dark:text-red-400' :
                'text-amber-500 dark:text-amber-400'
              }`}>
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  data.taskParentApprovalStatus === 'approved' ? 'bg-emerald-500' :
                  data.taskParentApprovalStatus === 'rejected' ? 'bg-red-500' :
                  'bg-amber-500'
                }`} />
                <span className="text-[9px] font-semibold tracking-wider lowercase">
                  {data.taskParentApprovalStatus === 'in_approval' ? 'em aprovação' :
                   data.taskParentApprovalStatus === 'approved' ? 'aprovada' : 'reprovada'}
                </span>
              </div>
            )}
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
