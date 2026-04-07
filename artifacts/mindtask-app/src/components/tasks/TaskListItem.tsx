import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Flag, Calendar as CalendarIcon, Map as MapIcon, Building2, User } from "lucide-react";
import { formatDueDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { TASK_STATUS_ORDER, getStatusActiveClass } from "@/lib/taskStatusConstants";

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
  overdue?: boolean;
  assignedTo?: string | null;
  assigneeName?: string | null;
  assigneeAvatarUrl?: string | null;
  mapId?: string | null;
  mapName?: string | null;
  cardId?: string | null;
  workspaceName?: string | null;
  isApprovalTask?: boolean | null;
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
  return STATUS_OPTIONS.find(o => o.value === s)?.label ?? s.replace("_", " ");
}

function getPriorityColor(p: string) {
  switch (p) {
    case "critical": return "text-red-500 bg-red-500/10 border-red-200 dark:border-red-900/50";
    case "high":     return "text-orange-500 bg-orange-500/10 border-orange-200 dark:border-orange-900/50";
    case "medium":   return "text-blue-500 bg-blue-500/10 border-blue-200 dark:border-blue-900/50";
    case "low":      return "text-slate-500 bg-slate-500/10 border-slate-200 dark:border-slate-800";
    default: return "";
  }
}

function translatePriority(p: string) {
  switch (p) {
    case "critical": return "máxima";
    case "high":     return "alta";
    case "medium":   return "média";
    case "low":      return "baixa";
    default: return p;
  }
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

  const [localTask, setLocalTask] = useState<TaskListItemData>(task);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(task.cardTitle || task.title);
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const titleInputRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const assigneeRef = useRef<HTMLDivElement>(null);
  const dueDateInputRef = useRef<HTMLInputElement>(null);

  const closeAllDropdowns = useCallback(() => {
    setStatusOpen(false);
    setPriorityOpen(false);
    setAssigneeOpen(false);
  }, []);

  const anyDropdownOpen = statusOpen || priorityOpen || assigneeOpen;

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
    setPriorityOpen(false);
  };

  const handlePriorityClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    openDropdownAt(e);
    setPriorityOpen(v => !v);
    setStatusOpen(false);
    setAssigneeOpen(false);
  };

  const handlePrioritySelect = (val: string) => {
    setPriorityOpen(false);
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
    setPriorityOpen(false);
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
    setSavingField("dueDate");
    patchTask({ dueDate: val || null }).finally(() => setSavingField(null));
  };

  const handleRowClick = () => {
    if (editingTitle || statusOpen || priorityOpen || assigneeOpen) return;
    onOpenDetail?.(localTask);
  };

  return (
    <div
      className="px-4 py-3 transition-colors flex flex-col gap-1.5 group cursor-pointer relative hover:bg-muted/50 dark:hover:bg-[#404040]"
      onClick={handleRowClick}
    >
      {/* Line 1: status badge + title (left), priority badge (right) */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Status badge — inline editable */}
        <div ref={statusRef} onClick={e => e.stopPropagation()} className="shrink-0">
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

        {/* Title — inline editable, takes remaining space */}
        <div className="flex-1 min-w-0">
          {editingTitle ? (
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
              {localTask.cardTitle || localTask.title}
            </h3>
          )}
        </div>

        {/* Priority badge — inline editable, fixed to right */}
        <div onClick={e => e.stopPropagation()} className="shrink-0 ml-auto">
          <Badge
            variant="outline"
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border cursor-pointer select-none transition-opacity ${getPriorityColor(localTask.priority)} ${savingField === "priority" ? "opacity-60" : ""}`}
            onClick={handlePriorityClick}
            title="Clique para alterar prioridade"
          >
            <Flag className="w-3 h-3 mr-1 inline-block" /> {translatePriority(localTask.priority)}
          </Badge>
          {priorityOpen && createPortal(
            <>
              <div className="fixed inset-0 z-[9998]" onClick={(e) => { e.stopPropagation(); closeAllDropdowns(); }} />
              <div className="fixed z-[9999] bg-card border border-border rounded-xl shadow-lg py-1 min-w-[120px]" style={{ top: dropdownPos.top, left: dropdownPos.left }}>
                {[
                  { value: "critical", label: "máxima" },
                  { value: "high",     label: "alta" },
                  { value: "medium",   label: "média" },
                  { value: "low",      label: "baixa" },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={(e) => { e.stopPropagation(); handlePrioritySelect(opt.value); }}
                    className={`w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-muted transition-colors flex items-center gap-2 ${localTask.priority === opt.value ? "opacity-60" : ""}`}
                  >
                    <Flag className={`w-3 h-3 ${getPriorityColor(opt.value).split(" ")[0]}`} />
                    {opt.label}
                  </button>
                ))}
              </div>
            </>,
            document.body
          )}
        </div>
      </div>

      {/* Line 2: avatar + date + workspace + map + badges */}
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
                    <Avatar className="w-[26px] h-[26px] shrink-0">
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
              sem prazo
            </span>
          )}
          <input
            ref={dueDateInputRef}
            type="date"
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer border-none outline-none [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0"
            value={localTask.dueDate ? localTask.dueDate.slice(0, 10) : ""}
            onChange={handleDueDateChange}
            onClick={e => e.stopPropagation()}
            title="Alterar prazo"
          />
        </label>

        {/* Workspace name (my-tasks page) */}
        {showWorkspaceName && localTask.workspaceName && (
          <Link
            href={`/workspaces/${localTask.workspaceId}`}
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1 hover:underline decoration-dotted shrink-0"
          >
            <Building2 className="w-3 h-3 shrink-0" />
            <span className="truncate max-w-[140px]">{localTask.workspaceName}</span>
          </Link>
        )}

        {/* Map name */}
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

        {/* Approval task badge */}
        {task.isApprovalTask && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-violet-600 bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900/50 px-2 py-0.5 rounded-full tracking-wide lowercase shrink-0">
            aprovação
          </span>
        )}

        {/* Standalone badge — shown in all contexts when task has no plan */}
        {!task.mapId && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 rounded-full tracking-wide lowercase shrink-0">
            Avulsa
          </span>
        )}
      </div>
    </div>
  );
}
