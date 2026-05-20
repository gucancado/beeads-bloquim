import { useGetTaskAttachmentUsage } from "@workspace/api-client-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";

interface DeleteAttachmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  taskId: string;
  attachmentId: string;
  fileName: string;
  isPending: boolean;
  onConfirm: () => void;
}

/**
 * Confirm-delete dialog for the "apagar arquivo" action. Queries the usage
 * endpoint so the user sees how many tasks lose the attachment, then runs
 * the hard delete on confirm.
 */
export function DeleteAttachmentDialog({
  open,
  onOpenChange,
  workspaceId,
  taskId,
  attachmentId,
  fileName,
  isPending,
  onConfirm,
}: DeleteAttachmentDialogProps) {
  const { data: usage, isLoading } = useGetTaskAttachmentUsage(
    workspaceId,
    taskId,
    attachmentId,
    { query: { enabled: open } },
  );

  const taskCount = usage?.taskCount ?? 0;
  const otherTasks = Math.max(taskCount - 1, 0);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Apagar &quot;{fileName}&quot;?</AlertDialogTitle>
          <AlertDialogDescription>
            {isLoading ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" /> verificando uso…
              </span>
            ) : taskCount > 1 ? (
              <>
                Este arquivo está vinculado a <strong>{taskCount} tarefas</strong>{" "}
                (incluindo esta). Apagá-lo o remove de todas elas
                {otherTasks > 0 ? ` — outras ${otherTasks} ${otherTasks === 1 ? "tarefa" : "tarefas"} perderão o arquivo.` : "."}
                <br />
                Esta ação não pode ser desfeita.
              </>
            ) : (
              <>
                O arquivo será apagado e não poderá ser recuperado.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={isPending || isLoading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> apagando…
              </span>
            ) : taskCount > 1 ? (
              "Apagar de todas as tarefas"
            ) : (
              "Apagar arquivo"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
