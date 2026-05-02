import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, Trash2, Plus, Paperclip, X, Loader2, AlertCircle } from "lucide-react";
import type { AttachmentResponse } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { useAttachmentBlobUrl } from "./useAttachmentBlobUrl";
import { AttachmentThumbnail } from "./AttachmentThumbnail";
import { PdfPreview } from "./PdfPreview";
import { getAttachmentKind, getFormatLabel } from "./attachmentTypes";

interface AttachmentViewerModalProps {
  open: boolean;
  onClose: () => void;
  attachments: AttachmentResponse[];
  initialAttachmentId: string | null;
  getDownloadUrl: (att: AttachmentResponse) => string;
  onDownload: (att: AttachmentResponse) => void;
  onDelete?: (att: AttachmentResponse) => void;
  onAddFiles?: (files: FileList | File[]) => void;
  uploading?: boolean;
}

function formatUploadDate(value: string | Date): string {
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return "";
  }
}

function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function AttachmentViewerModal({
  open,
  onClose,
  attachments,
  initialAttachmentId,
  getDownloadUrl,
  onDownload,
  onDelete,
  onAddFiles,
  uploading = false,
}: AttachmentViewerModalProps) {
  const [index, setIndex] = useState(0);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const addInputRef = useRef<HTMLInputElement>(null);

  // Only reset the index when the modal opens or the initial attachment changes.
  // We intentionally exclude `attachments` from the deps so that background
  // refetches (which produce a new array reference) don't snap back to the
  // initial item while the user is browsing.
  useEffect(() => {
    if (!open) return;
    const i = attachments.findIndex((a) => a.id === initialAttachmentId);
    setIndex(i === -1 ? 0 : Math.max(0, i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialAttachmentId]);

  // Clamp index when the attachment list shrinks (e.g., one is deleted).
  useEffect(() => {
    if (attachments.length === 0) return;
    setIndex((i) => Math.min(i, attachments.length - 1));
  }, [attachments.length]);

  const current = attachments[index];
  const total = attachments.length;

  useEffect(() => {
    setDims(null);
  }, [current?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowLeft" && total > 1) {
        e.preventDefault();
        e.stopPropagation();
        setIndex((i) => (i - 1 + total) % total);
      } else if (e.key === "ArrowRight" && total > 1) {
        e.preventDefault();
        e.stopPropagation();
        setIndex((i) => (i + 1) % total);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, total, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>(`[data-thumb-index="${index}"]`);
    if (active) {
      active.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [index]);

  const downloadUrl = useMemo(() => (current ? getDownloadUrl(current) : null), [current, getDownloadUrl]);

  if (!open || !current) return null;

  const kind = getAttachmentKind(current.mimeType);
  const formatLabel = getFormatLabel(current);
  const uploadLabel = formatUploadDate(current.createdAt);
  const sizeLabel = formatFileSize(current.fileSize);
  const showDims = (kind === "image" || kind === "video") && dims;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const showStrip = total > 1 || !!onAddFiles;
  const chromePx = showStrip ? 140 : 56;
  // Reserve room on each side for the nav buttons (40px button + 12px gap).
  const sideReservePx = total > 1 ? 104 : 0;

  const goPrev = () => setIndex((i) => (i - 1 + total) % total);
  const goNext = () => setIndex((i) => (i + 1) % total);

  const handleDelete = () => {
    if (!current || !onDelete) return;
    const confirmed = window.confirm(`Remover o anexo "${current.fileName}"?`);
    if (!confirmed) return;
    if (total <= 1) {
      onClose();
    }
    onDelete(current);
  };

  const handleAddClick = () => {
    if (!onAddFiles || uploading) return;
    addInputRef.current?.click();
  };

  const handleAddInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!onAddFiles) return;
    if (e.target.files && e.target.files.length > 0) {
      onAddFiles(e.target.files);
      e.target.value = "";
    }
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onAddFiles) return;
    if (!e.dataTransfer.types.includes("Files")) return;
    dragDepth.current += 1;
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onAddFiles) return;
    if (!e.dataTransfer.types.includes("Files")) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onAddFiles) return;
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onAddFiles) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onAddFiles(e.dataTransfer.files);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 animate-in fade-in"
      onClick={handleBackdropClick}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role="dialog"
      aria-modal="true"
      aria-label="Visualizador de anexos"
    >
      {dragActive && (
        <div className="absolute inset-2 sm:inset-4 z-20 pointer-events-none flex items-center justify-center bg-primary/15 border-2 border-dashed border-primary rounded-2xl">
          <div className="text-center">
            <Paperclip className="w-8 h-8 text-white mx-auto mb-2" />
            <p className="text-sm font-semibold text-white lowercase">solte para anexar</p>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 sm:gap-3 max-w-full max-h-full">
        {total > 1 && (
          <button
            type="button"
            onClick={goPrev}
            className="shrink-0 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 text-white flex items-center justify-center transition-colors backdrop-blur shadow-lg"
            title="Anterior (←)"
            aria-label="Anterior"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        <div
          className="inline-flex flex-col max-h-[95vh] rounded-xl overflow-hidden shadow-2xl bg-neutral-900 border border-white/10"
          onClick={(e) => e.stopPropagation()}
          style={{
            ["--chrome" as string]: `${chromePx}px`,
            ["--side-reserve" as string]: `${sideReservePx}px`,
            maxWidth: `calc(100vw - ${sideReservePx}px - 16px)`,
          } as React.CSSProperties}
        >
          <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-neutral-800 text-white w-full">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate" title={current.fileName}>{current.fileName}</p>
              <p className="text-[11px] text-white/70 lowercase truncate">
                <span>{formatLabel}</span>
                {uploadLabel && <span> · {uploadLabel}</span>}
                {showDims && dims && <span> · {dims.width}×{dims.height}px</span>}
                {sizeLabel && <span> · {sizeLabel}</span>}
                {total > 1 && <span> · {index + 1} / {total}</span>}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => onDownload(current)}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                title="Baixar arquivo"
                aria-label="Baixar arquivo"
              >
                <Download className="w-4 h-4" />
              </button>
              {onDelete && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="p-2 rounded-lg hover:bg-red-500/20 hover:text-red-300 transition-colors"
                  title="Remover anexo"
                  aria-label="Remover anexo"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                title="Fechar"
                aria-label="Fechar visualizador"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-center bg-black min-h-0 min-w-0">
            <AttachmentMedia
              key={current.id}
              attachment={current}
              downloadUrl={downloadUrl}
              onDimensions={setDims}
            />
          </div>

          {showStrip && (
            <div className="bg-neutral-800 border-t border-white/10 px-3 py-2 w-full">
              <div ref={stripRef} className="flex justify-center gap-2 overflow-x-auto scroll-smooth pb-1">
                {attachments.map((att, i) => (
                  <div
                    key={att.id}
                    data-thumb-index={i}
                    className={cn(
                      "shrink-0 rounded-xl ring-2 transition-all",
                      i === index ? "ring-white/90" : "ring-transparent opacity-70 hover:opacity-100",
                    )}
                  >
                    <AttachmentThumbnail
                      fileName={att.fileName}
                      mimeType={att.mimeType}
                      downloadUrl={getDownloadUrl(att)}
                      size={56}
                      onClick={() => setIndex(i)}
                    />
                  </div>
                ))}
                {onAddFiles && (
                  <button
                    type="button"
                    onClick={handleAddClick}
                    disabled={uploading}
                    className="shrink-0 w-14 h-14 rounded-xl border-2 border-dashed border-white/30 hover:border-white/60 hover:bg-white/5 flex items-center justify-center text-white/70 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Adicionar anexo"
                    aria-label="Adicionar anexo"
                  >
                    {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                  </button>
                )}
              </div>
              {onAddFiles && (
                <input
                  ref={addInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleAddInputChange}
                />
              )}
            </div>
          )}
        </div>

        {total > 1 && (
          <button
            type="button"
            onClick={goNext}
            className="shrink-0 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 text-white flex items-center justify-center transition-colors backdrop-blur shadow-lg"
            title="Próximo (→)"
            aria-label="Próximo"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

function AttachmentMedia({
  attachment,
  downloadUrl,
  onDimensions,
}: {
  attachment: AttachmentResponse;
  downloadUrl: string | null;
  onDimensions: (d: { width: number; height: number } | null) => void;
}) {
  const { url, loading, error } = useAttachmentBlobUrl(downloadUrl);
  const kind = getAttachmentKind(attachment.mimeType);

  const mediaMaxStyle: React.CSSProperties = {
    maxWidth: "min(calc(100vw - var(--side-reserve, 0px) - 16px), 1400px)",
    maxHeight: "calc(95vh - var(--chrome, 56px))",
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-2 text-white/80 px-10 py-16">
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-xs lowercase">carregando…</p>
      </div>
    );
  }
  if (error || !url) {
    return (
      <div className="flex flex-col items-center gap-2 text-white/80 px-10 py-16">
        <AlertCircle className="w-6 h-6" />
        <p className="text-xs lowercase">não foi possível abrir o arquivo</p>
      </div>
    );
  }

  if (kind === "image") {
    return (
      <img
        src={url}
        alt={attachment.fileName}
        className="block object-contain select-none"
        draggable={false}
        onLoad={(e) => {
          const img = e.currentTarget;
          onDimensions({ width: img.naturalWidth, height: img.naturalHeight });
        }}
        style={mediaMaxStyle}
      />
    );
  }

  if (kind === "video") {
    return (
      <video
        src={url}
        controls
        className="block"
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          onDimensions({ width: v.videoWidth, height: v.videoHeight });
        }}
        style={mediaMaxStyle}
      />
    );
  }

  if (kind === "pdf") {
    return (
      <PdfPreview
        src={url}
        maxWidth="min(calc(100vw - var(--side-reserve, 0px) - 16px), 1100px)"
        maxHeight="calc(95vh - var(--chrome, 56px))"
      />
    );
  }

  return null;
}
