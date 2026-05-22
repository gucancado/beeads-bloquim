import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface AutosaveIndicatorProps {
  /** True while at least one mutation tied to autosave is in flight. */
  isSaving: boolean;
  /**
   * How long "Salvo" stays visible after the saving→idle transition. Default
   * 1500ms — long enough to be noticed, short enough not to linger.
   */
  savedDurationMs?: number;
  className?: string;
}

/**
 * Visual feedback for autosave: shows "Salvando…" while a mutation is in
 * flight, then "Salvo" for ~1.5s after it completes, then disappears. Renders
 * nothing in the idle state by default so it doesn't take layout space when
 * the user isn't editing.
 */
export function AutosaveIndicator({
  isSaving,
  savedDurationMs = 1500,
  className,
}: AutosaveIndicatorProps) {
  const [showSaved, setShowSaved] = useState(false);
  const wasSaving = useRef(false);

  useEffect(() => {
    if (wasSaving.current && !isSaving) {
      setShowSaved(true);
      const t = setTimeout(() => setShowSaved(false), savedDurationMs);
      wasSaving.current = false;
      return () => clearTimeout(t);
    }
    if (isSaving) {
      wasSaving.current = true;
      setShowSaved(false);
    }
  }, [isSaving, savedDurationMs]);

  if (isSaving) {
    return (
      <span
        role="status"
        aria-live="polite"
        className={cn(
          "inline-flex items-center gap-1.5 text-xs text-muted-foreground lowercase",
          className,
        )}
      >
        <Spinner className="size-3" />
        salvando…
      </span>
    );
  }

  if (showSaved) {
    return (
      <span
        role="status"
        aria-live="polite"
        className={cn(
          "inline-flex items-center gap-1.5 text-xs text-muted-foreground/80 lowercase transition-opacity duration-200",
          className,
        )}
      >
        <Check className="size-3 text-emerald-500" aria-hidden />
        salvo
      </span>
    );
  }

  return null;
}
