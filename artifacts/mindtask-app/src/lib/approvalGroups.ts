export interface ApprovalGroupCardInput {
  id: string;
  taskId?: string | null;
  taskIsApprovalTask?: boolean;
  taskParentTaskId?: string | null;
  taskApprovalMode?: string | null;
}

/**
 * nodeId → ids de TODOS os membros do grupo rígido (incluindo o próprio id).
 * Grupo = card da tarefa-pai + cards de aprovação + join node virtual
 * (`join-<parentCardId>`, só em modo parallel com 2+ aprovações — espelha
 * buildJoinNodes do canvas). Cards sem aprovações e aprovações órfãs ficam
 * fora do índice (movem livres).
 *
 * CONTRATO de ordem do array (consumidores dependem disso):
 * `[cardPai, ...cardsDeAprovação, joinId?]` — pai é sempre o índice 0 e o
 * join, quando existe, é sempre o último. `join-` é namespace reservado de
 * nós virtuais (ids de card são UUIDs, sem colisão possível).
 */
export type ApprovalGroupIndex = Map<string, string[]>;

export function buildApprovalGroupIndex(cards: ApprovalGroupCardInput[]): ApprovalGroupIndex {
  const approvalsByParentTask = new Map<string, ApprovalGroupCardInput[]>();
  for (const c of cards) {
    if (c.taskIsApprovalTask && c.taskParentTaskId) {
      const list = approvalsByParentTask.get(c.taskParentTaskId) ?? [];
      list.push(c);
      approvalsByParentTask.set(c.taskParentTaskId, list);
    }
  }

  const index: ApprovalGroupIndex = new Map();
  for (const parentCard of cards) {
    if (parentCard.taskIsApprovalTask || !parentCard.taskId) continue;
    const children = approvalsByParentTask.get(parentCard.taskId);
    if (!children || children.length === 0) continue;
    const memberIds = [parentCard.id, ...children.map(c => c.id)];
    const isParallel = (parentCard.taskApprovalMode ?? 'sequential') === 'parallel';
    if (isParallel && children.length >= 2) memberIds.push(`join-${parentCard.id}`);
    for (const id of memberIds) index.set(id, memberIds);
  }
  return index;
}
