// Contrato do front com /api/plan-templates e /plan-templates/{capture,apply}
// do mapa (rotas fora do OpenAPI; ver spec 2026-10-05-modelos-de-plano).

export const PLAN_TEMPLATES_QUERY_KEY = ["/api/plan-templates"] as const;

export type PlanCounts = { cards: number; connections: number; texts: number; shapes: number };

export type PlanTemplateListItem = {
  id: string;
  name: string;
  counts: PlanCounts;
  createdAt: string;
  updatedAt: string;
};

export type PlanSelection = {
  cardIds: string[];
  textElementIds: string[];
  shapeIds: string[];
  /** Há ≥1 elemento que o servidor vai de fato guardar (decide o item "a partir da seleção"). */
  usable: boolean;
};

export type PlanCaptureResult = {
  template: { id: string; name: string; counts: PlanCounts; createdAt: string };
  skipped: { approvals: number; images: number };
};

export type PlanApplyResult = {
  cardIds: string[];
  connectionIds: string[];
  textElementIds: string[];
  shapeIds: string[];
  bounds: { x: number; y: number; width: number; height: number };
};

type NodeLike = { id: string; type?: string; selected?: boolean; data?: unknown };

const isImage = (n: NodeLike) => (n.data as { type?: string } | undefined)?.type === "image";

/**
 * Ids dos nós do ReactFlow = UUIDs do banco (sem prefixo) pra mindmap,
 * approvalnode, textnode e shapenode. joinnode é virtual e nunca vai.
 * Aprovações e imagens VÃO no corpo: o servidor exclui e conta em `skipped`.
 */
export function selectionFromNodes(nodes: NodeLike[]): PlanSelection {
  const sel = nodes.filter((n) => n.selected === true);
  return {
    cardIds: sel.filter((n) => n.type === "mindmap" || n.type === "approvalnode").map((n) => n.id),
    textElementIds: sel.filter((n) => n.type === "textnode").map((n) => n.id),
    shapeIds: sel.filter((n) => n.type === "shapenode").map((n) => n.id),
    usable: sel.some(
      (n) => n.type === "mindmap" || n.type === "textnode" || (n.type === "shapenode" && !isImage(n)),
    ),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function skippedDescription(s: { approvals: number; images: number }): string | undefined {
  const parts: string[] = [];
  if (s.approvals > 0) parts.push(plural(s.approvals, "aprovação", "aprovações"));
  if (s.images > 0) parts.push(plural(s.images, "imagem", "imagens"));
  if (parts.length === 0) return undefined;
  const verb = s.approvals + s.images === 1 ? "ficou" : "ficaram";
  return `${parts.join(" e ")} ${verb} de fora`;
}

export function formatPlanCounts(c: PlanCounts): string {
  const parts: string[] = [];
  if (c.cards > 0) parts.push(plural(c.cards, "tarefa", "tarefas"));
  if (c.texts > 0) parts.push(plural(c.texts, "texto", "textos"));
  if (c.shapes > 0) parts.push(plural(c.shapes, "forma", "formas"));
  return parts.length > 0 ? parts.join(" · ") : "vazio";
}
