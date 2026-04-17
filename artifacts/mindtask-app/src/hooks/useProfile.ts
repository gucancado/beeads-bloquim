import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const customFetch = (url: string, options?: RequestInit) => {
  return fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
};

export interface MyWorkspace {
  id: string;
  name: string;
  hidden: boolean;
  role: "admin" | "editor" | "executor";
  createdAt: string;
}

export function useMyWorkspaces() {
  return useQuery({
    queryKey: ["/api/auth/me/workspaces"],
    queryFn: async () => {
      const res = await customFetch("/api/auth/me/workspaces");
      if (!res.ok) throw new Error("Failed to fetch workspaces");
      return res.json() as Promise<MyWorkspace[]>;
    },
  });
}

interface UpdateMePayload {
  name?: string;
  avatarUrl?: string | null;
}

export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateMePayload | string) => {
      const body = typeof payload === "string" ? { name: payload } : payload;
      const res = await customFetch("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update profile");
      return res.json() as Promise<{ id: string; name: string; email: string; avatarUrl?: string | null }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });
}
