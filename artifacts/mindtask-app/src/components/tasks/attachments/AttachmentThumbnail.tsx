import { useEffect, useRef, useState } from "react";
import { Loader2, FileImage, FileVideo, FileText, AlertCircle, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAttachmentBlobUrl } from "./useAttachmentBlobUrl";
import { getAttachmentKind, type SupportedAttachmentKind } from "./attachmentTypes";
import { pdfjsLib } from "@/lib/pdfjs";

interface AttachmentThumbnailProps {
  fileName: string;
  mimeType: string;
  downloadUrl: string;
  size?: number;
  onClick?: () => void;
  className?: string;
}

function fallbackIcon(kind: SupportedAttachmentKind | null) {
  if (kind === "image") return FileImage;
  if (kind === "video") return FileVideo;
  if (kind === "pdf") return FileText;
  return FileText;
}

export function AttachmentThumbnail({
  fileName,
  mimeType,
  downloadUrl,
  size = 72,
  onClick,
  className,
}: AttachmentThumbnailProps) {
  const kind = getAttachmentKind(mimeType);
  const { url, loading, error } = useAttachmentBlobUrl(downloadUrl);
  const Icon = fallbackIcon(kind);

  return (
    <button
      type="button"
      onClick={onClick}
      title={fileName}
      className={cn(
        "relative group overflow-hidden rounded-xl border border-border bg-muted/40 hover:border-primary/60 transition-colors flex items-center justify-center shrink-0",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {loading && (
        <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
      )}
      {error && (
        <AlertCircle className="w-5 h-5 text-muted-foreground" />
      )}
      {!loading && !error && url && kind === "image" && (
        <img
          src={url}
          alt={fileName}
          className="w-full h-full object-cover"
          draggable={false}
        />
      )}
      {!loading && !error && url && kind === "video" && (
        <>
          <VideoFrameThumbnail src={url} fallbackIcon={Icon} />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
            <Play className="w-5 h-5 text-white drop-shadow-md" fill="currentColor" />
          </div>
        </>
      )}
      {!loading && !error && url && kind === "pdf" && (
        <PdfFirstPageThumbnail src={url} fallbackIcon={Icon} />
      )}
    </button>
  );
}

function VideoFrameThumbnail({
  src,
  fallbackIcon: Icon,
}: {
  src: string;
  fallbackIcon: React.ComponentType<{ className?: string }>;
}) {
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    return () => {
      if (posterUrl) URL.revokeObjectURL(posterUrl);
    };
  }, [posterUrl]);

  const handleLoaded = () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (video.currentTime === 0 && video.duration > 0.1) {
        video.currentTime = Math.min(0.1, video.duration / 2);
        return;
      }
    } catch {
      // ignore
    }
    captureFrame();
  };

  const handleSeeked = () => {
    captureFrame();
  };

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || posterUrl) return;
    try {
      const canvas = document.createElement("canvas");
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (!blob) return;
        setPosterUrl(URL.createObjectURL(blob));
      }, "image/jpeg", 0.7);
    } catch {
      setFailed(true);
    }
  };

  if (failed) {
    return <Icon className="w-5 h-5 text-muted-foreground" />;
  }

  if (posterUrl) {
    return <img src={posterUrl} alt="" className="w-full h-full object-cover" draggable={false} />;
  }

  return (
    <video
      ref={videoRef}
      src={src}
      muted
      playsInline
      preload="auto"
      crossOrigin="anonymous"
      className="w-full h-full object-cover"
      onLoadedData={handleLoaded}
      onSeeked={handleSeeked}
      onError={() => setFailed(true)}
    />
  );
}

function PdfFirstPageThumbnail({
  src,
  fallbackIcon: Icon,
}: {
  src: string;
  fallbackIcon: React.ComponentType<{ className?: string }>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof pdfjsLib.getDocument> | null = null;

    (async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        task = pdfjsLib.getDocument({ data: new Uint8Array(buf) });
        const pdf = await task.promise;
        if (cancelled) {
          await pdf.destroy();
          return;
        }
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const canvas = canvasRef.current;
        if (!canvas) {
          await pdf.destroy();
          return;
        }
        const dpr = window.devicePixelRatio || 1;
        const targetWidth = 144;
        const scale = Math.min(2, (targetWidth * dpr) / viewport.width);
        const scaled = page.getViewport({ scale });
        canvas.width = scaled.width;
        canvas.height = scaled.height;
        canvas.style.width = `${scaled.width / dpr}px`;
        canvas.style.height = `${scaled.height / dpr}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          await pdf.destroy();
          return;
        }
        await page.render({ canvasContext: ctx, viewport: scaled, canvas }).promise;
        if (cancelled) {
          await pdf.destroy();
          return;
        }
        setReady(true);
        await pdf.destroy();
      } catch (err) {
        if (!cancelled) {
          const e = err as { name?: string; message?: string; stack?: string };
          console.error(
            "[PdfFirstPageThumbnail] failed to render pdf",
            e?.name,
            e?.message,
            e?.stack,
            err,
          );
          setFailed(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (failed) {
    return <Icon className="w-5 h-5 text-muted-foreground" />;
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-white overflow-hidden">
      {!ready && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin absolute" />}
      <canvas ref={canvasRef} className="max-w-full max-h-full object-cover" />
    </div>
  );
}
