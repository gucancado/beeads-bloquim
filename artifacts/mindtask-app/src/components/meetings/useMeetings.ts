import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export type MeetingStatus =
  | "collecting" | "transcribed" | "failed" | "canceled"
  | "scheduled" | "needs_triage" | "missed";

export type Meeting = {
  id: string;
  workspaceId: string | null;
  mapId: string | null;
  title: string | null;
  meetCode: string;
  status: MeetingStatus;
  failureReason: string | null;
  episodeId: number | null;
  participants: Array<{ name: string; segments: number }> | null;
  occurredAt: string;
  durationSeconds: number | null;
  // agenda (F2)
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  attendees: Array<{ email: string; displayName?: string }> | null;
  collectEnabled: boolean;
  attributionMethod: string | null;
  gcalEventId: string | null;
  gcalRecurringEventId: string | null;
};

const MEETINGS_KEY = ["/api/meetings"];

export function useMeetings(workspaceId?: string | null) {
  const qs = workspaceId ? `?${new URLSearchParams({ workspaceId }).toString()}` : "";
  return useQuery<Meeting[]>({
    queryKey: [...MEETINGS_KEY, workspaceId ?? "standalone"],
    queryFn: () => customFetch(`/api/meetings${qs}`),
  });
}

const UPCOMING_KEY = ["/api/meetings/upcoming"];

/** Próximas reuniões da janela sincronizada (seção "próximas" da agenda). O
 *  backend já deduplica recorrência e ordena; o refetch moderado reflete novas
 *  rows do sync (cron 15min) sem poll agressivo. */
export function useUpcomingMeetings() {
  return useQuery<Meeting[]>({
    queryKey: UPCOMING_KEY,
    queryFn: () => customFetch("/api/meetings/upcoming"),
    refetchInterval: 60_000,
  });
}

function invalidateAgenda(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: UPCOMING_KEY });
  qc.invalidateQueries({ queryKey: MEETINGS_KEY });
}

export function useToggleCollect(id: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (body: { collectEnabled: boolean }) =>
      customFetch(`/api/meetings/${id}/collect`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => invalidateAgenda(qc),
    onError: (e: any) => toast({ title: "Erro ao alterar a coleta", description: e?.message, variant: "destructive" }),
  });
}

export function useTriageMeeting(id: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (body: { workspaceId: string; titleRulePattern?: string }): Promise<{ meeting: Meeting; titleRuleCreated: boolean }> =>
      customFetch(`/api/meetings/${id}/triage`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (res) => {
      invalidateAgenda(qc);
      toast({
        title: "Reunião atribuída",
        description: res.titleRuleCreated ? "Regra criada — as próximas resolvem sozinhas." : "Regra não criada (worker indisponível).",
      });
    },
    onError: (e: any) => toast({ title: "Erro na triagem", description: e?.message, variant: "destructive" }),
  });
}

export function useDiscardMeeting(id: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: () => customFetch(`/api/meetings/${id}/discard`, { method: "POST" }),
    onSuccess: () => invalidateAgenda(qc),
    onError: (e: any) => toast({ title: "Erro ao descartar", description: e?.message, variant: "destructive" }),
  });
}

/** Poll individual das reuniões em coleta (poll-through no backend).
 *  `enabled` é o gate inicial (status da lista); o `refetchInterval` é data-driven
 *  e PARA quando o status buscado deixa de ser "collecting" — senão o poll seguiria
 *  indefinidamente após a reunião virar transcribed pela própria resposta. */
export function useMeetingPoll(id: string, enabled: boolean) {
  return useQuery<Meeting>({
    queryKey: [`/api/meetings/${id}`],
    queryFn: () => customFetch(`/api/meetings/${id}`),
    enabled,
    refetchInterval: (query) => (query.state.data?.status === "collecting" ? 10_000 : false),
  });
}

export function useCreateMeeting() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (body: { meetUrlOrCode: string; workspaceId: string | null; mapId: string | null; title: string | null }) =>
      customFetch("/api/meetings", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: MEETINGS_KEY }),
    onError: (e: any) => toast({ title: "Erro ao iniciar reunião", description: e?.message, variant: "destructive" }),
  });
}

export function useMeetingAssociation(id: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (body: { workspaceId?: string | null; mapId?: string | null }) =>
      customFetch(`/api/meetings/${id}/association`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: MEETINGS_KEY }),
    onError: (e: any) => {
      const frozen = e?.data?.error === "attribution_frozen";
      toast({ title: frozen ? "Atribuição congelada" : "Erro ao reatribuir", description: e?.message, variant: "destructive" });
    },
  });
}

export function useStopMeeting(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => customFetch(`/api/meetings/${id}/stop`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: MEETINGS_KEY }),
  });
}
