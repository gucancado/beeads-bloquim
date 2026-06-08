import { useEffect, useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import type { StrategyNodeKind } from "@/hooks/useStrategy";

/**
 * Renderer dos nós do mapa estratégico (Fase 4). Um card por kind (paleta
 * @beeads/tokens) com edição inline autosave (§7.5): o campo salva no blur via
 * data.onPatchData. Nós de ciclo arquivado (readOnly) não editam.
 */

const KIND_META: Record<StrategyNodeKind, { label: string; accent: string }> = {
  objetivo: { label: "Objetivo", accent: "border-l-honey" },
  kr: { label: "KR", accent: "border-l-emerald-500" },
  tema: { label: "Tema", accent: "border-l-sky-500" },
  swot: { label: "SWOT", accent: "border-l-amber-500" },
  plano: { label: "Plano", accent: "border-l-violet-500" },
  recurso: { label: "Recurso", accent: "border-l-slate-400" },
};

const HEALTH_STYLE: Record<string, string> = {
  no_prazo: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  risco: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  fora: "bg-red-500/15 text-red-700 dark:text-red-300",
  atingido: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  nao_atingido: "bg-red-500/15 text-red-700 dark:text-red-300",
  sem_medicao: "bg-muted text-muted-foreground",
};

function HealthPill({ health }: { health?: string }) {
  if (!health) return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium lowercase ${HEALTH_STYLE[health] ?? "bg-muted text-muted-foreground"}`}>
      {health.replace(/_/g, " ")}
    </span>
  );
}

/** Campo de texto/número editável inline; autosave no blur (se mudou) ou Enter. */
function EditableField({
  value,
  onCommit,
  readOnly,
  type = "text",
  className = "",
  placeholder,
}: {
  value: string | number;
  onCommit: (v: string) => void;
  readOnly?: boolean;
  type?: "text" | "number";
  className?: string;
  placeholder?: string;
}) {
  const [v, setV] = useState(String(value ?? ""));
  useEffect(() => setV(String(value ?? "")), [value]);

  if (readOnly) {
    return <span className={className}>{String(value ?? "")}</span>;
  }
  return (
    <input
      type={type}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== String(value ?? "")) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setV(String(value ?? ""));
      }}
      className={`nodrag nopan w-full bg-transparent outline-none focus:ring-1 focus:ring-honey/50 rounded px-0.5 ${className}`}
    />
  );
}

export function StrategyNodeView({ data, selected }: NodeProps) {
  const kind = data.kind as StrategyNodeKind;
  const meta = KIND_META[kind] ?? KIND_META.tema;
  const ro = !!data.readOnly;
  const patch = (p: Record<string, any>) => data.onPatchData?.(p);

  return (
    <div
      className={`min-w-[190px] max-w-[260px] rounded-xl border border-l-4 bg-card px-3 py-2 shadow-md ${meta.accent} ${selected ? "ring-2 ring-honey" : ""} ${ro ? "opacity-60" : ""}`}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-muted-foreground/50" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{meta.label}</span>
        {(kind === "kr" || kind === "objetivo") && <HealthPill health={data.health} />}
      </div>

      {/* Título / texto principal por kind */}
      {kind === "swot" ? (
        <EditableField value={data.text ?? ""} onCommit={(val) => patch({ text: val })} readOnly={ro} placeholder="texto SWOT" className="mt-0.5 text-sm font-medium text-fg" />
      ) : kind === "plano" ? (
        <EditableField value={data.hypothesis ?? ""} onCommit={(val) => patch({ hypothesis: val })} readOnly={ro} placeholder="hipótese X→Y" className="mt-0.5 text-sm font-medium text-fg" />
      ) : kind === "recurso" ? (
        <EditableField value={data.label ?? ""} onCommit={(val) => patch({ label: val })} readOnly={ro} placeholder="recurso" className="mt-0.5 text-sm font-medium text-fg" />
      ) : (
        <EditableField value={data.title ?? ""} onCommit={(val) => patch({ title: val })} readOnly={ro} placeholder="título" className="mt-0.5 text-sm font-medium text-fg" />
      )}

      {kind === "kr" && (
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <EditableField
            value={Number(data.currentValue ?? 0)}
            onCommit={(val) => patch({ currentValue: Number(val) })}
            readOnly={ro}
            type="number"
            className="w-14 text-fg"
          />
          <span>/ {Number(data.targetValue ?? 0)} {data.unit ?? ""}</span>
        </div>
      )}
      {kind === "swot" && data.swotType && (
        <div className="mt-1 text-[10px] uppercase text-muted-foreground">{String(data.swotType)}</div>
      )}
      {kind === "objetivo" && data.status && (
        <div className="mt-1 text-[10px] uppercase text-muted-foreground">{String(data.status)}</div>
      )}
      {ro && <div className="mt-1 text-[10px] italic text-muted-foreground">histórico</div>}
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-muted-foreground/50" />
    </div>
  );
}
