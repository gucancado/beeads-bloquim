import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const customFetch = (url: string, options?: RequestInit) => {
  const token = localStorage.getItem("mindtask_token");
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  });
};

export function useToggleWorkspaceHidden(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (hidden: boolean) => {
      const res = await customFetch(`/api/workspaces/${workspaceId}/hidden`, {
        method: "PATCH",
        body: JSON.stringify({ hidden }),
      });
      if (!res.ok) throw new Error("Failed to update workspace visibility");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}`] });
    },
  });
}

export function useToggleMapHidden(workspaceId: string, mapId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (hidden: boolean) => {
      const res = await customFetch(`/api/workspaces/${workspaceId}/maps/${mapId}/hidden`, {
        method: "PATCH",
        body: JSON.stringify({ hidden }),
      });
      if (!res.ok) throw new Error("Failed to update map visibility");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps`] });
    },
  });
}

export function useListWorkspacesWithHidden(showHidden: boolean) {
  return useQuery({
    queryKey: ["/api/workspaces", { showHidden }],
    queryFn: async () => {
      const url = showHidden ? "/api/workspaces?showHidden=true" : "/api/workspaces";
      const res = await customFetch(url);
      if (!res.ok) throw new Error("Failed to fetch workspaces");
      return res.json() as Promise<Array<{
        id: string;
        name: string;
        hidden: boolean;
        role: string;
        createdAt: string;
        createdBy: string;
      }>>;
    },
  });
}

export function useListMapsWithHidden(workspaceId: string, showHidden: boolean) {
  return useQuery({
    queryKey: [`/api/workspaces/${workspaceId}/maps`, { showHidden }],
    queryFn: async () => {
      const url = showHidden
        ? `/api/workspaces/${workspaceId}/maps?showHidden=true`
        : `/api/workspaces/${workspaceId}/maps`;
      const res = await customFetch(url);
      if (!res.ok) throw new Error("Failed to fetch maps");
      return res.json() as Promise<Array<{
        id: string;
        name: string;
        hidden: boolean;
        workspaceId: string;
        createdAt: string;
        updatedAt: string;
      }>>;
    },
    enabled: !!workspaceId,
  });
}
