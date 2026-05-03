import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Calendar as CalendarIcon, Map as MapIcon, Building2, User, Repeat, Paperclip, ListChecks, MessageSquare } from "lucide-react";
import { formatDueDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TASK_STATUS_ORDER, getStatusActiveClass } from "@/lib/taskStatusConstants";
import { PriorityBadge } from "@/components/tasks/PriorityBadge";
import { getColorByIndex } from "@workspace/db/colorPalette";
import { ApprovalBadge, getApprovalDisplayTitle } from "@/lib/approvalTaskTitle";
import { useToast } from "@/hooks/use-toast";

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}

export interface TaskListItemMember {
  userId: string;
  name: string;
  avatarUrl?: string | null;
}

export interface TaskListItemData {
  id: string;
  workspaceId: string;
  title: string;
  cardTitle?: string | null;
  status: string;
  priority: string;
  dueDate?: string | null;
  startAt?: string | null;
  scheduleMode?: "ate" | "entre" | "em" | null;
  overdue?: boolean;
  assignedTo?: string | null;
  assigneeName?: string | null;
  assigneeAvatarUrl?: string | null;
  mapId?: string | null;
  mapName?: string | null;
  cardId?: string | null;
  workspaceName?: string | null;
  workspaceColorIndex?: number | null;
  isApprovalTask?: boolean | null;
  parentTaskId?: string | null;
  parentTaskTitle?: string | null;
  isRecurring?: boolean | null;
  recurrenceConfig?: { type: string } | null;
  attachmentCount?: number | null;
  subtaskCount?: number | null;
  subtaskCompletedCount?: number | null;
  commentCount?: number | null;
}

interface Props {
  task: TaskListItemData;
  members?: TaskListItemMember[];
  invalidateQueryKeys?: string[][];
  countsQueryKeys?: string[][];
  onOpenDetail?: (task: TaskListItemData) => void;
  showWorkspaceName?: boolean;
  showMapName?: boolean;
}

const STATUS_OPTIONS = TASK_STATUS_ORDER;

function getStatusLabel(s: string) {
  if (s === "completed") return "concluída";
  if (s === "blocked") return "cancelada";
  return STATUS_OPTIONS.find(o => o.value === s)?.label ?? s.replace("_", " ");
}


export function TaskListItem({
  task,
  members = [],
  invalidateQueryKeys = [],
  countsQueryKeys = [],
  onOpenDetail,
  showWorkspaceName = false,
  showMapName = false,
}: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [localTask, setLocalTask] = useState<TaskListItemData>(task);
  const [editingTitle, setEditingTitle] = useState(false);
  const isApprovalTask = !!task.isApprovalTask;
  const displayTitle = getApprovalDisplayTitle(localTask);
  const [titleValue, setTitleValue] = useState(task.cardTitle || task.title);
  const [statusOpen, setStatusOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);
  // Local override: lets the user switch to "entre"/"em" before persisting,
  // so the start input can be revealed and filled. Cleared after a
  // successful PATCH (or whenever the server's mode catches up).
  const [pendingMode, setPendingMode] = useState<"ate" | "entre" | "em" | null>(null);
  const effectiveMode = pendingMode ?? (localTask.scheduleMode ?? "ate");
  useEffect(() => {
    if (pendingMode && localTask.scheduleMode === pendingMode) setPendingMode(null);
  }, [localTask.scheduleMode, pendingMode]);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const titleInputRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const assigneeRef = useRef<HTMLDivElement>(null);
  const dueDateInputRef = useRef<HTMLInputElement>(null);
  const [editingPrazo, setEditingPrazo] = useState(false);
  const scheduleWrapperRef = useRef<HTMLDivElement>(null);

  const handleScheduleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && scheduleWrapperRef.current?.contains(next)) return;
    if (!localTask.dueDate && !localTask.startAt) {
      setEditingPrazo(false);
      setPendingMode(null);
    }
  };

  useEffect(() => {
    if (localTask.dueDate && editingPrazo) setEditingPrazo(false);
  }, [localTask.dueDate, editingPrazo]);

  const closeAllDropdowns = useCallback(() => {
    setStatusOpen(false);
    setAssigneeOpen(false);
  }, []);

  const anyDropdownOpen = statusOpen || assigneeOpen;

  useEffect(() => {
    if (!anyDropdownOpen) return;
    const close = () => closeAllDropdowns();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [anyDropdownOpen, closeAllDropdowns]);

  const openDropdownAt = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const top = rect.bottom + 4;
    const left = Math.min(rect.left, window.innerWidth - 180);
    setDropdownPos({ top: Math.min(top, window.innerHeight - 200), left: Math.max(4, left) });
  };

  useEffect(() => {
    setLocalTask(task);
    if (!editingTitle) {
      setTitleValue(task.cardTitle || task.title);
    }
  }, [task, editingTitle]);

  const isOverdue = !!localTask.overdue && localTask.status !== "completed" && localTask.status !== "blocked";
  const isLinkedToCard = !!(task.cardId && task.mapId);

  const isStandaloneTask = !task.workspaceId;

  const invalidate = useCallback(() => {
    invalidateQueryKeys.forEach(k => queryClient.invalidateQueries({ queryKey: k }));
    if (task.mapId && task.workspaceId) {
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${task.workspaceId}/maps/${task.mapId}`] });
      if (task.cardId) {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${task.workspaceId}/maps/${task.mapId}/cards/${task.cardId}`] });
      }
    }
  }, [invalidateQueryKeys, queryClient, task.mapId, task.cardId, task.workspaceId]);

  const patchTask = useCallback(async (body: Record<string, any>) => {
    try {
      const url = isStandaloneTask
        ? `/api/my-tasks/${task.id}`
        : `/api/workspaces/${task.workspaceId}/tasks/${task.id}`;
      const updated = await customFetch(url, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setLocalTask(prev => ({ ...prev, ...updated }));
      invalidate();
    } catch (err) {
      console.error("Inline edit failed:", err);
    }
  }, [task.workspaceId, task.id, invalidate, isStandaloneTask]);

  const invalidateCounts = useCallback(() => {
    countsQueryKeys.forEach(k => queryClient.invalidateQueries({ queryKey: k }));
  }, [countsQueryKeys, queryClient]);

  const patchStatus = useCallback(async (newStatus: string) => {
    try {
      const url = isStandaloneTask
        ? `/api/my-tasks/${task.id}/status`
        : `/api/workspaces/${task.workspaceId}/tasks/${task.id}/status`;
      const updated = await customFetch(url, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      setLocalTask(prev => ({ ...prev, ...updated }));
      invalidateCounts();
    } catch (err) {
      console.error("Inline status update failed:", err);
    }
  }, [task.workspaceId, task.id, isStandaloneTask, invalidateCounts]);

  const updateCardTitle = useCallback(async (newTitle: string) => {
    try {
      await customFetch(`/api/workspaces/${task.workspaceId}/maps/${task.mapId}/cards/${task.cardId}`, {
        method: "PUT",
        body: JSON.stringify({ title: newTitle }),
      });
      setLocalTask(prev => ({ ...prev, cardTitle: newTitle, title: newTitle }));
      invalidate();
    } catch (err) {
      console.error("Inline card title edit failed:", err);
    }
  }, [task.workspaceId, task.mapId, task.cardId, invalidate]);

  const handleTitleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTitleValue(localTask.cardTitle || localTask.title);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  };

  const handleTitleSave = () => {
    setEditingTitle(false);
    const trimmed = titleValue.trim();
    if (!trimmed || trimmed === (localTask.cardTitle || localTask.title)) return;
    setSavingField("title");
    if (isLinkedToCard) {
      updateCardTitle(trimmed).finally(() => setSavingField(null));
    } else {
      patchTask({ title: trimmed }).finally(() => setSavingField(null));
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleTitleSave();
    if (e.key === "Escape") { setEditingTitle(false); setTitleValue(localTask.cardTitle || localTask.title); }
  };

  const handleStatusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    openDropdownAt(e);
    setStatusOpen(v => !v);
    setAssigneeOpen(false);
  };

  const handlePrioritySelect = (val: string) => {
    setLocalTask(prev => ({ ...prev, priority: val }));
    setSavingField("priority");
    patchTask({ priority: val }).finally(() => setSavingField(null));
  };

  const handleStatusSelect = (val: string) => {
    setStatusOpen(false);
    setLocalTask(prev => ({ ...prev, status: val }));
    setSavingField("status");
    patchStatus(val).finally(() => setSavingField(null));
  };

  const handleAssigneeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (members.length === 0) return;
    openDropdownAt(e);
    setAssigneeOpen(v => !v);
    setStatusOpen(false);
  };

  const handleAssigneeSelect = (memberId: string | null) => {
    const member = members.find(m => m.userId === memberId) ?? null;
    setAssigneeOpen(false);
    setLocalTask(prev => ({
      ...prev,
      assignedTo: memberId,
      assigneeName: member?.name ?? null,
      assigneeAvatarUrl: member?.avatarUrl ?? null,
    }));
    setSavingField("assignee");
    patchTask({ assignedTo: memberId }).finally(() => setSavingField(null));
  };

  const handleDueDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const val = e.target.value;
    const startStr = localTask.startAt ? localTask.startAt.slice(0, 10) : "";
    if (effectiveMode === "entre" && val && startStr && val < startStr) {
      toast({ title: "fim deve ser após o início", variant: "destructive" });
      return;
    }
    setSavingField("dueDate");
    const iso = val ? val + "T12:00:00.000Z" : null;
    const body: { dueDate: string | null; startAt?: string | null; scheduleMode?: "ate" | "entre" | "em" } = { dueDate: iso };
    if (effectiveMode === "em") body.startAt = iso;
    if (pendingMode) body.scheduleMode = pendingMode;
    patchTask(body).finally(() => setSavingField(null));
  };

  const handleStartAtChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const val = e.target.value;
    const dueStr = localTask.dueDate ? localTask.dueDate.slice(0, 10) : "";
    if (val && dueStr && val > dueStr) {
      toast({ title: "início deve ser até o fim", variant: "destructive" });
      return;
    }
    setSavingField("startAt");
    const body: { startAt: string | null; scheduleMode?: "ate" | "entre" | "em" } = {
      startAt: val ? val + "T12:00:00.000Z" : null,
    };
    if (pendingMode) body.scheduleMode = pendingMode;
    patchTask(body).finally(() => setSavingField(null));
  };

  const handleScheduleModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    const next = e.target.value as "ate" | "entre" | "em";
    // For "em" with a dueDate already set, we can persist immediately
    // (mirroring startAt = dueDate). For "entre" requiring both bounds,
    // or "em" without a date yet, switch only the local UI mode and let
    // the user fill the missing field — the date handler will then
    // persist mode+dates atomically.
    if (next === "ate") {
      setPendingMode(null);
      setSavingField("scheduleMode");
      patchTask({ scheduleMode: "ate", startAt: null }).finally(() => setSavingField(null));
      return;
    }
    if (next === "em" && localTask.dueDate) {
      setPendingMode(null);
      setSavingField("scheduleMode");
      patchTask({ scheduleMode: "em", startAt: localTask.dueDate }).finally(() => setSavingField(null));
      return;
    }
    if (next === "entre" && localTask.startAt && localTask.dueDate) {
      setPendingMode(null);
      setSavingField("scheduleMode");
      patchTask({ scheduleMode: "entre" }).finally(() => setSavingField(null));
      return;
    }
    // Need more user input — keep mode pending in UI only.
    setPendingMode(next);
  };

  const handleRowClick = () => {
    if (editingTitle || statusOpen || assigneeOpen) return;
    onOpenDetail?.(localTask);
  };

  const workspaceColorHex = getColorByIndex(localTask.workspaceColorIndex ?? null);

  return (
    <div
      className="px-4 py-3 transition-colors flex flex-col gap-1.5 group cursor-pointer relative hover:bg-muted/50 dark:hover:bg-[#404040]"
      onClick={handleRowClick}
    >
      {/* Line 0: workspace and plan name above title */}
      {((showWorkspaceName && localTask.workspaceName) || (showMapName && localTask.mapName)) && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
          {showWorkspaceName && localTask.workspaceName && (
            <Link
              href={`/workspaces/${localTask.workspaceId}`}
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 hover:underline decoration-dotted shrink-0"
            >
              {workspaceColorHex ? (
                <span
                  style={{ backgroundColor: workspaceColorHex, width: 8, height: 8, minWidth: 8 }}
                  className="rounded-sm shrink-0 inline-block"
                />
              ) : (
                <Building2 className="w-3 h-3 shrink-0" />
              )}
              <span className="truncate max-w-[140px]">{localTask.workspaceName}</span>
            </Link>
          )}

          {showMapName && localTask.mapName && (
            <Link
              href={`/workspaces/${localTask.workspaceId}/maps/${localTask.mapId}`}
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 hover:underline decoration-dotted shrink-0"
            >
              <MapIcon className="w-3 h-3 shrink-0" />
              <span className="truncate max-w-[180px]">{localTask.mapName}</span>
            </Link>
          )}
        </div>
      )}

      {/* Line 1: title (left), status badge (right) */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Title — inline editable for regular tasks, read-only with badge for approval tasks */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {isApprovalTask ? (
            <>
              <ApprovalBadge />
              <h3
                className="text-base font-semibold text-foreground truncate"
                title={displayTitle}
              >
                {displayTitle}
              </h3>
            </>
          ) : editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleValue}
              onChange={e => setTitleValue(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={handleTitleKeyDown}
              onClick={e => e.stopPropagation()}
              className="text-base font-semibold text-foreground w-full bg-transparent border-b border-primary outline-none"
            />
          ) : (
            <h3
              className="text-base font-semibold text-foreground truncate cursor-text hover:underline decoration-dotted"
              onClick={handleTitleClick}
              title="Clique para editar o título"
            >
              {displayTitle}
            </h3>
          )}
        </div>

        {/* Status badge — inline editable, fixed to right */}
        <div ref={statusRef} onClick={e => e.stopPropagation()} className="shrink-0 ml-auto">
          <Badge
            variant="outline"
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold cursor-pointer select-none no-default-active-elevate transition-opacity border ${getStatusActiveClass(localTask.status)} ${savingField === "status" ? "opacity-60" : ""}`}
            onClick={handleStatusClick}
            title="Clique para alterar status"
          >
            {getStatusLabel(localTask.status)}
          </Badge>
          {statusOpen && createPortal(
            <>
              <div className="fixed inset-0 z-[9998]" onClick={(e) => { e.stopPropagation(); closeAllDropdowns(); }} />
              <div className="fixed z-[9999] bg-card border border-border rounded-xl shadow-lg py-1 min-w-[140px]" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
                {STATUS_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={(e) => { e.stopPropagation(); handleStatusSelect(opt.value); }}
                    className={`w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-muted transition-colors flex items-center gap-2 ${localTask.status === opt.value ? "opacity-60" : ""}`}
                  >
                    <span className={`inline-block w-2 h-2 rounded-full ${opt.color.split(" ")[0]}`} />
                    {opt.label}
                  </button>
                ))}
              </div>
            </>,
            document.body
          )}
        </div>
      </div>

      {/* Line 2: avatar + date + recurrence + priority + approval badge */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {/* Assignee avatar — inline editable */}
        <div onClick={e => e.stopPropagation()} ref={assigneeRef} className="shrink-0">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={`flex items-center cursor-pointer ${members.length > 0 ? "hover:opacity-70" : ""} ${savingField === "assignee" ? "opacity-60" : ""}`}
                  onClick={handleAssigneeClick}
                  title={members.length > 0 ? "Clique para alterar responsável" : undefined}
                >
                  {localTask.assigneeName ? (
                    <Avatar key={`${localTask.assignedTo ?? "none"}|${localTask.assigneeAvatarUrl ?? ""}`} className="w-[26px] h-[26px] shrink-0">
                      {localTask.assigneeAvatarUrl ? (
                        <AvatarImage src={localTask.assigneeAvatarUrl} alt={localTask.assigneeName} className="object-cover" />
                      ) : null}
                      <AvatarFallback className="text-[11px] font-semibold bg-primary/10 text-primary">
                        {getInitials(localTask.assigneeName)}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <User className="w-[21px] h-[21px] shrink-0 text-muted-foreground" />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {localTask.assigneeName ?? "Sem responsável"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {assigneeOpen && members.length > 0 && createPortal(
            <>
              <div className="fixed inset-0 z-[9998]" onClick={(e) => { e.stopPropagation(); closeAllDropdowns(); }} />
              <div className="fixed z-[9999] bg-card border border-border rounded-xl shadow-lg py-1 min-w-[160px]" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
                <button
                  onClick={(e) => { e.stopPropagation(); handleAssigneeSelect(null); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2"
                >
                  <User className="w-3 h-3" /> Sem responsável
                </button>
                {members.map(m => (
                  <button
                    key={m.userId}
                    onClick={(e) => { e.stopPropagation(); handleAssigneeSelect(m.userId); }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors flex items-center gap-2 ${localTask.assignedTo === m.userId ? "font-semibold" : ""}`}
                  >
                    {m.avatarUrl ? (
                      <img src={m.avatarUrl} alt={m.name} className="w-4 h-4 rounded-full object-cover" />
                    ) : (
                      <User className="w-3 h-3" />
                    )}
                    {m.name}
                  </button>
                ))}
              </div>
            </>,
            document.body
          )}
        </div>

        {/* Schedule — collapsed badge when there's no prazo, expanded controls otherwise */}
        {!localTask.dueDate && !editingPrazo ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEditingPrazo(true);
              setTimeout(() => {
                const input = dueDateInputRef.current;
                if (input) {
                  input.focus();
                  try { (input as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* noop */ }
                }
              }, 0);
            }}
            className="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer"
            title="Clique para definir prazo"
          >
            <CalendarIcon className="w-3 h-3 shrink-0" />
            <span>sem prazo</span>
          </button>
        ) : (
          <div
            ref={scheduleWrapperRef}
            onBlur={handleScheduleBlur}
            className="inline-flex flex-wrap items-center gap-x-3 gap-y-1"
          >
            {/* Schedule modality */}
            <select
              value={effectiveMode as string}
              onChange={handleScheduleModeChange}
              onClick={e => e.stopPropagation()}
              disabled={savingField === "scheduleMode"}
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] bg-transparent border border-input text-muted-foreground cursor-pointer ${savingField === "scheduleMode" ? "opacity-60" : ""}`}
              title="Modalidade do fazer"
            >
              <option value="ate">fazer até</option>
              <option value="entre">fazer entre</option>
              <option value="em">fazer em</option>
            </select>

            {/* Start date (visible only for "entre") */}
            {effectiveMode === "entre" && (
              <label
                className="relative inline-flex items-center gap-1 cursor-pointer shrink-0"
                onClick={e => e.stopPropagation()}
              >
                <CalendarIcon className="w-3 h-3 shrink-0 pointer-events-none text-muted-foreground" />
                <span className={`pointer-events-none select-none text-muted-foreground ${savingField === "startAt" ? "opacity-60" : ""}`}>
                  {localTask.startAt ? formatDueDate(localTask.startAt) : "vazio"}
                </span>
                <input
                  type="date"
                  max={localTask.dueDate ? localTask.dueDate.slice(0, 10) : undefined}
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer border-none outline-none [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0"
                  value={localTask.startAt ? localTask.startAt.slice(0, 10) : ""}
                  onChange={handleStartAtChange}
                  onClick={e => e.stopPropagation()}
                  title="Data de início"
                />
              </label>
            )}

            {/* Due date — inline editable */}
            <label
              className={`relative inline-flex items-center gap-1 cursor-pointer shrink-0 ${isOverdue ? "rounded-full px-2 py-0.5 border bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50" : ""}`}
              onClick={e => e.stopPropagation()}
            >
              <CalendarIcon className={`w-3 h-3 shrink-0 pointer-events-none ${isOverdue ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`} />
              {localTask.dueDate ? (
                <span
                  className={`pointer-events-none select-none ${isOverdue ? "text-red-700 dark:text-red-400" : "text-muted-foreground"} ${savingField === "dueDate" ? "opacity-60" : ""}`}
                >
                  {formatDueDate(localTask.dueDate)}
                </span>
              ) : (
                <span
                  className={`pointer-events-none select-none text-muted-foreground ${savingField === "dueDate" ? "opacity-60" : ""}`}
                >
                  vazio
                </span>
              )}
              <input
                ref={dueDateInputRef}
                type="date"
                min={effectiveMode === "entre" && localTask.startAt ? localTask.startAt.slice(0, 10) : undefined}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer border-none outline-none [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0"
                value={localTask.dueDate ? localTask.dueDate.slice(0, 10) : ""}
                onChange={handleDueDateChange}
                onClick={e => e.stopPropagation()}
                title="Alterar fazer"
              />
            </label>
          </div>
        )}

        {/* Recurrence indicator */}
        {localTask.isRecurring && localTask.recurrenceConfig && (
          <span
            className="inline-flex items-center shrink-0 text-muted-foreground"
            title={`repete ${{ daily: "diariamente", weekly: "semanalmente", monthly: "mensalmente", yearly: "anualmente", periodic: "periodicamente", custom: "personalizado" }[localTask.recurrenceConfig.type] ?? "periodicamente"}`}
          >
            <Repeat className="w-3 h-3" />
          </span>
        )}

        {/* Priority badge — inline editable */}
        <div onClick={e => e.stopPropagation()} className="shrink-0">
          <PriorityBadge
            value={localTask.priority}
            onChange={handlePrioritySelect}
            disabled={savingField === "priority"}
          />
        </div>

        {/* Attachment icon */}
        {localTask.attachmentCount != null && localTask.attachmentCount > 0 && (
          <Paperclip className="w-3 h-3 shrink-0 text-muted-foreground" aria-label="Possui anexos" />
        )}

        {/* Subtask + comment indicators immediately right of the attachment icon */}
        {((localTask.subtaskCount != null && localTask.subtaskCount > 0) ||
          (localTask.commentCount != null && localTask.commentCount > 0)) && (
          <div className="inline-flex items-center gap-2 shrink-0">
            {localTask.subtaskCount != null && localTask.subtaskCount > 0 && (
              <span
                className="inline-flex items-center gap-1 shrink-0 text-muted-foreground"
                title={`${localTask.subtaskCompletedCount ?? 0} de ${localTask.subtaskCount} subtarefas concluídas`}
              >
                <ListChecks className="w-3 h-3" />
                <span className="text-[11px] leading-none">{localTask.subtaskCompletedCount ?? 0} de {localTask.subtaskCount}</span>
              </span>
            )}
            {localTask.commentCount != null && localTask.commentCount > 0 && (
              <span
                className="inline-flex items-center gap-1 shrink-0 text-muted-foreground"
                title={`${localTask.commentCount} ${localTask.commentCount === 1 ? "comentário" : "comentários"}`}
              >
                <MessageSquare className="w-3 h-3" />
                <span className="text-[11px] leading-none">{localTask.commentCount}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
