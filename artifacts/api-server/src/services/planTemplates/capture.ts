// Funções puras da captura de modelo de plano (spec B2). Sem banco.
import type {
  CaptureCardRow,
  CaptureShapeRow,
  CaptureTextRow,
  MapSnapshot,
  PlanTemplatePayloadV1,
  Selection,
  Skipped,
} from "./types";

export type SelectedElements = {
  cards: CaptureCardRow[];
  texts: CaptureTextRow[];
  shapes: CaptureShapeRow[];
  skipped: Skipped;
};

export type RemappedConnection = {
  sourceCardId: string;
  targetCardId: string;
  sourceHandle: string | null;
  targetHandle: string | null;
};

const CAPTURABLE_SHAPES = new Set(["rect", "ellipse", "line"]);

export function hasSelection(sel: Selection): boolean {
  return sel.cardIds !== undefined || sel.textElementIds !== undefined || sel.shapeIds !== undefined;
}

export function selectElements(snapshot: MapSnapshot, sel: Selection): SelectedElements {
  const partial = hasSelection(sel);
  const pick = <T extends { id: string }>(rows: T[], ids: string[] | undefined): T[] => {
    if (!partial) return rows;
    if (!ids) return [];
    const wanted = new Set(ids);
    return rows.filter((r) => wanted.has(r.id));
  };

  const consideredCards = pick(snapshot.cards, sel.cardIds);
  const consideredShapes = pick(snapshot.shapes, sel.shapeIds);

  return {
    cards: consideredCards.filter((c) => !c.isApprovalTask),
    texts: pick(snapshot.texts, sel.textElementIds),
    shapes: consideredShapes.filter((s) => CAPTURABLE_SHAPES.has(s.type)),
    skipped: {
      approvals: consideredCards.filter((c) => c.isApprovalTask).length,
      images: consideredShapes.filter((s) => s.type === "image").length,
    },
  };
}

/**
 * D4: toda card_connection que toca um card de aprovação é remapeada pro card
 * pai da cadeia (resolvido com o mapa INTEIRO). Mantém só conexões cujas duas
 * pontas (pós-remapeamento) estão no conjunto, sem self-loop, deduplicadas por
 * par (a primeira ocorrência vence). Remapeada → handles source-right /
 * target-left; senão, os originais.
 */
export function remapConnections(
  snapshot: MapSnapshot,
  includedCardIds: Set<string>,
): RemappedConnection[] {
  const cardById = new Map(snapshot.cards.map((c) => [c.id, c]));
  const cardIdByTaskId = new Map<string, string>();
  for (const c of snapshot.cards) if (c.taskId) cardIdByTaskId.set(c.taskId, c.id);

  const resolve = (cardId: string): { id: string; remapped: boolean } | null => {
    const c = cardById.get(cardId);
    if (!c) return null;
    if (!c.isApprovalTask) return { id: c.id, remapped: false };
    const parentCardId = c.parentTaskId ? cardIdByTaskId.get(c.parentTaskId) : undefined;
    return parentCardId ? { id: parentCardId, remapped: true } : null;
  };

  const seen = new Set<string>();
  const out: RemappedConnection[] = [];
  for (const conn of snapshot.connections) {
    const s = resolve(conn.sourceCardId);
    const t = resolve(conn.targetCardId);
    if (!s || !t) continue;
    if (s.id === t.id) continue;
    if (!includedCardIds.has(s.id) || !includedCardIds.has(t.id)) continue;
    const pair = `${s.id}->${t.id}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const remapped = s.remapped || t.remapped;
    out.push({
      sourceCardId: s.id,
      targetCardId: t.id,
      sourceHandle: remapped ? "source-right" : conn.sourceHandle,
      targetHandle: remapped ? "target-left" : conn.targetHandle,
    });
  }
  return out;
}

export function normalizePositions(
  points: Array<{ positionX: number; positionY: number }>,
): { minX: number; minY: number } {
  if (points.length === 0) return { minX: 0, minY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  for (const p of points) {
    if (p.positionX < minX) minX = p.positionX;
    if (p.positionY < minY) minY = p.positionY;
  }
  return { minX, minY };
}

export function buildPayload(
  selected: SelectedElements,
  connections: RemappedConnection[],
  offset: { minX: number; minY: number },
): PlanTemplatePayloadV1 {
  const keyByCardId = new Map<string, string>();
  const cards = selected.cards.map((c, i) => {
    const key = `c${i + 1}`;
    keyByCardId.set(c.id, key);
    return {
      key,
      x: c.positionX - offset.minX,
      y: c.positionY - offset.minY,
      title: c.taskTitle ?? c.title,
      description: c.taskDescription ?? c.description,
      task: {
        priority: c.taskPriority ?? "medium",
        checklist: c.taskId ? c.checklist.map((i) => ({ text: i.text, order: i.order })) : [],
      },
    };
  });

  return {
    v: 1,
    cards,
    connections: connections.flatMap((cn) => {
      const sourceKey = keyByCardId.get(cn.sourceCardId);
      const targetKey = keyByCardId.get(cn.targetCardId);
      return sourceKey && targetKey
        ? [{ sourceKey, targetKey, sourceHandle: cn.sourceHandle, targetHandle: cn.targetHandle }]
        : [];
    }),
    texts: selected.texts.map((t) => ({
      x: t.positionX - offset.minX,
      y: t.positionY - offset.minY,
      width: t.width,
      height: t.height,
      fontSize: t.fontSize,
      color: t.color,
      content: t.content,
    })),
    shapes: selected.shapes.map((s) => ({
      type: s.type as "rect" | "ellipse" | "line",
      x: s.positionX - offset.minX,
      y: s.positionY - offset.minY,
      width: s.width,
      height: s.height,
      rotation: s.rotation,
      color: s.color,
      filled: s.filled,
      strokeStyle: s.strokeStyle === "dashed" ? ("dashed" as const) : ("solid" as const),
      x1: s.x1,
      y1: s.y1,
      x2: s.x2,
      y2: s.y2,
    })),
  };
}

export function buildCapture(
  snapshot: MapSnapshot,
  sel: Selection,
): { payload: PlanTemplatePayloadV1; skipped: Skipped } | null {
  const selected = selectElements(snapshot, sel);
  if (selected.cards.length + selected.texts.length + selected.shapes.length === 0) return null;
  const connections = remapConnections(snapshot, new Set(selected.cards.map((c) => c.id)));
  const offset = normalizePositions([...selected.cards, ...selected.texts, ...selected.shapes]);
  return { payload: buildPayload(selected, connections, offset), skipped: selected.skipped };
}
