import { useMutation } from "@tanstack/react-query";
import type { UseMutationOptions } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface TextElementResponse {
  id: string;
  mapId: string;
  content: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  fontSize: number;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTextElementRequest {
  positionX?: number;
  positionY?: number;
  width?: number;
  height?: number;
  fontSize?: number;
  color?: string;
  content?: string;
}

export interface UpdateTextElementRequest {
  content?: string;
  positionX?: number;
  positionY?: number;
  width?: number;
  height?: number;
  fontSize?: number;
  color?: string;
}

export const createTextElement = async (
  workspaceId: string,
  mapId: string,
  data: CreateTextElementRequest,
): Promise<TextElementResponse> => {
  return customFetch<TextElementResponse>(
    `/api/workspaces/${workspaceId}/maps/${mapId}/text-elements`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
};

export const updateTextElement = async (
  workspaceId: string,
  mapId: string,
  elementId: string,
  data: UpdateTextElementRequest,
): Promise<TextElementResponse> => {
  return customFetch<TextElementResponse>(
    `/api/workspaces/${workspaceId}/maps/${mapId}/text-elements/${elementId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
};

export const deleteTextElement = async (
  workspaceId: string,
  mapId: string,
  elementId: string,
): Promise<{ success: boolean }> => {
  return customFetch<{ success: boolean }>(
    `/api/workspaces/${workspaceId}/maps/${mapId}/text-elements/${elementId}`,
    { method: "DELETE" },
  );
};

export const useCreateTextElement = (
  options?: UseMutationOptions<
    TextElementResponse,
    unknown,
    { workspaceId: string; mapId: string; data: CreateTextElementRequest }
  >,
) => {
  return useMutation({
    mutationFn: ({ workspaceId, mapId, data }) =>
      createTextElement(workspaceId, mapId, data),
    ...options,
  });
};

export const useUpdateTextElement = (
  options?: UseMutationOptions<
    TextElementResponse,
    unknown,
    { workspaceId: string; mapId: string; elementId: string; data: UpdateTextElementRequest }
  >,
) => {
  return useMutation({
    mutationFn: ({ workspaceId, mapId, elementId, data }) =>
      updateTextElement(workspaceId, mapId, elementId, data),
    ...options,
  });
};

export const useDeleteTextElement = (
  options?: UseMutationOptions<
    { success: boolean },
    unknown,
    { workspaceId: string; mapId: string; elementId: string }
  >,
) => {
  return useMutation({
    mutationFn: ({ workspaceId, mapId, elementId }) =>
      deleteTextElement(workspaceId, mapId, elementId),
    ...options,
  });
};
