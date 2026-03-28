import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface CommentItem {
  id: string;
  taskId: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string | null;
  content: string;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskActivityItem {
  id: string;
  taskId: string;
  actorId: string | null;
  actorName: string | null;
  actorAvatarUrl: string | null;
  type: "task_created" | "assignee_changed" | "status_changed";
  metadata: Record<string, string | null>;
  createdAt: string;
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

export function useTaskComments(workspaceId: string, taskId: string | null) {
  return useQuery<CommentItem[]>({
    queryKey: [`task-comments`, workspaceId, taskId],
    queryFn: () =>
      apiFetch<CommentItem[]>(
        `${BASE}/api/workspaces/${workspaceId}/tasks/${taskId}/comments`
      ),
    enabled: !!taskId,
    staleTime: 0,
  });
}

export function useCreateTaskComment(workspaceId: string, taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      apiFetch<CommentItem>(
        `${BASE}/api/workspaces/${workspaceId}/tasks/${taskId}/comments`,
        { method: "POST", body: JSON.stringify({ content }) }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`task-comments`, workspaceId, taskId] });
    },
  });
}

export function useToggleTaskCommentHidden(workspaceId: string, taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      apiFetch<CommentItem>(
        `${BASE}/api/workspaces/${workspaceId}/tasks/${taskId}/comments/${commentId}`,
        { method: "PATCH" }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`task-comments`, workspaceId, taskId] });
    },
  });
}

export function useStandaloneTaskComments(taskId: string | null) {
  return useQuery<CommentItem[]>({
    queryKey: [`standalone-task-comments`, taskId],
    queryFn: () => apiFetch<CommentItem[]>(`${BASE}/api/my-tasks/${taskId}/comments`),
    enabled: !!taskId,
    staleTime: 0,
  });
}

export function useCreateStandaloneTaskComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      apiFetch<CommentItem>(`${BASE}/api/my-tasks/${taskId}/comments`, {
        method: "POST",
        body: JSON.stringify({ content }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`standalone-task-comments`, taskId] });
    },
  });
}

export function useTaskActivities(workspaceId: string | null, taskId: string | null) {
  const isWorkspace = !!workspaceId;
  return useQuery<TaskActivityItem[]>({
    queryKey: [`task-activities`, workspaceId ?? "standalone", taskId],
    queryFn: () =>
      apiFetch<TaskActivityItem[]>(
        isWorkspace
          ? `${BASE}/api/workspaces/${workspaceId}/tasks/${taskId}/activities`
          : `${BASE}/api/my-tasks/${taskId}/activities`
      ),
    enabled: !!taskId,
    staleTime: 0,
  });
}
