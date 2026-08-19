import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import type { RecurrenceConfig } from "@/components/tasks/RecurrencePanel";

export interface UseTaskAssociationArgs {
  resolvedTaskId: string | undefined;
  propWorkspaceId: string | undefined;
  currentUserId: string;
  open: boolean;
  isCardMode: boolean;
  markDirty: () => void;
  setAssignedTo: (v: string) => void;
  setIsRecurring: (v: boolean) => void;
  setRecurrenceConfig: (v: RecurrenceConfig | null) => void;
  setShowRecurrencePanel: (v: boolean) => void;
}

export function useTaskAssociation({
  resolvedTaskId,
  propWorkspaceId,
  currentUserId,
  open,
  isCardMode,
  markDirty,
  setAssignedTo,
  setIsRecurring,
  setRecurrenceConfig,
  setShowRecurrencePanel,
}: UseTaskAssociationArgs) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // taskWorkspaceId is the single source of truth for the task's scope: it starts
  // as the workspace the modal was opened from (empty for "Minhas tarefas") and
  // follows the task from then on — including when the user associates the task
  // to a workspace inside the modal. Deriving the scope from the PROP instead
  // left every write routed at /api/my-tasks/* after an in-modal association,
  // which the API rejects with 403 "Use a rota do workspace".
  const [taskWorkspaceId, setTaskWorkspaceId] = useState<string | null>(propWorkspaceId || null);
  const [taskMapId, setTaskMapId] = useState<string | null>(null);

  // Reset the scope whenever the modal is (re)opened for another task, so the
  // previous task's workspace never leaks into the next one.
  useEffect(() => {
    setTaskWorkspaceId(propWorkspaceId || null);
    setTaskMapId(null);
  }, [open, resolvedTaskId, propWorkspaceId]);

  const effectiveWorkspaceId = taskWorkspaceId ?? "";

  const { data: userWorkspaces } = useQuery<{ id: string; name: string; colorIndex?: number | null }[]>({
    queryKey: ["/api/workspaces"],
    queryFn: () => customFetch("/api/workspaces"),
    enabled: open,
  });

  const { data: workspaceMaps } = useQuery<{ id: string; name: string; hidden: boolean }[]>({
    queryKey: [`/api/workspaces/${effectiveWorkspaceId}/maps`],
    queryFn: () => customFetch(`/api/workspaces/${effectiveWorkspaceId}/maps`),
    enabled: open && !!effectiveWorkspaceId,
    select: (data) => data.filter(m => !m.hidden),
  });

  const invalidateTask = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/my-tasks"] });
    if (effectiveWorkspaceId) {
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${effectiveWorkspaceId}/tasks`] });
    }
  };

  const changeWorkspace = (newWsId: string | null) => {
    if (!resolvedTaskId) return;
    const previousWsId = taskWorkspaceId;
    customFetch(`/api/my-tasks/${resolvedTaskId}/association`, {
      method: "PATCH",
      body: JSON.stringify({ workspaceId: newWsId, mapId: null }),
    }).then(() => {
      setTaskWorkspaceId(newWsId);
      setTaskMapId(null);
      markDirty();
      if (!newWsId) {
        setAssignedTo(currentUserId);
      }
      invalidateTask();
      queryClient.invalidateQueries({ queryKey: [`/api/my-tasks/${resolvedTaskId}`] });
      // The task left its previous workspace — that list/detail is stale too.
      if (previousWsId && previousWsId !== newWsId) {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${previousWsId}/tasks`] });
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${previousWsId}/tasks/${resolvedTaskId}`] });
      }
      if (newWsId) {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${newWsId}/tasks`] });
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${newWsId}/tasks/${resolvedTaskId}`] });
      }
    }).catch(() => toast({ title: "Erro ao alterar workspace", variant: "destructive" }));
  };

  const changeMap = (newMapId: string | null) => {
    if (!resolvedTaskId) return;
    customFetch(`/api/my-tasks/${resolvedTaskId}/association`, {
      method: "PATCH",
      body: JSON.stringify({ mapId: newMapId }),
    }).then(() => {
      setTaskMapId(newMapId);
      markDirty();
      // Clear recurrence when associating with a map
      if (newMapId) {
        setIsRecurring(false);
        setRecurrenceConfig(null);
        setShowRecurrencePanel(false);
      }
      invalidateTask();
    }).catch(() => toast({ title: "Erro ao alterar plano", variant: "destructive" }));
  };

  return {
    taskWorkspaceId,
    setTaskWorkspaceId,
    taskMapId,
    setTaskMapId,
    effectiveWorkspaceId,
    userWorkspaces,
    workspaceMaps,
    changeWorkspace,
    changeMap,
  };
}
