import { useRef, useEffect, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Paperclip, X, FileText, FileImage, FileVideo, FileAudio, FileCode, File, Loader2 } from "lucide-react";
import {
  useListTaskAttachments,
  useCreateTaskAttachment,
  useDeleteTaskAttachment,
  getListTaskAttachmentsQueryKey,
} from "@workspace/api-client-react";
import type { AttachmentResponse } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

async function uploadFileWithAuth(file: File): Promise<{ objectPath: string } | null> {
  const token = localStorage.getItem("mindtask_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const urlRes = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
  });

  if (!urlRes.ok) return null;
  const { uploadURL, objectPath } = await urlRes.json();

  const putRes = await fetch(uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });

  if (!putRes.ok) return null;
  return { objectPath };
}

interface AttachmentsSectionProps {
  workspaceId: string;
  taskId: string;
  dropTargetEl?: HTMLElement | null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.startsWith("video/")) return FileVideo;
  if (mimeType.startsWith("audio/")) return FileAudio;
  if (
    mimeType.startsWith("text/") ||
    mimeType.includes("javascript") ||
    mimeType.includes("json") ||
    mimeType.includes("xml") ||
    mimeType.includes("html") ||
    mimeType.includes("css")
  ) return FileCode;
  if (mimeType.includes("pdf") || mimeType.includes("word") || mimeType.includes("text")) return FileText;
  return File;
}

export function AttachmentsSection({ workspaceId, taskId, dropTargetEl }: AttachmentsSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  const attachmentsKey = getListTaskAttachmentsQueryKey(workspaceId, taskId);

  const { data: attachments, isLoading } = useListTaskAttachments(workspaceId, taskId, {
    query: { enabled: !!workspaceId && !!taskId },
  });

  const createAttachmentMut = useCreateTaskAttachment();
  const deleteAttachmentMut = useDeleteTaskAttachment();

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    setUploading(true);
    try {
      for (const file of fileArray) {
        const uploadResult = await uploadFileWithAuth(file);
        if (!uploadResult) {
          toast({ title: `Falha ao fazer upload de "${file.name}"`, variant: "destructive" });
          continue;
        }
        await createAttachmentMut.mutateAsync({
          workspaceId,
          taskId,
          data: {
            objectPath: uploadResult.objectPath,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || "application/octet-stream",
          },
        });
        queryClient.invalidateQueries({ queryKey: attachmentsKey });
      }
    } catch {
      toast({ title: "Erro ao anexar arquivo", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [createAttachmentMut, workspaceId, taskId, queryClient, attachmentsKey, toast]);

  const handleRemove = useCallback(async (attachmentId: string) => {
    try {
      await deleteAttachmentMut.mutateAsync({ workspaceId, taskId, attachmentId });
      queryClient.invalidateQueries({ queryKey: attachmentsKey });
    } catch {
      toast({ title: "Erro ao remover anexo", variant: "destructive" });
    }
  }, [deleteAttachmentMut, workspaceId, taskId, queryClient, attachmentsKey, toast]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      e.target.value = "";
    }
  }, [handleFiles]);

  useEffect(() => {
    const target = dropTargetEl;
    if (!target) return;

    const handleDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        setIsDragOver(true);
      }
    };
    const handleDragLeave = (e: DragEvent) => {
      if (!target.contains(e.relatedTarget as Node)) {
        setIsDragOver(false);
      }
    };
    const handleDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
      }
    };
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    };

    target.addEventListener("dragenter", handleDragEnter);
    target.addEventListener("dragleave", handleDragLeave);
    target.addEventListener("dragover", handleDragOver);
    target.addEventListener("drop", handleDrop);

    return () => {
      target.removeEventListener("dragenter", handleDragEnter);
      target.removeEventListener("dragleave", handleDragLeave);
      target.removeEventListener("dragover", handleDragOver);
      target.removeEventListener("drop", handleDrop);
    };
  }, [dropTargetEl, handleFiles]);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        handleFiles(files);
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handleFiles]);

  return (
    <div className="space-y-2">
      {isDragOver && (
        <div className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-2xl">
          <div className="text-center">
            <Paperclip className="w-8 h-8 text-primary mx-auto mb-2" />
            <p className="text-sm font-semibold text-primary lowercase">solte para anexar</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1 rounded-lg hover:bg-muted disabled:opacity-50"
          title="Anexar arquivo"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
          <span className="lowercase">anexos +</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />
      </div>

      {isLoading ? null : attachments && attachments.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {attachments.map((attachment: AttachmentResponse) => {
            const IconComponent = getFileIcon(attachment.mimeType);
            return (
              <div
                key={attachment.id}
                className="flex items-center gap-2.5 px-3 py-2 bg-muted/40 rounded-xl border border-border group hover:bg-muted/60 transition-colors"
              >
                <IconComponent className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{attachment.fileName}</p>
                  <p className="text-[11px] text-muted-foreground">{formatFileSize(attachment.fileSize)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(attachment.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                  title="Remover anexo"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
