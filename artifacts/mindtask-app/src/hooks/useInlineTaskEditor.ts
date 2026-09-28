// Data layer for inline-editing a task row: local optimistic state, PATCH
// calls, and the "represa" that holds list invalidation while the schedule
// popover is open. Extracted from TaskListItem so the weekly calendar's
// cards can reuse the same behavior.
import { useState, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import type { TaskListItemData } from "@/components/tasks/TaskListItem";

export function useInlineTaskEditor<T extends TaskListItemData>(opts: {
  task: T;
  invalidateQueryKeys: readonly (readonly unknown[])[];
  countsQueryKeys?: readonly (readonly unknown[])[];
}) {
  const { task, invalidateQueryKeys, countsQueryKeys = [] } = opts;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [localTask, setLocalTask] = useState<T>(task);

  useEffect(() => {
    setLocalTask(task);
  }, [task]);

  const isLinkedToCard = !!(task.cardId && task.mapId);

  const isStandaloneTask = !task.workspaceId;

  // Enquanto o popover de prazo está aberto, a invalidação da lista fica
  // represada: cada escolha (modalidade, depois a data) muda o agrupamento, e
  // o refetch arrancaria a linha — junto com o popover — no meio da
  // configuração. Ex.: urgente → "fazer até" ainda sem data sai da janela
  // "hoje". A linha segue mostrando `localTask` (otimista) e a lista atualiza
  // quando o popover fecha.
  const scheduleOpenRef = useRef(false);
  const pendingInvalidateRef = useRef(false);

  const invalidate = useCallback(() => {
    if (scheduleOpenRef.current) {
      pendingInvalidateRef.current = true;
      return;
    }
    invalidateQueryKeys.forEach(k => queryClient.invalidateQueries({ queryKey: k }));
    if (task.mapId && task.workspaceId) {
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${task.workspaceId}/maps/${task.mapId}`] });
      if (task.cardId) {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${task.workspaceId}/maps/${task.mapId}/cards/${task.cardId}`] });
      }
    }
  }, [invalidateQueryKeys, queryClient, task.mapId, task.cardId, task.workspaceId]);

  const handleScheduleOpenChange = useCallback((open: boolean) => {
    scheduleOpenRef.current = open;
    if (!open && pendingInvalidateRef.current) {
      pendingInvalidateRef.current = false;
      invalidate();
    }
  }, [invalidate]);

  // Desmontar com invalidação represada (a linha saiu por outro motivo, ou a
  // página trocou) não pode engolir a atualização da lista.
  useEffect(() => () => {
    if (pendingInvalidateRef.current) {
      pendingInvalidateRef.current = false;
      scheduleOpenRef.current = false;
      invalidateQueryKeys.forEach(k => queryClient.invalidateQueries({ queryKey: k }));
    }
  }, [invalidateQueryKeys, queryClient]);

  const patchTask = useCallback(async (body: Record<string, unknown>) => {
    try {
      const url = isStandaloneTask
        ? `/api/my-tasks/${task.id}`
        : `/api/workspaces/${task.workspaceId}/tasks/${task.id}`;
      const updated = await customFetch<Partial<T>>(url, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setLocalTask(prev => ({ ...prev, ...updated }));
      invalidate();
    } catch (err) {
      console.error("Inline edit failed:", err);
      toast({
        title: "Não foi possível salvar a alteração.",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    }
  }, [task.workspaceId, task.id, invalidate, isStandaloneTask, toast]);

  const invalidateCounts = useCallback(() => {
    countsQueryKeys.forEach(k => queryClient.invalidateQueries({ queryKey: k }));
  }, [countsQueryKeys, queryClient]);

  const patchStatus = useCallback(async (newStatus: string) => {
    try {
      const url = isStandaloneTask
        ? `/api/my-tasks/${task.id}/status`
        : `/api/workspaces/${task.workspaceId}/tasks/${task.id}/status`;
      const updated = await customFetch<Partial<T>>(url, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      setLocalTask(prev => ({ ...prev, ...updated }));
      // Mudar status pode alterar a ordenação da lista (o sort do backend
      // considera urgente/dueDate/priority mas a tarefa também pode sair do
      // filtro ativo, ou outro overdue cruzar pra cima). Invalida a lista
      // junto com os counts pra refazer o fetch.
      invalidate();
      invalidateCounts();
    } catch (err) {
      console.error("Inline status update failed:", err);
      toast({
        title: "Não foi possível mudar o status.",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    }
  }, [task.workspaceId, task.id, isStandaloneTask, invalidate, invalidateCounts, toast]);

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
      toast({
        title: "Não foi possível renomear o card.",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    }
  }, [task.workspaceId, task.mapId, task.cardId, invalidate, toast]);

  const saveTitle = useCallback(async (next: string) => {
    if (isLinkedToCard) await updateCardTitle(next);
    else await patchTask({ title: next });
  }, [isLinkedToCard, updateCardTitle, patchTask]);

  return {
    localTask,
    setLocalTask,
    isStandaloneTask,
    isLinkedToCard,
    invalidate,
    handleScheduleOpenChange,
    patchTask,
    patchStatus,
    updateCardTitle,
    saveTitle,
  };
}
