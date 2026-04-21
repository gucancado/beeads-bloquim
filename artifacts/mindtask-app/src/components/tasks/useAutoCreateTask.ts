import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export interface UseAutoCreateTaskArgs {
  open: boolean;
  isCardMode: boolean;
  taskId: string | null;
  propWorkspaceId: string;
  currentUserId: string;
  setTitle: (v: string) => void;
  setAssignedTo: (v: string) => void;
  setTaskWorkspaceId: (v: string | null) => void;
  invalidateTask: () => void;
  onAutoCreated?: (taskId: string) => void;
}

export function useAutoCreateTask({
  open,
  isCardMode,
  taskId,
  propWorkspaceId,
  currentUserId,
  setTitle,
  setAssignedTo,
  setTaskWorkspaceId,
  invalidateTask,
  onAutoCreated,
}: UseAutoCreateTaskArgs) {
  const [autoCreatedTaskId, setAutoCreatedTaskId] = useState<string | null>(null);
  const [autoCreateDirty, setAutoCreateDirty] = useState(false);
  const [autoCreateError, setAutoCreateError] = useState(false);
  const autoCreateMutRef = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;

  const autoCreateMutation = useMutation({
    mutationFn: () => {
      if (propWorkspaceId) {
        return customFetch(`/api/workspaces/${propWorkspaceId}/tasks`, {
          method: "POST",
          body: JSON.stringify({ title: "nova tarefa", priority: "medium" }),
        });
      }
      return customFetch("/api/my-tasks", {
        method: "POST",
        body: JSON.stringify({ title: "nova tarefa", priority: "medium" }),
      });
    },
    onSuccess: (newTask: { id: string }) => {
      const wasStandalone = !propWorkspaceId;
      if (!openRef.current) {
        const delPath = wasStandalone
          ? `/api/my-tasks/${newTask.id}`
          : `/api/workspaces/${propWorkspaceId}/tasks/${newTask.id}`;
        customFetch(delPath, { method: "DELETE" }).catch(() => {});
        invalidateTask();
        return;
      }
      setAutoCreatedTaskId(newTask.id);
      onAutoCreated?.(newTask.id);

      setTitle("nova tarefa");
      setAssignedTo(currentUserId);
      if (propWorkspaceId) {
        setTaskWorkspaceId(propWorkspaceId);
      }
      invalidateTask();
    },
    onError: () => {
      autoCreateMutRef.current = false;
      setAutoCreateError(true);
    },
  });

  useEffect(() => {
    if (open && !isCardMode && !taskId && !autoCreatedTaskId && !autoCreateMutRef.current && !autoCreateError) {
      autoCreateMutRef.current = true;
      setAutoCreateError(false);
      autoCreateMutation.mutate();
    }
    if (!open) {
      autoCreateMutRef.current = false;
      setAutoCreateError(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isCardMode, taskId, autoCreatedTaskId, autoCreateError]);

  // Reset auto-create state when modal closes (was previously inline in modal).
  useEffect(() => {
    if (!open) {
      setAutoCreatedTaskId(null);
      setAutoCreateDirty(false);
    }
  }, [open]);

  const isAutoCreating =
    !autoCreateError && (autoCreateMutation.isPending || (!isCardMode && !taskId && !autoCreatedTaskId));

  const retryAutoCreate = () => {
    setAutoCreateError(false);
    autoCreateMutRef.current = false;
  };

  return {
    autoCreatedTaskId,
    autoCreateDirty,
    setAutoCreateDirty,
    autoCreateError,
    isAutoCreating,
    retryAutoCreate,
  };
}
