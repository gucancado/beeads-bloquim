import { Handle, Position, type NodeProps } from "reactflow";
import type { StrategyNodeKind } from "@/hooks/useStrategy";

/**
 * Renderer base dos nós do mapa estratégico (Fase 4). Um card por kind, com
 * paleta @beeads/tokens. Será refinado em componentes dedicados por tipo
 * (ObjectiveNode/KrNode/…) + floating edges; por ora um switch por kind.
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

export function StrategyNodeView({ data, selected }: NodeProps) {
  const kind = data.kind as StrategyNodeKind;
  const meta = KIND_META[kind] ?? KIND_META.tema;

  const title =
    data.title ?? data.label ?? data.text ?? (kind === "plano" ? (data.hypothesis || "Plano") : meta.label);

  return (
    <div
      className={`min-w-[180px] max-w-[260px] rounded-xl border border-l-4 bg-card px-3 py-2 shadow-md ${meta.accent} ${selected ? "ring-2 ring-honey" : ""} ${data.readOnly ? "opacity-60" : ""}`}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-muted-foreground/50" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{meta.label}</span>
        {kind === "kr" && <HealthPill health={data.health} />}
        {kind === "objetivo" && <HealthPill health={data.health} />}
      </div>
      <div className="mt-0.5 text-sm font-medium text-fg break-words">{title}</div>
      {kind === "kr" && (
        <div className="mt-1 text-xs text-muted-foreground">
          {Number(data.currentValue ?? 0)} / {Number(data.targetValue ?? 0)} {data.unit ?? ""}
        </div>
      )}
      {kind === "swot" && data.swotType && (
        <div className="mt-1 text-[10px] uppercase text-muted-foreground">{String(data.swotType)}</div>
      )}
      {kind === "objetivo" && data.status && (
        <div className="mt-1 text-[10px] uppercase text-muted-foreground">{String(data.status)}</div>
      )}
      {data.readOnly && <div className="mt-1 text-[10px] italic text-muted-foreground">histórico</div>}
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-muted-foreground/50" />
    </div>
  );
}
