import type { NodeChange, XYPosition } from 'reactflow';

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
 * nós virtuais (ids de card são UUIDs, sem colisão possível). O MESMO array
 * é compartilhado por referência entre todas as chaves do grupo — tratar
 * como read-only; nunca mutar in-place.
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

type PositionChange = Extract<NodeChange, { type: 'position' }>;

/**
 * Expande NodeChanges de posição: quando um membro de grupo rígido se move,
 * gera changes com o MESMO delta pros demais membros. Ids já presentes nas
 * changes originais (seleção contendo vários membros) não recebem propagação.
 * Change de posição sem `position` (evento de fim de drag do ReactFlow) só
 * replica a flag `dragging`, pra nenhum membro ficar preso em dragging=true.
 */
export function expandPositionChanges(
  changes: NodeChange[],
  getPosition: (id: string) => XYPosition | undefined,
  groupIndex: ApprovalGroupIndex,
): NodeChange[] {
  const explicitIds = new Set<string>();
  for (const ch of changes) {
    if (ch.type === 'position') explicitIds.add(ch.id);
  }

  const propagated: PositionChange[] = [];
  const propagatedIds = new Set<string>();

  for (const ch of changes) {
    if (ch.type !== 'position') continue;
    const memberIds = groupIndex.get(ch.id);
    if (!memberIds) continue;

    if (!ch.position) {
      if (ch.dragging === undefined) continue;
      for (const memberId of memberIds) {
        if (memberId === ch.id || explicitIds.has(memberId) || propagatedIds.has(memberId)) continue;
        propagatedIds.add(memberId);
        propagated.push({ id: memberId, type: 'position', dragging: ch.dragging });
      }
      continue;
    }

    const origin = getPosition(ch.id);
    if (!origin) continue;
    const dx = ch.position.x - origin.x;
    const dy = ch.position.y - origin.y;

    for (const memberId of memberIds) {
      if (memberId === ch.id || explicitIds.has(memberId) || propagatedIds.has(memberId)) continue;
      const memberPos = getPosition(memberId);
      if (!memberPos) continue;
      const next = { x: memberPos.x + dx, y: memberPos.y + dy };
      propagatedIds.add(memberId);
      propagated.push({
        id: memberId,
        type: 'position',
        position: next,
        positionAbsolute: next,
        dragging: ch.dragging,
      });
    }
  }

  return propagated.length ? [...changes, ...propagated] : changes;
}
