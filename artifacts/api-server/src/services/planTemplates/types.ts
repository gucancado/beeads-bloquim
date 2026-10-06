import { z } from "zod/v4";

// ATENÇÃO: este módulo é importado por testes puros — não importar
// @workspace/db aqui (lança sem DATABASE_URL).

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type Priority = (typeof PRIORITIES)[number];

const checklistItemSchema = z.object({ text: z.string(), order: z.number().int() });

export const planTemplatePayloadV1Schema = z.object({
  v: z.literal(1),
  cards: z.array(
    z.object({
      key: z.string().min(1),
      x: z.number(),
      y: z.number(),
      title: z.string(),
      description: z.string().nullable(),
      task: z.object({
        priority: z.enum(PRIORITIES),
        checklist: z.array(checklistItemSchema),
      }),
    }),
  ),
  connections: z.array(
    z.object({
      sourceKey: z.string(),
      targetKey: z.string(),
      sourceHandle: z.string().nullable(),
      targetHandle: z.string().nullable(),
    }),
  ),
  texts: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      fontSize: z.number().int(),
      color: z.string(),
      content: z.string(),
    }),
  ),
  shapes: z.array(
    z.object({
      type: z.enum(["rect", "ellipse", "line"]),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      rotation: z.number(),
      color: z.string(),
      filled: z.boolean(),
      strokeStyle: z.enum(["solid", "dashed"]),
      x1: z.number().nullable(),
      y1: z.number().nullable(),
      x2: z.number().nullable(),
      y2: z.number().nullable(),
    }),
  ),
});

export type PlanTemplatePayloadV1 = z.infer<typeof planTemplatePayloadV1Schema>;

export type PlanCounts = { cards: number; connections: number; texts: number; shapes: number };

/** Contagens tolerantes: payload malformado conta 0, nunca lança. */
export function payloadCounts(payload: unknown): PlanCounts {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return {
    cards: len(p.cards),
    connections: len(p.connections),
    texts: len(p.texts),
    shapes: len(p.shapes),
  };
}

/** Linha de card do mapa com a tarefa (left join) e o checklist já ordenado. */
export type CaptureCardRow = {
  id: string;
  positionX: number;
  positionY: number;
  title: string;
  description: string | null;
  taskId: string | null;
  taskTitle: string | null;
  taskDescription: string | null;
  taskPriority: Priority | null;
  isApprovalTask: boolean;
  parentTaskId: string | null;
  checklist: Array<{ text: string; order: number }>;
};

export type CaptureConnectionRow = {
  sourceCardId: string;
  targetCardId: string;
  sourceHandle: string | null;
  targetHandle: string | null;
};

export type CaptureTextRow = {
  id: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  fontSize: number;
  color: string;
  content: string;
};

export type CaptureShapeRow = {
  id: string;
  type: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
  filled: boolean;
  strokeStyle: string;
  x1: number | null;
  y1: number | null;
  x2: number | null;
  y2: number | null;
};

export type MapSnapshot = {
  cards: CaptureCardRow[];
  connections: CaptureConnectionRow[];
  texts: CaptureTextRow[];
  shapes: CaptureShapeRow[];
};

/** Sem nenhum array = mapa inteiro. Com qualquer array = só os ids listados. */
export type Selection = {
  cardIds?: string[];
  textElementIds?: string[];
  shapeIds?: string[];
};

export type Skipped = { approvals: number; images: number };
