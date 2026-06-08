import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

/**
 * Hooks do grafo estratégico (Mapa Estratégico, Fase 4). Custom (customFetch +
 * React Query) em vez de Orval — o escape hatch sancionado pelo CLAUDE.md para
 * hooks fora do codegen. Espelha o contrato de routes/strategy.ts.
 */

export type StrategyNodeKind = "objetivo" | "swot" | "tema" | "kr" | "plano" | "recurso";

export interface StrategyNode {
  id: string;
  kind: StrategyNodeKind;
  positionX: number;
  positionY: number;
  width: number | null;
  color: string | null;
  readOnly: boolean;
  data: Record<string, any>;
}

export interface StrategyEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: string | null;
  label: string | null;
  metadata: unknown;
}

export interface StrategyCycle {
  id: string;
  label: string;
  status: "ativo" | "arquivado";
  startsOn: string;
  endsOn: string;
}

export interface StrategyGraph {
  map: { id: string; kind: string; name: string; workspaceId: string };
  cycle: StrategyCycle | null;
  nodes: StrategyNode[];
  edges: StrategyEdge[];
}

export const strategyKey = (workspaceId: string) => ["strategy", workspaceId] as const;
const base = (wsId: string) => `/api/workspaces/${wsId}/strategy`;

export function useStrategyGraph(workspaceId: string) {
  return useQuery({
    queryKey: strategyKey(workspaceId),
    queryFn: () => customFetch<StrategyGraph>(base(workspaceId)),
    enabled: !!workspaceId,
    // paridade com o plano de ação: refetch periódico leve (§7.6)
    refetchInterval: 5000,
  });
}

export function useCreateStrategyNode(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { kind: StrategyNodeKind; positionX: number; positionY: number; width?: number | null; color?: string | null; data: Record<string, any> }) =>
      customFetch<StrategyNode>(`${base(workspaceId)}/nodes`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: strategyKey(workspaceId) }),
  });
}

export function useUpdateStrategyNode(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ nodeId, ...body }: { nodeId: string; positionX?: number; positionY?: number; width?: number | null; color?: string | null; data?: Record<string, any> }) =>
      customFetch(`${base(workspaceId)}/nodes/${nodeId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: strategyKey(workspaceId) }),
  });
}

export function useDeleteStrategyNode(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (nodeId: string) =>
      customFetch(`${base(workspaceId)}/nodes/${nodeId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: strategyKey(workspaceId) }),
  });
}

export function useCreateStrategyEdge(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { sourceNodeId: string; targetNodeId: string; relationType?: string | null; label?: string | null }) =>
      customFetch<StrategyEdge>(`${base(workspaceId)}/edges`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: strategyKey(workspaceId) }),
  });
}

export function useUpdateStrategyEdge(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ edgeId, ...body }: { edgeId: string; relationType?: string | null; label?: string | null; metadata?: unknown }) =>
      customFetch(`${base(workspaceId)}/edges/${edgeId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: strategyKey(workspaceId) }),
  });
}

export function useDeleteStrategyEdge(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (edgeId: string) =>
      customFetch(`${base(workspaceId)}/edges/${edgeId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: strategyKey(workspaceId) }),
  });
}

export function useOpenStrategyCycle(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { label: string; startsOn?: string; endsOn?: string }) =>
      customFetch<StrategyCycle>(`${base(workspaceId)}/cycles`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: strategyKey(workspaceId) }),
  });
}
