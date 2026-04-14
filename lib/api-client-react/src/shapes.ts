import { useMutation } from "@tanstack/react-query";
import type { UseMutationOptions } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface ShapeResponse {
  id: string;
  mapId: string;
  type: "line" | "rect" | "ellipse";
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
  filled: boolean;
  strokeStyle: "solid" | "dashed";
  x1: number | null;
  y1: number | null;
  x2: number | null;
  y2: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateShapeRequest {
  type?: "line" | "rect" | "ellipse";
  positionX?: number;
  positionY?: number;
  width?: number;
  height?: number;
  rotation?: number;
  color?: string;
  filled?: boolean;
  strokeStyle?: "solid" | "dashed";
}

export interface UpdateShapeRequest {
  positionX?: number;
  positionY?: number;
  width?: number;
  height?: number;
  rotation?: number;
  color?: string;
  filled?: boolean;
  strokeStyle?: "solid" | "dashed";
  x1?: number | null;
  y1?: number | null;
  x2?: number | null;
  y2?: number | null;
}

export const createShape = async (
  workspaceId: string,
  mapId: string,
  data: CreateShapeRequest,
): Promise<ShapeResponse> => {
  return customFetch<ShapeResponse>(
    `/api/workspaces/${workspaceId}/maps/${mapId}/shapes`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
};

export const updateShape = async (
  workspaceId: string,
  mapId: string,
  shapeId: string,
  data: UpdateShapeRequest,
): Promise<ShapeResponse> => {
  return customFetch<ShapeResponse>(
    `/api/workspaces/${workspaceId}/maps/${mapId}/shapes/${shapeId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
};

export const deleteShape = async (
  workspaceId: string,
  mapId: string,
  shapeId: string,
): Promise<{ success: boolean }> => {
  return customFetch<{ success: boolean }>(
    `/api/workspaces/${workspaceId}/maps/${mapId}/shapes/${shapeId}`,
    { method: "DELETE" },
  );
};

export const useCreateShape = (
  options?: UseMutationOptions<
    ShapeResponse,
    unknown,
    { workspaceId: string; mapId: string; data: CreateShapeRequest }
  >,
) => {
  return useMutation({
    mutationFn: ({ workspaceId, mapId, data }) =>
      createShape(workspaceId, mapId, data),
    ...options,
  });
};

export const useUpdateShape = (
  options?: UseMutationOptions<
    ShapeResponse,
    unknown,
    { workspaceId: string; mapId: string; shapeId: string; data: UpdateShapeRequest }
  >,
) => {
  return useMutation({
    mutationFn: ({ workspaceId, mapId, shapeId, data }) =>
      updateShape(workspaceId, mapId, shapeId, data),
    ...options,
  });
};

export const useDeleteShape = (
  options?: UseMutationOptions<
    { success: boolean },
    unknown,
    { workspaceId: string; mapId: string; shapeId: string }
  >,
) => {
  return useMutation({
    mutationFn: ({ workspaceId, mapId, shapeId }) =>
      deleteShape(workspaceId, mapId, shapeId),
    ...options,
  });
};
