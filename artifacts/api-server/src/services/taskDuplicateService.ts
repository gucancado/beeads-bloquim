import { db } from "@workspace/db";
import {
  tasks,
  cards,
  subtasks,
  taskActivities,
} from "@workspace/db/schema";
import { eq, and, asc } from "drizzle-orm";

/** Generic { status, body } envelope so route handlers stay one-liners. */
export interface ServiceResponse<T = unknown> {
  status: number;
  body: T;
}

const CARD_WIDTH = 240;
const CARD_GAP = 50;

/**
 * Find an X coordinate that doesn't visually collide with any of `occupiedXs`
 * (cards within `CARD_WIDTH` of each other are considered colliding).
 * Slides right by `CARD_WIDTH + CARD_GAP` until a free slot is found, giving
 * up after 50 attempts and returning whatever it has (matches the
 * pre-extraction behavior).
 */
function findFreeX(idealX: number, occupiedXs: number[]): number {
  let candidateX = idealX;
  const step = CARD_WIDTH + CARD_GAP;
  let attempts = 0;
  while (attempts < 50) {
    const collides = occupiedXs.some(
      (ox) => Math.abs(ox - candidateX) < CARD_WIDTH,
    );
    if (!collides) return candidateX;
    candidateX += step;
    attempts++;
  }
  return candidateX;
}

/**
 * Deep-duplicate a task within its workspace:
 *   - copies title, description (preferring the card's description when the
 *     task lives on a map), assignee, priority, mapId and approvalMode;
 *   - resets `status` to "draft" and `overdue` to false on every new row;
 *   - re-creates each subtask (text/completed/order preserved);
 *   - if the task lives on a map, creates a new card placed to the right of
 *     the original (sliding right to avoid collisions);
 *   - re-creates each approver as a new approval-task parented to the new
 *     task, and (on a map) a sibling approval card placed to the right;
 *   - records a `task_duplicated` activity on the new task with metadata
 *     `{ originalTaskId, workspaceId }`.
 *
 *   404 — original task not found in this workspace
 *   201 — public shape of the new task (matches the pre-extraction body)
 */
export async function duplicateTask(
  workspaceId: string,
  taskId: string,
  actorId: string,
): Promise<ServiceResponse> {
  const [original] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
    .limit(1);

  if (!original) {
    return { status: 404, body: { error: "Not found" } };
  }

  const [originalSubtasks, originalApprovalTasks, originalCardRow] =
    await Promise.all([
      db
        .select()
        .from(subtasks)
        .where(eq(subtasks.taskId, taskId))
        .orderBy(asc(subtasks.order), asc(subtasks.createdAt)),
      db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.parentTaskId, taskId),
            eq(tasks.isApprovalTask, true),
          ),
        )
        .orderBy(asc(tasks.approvalOrder)),
      original.mapId
        ? db
            .select({ description: cards.description })
            .from(cards)
            .where(eq(cards.taskId, taskId))
            .limit(1)
        : Promise.resolve([] as Array<{ description: string | null }>),
    ]);

  const effectiveDescription =
    originalCardRow[0]?.description ?? original.description;

  const result = await db.transaction(async (tx) => {
    const [newTask] = await tx
      .insert(tasks)
      .values({
        workspaceId: original.workspaceId,
        mapId: original.mapId,
        title: original.title,
        description: effectiveDescription,
        assignedTo: original.assignedTo,
        ownerId: original.ownerId,
        priority: original.priority ?? "medium",
        status: "draft",
        approvalMode: original.approvalMode,
        overdue: false,
      })
      .returning();

    if (originalSubtasks.length > 0) {
      await tx.insert(subtasks).values(
        originalSubtasks.map((s) => ({
          taskId: newTask.id,
          text: s.text,
          completed: s.completed,
          order: s.order,
        })),
      );
    }

    let newTaskCardId: string | undefined;
    let originalCardPositionX = 0;
    let originalCardPositionY = 0;

    if (original.mapId) {
      const [originalCard, allMapCards] = await Promise.all([
        tx
          .select({ positionX: cards.positionX, positionY: cards.positionY })
          .from(cards)
          .where(eq(cards.taskId, taskId))
          .limit(1),
        tx
          .select({ positionX: cards.positionX })
          .from(cards)
          .where(eq(cards.mapId, original.mapId)),
      ]);

      if (originalCard[0]) {
        originalCardPositionX = originalCard[0].positionX;
        originalCardPositionY = originalCard[0].positionY;
      }

      const occupiedXs = allMapCards.map((c) => c.positionX);
      const idealX = originalCardPositionX + CARD_WIDTH + CARD_GAP;
      const newCardX = findFreeX(idealX, occupiedXs);
      const newCardY = originalCardPositionY;

      const [newCard] = await tx
        .insert(cards)
        .values({
          mapId: original.mapId,
          title: newTask.title,
          description: newTask.description,
          positionX: newCardX,
          positionY: newCardY,
          taskId: newTask.id,
          statusVisual: "draft",
        })
        .returning({ id: cards.id });

      newTaskCardId = newCard?.id;
      occupiedXs.push(newCardX);
    }

    for (const approvalTask of originalApprovalTasks) {
      const [newApprovalTask] = await tx
        .insert(tasks)
        .values({
          workspaceId: original.workspaceId,
          mapId: original.mapId,
          title: approvalTask.title,
          assignedTo: approvalTask.assignedTo,
          priority: "medium",
          status: "draft",
          isApprovalTask: true,
          parentTaskId: newTask.id,
          approvalOrder: approvalTask.approvalOrder,
          overdue: false,
        })
        .returning();

      if (original.mapId && newTaskCardId) {
        const [originalApprovalCard, allMapCards] = await Promise.all([
          tx
            .select({
              positionX: cards.positionX,
              positionY: cards.positionY,
            })
            .from(cards)
            .where(eq(cards.taskId, approvalTask.id))
            .limit(1),
          tx
            .select({ positionX: cards.positionX })
            .from(cards)
            .where(eq(cards.mapId, original.mapId)),
        ]);

        const occupiedXs = allMapCards.map((c) => c.positionX);

        let approvalCardY: number;
        let idealApprovalX: number;

        if (originalApprovalCard[0]) {
          idealApprovalX =
            originalApprovalCard[0].positionX + CARD_WIDTH + CARD_GAP;
          approvalCardY = originalApprovalCard[0].positionY;
        } else {
          const offsetX = 350 + (approvalTask.approvalOrder ?? 0) * 50;
          const offsetY = 150 + (approvalTask.approvalOrder ?? 0) * 120;
          idealApprovalX =
            originalCardPositionX + CARD_WIDTH + CARD_GAP + offsetX;
          approvalCardY = originalCardPositionY + offsetY;
        }

        const approvalCardX = findFreeX(idealApprovalX, occupiedXs);

        await tx.insert(cards).values({
          mapId: original.mapId,
          title: newApprovalTask.title,
          positionX: approvalCardX,
          positionY: approvalCardY,
          taskId: newApprovalTask.id,
          statusVisual: "draft",
        });
      }
    }

    await tx.insert(taskActivities).values({
      taskId: newTask.id,
      actorId,
      type: "task_duplicated",
      metadata: { originalTaskId: taskId, workspaceId },
    });

    return { newTask, newTaskCardId };
  });

  return {
    status: 201,
    body: {
      id: result.newTask.id,
      cardId: result.newTaskCardId ?? null,
      title: result.newTask.title,
      description: result.newTask.description,
      status: result.newTask.status,
      priority: result.newTask.priority,
      assignedTo: result.newTask.assignedTo,
      workspaceId: result.newTask.workspaceId,
      mapId: result.newTask.mapId,
      approvalMode: result.newTask.approvalMode,
      createdAt: result.newTask.createdAt,
    },
  };
}
