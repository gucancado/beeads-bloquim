import { useRef, useLayoutEffect, useState, useEffect, cloneElement } from 'react';
import { getStatusColorHex, formatDueDate, addOneDayYmd } from '@/lib/utils';
import { DatePickerPopover } from '@/components/ui/date-picker-popover';
import { TASK_STATUS_ORDER, getStatusLabel as getStatusLabelCentralized, getStatusOrderEntry } from '@/lib/taskStatusConstants';
import { Maximize2, Calendar, Paperclip, ListChecks, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@beeads/ui";
import { AssigneeAvatarPicker, type AvatarPickerMember } from '@/components/tasks/AssigneeAvatarPicker';
import { useToast } from '@/hooks/use-toast';
import { EditableTitle } from '@/components/ui/editable-title';
import { Popover, PopoverContent, PopoverTrigger } from "@beeads/ui";

function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent?.trim() || '';
}

export interface NodeColors {
  hex: string;
  bgLight: string;
  borderNormal: string;
  borderSelected: string;
  shadowSelected: string;
  hoverBorder: string;
}

export function getNodeColors(status: string): NodeColors {
  switch (status) {
    case 'pending':
      return {
        hex: getStatusColorHex('pending'),
        bgLight: 'bg-slate-100 dark:bg-background',
        borderNormal: 'border-blue-200 dark:border-blue-800',
        borderSelected: 'border-blue-500',
        shadowSelected: `0 0 0 3px ${getStatusColorHex('pending').replace(')', ' / 0.35)')}, 0 8px 32px -4px ${getStatusColorHex('pending').replace(')', ' / 0.55)')}`,
        hoverBorder: 'hover:border-blue-300 dark:hover:border-blue-700',
      };
    case 'in_progress':
      return {
        hex: getStatusColorHex('in_progress'),
        bgLight: 'bg-slate-100 dark:bg-background',
        borderNormal: 'border-amber-200 dark:border-amber-800',
        borderSelected: 'border-amber-500',
        shadowSelected: `0 0 0 3px ${getStatusColorHex('in_progress').replace(')', ' / 0.35)')}, 0 8px 32px -4px ${getStatusColorHex('in_progress').replace(')', ' / 0.55)')}`,
        hoverBorder: 'hover:border-amber-300 dark:hover:border-amber-700',
      };
    case 'completed':
      return {
        hex: getStatusColorHex('completed'),
        bgLight: 'bg-emerald-50 dark:bg-emerald-950',
        borderNormal: 'border-emerald-200 dark:border-emerald-800',
        borderSelected: 'border-emerald-500',
        shadowSelected: `0 0 0 3px ${getStatusColorHex('completed').replace(')', ' / 0.35)')}, 0 8px 32px -4px ${getStatusColorHex('completed').replace(')', ' / 0.55)')}`,
        hoverBorder: 'hover:border-emerald-300 dark:hover:border-emerald-700',
      };
    case 'blocked':
      return {
        hex: getStatusColorHex('blocked'),
        bgLight: 'bg-slate-50 dark:bg-slate-950',
        borderNormal: 'border-slate-200 dark:border-slate-700',
        borderSelected: 'border-slate-400',
        shadowSelected: `0 0 0 3px ${getStatusColorHex('blocked').replace(')', ' / 0.35)')}, 0 8px 32px -4px ${getStatusColorHex('blocked').replace(')', ' / 0.55)')}`,
        hoverBorder: 'hover:border-slate-400 dark:hover:border-slate-500',
      };
    case 'overdue':
      return {
        hex: getStatusColorHex('overdue'),
        bgLight: 'bg-red-50 dark:bg-red-950',
        borderNormal: 'border-red-200 dark:border-red-800',
        borderSelected: 'border-red-500',
        shadowSelected: `0 0 0 3px ${getStatusColorHex('overdue').replace(')', ' / 0.35)')}, 0 8px 32px -4px ${getStatusColorHex('overdue').replace(')', ' / 0.55)')}`,
        hoverBorder: 'hover:border-red-300 dark:hover:border-red-700',
      };
    case 'draft':
      return {
        hex: getStatusColorHex('draft'),
        bgLight: 'bg-slate-100 dark:bg-background',
        borderNormal: 'border-purple-200 dark:border-purple-800',
        borderSelected: 'border-purple-500',
        shadowSelected: `0 0 0 3px ${getStatusColorHex('draft').replace(')', ' / 0.35)')}, 0 8px 32px -4px ${getStatusColorHex('draft').replace(')', ' / 0.55)')}`,
        hoverBorder: 'hover:border-purple-300 dark:hover:border-purple-700',
      };
    default:
      return {
        hex: getStatusColorHex('no_task'),
        bgLight: 'bg-slate-50 dark:bg-slate-950',
        borderNormal: 'border-slate-200 dark:border-slate-700',
        borderSelected: 'border-slate-400',
        shadowSelected: `0 0 0 3px ${getStatusColorHex('no_task').replace(')', ' / 0.35)')}, 0 8px 32px -4px ${getStatusColorHex('no_task').replace(')', ' / 0.55)')}`,
        hoverBorder: 'hover:border-slate-300 dark:hover:border-slate-600',
      };
  }
}

export type ScheduleModeValue = "ate" | "entre" | "em" | "sem_prazo" | "urgente";
export type SchedulePatch = { scheduleMode?: ScheduleModeValue; startAt?: string | null; dueDate?: string | null };

export interface TaskCardData {
  title: string;
  statusVisual: string;
  taskId?: string | null;
  taskDueDate?: string | null;
  taskStartAt?: string | null;
  taskScheduleMode?: ScheduleModeValue | null;
  taskAssigneeName?: string | null;
  taskAssigneeId?: string | null;
  taskAssigneeAvatarUrl?: string | null;
  taskDescription?: string | null;
  taskCompletedAt?: string | null;
  taskParentApprovalStatus?: string | null;
  taskAttachmentCount?: number | null;
  taskSubtaskCount?: number | null;
  taskSubtaskCompletedCount?: number | null;
  taskCommentCount?: number | null;
}

export interface TaskCardBodyProps {
  data: TaskCardData;
  selected?: boolean;
  /** "canvas" = largura do node (220–280px); "fill" = ocupa a coluna. */
  width?: "canvas" | "fill";
  members?: AvatarPickerMember[];
  autoFocusTitle?: boolean;
  onAutoFocusConsumed?: () => void;
  onTitleSave: (next: string) => void;
  onEditingChange?: (editing: boolean) => void;
  onStatusChange: (status: "pending" | "in_progress" | "completed" | "blocked" | "draft") => void;
  onAssigneeChange: (userId: string) => void; // "unassigned" = sem responsável
  onSchedulePatch: (patch: SchedulePatch) => void;
  /** true enquanto a edição de prazo está em curso (sem-prazo aberto ou modalidade pendente). */
  onScheduleEditingChange?: (editing: boolean) => void;
  onOpen: () => void;
  /** Renderizado primeiro dentro do elemento raiz (Handles e botão "+" no canvas). */
  children?: React.ReactNode;
}

const STATUS_OPTIONS = TASK_STATUS_ORDER;

function statusLabel(s: string) {
  if (s === 'overdue') return 'vencida';
  if (s === 'no_task') return 'sem tarefa';
  return getStatusLabelCentralized(s);
}


export default function TaskCardBody({
  data,
  selected = false,
  width = "canvas",
  members,
  autoFocusTitle,
  onAutoFocusConsumed,
  onTitleSave,
  onEditingChange,
  onStatusChange,
  onAssigneeChange,
  onSchedulePatch,
  onScheduleEditingChange,
  onOpen,
  children,
}: TaskCardBodyProps) {
  const { toast } = useToast();
  const color = getStatusColorHex(data.statusVisual);
  const nodeColors = getNodeColors(data.statusVisual);
  const isMuted = data.statusVisual === 'no_task';
  const hasTask = !!data.taskId;

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

  let startAtStr: string | null = null;
  if (data.taskStartAt) {
    try {
      startAtStr = formatDueDate(data.taskStartAt);
    } catch {
      startAtStr = null;
    }
  }

  const isOverdue =
    data.taskDueDate &&
    new Date(data.taskDueDate.slice(0, 10) + 'T23:59:59') < new Date() &&
    data.statusVisual !== 'completed';

  const hasAssignee = !!data.taskAssigneeName;
  const hasDueDate = !!dueDateStr;
  const hasStartAt = !!startAtStr;

  const [autoFocusTitleTrigger, setAutoFocusTitleTrigger] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [editingNoPrazo, setEditingNoPrazo] = useState(false);
  const scheduleWrapperRef = useRef<HTMLDivElement>(null);

  const handleScheduleWrapperBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && scheduleWrapperRef.current?.contains(next)) return;
    if (!data.taskDueDate && !data.taskStartAt) {
      setEditingNoPrazo(false);
      setPendingMode(null);
    }
  };


  useEffect(() => {
    if (data.taskDueDate && editingNoPrazo) setEditingNoPrazo(false);
  }, [data.taskDueDate, editingNoPrazo]);

  useEffect(() => {
    if (autoFocusTitle) setAutoFocusTitleTrigger(true);
  }, [autoFocusTitle]);

  const handleTitleSave = (next: string) => onTitleSave(next);

  const handleTitleEditingChange = (editing: boolean) => onEditingChange?.(editing);

  const handleAutoFocusConsumed = () => {
    setAutoFocusTitleTrigger(false);
    onAutoFocusConsumed?.();
  };

  const handleStatusChange = (newStatus: string) => {
    setEditingStatus(false);
    if (newStatus === data.statusVisual) return;
    onStatusChange(newStatus as 'pending' | 'in_progress' | 'completed' | 'blocked' | 'draft');
  };

  const handleAssigneeChange = (userId: string) => onAssigneeChange(userId);

  const serverScheduleMode = (data.taskScheduleMode ?? "ate") as "ate" | "entre" | "em" | "sem_prazo" | "urgente";
  // Local override: lets the user switch to "entre"/"em" before the dates
  // are filled. Cleared once the server's mode catches up.
  const [pendingMode, setPendingMode] = useState<"ate" | "entre" | "em" | "sem_prazo" | "urgente" | null>(null);
  useEffect(() => {
    if (pendingMode && serverScheduleMode === pendingMode) setPendingMode(null);
  }, [serverScheduleMode, pendingMode]);
  const currentScheduleMode: "ate" | "entre" | "em" | "sem_prazo" | "urgente" = pendingMode ?? serverScheduleMode;
  const scheduleEditing = editingNoPrazo || pendingMode !== null;
  // Emite só em transição (sem `false` inicial nem reemissão por callback
  // inline); ao desmontar no meio da edição, fecha com `false`.
  const onScheduleEditingChangeRef = useRef(onScheduleEditingChange);
  onScheduleEditingChangeRef.current = onScheduleEditingChange;
  const lastScheduleEditingRef = useRef(false);
  useEffect(() => {
    if (lastScheduleEditingRef.current === scheduleEditing) return;
    lastScheduleEditingRef.current = scheduleEditing;
    onScheduleEditingChangeRef.current?.(scheduleEditing);
  }, [scheduleEditing]);
  useEffect(() => () => {
    if (lastScheduleEditingRef.current) {
      lastScheduleEditingRef.current = false;
      onScheduleEditingChangeRef.current?.(false);
    }
  }, []);

  const handleDueDateSelect = (val: string) => {
    if (currentScheduleMode === "entre" && val && data.taskStartAt) {
      const startStr = data.taskStartAt.slice(0, 10);
      if (val < startStr) {
        toast({ title: "fim deve ser após o início", variant: "destructive" });
        return;
      }
    }
    if (!val) {
      if (data.taskDueDate) {
        onSchedulePatch(currentScheduleMode === "em" ? { dueDate: null, startAt: null } : { dueDate: null });
      }
      return;
    }
    const isoDate = val + "T12:00:00.000Z";
    if (!pendingMode && data.taskDueDate && data.taskDueDate.slice(0, 10) === val) return;
    const apiData: { dueDate: string; startAt?: string | null; scheduleMode?: "ate" | "entre" | "em" | "sem_prazo" | "urgente" } = { dueDate: isoDate };
    if (currentScheduleMode === "em") {
      apiData.startAt = isoDate;
    }
    if (pendingMode) {
      apiData.scheduleMode = pendingMode;
    }
    onSchedulePatch(apiData);
  };

  const handleScheduleModeChange = (next: "ate" | "entre" | "em" | "sem_prazo" | "urgente") => {
    if (next === currentScheduleMode) return;
    // Persist immediately when the mode is fully specifiable from existing
    // data; otherwise switch only the local UI mode and let the date input
    // handler persist mode + dates atomically.
    if (next === "sem_prazo" || next === "urgente") {
      setPendingMode(null);
      onSchedulePatch({ scheduleMode: next, startAt: null, dueDate: null });
      return;
    }
    if (next === "ate") {
      setPendingMode(null);
      onSchedulePatch({ scheduleMode: "ate", startAt: null });
      return;
    }
    if (next === "em" && data.taskDueDate) {
      setPendingMode(null);
      onSchedulePatch({ scheduleMode: "em", startAt: data.taskDueDate });
      return;
    }
    if (next === "entre" && data.taskStartAt && data.taskDueDate) {
      setPendingMode(null);
      onSchedulePatch({ scheduleMode: "entre" });
      return;
    }
    setPendingMode(next);
  };

  const handleStartAtSelect = (val: string) => {
    if (val && data.taskDueDate) {
      const dueStr = data.taskDueDate.slice(0, 10);
      if (val > dueStr) {
        toast({ title: "início deve ser até o fim", variant: "destructive" });
        return;
      }
    }
    if (!val) {
      if (data.taskStartAt) {
        onSchedulePatch({ startAt: null });
      }
      return;
    }
    const iso = val + "T12:00:00.000Z";
    if (!pendingMode && (data.taskStartAt ?? null) === iso) return;
    // "entre" auto-fill: empty dueDate → default to startAt + 1 day.
    if (currentScheduleMode === "entre" && !data.taskDueDate) {
      const autoDueIso = addOneDayYmd(val) + "T12:00:00.000Z";
      onSchedulePatch({ scheduleMode: "entre", startAt: iso, dueDate: autoDueIso });
      return;
    }
    const apiData: { startAt: string; scheduleMode?: "ate" | "entre" | "em" | "sem_prazo" | "urgente" } = { startAt: iso };
    if (pendingMode) {
      apiData.scheduleMode = pendingMode;
    }
    onSchedulePatch(apiData);
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
    const mutedEntry = getStatusOrderEntry(data.statusVisual);
    const MutedStatusIcon = mutedEntry?.icon;
    const statusText = isCompleted ? completedDateStr : null;
    return (
      <div
        className={`group/node relative ${width === "fill" ? "w-full" : "min-w-[180px] max-w-[240px]"} rounded-2xl transition-all duration-300 hover:shadow-md ${nodeColors.hoverBorder} ${nodeColors.bgLight} ${selected ? `border-[3px] scale-[1.02] ${nodeColors.borderSelected}` : `border-2 ${nodeColors.borderNormal}`}`}
        style={selected ? { boxShadow: nodeColors.shadowSelected } : undefined}
        onDoubleClick={(e) => { e.stopPropagation(); onOpen(); }}
      >
        {children}

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
              data-no-dnd
              className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover/node:opacity-100 transition-all hover:scale-110 cursor-pointer bg-muted text-muted-foreground"
              title="Expandir card"
              onClick={(e) => { e.stopPropagation(); onOpen(); }}
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
            {data.taskAttachmentCount != null && data.taskAttachmentCount > 0 && (
              <Paperclip className="w-3 h-3 flex-shrink-0 text-gray-400" aria-label="Possui anexos" />
            )}
            {MutedStatusIcon && (
              <MutedStatusIcon
                className={`w-3 h-3 flex-shrink-0 text-gray-400 transition-colors duration-300 ${mutedIconColor}`}
                aria-label={mutedEntry?.label ?? ''}
              />
            )}
            {statusText && (
              <span className={`text-[10px] text-gray-400 transition-colors duration-300 ${mutedTextColor}`}>
                {statusText}
              </span>
            )}
            {((data.taskSubtaskCount != null && data.taskSubtaskCount > 0) ||
              (data.taskCommentCount != null && data.taskCommentCount > 0)) && (
              <div className="ml-auto inline-flex items-center gap-2 flex-shrink-0">
                {data.taskSubtaskCount != null && data.taskSubtaskCount > 0 && (
                  <span
                    className={`inline-flex items-center gap-0.5 text-[10px] text-gray-400 flex-shrink-0 transition-colors duration-300 ${mutedTextColor}`}
                    title={`${data.taskSubtaskCompletedCount ?? 0} de ${data.taskSubtaskCount} subtarefas concluídas`}
                  >
                    <ListChecks className={`w-3 h-3 ${mutedIconColor}`} />
                    <span>{data.taskSubtaskCompletedCount ?? 0} de {data.taskSubtaskCount}</span>
                  </span>
                )}
                {data.taskCommentCount != null && data.taskCommentCount > 0 && (
                  <span
                    className={`inline-flex items-center gap-0.5 text-[10px] text-gray-400 flex-shrink-0 transition-colors duration-300 ${mutedTextColor}`}
                    title={`${data.taskCommentCount} ${data.taskCommentCount === 1 ? "comentário" : "comentários"}`}
                  >
                    <MessageSquare className={`w-3 h-3 ${mutedIconColor}`} />
                    <span>{data.taskCommentCount}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group/node relative ${width === "fill" ? "w-full" : "min-w-[220px] max-w-[280px]"} rounded-2xl shadow-lg transition-all duration-200 ${nodeColors.bgLight} ${selected ? `border-[3px] scale-[1.02] ${nodeColors.borderSelected}` : `border-2 ${nodeColors.borderNormal}`}`}
      style={{
        boxShadow: selected ? nodeColors.shadowSelected : undefined,
      }}
      onDoubleClick={(e) => { e.stopPropagation(); onOpen(); }}
    >
      {children}

      {/* Card content */}
      <div className="px-5 py-4 relative overflow-hidden rounded-xl">
        {data.statusVisual !== 'pending' && (
          <div
            className="absolute top-0 left-0 w-full h-1.5 rounded-t-xl"
            style={{ backgroundColor: color, opacity: isMuted ? 0.3 : 1 }}
          />
        )}

        <div className="flex items-start justify-between gap-3 mt-2">
          <EditableTitle
            value={data.title}
            onSave={handleTitleSave}
            onEditingChange={handleTitleEditingChange}
            stopPropagation
            nodragForReactFlow
            autoFocus={autoFocusTitleTrigger}
            onAutoFocusConsumed={handleAutoFocusConsumed}
            displayClassName="font-display font-bold text-foreground text-base leading-tight break-words pr-2 hover:bg-muted/30 rounded px-0.5 transition-colors"
            inputClassName="font-display font-bold text-foreground text-base leading-tight break-words pr-2"
            hoverTitle="Clique para editar o título"
          />
          <button
            data-no-dnd
            className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center opacity-0 group-hover/node:opacity-100 transition-all hover:scale-110 cursor-pointer"
            style={{
              backgroundColor: `${color.replace(')', ' / 0.12)')}`,
              color,
            }}
            title="Expandir card"
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {plainDescription && (
          <div className="mt-2 relative">
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
                    data-no-dnd
                    className="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
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
                  data-no-dnd
                  className="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
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
                data-no-dnd
                className="flex-shrink-0"
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
              <div className="flex items-center flex-shrink-0">
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

            {data.taskAttachmentCount != null && data.taskAttachmentCount > 0 && (
              <Paperclip className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" aria-label="Possui anexos" />
            )}

            {/* Non-task due-date display */}
            {!hasTask && hasDueDate && (
              <div
                className={`flex items-center gap-1 text-[11px] font-medium ml-auto rounded px-1 transition-colors ${isOverdue ? 'text-red-500' : 'text-muted-foreground'} cursor-default`}
              >
                <Calendar className="w-3 h-3 flex-shrink-0" />
                <span>{dueDateStr}</span>
              </div>
            )}

            {/* Task schedule fields — stacks vertically in "entre" mode */}
            {hasTask && !hasDueDate && !editingNoPrazo && currentScheduleMode !== "urgente" && (
              <button
                type="button"
                data-no-dnd
                className="ml-auto flex items-center gap-1 text-[11px] font-medium text-muted-foreground rounded px-1 hover:text-foreground hover:bg-muted/30 transition-colors cursor-pointer"
                title="Clique para definir prazo"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingNoPrazo(true);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <Calendar className="w-3 h-3 flex-shrink-0" />
                <span>sem prazo</span>
              </button>
            )}
            {hasTask && !hasDueDate && !editingNoPrazo && currentScheduleMode === "urgente" && (
              <button
                type="button"
                data-no-dnd
                className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold bg-red-100 text-red-700 border border-red-300 hover:bg-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/60 transition-colors cursor-pointer"
                title="Clique para alterar modalidade de prazo"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingNoPrazo(true);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <span>urgente</span>
              </button>
            )}
            {hasTask && (hasDueDate || editingNoPrazo) && (
              <div
                ref={scheduleWrapperRef}
                onBlur={handleScheduleWrapperBlur}
                data-no-dnd
                className={`ml-auto ${currentScheduleMode === "entre" ? "flex flex-col items-end gap-1" : "flex items-center gap-1"}`}
              >
                {/* Top row: mode select + startAt (only shown for "entre") */}
                <div className="flex items-center gap-1">
                  <select
                    value={currentScheduleMode}
                    onChange={(e) => { e.stopPropagation(); handleScheduleModeChange(e.target.value as "ate" | "entre" | "em" | "sem_prazo" | "urgente"); }}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    className="nodrag text-[10px] bg-card border border-border rounded-lg px-1.5 py-0.5 outline-none cursor-pointer"
                    title="Modalidade do fazer"
                  >
                    <option value="urgente">urgente</option>
                    <option value="ate">fazer até</option>
                    <option value="entre">fazer entre</option>
                    <option value="em">fazer em</option>
                    <option value="sem_prazo">sem prazo</option>
                  </select>
                  {currentScheduleMode === "entre" && (
                    <DatePickerPopover
                      value={data.taskStartAt ? data.taskStartAt.slice(0, 10) : ""}
                      onSelect={handleStartAtSelect}
                      max={data.taskDueDate ? data.taskDueDate.slice(0, 10) : undefined}
                    >
                      {hasStartAt ? (
                        <button
                          type="button"
                          className="flex items-center gap-1 text-[11px] font-medium rounded px-1 transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/30 cursor-pointer bg-transparent border-none"
                          title="Clique para editar início"
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          <Calendar className="w-3 h-3 flex-shrink-0" />
                          <span>{startAtStr}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="flex items-center gap-1 text-[11px] text-muted-foreground opacity-0 group-hover/node:opacity-100 hover:text-foreground transition-all cursor-pointer bg-transparent border-none"
                          title="Adicionar início"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Calendar className="w-3 h-3" />
                        </button>
                      )}
                    </DatePickerPopover>
                  )}
                </div>

                {/* Due-date row — below startAt for "entre", inline otherwise.
                    Hidden in "urgente" / "sem_prazo" since they have no dates. */}
                {currentScheduleMode !== "urgente" && currentScheduleMode !== "sem_prazo" && (
                <DatePickerPopover
                  value={data.taskDueDate ? data.taskDueDate.slice(0, 10) : ""}
                  onSelect={handleDueDateSelect}
                  min={currentScheduleMode === "entre" && data.taskStartAt ? data.taskStartAt.slice(0, 10) : undefined}
                >
                  {hasDueDate ? (
                    <button
                      type="button"
                      className={`flex items-center gap-1 text-[11px] font-medium rounded px-1 transition-colors ${isOverdue ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'} cursor-pointer bg-transparent border-none`}
                      title="Clique para editar fazer"
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      <Calendar className="w-3 h-3 flex-shrink-0" />
                      <span>{dueDateStr}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[11px] text-muted-foreground opacity-0 group-hover/node:opacity-100 hover:text-foreground transition-all cursor-pointer bg-transparent border-none"
                      title="Adicionar fazer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Calendar className="w-3 h-3" />
                    </button>
                  )}
                </DatePickerPopover>
                )}
              </div>
            )}
          </div>
        ) : null}

        {/* Status badge */}
        <div className="mt-3 pt-3 border-t flex items-center gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            {(() => {
              const entry = getStatusOrderEntry(data.statusVisual);
              const StatusIcon = entry?.icon;
              const ariaLabel = entry?.label ?? statusLabel(data.statusVisual);
              const badge = (
                <div
                  data-no-dnd
                  className={`flex items-center justify-center w-6 h-6 rounded-full ${hasTask ? 'cursor-pointer hover:opacity-80 transition-opacity' : 'cursor-default'}`}
                  style={{ backgroundColor: color, color: '#fff' }}
                  title={hasTask ? `status: ${ariaLabel}. Clique para alterar.` : `status: ${ariaLabel}`}
                  aria-label={ariaLabel}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  {StatusIcon ? (
                    <StatusIcon className="w-3.5 h-3.5" />
                  ) : (
                    <span className="text-[9px] font-semibold tracking-wider lowercase">{ariaLabel}</span>
                  )}
                </div>
              );
              if (!hasTask) return badge;
              return (
                <Popover open={editingStatus} onOpenChange={setEditingStatus}>
                  <PopoverTrigger render={(props) => cloneElement(badge, props)} />
                  <PopoverContent
                    align="start"
                    className="p-1 rounded-xl min-w-[180px]"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    {STATUS_OPTIONS.map(opt => {
                      const OptIcon = opt.icon;
                      const isCurrent = data.statusVisual === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleStatusChange(opt.value)}
                          className={`w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-muted/60 transition-colors flex items-center gap-2 rounded-md ${isCurrent ? 'bg-muted/30' : ''}`}
                          aria-pressed={isCurrent}
                        >
                          <OptIcon className={`w-3.5 h-3.5 ${opt.dot.replace('bg-', 'text-')}`} />
                          {opt.menuLabel}
                        </button>
                      );
                    })}
                  </PopoverContent>
                </Popover>
              );
            })()}
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
          {((data.taskSubtaskCount != null && data.taskSubtaskCount > 0) ||
            (data.taskCommentCount != null && data.taskCommentCount > 0)) && (
            <div className="ml-auto inline-flex items-center gap-2 flex-shrink-0">
              {data.taskSubtaskCount != null && data.taskSubtaskCount > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground flex-shrink-0"
                  title={`${data.taskSubtaskCompletedCount ?? 0} de ${data.taskSubtaskCount} subtarefas concluídas`}
                >
                  <ListChecks className="w-3.5 h-3.5" />
                  <span>{data.taskSubtaskCompletedCount ?? 0} de {data.taskSubtaskCount}</span>
                </span>
              )}
              {data.taskCommentCount != null && data.taskCommentCount > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground flex-shrink-0"
                  title={`${data.taskCommentCount} ${data.taskCommentCount === 1 ? "comentário" : "comentários"}`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>{data.taskCommentCount}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

