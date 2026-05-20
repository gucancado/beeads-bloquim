import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, X, FileText, FileImage, FileVideo, FileAudio, FileCode, File, Loader2, Download, Star, Link2, Trash2 } from "lucide-react";
import {
  useListTaskAttachments,
  useDeleteTaskAttachment,
  useSetTaskAttachmentKind,
  useUnlinkAttachmentFromTask,
  getListTaskAttachmentsQueryKey,
  customFetch,
} from "@workspace/api-client-react";
import type { AttachmentResponse } from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { useToast } from "@/hooks/use-toast";
import { AttachmentThumbnail } from "@/components/tasks/attachments/AttachmentThumbnail";
import { AttachmentViewerModal } from "@/components/tasks/attachments/AttachmentViewerModal";
import { DeleteAttachmentDialog } from "@/components/tasks/attachments/DeleteAttachmentDialog";
import {
  isSupportedAttachment,
  sortAttachmentsByCreatedAtAsc,
  getAttachmentDownloadUrl,
} from "@/components/tasks/attachments/attachmentTypes";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const BLOCKED_EXTENSIONS = [".exe", ".bat", ".cmd", ".sh", ".ps1", ".msi", ".scr"];

function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE) {
    return "O arquivo excede o limite de 50 MB";
  }
  const nameLower = file.name.toLowerCase();
  if (BLOCKED_EXTENSIONS.some((ext) => nameLower.endsWith(ext))) {
    return `Este tipo de arquivo (${BLOCKED_EXTENSIONS.find((e) => nameLower.endsWith(e))}) não é permitido`;
  }
  return null;
}

type AttachmentMode = "full" | "deliverables-readonly";

interface AttachmentsSectionProps {
  workspaceId?: string;
  taskId: string;
  dropTargetEl?: HTMLElement | null;
  /**
   * `full` (default) shows uploader, deletion and (optionally) the kind
   * toggle. `deliverables-readonly` hides every editing affordance and is
   * meant for the approval modal, where the listing already arrives
   * filtered to the parent task's deliverables.
   */
  mode?: AttachmentMode;
  /**
   * When true, attachments display a "marcar como entregável" star button
   * that toggles their `kind`. Only relevant in `full` mode.
   */
  allowKindToggle?: boolean;
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

function getStandaloneAttachmentsQueryKey(taskId: string) {
  return ["myTasks", taskId, "attachments"] as const;
}

function AttachmentsSectionWorkspace({
  workspaceId,
  taskId,
  dropTargetEl,
  mode,
  allowKindToggle,
}: Required<Pick<AttachmentsSectionProps, "workspaceId">> & Omit<AttachmentsSectionProps, "workspaceId">) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  const attachmentsKey = getListTaskAttachmentsQueryKey(workspaceId, taskId);

  const { data: attachments, isLoading } = useListTaskAttachments(workspaceId, taskId, {
    query: { enabled: !!taskId },
  });

  const deleteAttachmentMut = useDeleteTaskAttachment();
  const setKindMut = useSetTaskAttachmentKind();
  const unlinkMut = useUnlinkAttachmentFromTask();
  const [deleteTarget, setDeleteTarget] = useState<AttachmentResponse | null>(null);
  const { uploadFile } = useUpload();


  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    setUploading(true);
    try {
      for (const file of fileArray) {
        const validationError = validateFile(file);
        if (validationError) {
          toast({ title: validationError, variant: "destructive" });
          continue;
        }
        const result = await uploadFile(file, {
          bucket: "attachments",
          entityKind: "task",
          entityId: taskId,
        });
        if (!result) {
          toast({ title: `Falha ao fazer upload de "${file.name}"`, variant: "destructive" });
          continue;
        }
        queryClient.invalidateQueries({ queryKey: attachmentsKey });
      }
    } catch {
      toast({ title: "Erro ao anexar arquivo", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [uploadFile, taskId, queryClient, attachmentsKey, toast]);

  // "Remove" splits in two flows based on whether the attachment is native
  // here or inherited via the canvas connection:
  //   - native (inheritedFromTaskId === null): show the confirm-delete dialog
  //     that warns about other tasks linked to the file and runs the hard
  //     delete on confirm.
  //   - inherited but has a task_attachments row (was promoted in this task):
  //     unlink only — file stays on the upstream task.
  //   - pure inherited (no row): no action — user must disconnect the cards
  //     on the canvas to break the inheritance.
  const handleRemove = useCallback(
    async (attachment: AttachmentResponse) => {
      if (attachment.inheritedFromTaskId) {
        try {
          await unlinkMut.mutateAsync({
            workspaceId,
            taskId,
            attachmentId: attachment.id,
          });
          queryClient.invalidateQueries({ queryKey: attachmentsKey });
        } catch {
          toast({ title: "Erro ao desvincular anexo", variant: "destructive" });
        }
        return;
      }
      setDeleteTarget(attachment);
    },
    [unlinkMut, workspaceId, taskId, queryClient, attachmentsKey, toast],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteAttachmentMut.mutateAsync({
        workspaceId,
        taskId,
        attachmentId: deleteTarget.id,
      });
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: attachmentsKey });
    } catch {
      toast({ title: "Erro ao apagar anexo", variant: "destructive" });
    }
  }, [deleteAttachmentMut, deleteTarget, workspaceId, taskId, queryClient, attachmentsKey, toast]);

  // Kind change is inheritance-aware: promoting a `pending` inherited
  // attachment is allowed and creates a row so the attachment will flow
  // downstream (still gated by upstream's completion at read time).
  const handleToggleKind = useCallback(async (attachment: AttachmentResponse) => {
    const nextKind = attachment.kind === "deliverable" ? "standard" : "deliverable";
    try {
      await setKindMut.mutateAsync({
        workspaceId,
        taskId,
        attachmentId: attachment.id,
        data: { kind: nextKind },
      });
      queryClient.invalidateQueries({ queryKey: attachmentsKey });
    } catch {
      toast({ title: "Erro ao atualizar tipo do anexo", variant: "destructive" });
    }
  }, [setKindMut, workspaceId, taskId, queryClient, attachmentsKey, toast]);

  const handleDownload = useCallback((attachment: AttachmentResponse) => {
    const url = `/api/workspaces/${workspaceId}/tasks/${taskId}/attachments/${attachment.id}/download`;
    fetch(url, { credentials: "include" })
      .then(res => {
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        return res.blob();
      })
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = attachment.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      })
      .catch(() => toast({ title: "Erro ao baixar anexo", variant: "destructive" }));
  }, [workspaceId, taskId, toast]);

  return (
    <>
      <AttachmentsSectionUI
        workspaceId={workspaceId}
        taskId={taskId}
        attachments={attachments ?? []}
        isLoading={isLoading}
        uploading={uploading}
        isDragOver={isDragOver}
        fileInputRef={fileInputRef}
        dropTargetEl={dropTargetEl}
        mode={mode ?? "full"}
        allowKindToggle={!!allowKindToggle}
        onFiles={handleFiles}
        onRemove={handleRemove}
        onDownload={handleDownload}
        onToggleKind={handleToggleKind}
        onDragOver={setIsDragOver}
      />
      {deleteTarget && (
        <DeleteAttachmentDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          workspaceId={workspaceId}
          taskId={taskId}
          attachmentId={deleteTarget.id}
          fileName={deleteTarget.fileName}
          isPending={deleteAttachmentMut.isPending}
          onConfirm={handleConfirmDelete}
        />
      )}
    </>
  );
}

function AttachmentsSectionStandalone({ taskId, dropTargetEl, mode, allowKindToggle }: Omit<AttachmentsSectionProps, "workspaceId">) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  const attachmentsKey = getStandaloneAttachmentsQueryKey(taskId);

  const { data: attachments, isLoading } = useQuery<AttachmentResponse[]>({
    queryKey: attachmentsKey,
    queryFn: () => customFetch<AttachmentResponse[]>(`/api/my-tasks/${taskId}/attachments`),
    enabled: !!taskId,
  });

  const { uploadFile } = useUpload();

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    setUploading(true);
    try {
      for (const file of fileArray) {
        const validationError = validateFile(file);
        if (validationError) {
          toast({ title: validationError, variant: "destructive" });
          continue;
        }
        const result = await uploadFile(file, {
          bucket: "attachments",
          entityKind: "task",
          entityId: taskId,
        });
        if (!result) {
          toast({ title: `Falha ao fazer upload de "${file.name}"`, variant: "destructive" });
          continue;
        }
        queryClient.invalidateQueries({ queryKey: attachmentsKey });
      }
    } catch {
      toast({ title: "Erro ao anexar arquivo", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [uploadFile, taskId, queryClient, attachmentsKey, toast]);

  const handleRemove = useCallback(async (attachment: AttachmentResponse) => {
    try {
      await customFetch<{ success: boolean }>(`/api/my-tasks/${taskId}/attachments/${attachment.id}`, {
        method: "DELETE",
      });
      queryClient.invalidateQueries({ queryKey: attachmentsKey });
    } catch {
      toast({ title: "Erro ao remover anexo", variant: "destructive" });
    }
  }, [taskId, queryClient, attachmentsKey, toast]);

  const handleDownload = useCallback((attachment: AttachmentResponse) => {
    const url = `/api/my-tasks/${taskId}/attachments/${attachment.id}/download`;
    fetch(url, { credentials: "include" })
      .then(res => {
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        return res.blob();
      })
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = attachment.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      })
      .catch(() => toast({ title: "Erro ao baixar anexo", variant: "destructive" }));
  }, [taskId, toast]);

  return (
    <AttachmentsSectionUI
      workspaceId={undefined}
      taskId={taskId}
      attachments={attachments ?? []}
      isLoading={isLoading}
      uploading={uploading}
      isDragOver={isDragOver}
      fileInputRef={fileInputRef}
      dropTargetEl={dropTargetEl}
      mode={mode ?? "full"}
      allowKindToggle={!!allowKindToggle}
      onFiles={handleFiles}
      onRemove={handleRemove}
      onDownload={handleDownload}
      onToggleKind={undefined}
      onDragOver={setIsDragOver}
    />
  );
}

interface AttachmentsSectionUIProps {
  workspaceId: string | undefined;
  taskId: string;
  attachments: AttachmentResponse[];
  isLoading: boolean;
  uploading: boolean;
  isDragOver: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  dropTargetEl?: HTMLElement | null;
  mode: AttachmentMode;
  allowKindToggle: boolean;
  onFiles: (files: FileList | File[]) => void;
  onRemove: (attachment: AttachmentResponse) => void;
  onDownload: (attachment: AttachmentResponse) => void;
  onToggleKind?: (attachment: AttachmentResponse) => void;
  onDragOver: (value: boolean) => void;
}

function AttachmentsSectionUI({
  workspaceId,
  taskId,
  attachments,
  isLoading,
  uploading,
  isDragOver,
  fileInputRef,
  dropTargetEl,
  mode,
  allowKindToggle,
  onFiles,
  onRemove,
  onDownload,
  onToggleKind,
  onDragOver,
}: AttachmentsSectionUIProps) {
  const isReadonly = mode === "deliverables-readonly";
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerAttachmentId, setViewerAttachmentId] = useState<string | null>(null);

  const supportedAttachments = useMemo(
    () => sortAttachmentsByCreatedAtAsc(attachments.filter(isSupportedAttachment)),
    [attachments],
  );

  const otherAttachments = useMemo(
    () => attachments.filter((a) => !isSupportedAttachment(a)),
    [attachments],
  );

  const getDownloadUrl = useCallback(
    (att: AttachmentResponse) => getAttachmentDownloadUrl(att, workspaceId, taskId),
    [workspaceId, taskId],
  );

  const handleOpenViewer = useCallback((attachmentId: string) => {
    setViewerAttachmentId(attachmentId);
    setViewerOpen(true);
  }, []);

  const handleCloseViewer = useCallback(() => {
    setViewerOpen(false);
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFiles(e.target.files);
      e.target.value = "";
    }
  }, [onFiles]);

  useEffect(() => {
    if (isReadonly) return;
    const target = dropTargetEl;
    if (!target) return;

    const handleDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        onDragOver(true);
      }
    };
    const handleDragLeave = (e: DragEvent) => {
      if (!target.contains(e.relatedTarget as Node)) {
        onDragOver(false);
      }
    };
    const handleDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
      }
    };
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      onDragOver(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        onFiles(e.dataTransfer.files);
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
  }, [dropTargetEl, onFiles, onDragOver, isReadonly]);

  useEffect(() => {
    if (isReadonly) return;
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
        onFiles(files);
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [onFiles, isReadonly]);

  const showKindStar = allowKindToggle && !isReadonly && !!onToggleKind;
  const hasAnyAttachment = attachments.length > 0;

  return (
    <div className="space-y-2">
      {!isReadonly && isDragOver && (
        <div className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-2xl">
          <div className="text-center">
            <Paperclip className="w-8 h-8 text-primary mx-auto mb-2" />
            <p className="text-sm font-semibold text-primary lowercase">solte para anexar</p>
          </div>
        </div>
      )}

      {!isReadonly && (
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
      )}

      {isLoading ? null : isReadonly && !hasAnyAttachment ? (
        <p className="text-xs text-muted-foreground italic lowercase">Nenhum entregável anexado.</p>
      ) : (
        <>
          {supportedAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {supportedAttachments.map((attachment) => {
                const isPending = attachment.state === "pending";
                return (
                  <div
                    key={attachment.id}
                    className={`relative group ${isPending ? "opacity-50" : ""}`}
                    title={isPending ? "Aguardando conclusão da tarefa fonte" : undefined}
                  >
                    {isPending ? (
                      <div className="cursor-not-allowed">
                        <AttachmentThumbnail
                          fileName={attachment.fileName}
                          mimeType={attachment.mimeType}
                          downloadUrl={undefined}
                          onClick={() => {}}
                        />
                      </div>
                    ) : (
                      <AttachmentThumbnail
                        fileName={attachment.fileName}
                        mimeType={attachment.mimeType}
                        downloadUrl={getDownloadUrl(attachment)}
                        onClick={() => handleOpenViewer(attachment.id)}
                      />
                    )}
                    {attachment.kind === "deliverable" && (
                      <span className="absolute top-1 left-1 inline-flex items-center gap-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 text-[10px] font-semibold px-1.5 py-0.5 ring-1 ring-amber-300 dark:ring-amber-800 shadow-sm">
                        <Star className="w-2.5 h-2.5 fill-current" />
                        <span className="lowercase">entregável</span>
                      </span>
                    )}
                    {showKindStar && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onToggleKind!(attachment); }}
                        className={`opacity-0 group-hover:opacity-100 transition-opacity absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-background border border-border flex items-center justify-center ${attachment.kind === "deliverable" ? "text-amber-600 hover:text-amber-700" : "text-muted-foreground hover:text-amber-600"}`}
                        title={attachment.kind === "deliverable" ? "Desmarcar como entregável" : "Marcar como entregável"}
                      >
                        <Star className={`w-3 h-3 ${attachment.kind === "deliverable" ? "fill-current" : ""}`} />
                      </button>
                    )}
                    {attachment.inheritedFromTaskId && (
                      <span className="absolute bottom-1 left-1 inline-flex items-center gap-0.5 rounded-full bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400 text-[10px] font-semibold px-1.5 py-0.5 ring-1 ring-sky-300 dark:ring-sky-800 shadow-sm" title={isPending ? "Aguardando conclusão da tarefa fonte" : "Herdado de outra tarefa conectada"}>
                        <Link2 className="w-2.5 h-2.5" />
                        <span className="lowercase">{isPending ? "pendente" : "herdado"}</span>
                      </span>
                    )}
                    {!isReadonly && !isPending && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onRemove(attachment); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive"
                        title={attachment.inheritedFromTaskId ? "Desvincular desta tarefa" : "Apagar arquivo"}
                      >
                        {attachment.inheritedFromTaskId ? <X className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {otherAttachments.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {otherAttachments.map((attachment: AttachmentResponse) => {
                const IconComponent = getFileIcon(attachment.mimeType);
                const isPending = attachment.state === "pending";
                return (
                  <div
                    key={attachment.id}
                    className={`flex items-center gap-2.5 px-3 py-2 bg-muted/40 rounded-xl border border-border group hover:bg-muted/60 transition-colors ${isPending ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    onDoubleClick={isPending ? undefined : () => onDownload(attachment)}
                    title={isPending ? "Aguardando conclusão da tarefa fonte" : undefined}
                  >
                    <IconComponent className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-sm text-foreground truncate">{attachment.fileName}</p>
                        {attachment.kind === "deliverable" && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 text-[10px] font-semibold px-1.5 py-0.5 ring-1 ring-amber-300 dark:ring-amber-800 shrink-0">
                            <Star className="w-2.5 h-2.5 fill-current" />
                            <span className="lowercase">entregável</span>
                          </span>
                        )}
                        {attachment.inheritedFromTaskId && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400 text-[10px] font-semibold px-1.5 py-0.5 ring-1 ring-sky-300 dark:ring-sky-800 shrink-0">
                            <Link2 className="w-2.5 h-2.5" />
                            <span className="lowercase">{isPending ? "pendente" : "herdado"}</span>
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{formatFileSize(attachment.fileSize)}</p>
                    </div>
                    {showKindStar && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onToggleKind!(attachment); }}
                        className={`opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded-full flex items-center justify-center hover:bg-amber-100 dark:hover:bg-amber-950/40 flex-shrink-0 ${attachment.kind === "deliverable" ? "text-amber-600" : "text-muted-foreground hover:text-amber-600"}`}
                        title={attachment.kind === "deliverable" ? "Desmarcar como entregável" : "Marcar como entregável"}
                      >
                        <Star className={`w-3 h-3 ${attachment.kind === "deliverable" ? "fill-current" : ""}`} />
                      </button>
                    )}
                    {!isPending && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onDownload(attachment); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 flex-shrink-0"
                        title="Baixar anexo"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                    )}
                    {!isReadonly && !isPending && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onRemove(attachment); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                        title={attachment.inheritedFromTaskId ? "Desvincular desta tarefa" : "Apagar arquivo"}
                      >
                        {attachment.inheritedFromTaskId ? <X className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <AttachmentViewerModal
        open={viewerOpen}
        onClose={handleCloseViewer}
        attachments={supportedAttachments}
        initialAttachmentId={viewerAttachmentId}
        getDownloadUrl={getDownloadUrl}
        onDownload={onDownload}
        onDelete={isReadonly ? undefined : ((att) => onRemove(att))}
        onAddFiles={isReadonly ? undefined : onFiles}
        uploading={uploading}
      />
    </div>
  );
}

export function AttachmentsSection({ workspaceId, taskId, dropTargetEl, mode, allowKindToggle }: AttachmentsSectionProps) {
  if (workspaceId) {
    return <AttachmentsSectionWorkspace workspaceId={workspaceId} taskId={taskId} dropTargetEl={dropTargetEl} mode={mode} allowKindToggle={allowKindToggle} />;
  }
  return <AttachmentsSectionStandalone taskId={taskId} dropTargetEl={dropTargetEl} mode={mode} allowKindToggle={allowKindToggle} />;
}
