import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface CommentItem {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  content: string;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("mindtask_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function useComments(workspaceId: string, mapId: string, cardId: string | null) {
  return useQuery<CommentItem[]>({
    queryKey: [`comments`, workspaceId, mapId, cardId],
    queryFn: () =>
      apiFetch<CommentItem[]>(
        `${BASE}/api/workspaces/${workspaceId}/maps/${mapId}/cards/${cardId}/comments`
      ),
    enabled: !!cardId,
    staleTime: 0,
  });
}

export function useCreateComment(workspaceId: string, mapId: string, cardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      apiFetch<CommentItem>(
        `${BASE}/api/workspaces/${workspaceId}/maps/${mapId}/cards/${cardId}/comments`,
        { method: "POST", body: JSON.stringify({ content }) }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`comments`, workspaceId, mapId, cardId] });
    },
  });
}

export function useToggleCommentHidden(workspaceId: string, mapId: string, cardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      apiFetch<CommentItem>(
        `${BASE}/api/workspaces/${workspaceId}/maps/${mapId}/cards/${cardId}/comments/${commentId}`,
        { method: "PATCH" }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`comments`, workspaceId, mapId, cardId] });
    },
  });
}
