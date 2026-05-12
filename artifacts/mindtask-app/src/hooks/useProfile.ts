import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserClass, UserPronouns } from "@workspace/api-client-react";

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
  whatsapp?: string | null;
  classes?: UserClass[];
  pronouns?: UserPronouns;
}

export function useUpdateMe() {
  const queryClient = useQueryClient();
  const meKey = ["/api/auth/me"] as const;
  return useMutation({
    mutationFn: async (payload: UpdateMePayload | string) => {
      const body = typeof payload === "string" ? { name: payload } : payload;
      const res = await customFetch("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update profile");
      return res.json() as Promise<Record<string, unknown>>;
    },
    // Apply the change to the cache up front so checkboxes/selects don't
    // visibly flip back-and-forth while the request is in flight. Mirrors how
    // task edits feel — the UI commits immediately, the network catches up.
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: meKey });
      const previous = queryClient.getQueryData<Record<string, unknown>>(meKey);
      const patch = typeof payload === "string" ? { name: payload } : payload;
      if (previous) {
        queryClient.setQueryData(meKey, { ...previous, ...patch });
      }
      return { previous };
    },
    onError: (_err, _payload, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(meKey, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: meKey });
    },
  });
}
