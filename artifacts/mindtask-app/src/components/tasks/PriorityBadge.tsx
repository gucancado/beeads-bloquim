import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { getPriorityColor, getPriorityStars, translatePriority, PRIORITY_OPTIONS } from "./priorityUtils";

interface PriorityBadgeProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  portalContainer?: HTMLElement | null;
}

export function PriorityBadge({ value, onChange, disabled, portalContainer }: PriorityBadgeProps) {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const [hoveredOpt, setHoveredOpt] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);

  const handleBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    const badgeRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (portalContainer) {
      const containerRect = portalContainer.getBoundingClientRect();
      const top = badgeRect.bottom - containerRect.top + portalContainer.scrollTop + 4;
      const left = Math.max(0, Math.min(
        badgeRect.left - containerRect.left + portalContainer.scrollLeft,
        portalContainer.clientWidth - 180
      ));
      setDropdownPos({ top, left });
    } else {
      const top = badgeRect.bottom + 4;
      const left = Math.min(badgeRect.left, window.innerWidth - 180);
      setDropdownPos({
        top: Math.min(top, window.innerHeight - 200),
        left: Math.max(4, left),
      });
    }
    setOpen(v => !v);
  };

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        badgeRef.current && !badgeRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const handleSelect = (val: string) => {
    setOpen(false);
    onChange(val);
  };

  return (
    <>
      <Badge
        ref={badgeRef}
        variant="outline"
        className={`px-1 py-0 text-sm border-0 bg-transparent shadow-none cursor-pointer select-none transition-opacity leading-none ${getPriorityColor(value)} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
        onClick={handleBadgeClick}
        title={`prioridade ${translatePriority(value)}`}
      >
        {"★".repeat(getPriorityStars(value))}
      </Badge>

      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] bg-card border border-border rounded-xl shadow-lg py-1 min-w-[120px]"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          {PRIORITY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onMouseDown={(e) => { e.stopPropagation(); handleSelect(opt.value); }}
              onMouseEnter={() => setHoveredOpt(opt.value)}
              onMouseLeave={() => setHoveredOpt(null)}
              className={`w-full text-left px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-2 ${value === opt.value ? "opacity-60" : ""}`}
              style={{ backgroundColor: hoveredOpt === opt.value ? "hsl(var(--muted))" : undefined }}
            >
              <span className={`inline-block w-[4em] shrink-0 text-right text-xs leading-none ${getPriorityColor(opt.value)}`}>
                {"★".repeat(getPriorityStars(opt.value))}
              </span>
              {opt.label}
            </button>
          ))}
        </div>,
        portalContainer ?? document.body
      )}
    </>
  );
}
