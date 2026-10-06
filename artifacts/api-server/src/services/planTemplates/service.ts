import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  cards,
  cardConnections,
  mapShapes,
  mapTextElements,
  maps,
  planTemplates,
  subtasks,
  taskActivities,
  tasks,
} from "@workspace/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { buildCapture, hasSelection } from "./capture";
import { computeBounds, computeOrigin, existingBoxes } from "./apply";
import { payloadCounts, planTemplatePayloadV1Schema, type MapSnapshot, type Selection } from "./types";

export interface ServiceResponse<T = unknown> {
  status: number;
  body: T;
}

async function loadSnapshot(mapId: string): Promise<MapSnapshot> {
  const cardRows = await db
    .select({
      id: cards.id,
      positionX: cards.positionX,
      positionY: cards.positionY,
      title: cards.title,
      description: cards.description,
      taskId: cards.taskId,
      taskTitle: tasks.title,
      taskDescription: tasks.description,
      taskPriority: tasks.priority,
      isApprovalTask: tasks.isApprovalTask,
      parentTaskId: tasks.parentTaskId,
    })
    .from(cards)
    .leftJoin(tasks, eq(tasks.id, cards.taskId))
    .where(eq(cards.mapId, mapId));

  const taskIds = cardRows.map((c) => c.taskId).filter((id): id is string => !!id);
  const checklistRows =
    taskIds.length === 0
      ? []
      : await db
          .select({ taskId: subtasks.taskId, text: subtasks.text, order: subtasks.order })
          .from(subtasks)
          .where(inArray(subtasks.taskId, taskIds))
          .orderBy(asc(subtasks.order), asc(subtasks.createdAt));
  const checklistByTask = new Map<string, Array<{ text: string; order: number }>>();
  for (const r of checklistRows) {
    const list = checklistByTask.get(r.taskId) ?? [];
    list.push({ text: r.text, order: r.order });
    checklistByTask.set(r.taskId, list);
  }

  const connections = await db
    .select({
      sourceCardId: cardConnections.sourceCardId,
      targetCardId: cardConnections.targetCardId,
      sourceHandle: cardConnections.sourceHandle,
      targetHandle: cardConnections.targetHandle,
    })
    .from(cardConnections)
    .where(eq(cardConnections.mapId, mapId));

  const texts = await db
    .select({
      id: mapTextElements.id,
      positionX: mapTextElements.positionX,
      positionY: mapTextElements.positionY,
      width: mapTextElements.width,
      height: mapTextElements.height,
      fontSize: mapTextElements.fontSize,
      color: mapTextElements.color,
      content: mapTextElements.content,
    })
    .from(mapTextElements)
    .where(eq(mapTextElements.mapId, mapId));

  const shapes = await db
    .select({
      id: mapShapes.id,
      type: mapShapes.type,
      positionX: mapShapes.positionX,
      positionY: mapShapes.positionY,
      width: mapShapes.width,
      height: mapShapes.height,
      rotation: mapShapes.rotation,
      color: mapShapes.color,
      filled: mapShapes.filled,
      strokeStyle: mapShapes.strokeStyle,
      x1: mapShapes.x1,
      y1: mapShapes.y1,
      x2: mapShapes.x2,
      y2: mapShapes.y2,
    })
    .from(mapShapes)
    .where(eq(mapShapes.mapId, mapId));

  return {
    cards: cardRows.map((c) => ({
      ...c,
      isApprovalTask: c.isApprovalTask ?? false,
      checklist: c.taskId ? checklistByTask.get(c.taskId) ?? [] : [],
    })),
    connections,
    texts,
    shapes,
  };
}

export async function captureFromMap(args: {
  userId: string;
  mapId: string;
  selection: Selection;
}): Promise<ServiceResponse> {
  const [map] = await db.select({ name: maps.name }).from(maps).where(eq(maps.id, args.mapId)).limit(1);
  if (!map) return { status: 404, body: { error: "Not found" } };

  const result = buildCapture(await loadSnapshot(args.mapId), args.selection);
  if (!result) return { status: 400, body: { error: "nada pra salvar no modelo" } };

  const name = hasSelection(args.selection) ? `${map.name} (seleção)` : map.name;
  const [row] = await db
    .insert(planTemplates)
    .values({ userId: args.userId, name, payload: result.payload })
    .returning();
  return {
    status: 201,
    body: {
      template: { id: row.id, name: row.name, counts: payloadCounts(row.payload), createdAt: row.createdAt },
      skipped: result.skipped,
    },
  };
}

export async function applyToMap(args: {
  userId: string;
  actorName: string | null;
  source: string | null;
  templateId: string;
  mapId: string;
  workspaceId: string;
}): Promise<ServiceResponse> {
  const { userId, mapId, workspaceId } = args;
  const [tpl] = await db
    .select()
    .from(planTemplates)
    .where(and(eq(planTemplates.id, args.templateId), eq(planTemplates.userId, userId)))
    .limit(1);
  if (!tpl) return { status: 404, body: { error: "Not found" } };

  const parsed = planTemplatePayloadV1Schema.safeParse(tpl.payload);
  if (!parsed.success) return { status: 422, body: { error: "modelo em formato não suportado" } };
  const payload = parsed.data;

  // Mesmo shape que recordTaskActivity produz (que usa o db global e por isso
  // não serve dentro da transação).
  const metadata: Record<string, string | null> = { actorName: args.actorName };
  if (args.source) metadata.source = args.source;

  const body = await db.transaction(async (tx) => {
    // D6: serializa applies no mesmo mapa antes de ler as caixas.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${mapId}::text))`);

    const cardRows = await tx
      .select({ positionX: cards.positionX, positionY: cards.positionY })
      .from(cards)
      .where(eq(cards.mapId, mapId));
    const textRows = await tx
      .select({
        positionX: mapTextElements.positionX,
        positionY: mapTextElements.positionY,
        width: mapTextElements.width,
        height: mapTextElements.height,
      })
      .from(mapTextElements)
      .where(eq(mapTextElements.mapId, mapId));
    const shapeRows = await tx
      .select({
        type: mapShapes.type,
        positionX: mapShapes.positionX,
        positionY: mapShapes.positionY,
        width: mapShapes.width,
        height: mapShapes.height,
        rotation: mapShapes.rotation,
      })
      .from(mapShapes)
      .where(eq(mapShapes.mapId, mapId));

    const origin = computeOrigin(existingBoxes({ cards: cardRows, texts: textRows, shapes: shapeRows }));

    // Ids gerados aqui pra inserir em lote (poucos round-trips dentro da transação).
    const keyToCardId = new Map<string, string>();
    const taskValues: Array<typeof tasks.$inferInsert> = [];
    const cardValues: Array<typeof cards.$inferInsert & { id: string }> = [];
    const checklistValues: Array<typeof subtasks.$inferInsert> = [];
    const activityValues: Array<typeof taskActivities.$inferInsert> = [];
    for (const c of payload.cards) {
      const taskId = randomUUID();
      const cardId = randomUUID();
      keyToCardId.set(c.key, cardId);
      taskValues.push({
        id: taskId,
        title: c.title,
        description: c.description,
        priority: c.task.priority,
        status: "draft",
        scheduleMode: "sem_prazo",
        mapId,
        workspaceId,
        assignedTo: userId,
        ownerId: userId,
        createdBy: userId,
      });
      cardValues.push({
        id: cardId,
        mapId,
        title: c.title,
        description: c.description,
        positionX: origin.x + c.x,
        positionY: origin.y + c.y,
        statusVisual: "draft",
        taskId,
      });
      for (const item of c.task.checklist) {
        checklistValues.push({ taskId, text: item.text, completed: false, order: item.order });
      }
      activityValues.push({ taskId, actorId: userId, type: "task_created", metadata });
    }
    if (taskValues.length) await tx.insert(tasks).values(taskValues);
    if (cardValues.length) await tx.insert(cards).values(cardValues);
    if (checklistValues.length) await tx.insert(subtasks).values(checklistValues);
    if (activityValues.length) await tx.insert(taskActivities).values(activityValues);

    // Sem dedupe: par duplicado viola a unique e derruba a transação (a captura já deduplica).
    const connectionValues = payload.connections.flatMap((cn) => {
      const sourceCardId = keyToCardId.get(cn.sourceKey);
      const targetCardId = keyToCardId.get(cn.targetKey);
      return sourceCardId && targetCardId
        ? [{ id: randomUUID(), mapId, sourceCardId, targetCardId, sourceHandle: cn.sourceHandle, targetHandle: cn.targetHandle }]
        : [];
    });
    if (connectionValues.length) await tx.insert(cardConnections).values(connectionValues);

    const textValues = payload.texts.map((t) => ({
      id: randomUUID(),
      mapId,
      positionX: origin.x + t.x,
      positionY: origin.y + t.y,
      width: t.width,
      height: t.height,
      fontSize: t.fontSize,
      color: t.color,
      content: t.content,
    }));
    if (textValues.length) await tx.insert(mapTextElements).values(textValues);

    const shapeValues = payload.shapes.map((s) => ({
      id: randomUUID(),
      mapId,
      type: s.type,
      positionX: origin.x + s.x,
      positionY: origin.y + s.y,
      width: s.width,
      height: s.height,
      rotation: s.rotation,
      color: s.color,
      filled: s.filled,
      strokeStyle: s.strokeStyle,
      x1: s.x1,
      y1: s.y1,
      x2: s.x2,
      y2: s.y2,
    }));
    if (shapeValues.length) await tx.insert(mapShapes).values(shapeValues);

    return {
      cardIds: cardValues.map((c) => c.id),
      connectionIds: connectionValues.map((c) => c.id),
      textElementIds: textValues.map((t) => t.id),
      shapeIds: shapeValues.map((s) => s.id),
      bounds: computeBounds(payload, origin),
    };
  });

  return { status: 200, body };
}

function toListItem(r: { id: string; name: string; payload: unknown; createdAt: Date; updatedAt: Date }) {
  return { id: r.id, name: r.name, counts: payloadCounts(r.payload), createdAt: r.createdAt, updatedAt: r.updatedAt };
}

export async function listPlanTemplates(userId: string): Promise<ServiceResponse> {
  const rows = await db
    .select()
    .from(planTemplates)
    .where(eq(planTemplates.userId, userId))
    .orderBy(asc(planTemplates.createdAt));
  return { status: 200, body: rows.map(toListItem) };
}

export async function renamePlanTemplate(userId: string, id: string, name: string): Promise<ServiceResponse> {
  const [row] = await db
    .update(planTemplates)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(planTemplates.id, id), eq(planTemplates.userId, userId)))
    .returning();
  if (!row) return { status: 404, body: { error: "Not found" } };
  return { status: 200, body: toListItem(row) };
}

export async function deletePlanTemplate(userId: string, id: string): Promise<ServiceResponse> {
  const [row] = await db
    .delete(planTemplates)
    .where(and(eq(planTemplates.id, id), eq(planTemplates.userId, userId)))
    .returning({ id: planTemplates.id });
  if (!row) return { status: 404, body: { error: "Not found" } };
  return { status: 200, body: { success: true } };
}
