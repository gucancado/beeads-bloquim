import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { statusFilterToApi } from "@/lib/taskStatusConstants";
import { weekBoundsISO } from "@/lib/calendar/week";
import type { CalendarMeeting, CalendarTask } from "@/lib/calendar/placement";
import type { OptimisticPatch, ReorderBody } from "@/lib/calendar/dnd";

export type CalendarScope = { kind: "my" } | { kind: "workspace"; workspaceId: string };

/** Prefixo igual ao da lista: toda invalidação existente por prefixo atualiza o calendário. */
function tasksBaseKey(scope: CalendarScope): string {
  return scope.kind === "my" ? "/api/my-tasks" : `/api/workspaces/${scope.workspaceId}/tasks`;
}

export function calendarTasksKey(scope: CalendarScope, weekStart: string, status: string, assignees: string[]): unknown[] {
  return [tasksBaseKey(scope), "calendar", weekStart, status, assignees];
}

export function calendarMeetingsKey(scope: CalendarScope, weekStart: string): unknown[] {
  return ["/api/meetings", "calendar", scope.kind === "my" ? "my" : scope.workspaceId, weekStart];
}

export function useCalendarTasks(scope: CalendarScope, weekStart: string, status: string, assignees: string[]) {
  return useQuery<CalendarTask[]>({
    queryKey: calendarTasksKey(scope, weekStart, status, assignees),
    queryFn: () => {
      const { from, to } = weekBoundsISO(weekStart);
      const p = new URLSearchParams({ from, to, status: statusFilterToApi(status), assignedTo: assignees.join(",") });
      if (scope.kind === "workspace") p.set("workspaceId", scope.workspaceId);
      return customFetch<CalendarTask[]>(`/api/calendar/tasks?${p.toString()}`);
    },
    // Troca de semana mantém o kanban na tela enquanto a próxima carrega.
    placeholderData: keepPreviousData,
  });
}

export function useCalendarMeetings(scope: CalendarScope, weekStart: string) {
  return useQuery<CalendarMeeting[]>({
    queryKey: calendarMeetingsKey(scope, weekStart),
    queryFn: async () => {
      const { from, to } = weekBoundsISO(weekStart);
      const p = new URLSearchParams({ from, to });
      if (scope.kind === "workspace") p.set("workspaceId", scope.workspaceId);
      try {
        return await customFetch<CalendarMeeting[]>(`/api/meetings?${p.toString()}`);
      } catch (err) {
        // 503 = integração de reuniões desligada no ambiente: calendário sem reuniões.
        if ((err as { status?: number }).status === 503) return [];
        throw err;
      }
    },
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function applyOptimistic<T extends { id: string }>(rows: T[] | undefined, patch: Record<string, object>): T[] | undefined {
  if (!rows) return rows;
  return rows.map(r => (patch[r.id] ? { ...r, ...patch[r.id] } : r));
}

export function useReorderCalendar(tasksKey: unknown[], meetingsKey: unknown[], extraInvalidate: unknown[][]) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ body }: { body: ReorderBody; optimistic: OptimisticPatch }) =>
      customFetch("/api/calendar/reorder", { method: "PUT", body: JSON.stringify(body) }),
    onMutate: async ({ optimistic }) => {
      await qc.cancelQueries({ queryKey: tasksKey });
      await qc.cancelQueries({ queryKey: meetingsKey });
      const prevTasks = qc.getQueryData<CalendarTask[]>(tasksKey);
      const prevMeetings = qc.getQueryData<CalendarMeeting[]>(meetingsKey);
      qc.setQueryData<CalendarTask[]>(tasksKey, rows => applyOptimistic(rows, optimistic.tasks));
      qc.setQueryData<CalendarMeeting[]>(meetingsKey, rows => applyOptimistic(rows, optimistic.meetings));
      return { prevTasks, prevMeetings };
    },
    onError: (err, _vars, ctx) => {
      qc.setQueryData(tasksKey, ctx?.prevTasks);
      qc.setQueryData(meetingsKey, ctx?.prevMeetings);
      toast({
        title: "Não foi possível reorganizar.",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [tasksKey[0]] });
      qc.invalidateQueries({ queryKey: meetingsKey });
      extraInvalidate.forEach(k => qc.invalidateQueries({ queryKey: k }));
    },
  });
}
