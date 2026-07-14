import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export type Meeting = {
  id: string;
  workspaceId: string | null;
  mapId: string | null;
  title: string | null;
  meetCode: string;
  status: "collecting" | "transcribed" | "failed" | "canceled";
  failureReason: string | null;
  episodeId: number | null;
  participants: Array<{ name: string; segments: number }> | null;
  occurredAt: string;
  durationSeconds: number | null;
};

const MEETINGS_KEY = ["/api/meetings"];

export function useMeetings(workspaceId?: string | null) {
  const qs = workspaceId ? `?${new URLSearchParams({ workspaceId }).toString()}` : "";
  return useQuery<Meeting[]>({
    queryKey: [...MEETINGS_KEY, workspaceId ?? "standalone"],
    queryFn: () => customFetch(`/api/meetings${qs}`),
  });
}

/** Poll individual das reuniões em coleta (poll-through no backend). */
export function useMeetingPoll(id: string, enabled: boolean) {
  return useQuery<Meeting>({
    queryKey: [`/api/meetings/${id}`],
    queryFn: () => customFetch(`/api/meetings/${id}`),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
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
