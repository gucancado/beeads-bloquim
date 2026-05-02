import { useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { pdfjsLib } from "@/lib/pdfjs";

interface PdfPreviewProps {
  src: string;
  maxWidth: string;
  maxHeight: string;
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function PdfPreview({ src, maxWidth, maxHeight }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]> | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setTotalPages(0);
    setPage(1);

    let getDocTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;

    (async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        getDocTask = pdfjsLib.getDocument({ data: new Uint8Array(buf) });
        const pdf = await getDocTask.promise;
        if (cancelled) {
          await pdf.destroy();
          return;
        }
        pdfDocRef.current = pdf;
        setTotalPages(pdf.numPages);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const e = err as { name?: string; message?: string; stack?: string };
        console.error(
          "[PdfPreview] failed to load pdf",
          e?.name,
          e?.message,
          e?.stack,
          err,
        );
        setError(true);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (getDocTask) {
        getDocTask.destroy().catch(() => {});
      }
      const doc = pdfDocRef.current;
      pdfDocRef.current = null;
      if (doc) {
        doc.destroy();
      }
    };
  }, [src]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const pdf = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas || totalPages === 0 || !containerSize) return;

    let cancelled = false;

    (async () => {
      try {
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
          renderTaskRef.current = null;
        }
        const pdfPage = await pdf.getPage(page);
        if (cancelled) return;
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const dpr = window.devicePixelRatio || 1;
        const fitWidth = containerSize.width / baseViewport.width;
        const fitHeight = containerSize.height / baseViewport.height;
        const fitScale = Math.max(0.1, Math.min(fitWidth, fitHeight));
        const userZoom = ZOOM_LEVELS[zoomIndex] ?? 1;
        const scale = fitScale * userZoom;
        const viewport = pdfPage.getViewport({ scale: scale * dpr });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const task = pdfPage.render({ canvasContext: ctx, viewport, canvas });
        renderTaskRef.current = task;
        await task.promise;
        if (cancelled) return;
        renderTaskRef.current = null;
      } catch {
        if (!cancelled) {
          setError(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [page, zoomIndex, totalPages, containerSize]);

  const goPrev = () => setPage((p) => Math.max(1, p - 1));
  const goNext = () => setPage((p) => Math.min(totalPages, p + 1));
  const zoomIn = () => setZoomIndex((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1));
  const zoomOut = () => setZoomIndex((i) => Math.max(0, i - 1));

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 text-white/80 bg-neutral-950"
        style={{ width: maxWidth, height: maxHeight }}
      >
        <AlertCircle className="w-6 h-6" />
        <p className="text-xs lowercase">não foi possível abrir o pdf</p>
      </div>
    );
  }

  return (
    <div
      className="relative flex flex-col bg-neutral-950"
      style={{ width: maxWidth, height: maxHeight }}
    >
      <div
        ref={containerRef}
        className="flex-1 min-h-0 min-w-0 overflow-auto flex items-center justify-center p-2"
      >
        {loading && <Loader2 className="w-6 h-6 text-white/80 animate-spin" />}
        <canvas ref={canvasRef} className={loading ? "hidden" : "block bg-white shadow-lg"} />
      </div>
      {totalPages > 0 && (
        <div className="shrink-0 flex items-center justify-center gap-2 px-3 py-2 bg-neutral-900 border-t border-white/10 text-white text-xs">
          <button
            type="button"
            onClick={goPrev}
            disabled={page <= 1}
            className="p-1.5 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Página anterior"
            title="Página anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="lowercase tabular-nums">
            página {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={goNext}
            disabled={page >= totalPages}
            className="p-1.5 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Próxima página"
            title="Próxima página"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="mx-2 h-4 w-px bg-white/20" />
          <button
            type="button"
            onClick={zoomOut}
            disabled={zoomIndex <= 0}
            className="p-1.5 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Diminuir zoom"
            title="Diminuir zoom"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="lowercase tabular-nums w-12 text-center">
            {Math.round((ZOOM_LEVELS[zoomIndex] ?? 1) * 100)}%
          </span>
          <button
            type="button"
            onClick={zoomIn}
            disabled={zoomIndex >= ZOOM_LEVELS.length - 1}
            className="p-1.5 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Aumentar zoom"
            title="Aumentar zoom"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
