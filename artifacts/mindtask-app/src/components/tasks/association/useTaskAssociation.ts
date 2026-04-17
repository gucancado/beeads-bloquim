import { useState } from "react";
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

  const [showMore, setShowMore] = useState(false);
  const [taskWorkspaceId, setTaskWorkspaceId] = useState<string | null>(null);
  const [taskMapId, setTaskMapId] = useState<string | null>(null);

  const effectiveWorkspaceId = propWorkspaceId || taskWorkspaceId || "";

  const { data: userWorkspaces } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/workspaces"],
    queryFn: () => customFetch("/api/workspaces"),
    enabled: open && !isCardMode,
  });

  const { data: workspaceMaps } = useQuery<{ id: string; name: string; hidden: boolean }[]>({
    queryKey: [`/api/workspaces/${effectiveWorkspaceId}/maps`],
    queryFn: () => customFetch(`/api/workspaces/${effectiveWorkspaceId}/maps`),
    enabled: open && !!effectiveWorkspaceId && !isCardMode,
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
    showMore,
    setShowMore,
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
