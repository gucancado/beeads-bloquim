import { db } from "@workspace/db";
import { tasks, cards, cardConnections } from "@workspace/db/schema";
import { eq, and, inArray, asc } from "drizzle-orm";

export interface ApprovalChainInfo {
  parentCardId: string;
  approvalTasksSorted: { id: string; approvalOrder: number }[];
  approvalCardByTaskId: Map<string, string>;
  chainCardIds: Set<string>;
}

/**
 * Loads the approval chain for a parent task: its card, its ordered approval
 * subtasks, the cards backing those approval tasks, and the union set of all
 * card ids that participate in the chain.
 *
 * Returns `null` when the parent task has no card (orphaned task).
 */
export async function getApprovalChainInfo(
  taskId: string,
): Promise<ApprovalChainInfo | null> {
  const [parentCard] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.taskId, taskId))
    .limit(1);
  if (!parentCard) return null;

  const approvalTasksSorted = await db
    .select({ id: tasks.id, approvalOrder: tasks.approvalOrder })
    .from(tasks)
    .where(and(eq(tasks.parentTaskId, taskId), eq(tasks.isApprovalTask, true)))
    .orderBy(asc(tasks.approvalOrder));

  const approvalCardByTaskId = new Map<string, string>();
  if (approvalTasksSorted.length > 0) {
    const approvalCards = await db
      .select({ id: cards.id, taskId: cards.taskId })
      .from(cards)
      .where(inArray(cards.taskId, approvalTasksSorted.map((t) => t.id)));
    for (const c of approvalCards) {
      if (c.taskId) approvalCardByTaskId.set(c.taskId, c.id);
    }
  }

  const chainCardIds = new Set<string>([
    parentCard.id,
    ...approvalCardByTaskId.values(),
  ]);
  return {
    parentCardId: parentCard.id,
    approvalTasksSorted,
    approvalCardByTaskId,
    chainCardIds,
  };
}

/**
 * Picks the card id that should act as the chain "exit" — i.e. the card whose
 * outgoing connections feed downstream cards. The choice depends on approval
 * mode (`sequential` → last approval; otherwise → parent card).
 *
 * Falls back to the parent card id when the corresponding approval card cannot
 * be found.
 */
export function computeTerminalCardId(
  approvalTasksSorted: { id: string; approvalOrder: number }[],
  approvalCardByTaskId: Map<string, string>,
  parentCardId: string,
  mode: string,
): string {
  if (approvalTasksSorted.length === 0) return parentCardId;
  if (approvalTasksSorted.length === 1) {
    return approvalCardByTaskId.get(approvalTasksSorted[0].id) ?? parentCardId;
  }
  if (mode === "sequential") {
    const last = approvalTasksSorted[approvalTasksSorted.length - 1];
    return approvalCardByTaskId.get(last.id) ?? parentCardId;
  }
  return parentCardId;
}

/**
 * Moves outgoing connections from `oldTerminalCardId` to `newTerminalCardId`
 * for any target that is *outside* the chain. If the destination already has
 * an equivalent connection, the duplicate from the old terminal is removed
 * instead of being re-pointed (preserves the (source,target) uniqueness).
 *
 * No-ops when the terminal is unchanged.
 */
export async function rerouteDownstreamConnections(
  oldTerminalCardId: string,
  newTerminalCardId: string,
  chainCardIds: Set<string>,
): Promise<void> {
  if (oldTerminalCardId === newTerminalCardId) return;
  const conns = await db
    .select({
      id: cardConnections.id,
      targetCardId: cardConnections.targetCardId,
      sourceHandle: cardConnections.sourceHandle,
      targetHandle: cardConnections.targetHandle,
    })
    .from(cardConnections)
    .where(eq(cardConnections.sourceCardId, oldTerminalCardId));
  const downstream = conns.filter((c) => !chainCardIds.has(c.targetCardId));
  if (downstream.length === 0) return;

  for (const conn of downstream) {
    const [existing] = await db
      .select({ id: cardConnections.id })
      .from(cardConnections)
      .where(
        and(
          eq(cardConnections.sourceCardId, newTerminalCardId),
          eq(cardConnections.targetCardId, conn.targetCardId),
        ),
      )
      .limit(1);
    if (existing) {
      await db.delete(cardConnections).where(eq(cardConnections.id, conn.id));
    } else {
      await db
        .update(cardConnections)
        .set({ sourceCardId: newTerminalCardId })
        .where(eq(cardConnections.id, conn.id));
    }
  }
}
