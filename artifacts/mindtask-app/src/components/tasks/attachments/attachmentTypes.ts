import type { AttachmentResponse } from "@workspace/api-client-react";

export type SupportedAttachmentKind = "image" | "video" | "pdf";

export function getAttachmentKind(mimeType: string): SupportedAttachmentKind | null {
  const mt = (mimeType || "").toLowerCase();
  if (mt.startsWith("image/")) return "image";
  if (mt.startsWith("video/")) return "video";
  if (mt === "application/pdf") return "pdf";
  return null;
}

export function isSupportedAttachment(att: AttachmentResponse): boolean {
  return getAttachmentKind(att.mimeType) !== null;
}

export function getAttachmentDownloadUrl(
  att: AttachmentResponse,
  workspaceId: string | undefined,
  taskId: string,
): string {
  if (workspaceId) {
    return `/api/workspaces/${workspaceId}/tasks/${taskId}/attachments/${att.id}/download`;
  }
  return `/api/my-tasks/${taskId}/attachments/${att.id}/download`;
}

export function sortAttachmentsByCreatedAtAsc<T extends { createdAt: string | Date }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ta = new Date(a.createdAt as string | Date).getTime();
    const tb = new Date(b.createdAt as string | Date).getTime();
    return ta - tb;
  });
}

export function getFormatLabel(att: { fileName: string; mimeType: string }): string {
  const dot = att.fileName.lastIndexOf(".");
  if (dot > -1 && dot < att.fileName.length - 1) {
    return att.fileName.slice(dot + 1).toUpperCase();
  }
  const slash = att.mimeType.indexOf("/");
  if (slash > -1) return att.mimeType.slice(slash + 1).toUpperCase();
  return att.mimeType.toUpperCase();
}
