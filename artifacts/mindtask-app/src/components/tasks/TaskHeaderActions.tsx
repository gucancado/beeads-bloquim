import type { ReactNode } from "react";
import { Loader2, Copy, Trash2 } from "lucide-react";
import { Button } from "@beeads/ui";
import { TaskApplyTemplateButton } from "@/components/tasks/TaskApplyTemplateButton";

export function TaskHeaderActions({
  parentApprovalStatus,
  isEditing,
  isStandalone,
  isCardMode,
  effectiveWorkspaceId,
  isDuplicating,
  onDuplicate,
  onDelete,
  leftSlot,
  ownerSlot,
  taskId,
  taskStatus,
  onTemplateApplied,
  templatePortalContainer,
  templateSkipConfirm,
}: {
  parentApprovalStatus: string | null;
  isEditing: boolean;
  isStandalone: boolean;
  isCardMode: boolean;
  effectiveWorkspaceId: string;
  isDuplicating: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  leftSlot?: ReactNode;
  ownerSlot?: ReactNode;
  taskId?: string | null;
  taskStatus?: string;
  onTemplateApplied?: () => void;
  templatePortalContainer?: HTMLElement | null;
  templateSkipConfirm?: boolean;
}) {
  return (
    <>
      {parentApprovalStatus && (
        <div className="mb-2">
          <span
            className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full lowercase border ${
              parentApprovalStatus === "approved"
                ? "text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800"
                : parentApprovalStatus === "rejected"
                ? "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800"
                : "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                parentApprovalStatus === "approved"
                  ? "bg-emerald-500"
                  : parentApprovalStatus === "rejected"
                  ? "bg-red-500"
                  : "bg-amber-500"
              }`}
            />
            {parentApprovalStatus === "in_approval"
              ? "em aprovação"
              : parentApprovalStatus === "approved"
              ? "aprovada"
              : "reprovada"}
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 mb-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {leftSlot}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
        {ownerSlot}
        {isEditing && taskStatus !== undefined && (
          <TaskApplyTemplateButton
            taskId={taskId ?? null}
            status={taskStatus}
            onApplied={() => onTemplateApplied?.()}
            portalContainer={templatePortalContainer}
            skipConfirm={templateSkipConfirm}
          />
        )}
        {isEditing && !isStandalone && !!effectiveWorkspaceId && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onDuplicate}
            disabled={isDuplicating}
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg"
            title="duplicar tarefa"
          >
            {isDuplicating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </Button>
        )}
        {isEditing && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
            title={isCardMode ? "deletar card" : "excluir tarefa"}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
        </div>
      </div>
    </>
  );
}
