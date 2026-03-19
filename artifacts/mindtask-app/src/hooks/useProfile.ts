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

export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const res = await customFetch("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to update profile");
      return res.json() as Promise<{ id: string; name: string; email: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });
}
