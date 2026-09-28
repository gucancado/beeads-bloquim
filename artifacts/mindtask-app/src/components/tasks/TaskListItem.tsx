// Renders a single task as a <tr> inside a <TaskTable>. Cells (after the
// always-leading "title" cell) are rendered in the order defined by the
// user's saved column preferences — passed in via `columnOrder`.
import { useState, useEffect, cloneElement } from "react";
import { Calendar as CalendarIcon, Map as MapIcon, Building2, User, Repeat, Paperclip, ListChecks, MessageSquare } from "lucide-react";
import { formatDueDate, addOneDayYmd } from "@/lib/utils";
import { SchedulePopover } from "@/components/tasks/SchedulePopover";
import { Badge } from "@beeads/ui";
import { Avatar, AvatarFallback, AvatarImage } from "@beeads/ui";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@beeads/ui";
import { Link } from "wouter";
import { TASK_STATUS_ORDER, getStatusActiveClass, getStatusOrderEntry } from "@/lib/taskStatusConstants";
import { PriorityBadge } from "@/components/tasks/PriorityBadge";
import { getColorByIndex } from "@workspace/db/colorPalette";
import { ApprovalBadge, getApprovalDisplayTitle } from "@/lib/approvalTaskTitle";
import { useToast } from "@/hooks/use-toast";
import { TaskColumnKey, TASK_COLUMN_WIDTH_CLASS } from "@/lib/taskColumnConstants";
import { EditableTitle } from "@/components/ui/editable-title";
import { Popover, PopoverContent, PopoverTrigger } from "@beeads/ui";
import { MemberSelectList } from "@/components/tasks/MemberSelectList";
import { useInlineTaskEditor } from "@/hooks/useInlineTaskEditor";

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
  scheduleMode?: "ate" | "entre" | "em" | "sem_prazo" | "urgente" | null;
  overdue?: boolean;
  completedAt?: string | null;
  // "Bloqueada desde": último evento status_changed→blocked (activity log),
  // servido pelo backend. Substitui a leitura de cancelled_at, que ficava vazia
  // quando a tarefa era bloqueada pelo canvas (cards.ts não escreve a coluna).
  blockedSince?: string | null;
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
  columnOrder: readonly TaskColumnKey[];
  dateColumnMode?: "default" | "completed" | "cancelled";
}

const STATUS_OPTIONS = TASK_STATUS_ORDER;

type ScheduleMode = "ate" | "entre" | "em" | "sem_prazo" | "urgente";

/**
 * Texto da célula de prazo: "até X" / "entre X e Y" / "em X" / "sem prazo" /
 * "urgente". X e Y saem do formatDueDate (hoje, amanhã, dia da semana, dd/MM).
 * Em "fazer em", palavra relativa aparece sozinha ("hoje", "sexta") porque
 * "em hoje" não é português; só data numérica ganha o "em".
 */
function scheduleLabel(mode: ScheduleMode, startAt: string | null | undefined, dueDate: string | null | undefined): string {
  const due = dueDate ? formatDueDate(dueDate) : null;
  const start = startAt ? formatDueDate(startAt) : null;
  switch (mode) {
    case "sem_prazo": return "sem prazo";
    case "urgente": return "urgente";
    case "entre": return `entre ${start ?? "…"} e ${due ?? "…"}`;
    case "em":
      if (!due) return "em …";
      return /^\d{2}\/\d{2}/.test(due) ? `em ${due}` : due;
    default: return `até ${due ?? "…"}`;
  }
}

function getStatusEntry(s: string) {
  return getStatusOrderEntry(s);
}


export function TaskListItem({
  task,
  members = [],
  invalidateQueryKeys = [],
  countsQueryKeys = [],
  onOpenDetail,
  showWorkspaceName = false,
  showMapName = false,
  columnOrder,
  dateColumnMode = "default",
}: Props) {
  const { toast } = useToast();

  const {
    localTask, setLocalTask,
    handleScheduleOpenChange, patchTask, patchStatus, saveTitle,
  } = useInlineTaskEditor({ task, invalidateQueryKeys, countsQueryKeys });
  const [editingTitle, setEditingTitle] = useState(false);
  const isApprovalTask = !!task.isApprovalTask;
  const displayTitle = getApprovalDisplayTitle(localTask);
  const [statusOpen, setStatusOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<"ate" | "entre" | "em" | "sem_prazo" | "urgente" | null>(null);
  const effectiveMode = pendingMode ?? (localTask.scheduleMode ?? "ate");
  useEffect(() => {
    if (pendingMode && localTask.scheduleMode === pendingMode) setPendingMode(null);
  }, [localTask.scheduleMode, pendingMode]);

  const isOverdue = !!localTask.overdue && localTask.status !== "completed" && localTask.status !== "blocked";

  const handleTitleSave = (next: string) => {
    setSavingField("title");
    saveTitle(next).finally(() => setSavingField(null));
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

  const handleDueDateSelect = (val: string) => {
    const startStr = localTask.startAt ? localTask.startAt.slice(0, 10) : "";
    if (effectiveMode === "entre" && val && startStr && val < startStr) {
      toast({ title: "fim deve ser após o início", variant: "destructive" });
      return;
    }
    const iso = val ? val + "T12:00:00.000Z" : null;
    if (effectiveMode === "entre" && iso && localTask.startAt) {
      setLocalTask(prev => ({ ...prev, dueDate: iso }));
      setSavingField("dueDate");
      patchTask({
        scheduleMode: "entre",
        startAt: localTask.startAt,
        dueDate: iso,
      }).finally(() => setSavingField(null));
      return;
    }
    if (effectiveMode === "entre" && !localTask.startAt) {
      setLocalTask(prev => ({ ...prev, dueDate: iso }));
      return;
    }
    setLocalTask(prev => ({ ...prev, dueDate: iso }));
    setSavingField("dueDate");
    const body: { dueDate: string | null; startAt?: string | null; scheduleMode?: "ate" | "entre" | "em" | "sem_prazo" | "urgente" } = { dueDate: iso };
    if (effectiveMode === "em") body.startAt = iso;
    if (pendingMode) body.scheduleMode = pendingMode;
    patchTask(body).finally(() => setSavingField(null));
  };

  const handleStartAtSelect = (val: string) => {
    const dueStr = localTask.dueDate ? localTask.dueDate.slice(0, 10) : "";
    if (val && dueStr && val > dueStr) {
      toast({ title: "início deve ser até o fim", variant: "destructive" });
      return;
    }
    const iso = val ? val + "T12:00:00.000Z" : null;
    if (effectiveMode === "entre" && val && iso && !localTask.dueDate) {
      const autoDueIso = addOneDayYmd(val) + "T12:00:00.000Z";
      setLocalTask(prev => ({ ...prev, startAt: iso, dueDate: autoDueIso }));
      setSavingField("startAt");
      patchTask({
        scheduleMode: "entre",
        startAt: iso,
        dueDate: autoDueIso,
      }).finally(() => setSavingField(null));
      return;
    }
    if (effectiveMode === "entre" && iso && localTask.dueDate) {
      setLocalTask(prev => ({ ...prev, startAt: iso }));
      setSavingField("startAt");
      patchTask({
        scheduleMode: "entre",
        startAt: iso,
        dueDate: localTask.dueDate,
      }).finally(() => setSavingField(null));
      return;
    }
    if (effectiveMode === "entre" && !localTask.dueDate) {
      setLocalTask(prev => ({ ...prev, startAt: iso }));
      return;
    }
    setLocalTask(prev => ({ ...prev, startAt: iso }));
    setSavingField("startAt");
    const body: { startAt: string | null; scheduleMode?: "ate" | "entre" | "em" | "sem_prazo" | "urgente" } = {
      startAt: iso,
    };
    if (pendingMode) body.scheduleMode = pendingMode;
    patchTask(body).finally(() => setSavingField(null));
  };

  const handleModalitySelect = (next: "ate" | "entre" | "em" | "sem_prazo" | "urgente") => {
    if (next === effectiveMode) return;
    if (next === "sem_prazo" || next === "urgente") {
      setPendingMode(null);
      setLocalTask(prev => ({ ...prev, scheduleMode: next, startAt: null, dueDate: null }));
      setSavingField("scheduleMode");
      patchTask({ scheduleMode: next, startAt: null, dueDate: null }).finally(() => setSavingField(null));
      return;
    }
    if (next === "ate") {
      setPendingMode(null);
      setLocalTask(prev => ({ ...prev, scheduleMode: "ate", startAt: null }));
      setSavingField("scheduleMode");
      patchTask({ scheduleMode: "ate", startAt: null }).finally(() => setSavingField(null));
      return;
    }
    if (next === "em" && localTask.dueDate) {
      setPendingMode(null);
      setLocalTask(prev => ({ ...prev, scheduleMode: "em", startAt: prev.dueDate }));
      setSavingField("scheduleMode");
      patchTask({ scheduleMode: "em", startAt: localTask.dueDate }).finally(() => setSavingField(null));
      return;
    }
    if (next === "entre" && localTask.startAt && localTask.dueDate) {
      setPendingMode(null);
      setLocalTask(prev => ({ ...prev, scheduleMode: "entre" }));
      setSavingField("scheduleMode");
      patchTask({ scheduleMode: "entre" }).finally(() => setSavingField(null));
      return;
    }
    setPendingMode(next);
  };

  const handleRowClick = () => {
    if (editingTitle || statusOpen || assigneeOpen) return;
    onOpenDetail?.(localTask);
  };

  const workspaceColorHex = getColorByIndex(localTask.workspaceColorIndex ?? null);

  // ─── Cell renderers ───────────────────────────────────────────────────────

  const renderTitleCell = () => (
    <div className="flex items-center gap-2 min-w-0">
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
      ) : (
        <EditableTitle
          value={localTask.cardTitle || localTask.title}
          onSave={handleTitleSave}
          onEditingChange={setEditingTitle}
          stopPropagation
          hoverTitle="Clique para editar o título"
          displayClassName="text-base font-semibold text-foreground truncate hover:underline decoration-dotted"
          inputClassName="text-base font-semibold text-foreground"
        />
      )}
    </div>
  );

  const renderStatusCell = () => {
    const entry = getStatusEntry(localTask.status);
    const StatusIcon = entry?.icon;
    return (
      <div onClick={e => e.stopPropagation()} className="inline-flex">
        <Popover
          open={statusOpen}
          onOpenChange={(open) => {
            setStatusOpen(open);
            if (open) setAssigneeOpen(false);
          }}
        >
          <PopoverTrigger render={(props) => (
            <Badge
              {...props}
              variant="outline"
              className={`rounded-full w-6 h-6 p-0 inline-flex items-center justify-center cursor-pointer select-none no-default-active-elevate transition-opacity border ${getStatusActiveClass(localTask.status)} ${savingField === "status" ? "opacity-60" : ""}`}
              title={`status: ${entry?.label ?? localTask.status}. Clique para alterar.`}
              aria-label={entry?.label ?? localTask.status}
            >
              {StatusIcon ? <StatusIcon className="w-3.5 h-3.5" /> : null}
            </Badge>
          )} />
          <PopoverContent
            align="start"
            className="p-1 rounded-xl min-w-[180px]"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            {STATUS_OPTIONS.map(opt => {
              const OptIcon = opt.icon;
              const isCurrent = localTask.status === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleStatusSelect(opt.value)}
                  className={`w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-muted/60 transition-colors flex items-center gap-2 rounded-md ${isCurrent ? "bg-muted/30" : ""}`}
                  aria-pressed={isCurrent}
                >
                  <OptIcon className={`w-3.5 h-3.5 ${opt.dot.replace("bg-", "text-")}`} />
                  {opt.menuLabel}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
      </div>
    );
  };

  const renderAssigneeCell = () => {
    const trigger = (
      <div
        className={`flex items-center ${members.length > 0 ? "cursor-pointer hover:opacity-70" : "cursor-default"} ${savingField === "assignee" ? "opacity-60" : ""}`}
      >
        {localTask.assigneeName ? (
          <Avatar
            key={`${localTask.assignedTo ?? "none"}|${localTask.assigneeAvatarUrl ?? ""}`}
            className="w-[26px] h-[26px] shrink-0"
          >
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
    );

    return (
      <div onClick={e => e.stopPropagation()} className="inline-flex">
        {members.length === 0 ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger render={(props) => cloneElement(trigger, props)} />
              <TooltipContent>{localTask.assigneeName ?? "sem responsável"}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Popover
            open={assigneeOpen}
            onOpenChange={(open) => {
              setAssigneeOpen(open);
              if (open) setStatusOpen(false);
            }}
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={(tooltipProps) => (
                  <PopoverTrigger
                    {...tooltipProps}
                    render={(popoverProps) => (
                      <button
                        {...popoverProps}
                        type="button"
                        aria-label={localTask.assigneeName ?? "atribuir responsável"}
                        className="appearance-none bg-transparent border-0 p-0 m-0"
                      >
                        {trigger}
                      </button>
                    )}
                  />
                )} />
                <TooltipContent>{localTask.assigneeName ?? "sem responsável"}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <PopoverContent
              align="start"
              className="w-auto p-1 rounded-xl min-w-[180px]"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <MemberSelectList
                density="compact"
                members={members}
                selectedId={localTask.assignedTo ?? null}
                onSelect={(id) => {
                  setAssigneeOpen(false);
                  handleAssigneeSelect(id);
                }}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
    );
  };

  const renderPriorityCell = () => (
    <div onClick={e => e.stopPropagation()} className="inline-flex">
      <PriorityBadge
        value={localTask.priority}
        onChange={handlePrioritySelect}
        disabled={savingField === "priority"}
      />
    </div>
  );

  const renderScheduleCell = () => {
    // When the page is filtering by a terminal status, this column is repurposed
    // to display the relevant completion/cancellation timestamp instead of the
    // inline schedule editor.
    if (dateColumnMode === "completed") {
      const iso = localTask.completedAt ?? null;
      return (
        <span className="text-xs text-muted-foreground">
          {iso ? formatDueDate(iso) : "—"}
        </span>
      );
    }
    if (dateColumnMode === "cancelled") {
      const iso = localTask.blockedSince ?? null;
      return (
        <span className="text-xs text-muted-foreground">
          {iso ? formatDueDate(iso) : "—"}
        </span>
      );
    }
    const recurrenceIcon = localTask.isRecurring && localTask.recurrenceConfig ? (
      <span
        className="inline-flex items-center text-muted-foreground shrink-0"
        title={`repete ${{ daily: "diariamente", weekly: "semanalmente", monthly: "mensalmente", yearly: "anualmente", periodic: "periodicamente", custom: "personalizado" }[localTask.recurrenceConfig.type] ?? "periodicamente"}`}
      >
        <Repeat className="w-3.5 h-3.5" />
      </span>
    ) : null;

    // O texto inteiro ("até X", "entre X e Y", "em X", "sem prazo", "urgente")
    // é o gatilho de um único popover de configuração: modalidade + calendário(s)
    // + atalhos hoje/amanhã. Os handlers de persistência são os mesmos de antes.
    const label = scheduleLabel(effectiveMode, localTask.startAt, localTask.dueDate);
    const saving = savingField === "dueDate" || savingField === "startAt" || savingField === "scheduleMode";
    const tone = effectiveMode === "urgente"
      ? "rounded-full px-2 py-0.5 text-[11px] font-semibold bg-red-100 text-red-700 border border-red-300 hover:bg-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/60"
      : isOverdue
        ? "rounded-full px-2 py-0.5 border bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50"
        : effectiveMode === "sem_prazo"
          ? "rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40"
          : "text-muted-foreground hover:text-foreground";

    return (
      <div onClick={e => e.stopPropagation()} className="inline-flex flex-nowrap items-center gap-2 text-xs whitespace-nowrap">
        <SchedulePopover
          onOpenChange={handleScheduleOpenChange}
          mode={effectiveMode}
          startAt={localTask.startAt}
          dueDate={localTask.dueDate}
          onModeChange={handleModalitySelect}
          onStartAtSelect={handleStartAtSelect}
          onDueDateSelect={handleDueDateSelect}
        >
          <button
            type="button"
            title="Configurar prazo"
            className={`inline-flex items-center gap-1 cursor-pointer shrink-0 bg-transparent border-0 p-0 select-none transition-colors ${tone} ${saving ? "opacity-60" : ""}`}
          >
            {effectiveMode !== "urgente" && <CalendarIcon className="w-3 h-3 shrink-0" />}
            <span>{label}</span>
          </button>
        </SchedulePopover>
        {recurrenceIcon}
      </div>
    );
  };

  const renderChecklistCell = () => {
    const total = Number(localTask.subtaskCount ?? 0);
    if (total <= 0) return null;
    const done = Number(localTask.subtaskCompletedCount ?? 0);
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        title={`${done} de ${total} subtarefas concluídas`}
      >
        <ListChecks className="w-3.5 h-3.5" />
        <span className="text-[11px] leading-none">{done} de {total}</span>
      </span>
    );
  };

  const renderCommentsCell = () => {
    const count = Number(localTask.commentCount ?? 0);
    if (count <= 0) return null;
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        title={`${count} ${count === 1 ? "comentário" : "comentários"}`}
      >
        <MessageSquare className="w-3.5 h-3.5" />
        <span className="text-[11px] leading-none">{count}</span>
      </span>
    );
  };

  const renderAttachmentsCell = () => {
    const count = Number(localTask.attachmentCount ?? 0);
    if (count <= 0) return null;
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        title={`${count} ${count === 1 ? "anexo" : "anexos"}`}
      >
        <Paperclip className="w-3.5 h-3.5" />
        <span className="text-[11px] leading-none">{count}</span>
      </span>
    );
  };

  const renderWorkspaceMapCell = () => {
    const wsVisible = showWorkspaceName && localTask.workspaceName;
    const mapVisible = showMapName && localTask.mapName;
    if (!wsVisible && !mapVisible) return null;
    return (
      <div className="flex flex-col gap-0.5 min-w-0 text-xs text-muted-foreground">
        {wsVisible && (
          <Link
            href={`/workspaces/${localTask.workspaceId}`}
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1 hover:underline decoration-dotted min-w-0"
          >
            {workspaceColorHex ? (
              <span
                style={{ backgroundColor: workspaceColorHex, width: 8, height: 8, minWidth: 8 }}
                className="rounded-sm shrink-0 inline-block"
              />
            ) : (
              <Building2 className="w-3 h-3 shrink-0" />
            )}
            <span className="truncate">{localTask.workspaceName}</span>
          </Link>
        )}
        {mapVisible && (
          <Link
            href={`/workspaces/${localTask.workspaceId}/maps/${localTask.mapId}`}
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1 hover:underline decoration-dotted min-w-0"
          >
            <MapIcon className="w-3 h-3 shrink-0" />
            <span className="truncate">{localTask.mapName}</span>
          </Link>
        )}
      </div>
    );
  };

  const renderCell = (key: TaskColumnKey) => {
    switch (key) {
      case "title": return renderTitleCell();
      case "status": return renderStatusCell();
      case "assignee": return renderAssigneeCell();
      case "priority": return renderPriorityCell();
      case "schedule": return renderScheduleCell();
      case "checklist": return renderChecklistCell();
      case "comments": return renderCommentsCell();
      case "attachments": return renderAttachmentsCell();
      case "workspace_map": return renderWorkspaceMapCell();
    }
  };

  return (
    <tr
      className="transition-colors group cursor-pointer bg-card border-b border-border/60 hover:bg-muted/50"
      onClick={handleRowClick}
    >
      {columnOrder.map(key => (
        <td key={key} className={`${key === "title" ? "px-4" : "px-3"} py-3 align-middle ${TASK_COLUMN_WIDTH_CLASS[key]}`}>
          {renderCell(key)}
        </td>
      ))}
    </tr>
  );
}
