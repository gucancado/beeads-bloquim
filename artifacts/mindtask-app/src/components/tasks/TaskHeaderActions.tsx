import { Loader2, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TASK_STATUS_ORDER } from "@/lib/taskStatusConstants";

export function TaskHeaderActions({
  parentApprovalStatus,
  isEditing,
  isTaskReady,
  isStandalone,
  isCardMode,
  effectiveWorkspaceId,
  status,
  isDuplicating,
  onStatusChange,
  onDuplicate,
  onDelete,
}: {
  parentApprovalStatus: string | null;
  isEditing: boolean;
  isTaskReady: boolean;
  isStandalone: boolean;
  isCardMode: boolean;
  effectiveWorkspaceId: string;
  status: string;
  isDuplicating: boolean;
  onStatusChange: (newStatus: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 mb-1">
      {parentApprovalStatus && (
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full lowercase border ${
          parentApprovalStatus === 'approved'
            ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800'
            : parentApprovalStatus === 'rejected'
            ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800'
            : 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            parentApprovalStatus === 'approved' ? 'bg-emerald-500' :
            parentApprovalStatus === 'rejected' ? 'bg-red-500' : 'bg-amber-500'
          }`} />
          {parentApprovalStatus === 'in_approval' ? 'em aprovação' :
           parentApprovalStatus === 'approved' ? 'aprovada' : 'reprovada'}
        </span>
      )}
      <div className="flex items-center gap-1.5 ml-auto flex-wrap justify-end">
        {isEditing && isTaskReady && TASK_STATUS_ORDER.map(opt => (
          <button
            key={opt.value}
            onClick={() => onStatusChange(opt.value)}
            className={`text-xs font-semibold px-3 py-1 rounded-full border transition-all lowercase ${
              status === opt.value
                ? opt.activeClass
                : "bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
        {isEditing && !isStandalone && !!effectiveWorkspaceId && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onDuplicate}
            disabled={isDuplicating}
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg"
            title="duplicar tarefa"
          >
            {isDuplicating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
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
  );
}
