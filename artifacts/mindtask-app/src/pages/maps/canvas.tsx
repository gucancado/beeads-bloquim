import { useState, useCallback, useEffect, useRef } from "react";
import { useRoute } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { ReactFlow, Controls, Background, useNodesState, useEdgesState, addEdge, Connection, Edge, Node, BackgroundVariant, ReactFlowProvider, EdgeChange, ConnectionMode, useReactFlow } from 'reactflow';
import 'reactflow/dist/style.css';
import MindMapNode from "@/components/maps/MindMapNode";
import TextNode from "@/components/maps/TextNode";
import DeletableEdge from "@/components/maps/DeletableEdge";
import ApprovalNode from "@/components/maps/ApprovalNode";
import ApprovalJoinNode from "@/components/maps/ApprovalJoinNode";
import ApprovalEdge from "@/components/maps/ApprovalEdge";
import { TaskDetailModal } from "@/components/tasks/TaskDetailModal";
import { useGetMap, useUpdateCard, useCreateCard, useCreateConnection, useDeleteConnection, useDeleteCard, customFetch, CreateConnectionRequest, useCreateTextElement, useUpdateTextElement, useDeleteTextElement } from "@workspace/api-client-react";
import { Loader2, ArrowLeft, Plus, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

interface CreateConnectionRequestWithHandles extends CreateConnectionRequest {
  sourceHandle?: string;
  targetHandle?: string;
}

const nodeTypes = { mindmap: MindMapNode, textnode: TextNode, approvalnode: ApprovalNode, joinnode: ApprovalJoinNode };
const edgeTypes = { deletable: DeletableEdge, approval: ApprovalEdge };

const INACTIVE_STATUSES = new Set(['blocked', 'pending', 'draft']);

const EDGE_BASE = {
  type: 'deletable' as const,
};

const EDGE_STYLE_ACTIVE = { strokeWidth: 2, stroke: '#374151' };
const EDGE_STYLE_INACTIVE = { strokeWidth: 2, stroke: '#d1d5db', strokeDasharray: '5 5' };

function edgeStyle(animated: boolean) {
  return animated ? EDGE_STYLE_ACTIVE : EDGE_STYLE_INACTIVE;
}

interface ConnectionWithHandles {
  id: string;
  sourceCardId: string;
  targetCardId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

function isEdgeAnimated(sourceId: string, targetId: string, cards: Array<{ id: string; statusVisual: string }>): boolean {
  const source = cards.find(c => c.id === sourceId);
  const target = cards.find(c => c.id === targetId);
  if (source && INACTIVE_STATUSES.has(source.statusVisual)) return false;
  if (target && INACTIVE_STATUSES.has(target.statusVisual)) return false;
  return true;
}

type ApprovalCardMeta = {
  id: string;
  taskId?: string | null;
  statusVisual: string;
  taskIsApprovalTask?: boolean;
  taskParentTaskId?: string | null;
  taskApprovalMode?: string | null;
  taskApprovalDecision?: string | null;
  taskApprovalOrder?: number | null;
  taskAssigneeName?: string | null;
  taskAssigneeAvatarUrl?: string | null;
  taskDueDate?: string | null;
  taskParentApprovalStatus?: string | null;
  title?: string;
  positionX: number;
  positionY: number;
};

/**
 * Returns a Map<regularCardId, terminalCardId>.
 * - If a regular card has no approval children → terminalCardId = regularCardId (it is its own terminal)
 * - If a regular card has a single approval child → terminalCardId = that child's id
 * - If sequential mode with 2+ children → terminalCardId = id of the child with highest approvalOrder
 * - If parallel mode with 2+ children → terminalCardId = "join-${parentCardId}" (virtual join node)
 */
function buildTerminalNodeMap(cardList: ApprovalCardMeta[]): Map<string, string> {
  const result = new Map<string, string>();

  const approvalChildren = cardList.filter(c => !!c.taskIsApprovalTask && c.taskParentTaskId);
  const parentGroups = new Map<string, ApprovalCardMeta[]>();
  for (const c of approvalChildren) {
    const parentTaskId = c.taskParentTaskId!;
    if (!parentGroups.has(parentTaskId)) parentGroups.set(parentTaskId, []);
    parentGroups.get(parentTaskId)!.push(c);
  }

  for (const c of cardList) {
    if (c.taskIsApprovalTask) continue;
    const taskId = c.taskId;
    if (!taskId) {
      result.set(c.id, c.id);
      continue;
    }
    const children = parentGroups.get(taskId);
    if (!children || children.length === 0) {
      result.set(c.id, c.id);
      continue;
    }
    const parentCard = cardList.find(x => x.id === c.id);
    const approvalMode = parentCard?.taskApprovalMode ?? 'sequential';
    if (children.length === 1) {
      result.set(c.id, children[0].id);
    } else if (approvalMode === 'sequential') {
      const sorted = [...children].sort((a, b) => (a.taskApprovalOrder ?? 0) - (b.taskApprovalOrder ?? 0));
      if (sorted.length > 0) {
        result.set(c.id, sorted[sorted.length - 1].id);
      } else {
        result.set(c.id, c.id);
      }
    } else {
      result.set(c.id, `join-${c.id}`);
    }
  }
  return result;
}

function buildApprovalEdges(
  cardList: ApprovalCardMeta[],
): Edge[] {
  const approvalCards = cardList.filter(c => c.taskIsApprovalTask && c.taskParentTaskId);
  if (!approvalCards.length) return [];

  const taskIdToCardId = new Map<string, string>();
  for (const c of cardList) {
    if (c.taskId) taskIdToCardId.set(c.taskId, c.id);
  }

  const parentGroups = new Map<string, ApprovalCardMeta[]>();
  for (const c of approvalCards) {
    const parentTaskId = c.taskParentTaskId!;
    if (!parentGroups.has(parentTaskId)) parentGroups.set(parentTaskId, []);
    parentGroups.get(parentTaskId)!.push(c);
  }

  const edges: Edge[] = [];
  for (const [parentTaskId, children] of parentGroups) {
    const parentCardId = taskIdToCardId.get(parentTaskId);
    if (!parentCardId) continue;

    const parentCard = cardList.find(c => c.id === parentCardId);
    const approvalMode = parentCard?.taskApprovalMode ?? 'sequential';

    const sortedChildren = [...children].sort(
      (a, b) => (a.taskApprovalOrder ?? 0) - (b.taskApprovalOrder ?? 0),
    );

    if (approvalMode === 'sequential') {
      const sourceCardIds = [parentCardId, ...sortedChildren.slice(0, -1).map(c => c.id)];
      const targetCardIds = sortedChildren.map(c => c.id);
      sourceCardIds.forEach((sourceId, i) => {
        const animated = isEdgeAnimated(sourceId, targetCardIds[i], cardList);
        edges.push({
          id: `approval-${sourceId}-${targetCardIds[i]}`,
          source: sourceId,
          target: targetCardIds[i],
          sourceHandle: 'source-right',
          targetHandle: 'target-left',
          type: 'approval',
          animated,
          style: edgeStyle(animated),
          deletable: false,
          selectable: false,
          data: { isApprovalEdge: true },
        });
      });
    } else if (sortedChildren.length === 1) {
      const animated = isEdgeAnimated(parentCardId, sortedChildren[0].id, cardList);
      edges.push({
        id: `approval-${parentCardId}-${sortedChildren[0].id}`,
        source: parentCardId,
        target: sortedChildren[0].id,
        sourceHandle: 'source-right',
        targetHandle: 'target-left',
        type: 'approval',
        animated,
        style: edgeStyle(animated),
        deletable: false,
        selectable: false,
        data: { isApprovalEdge: true },
      });
    } else {
      const joinNodeId = `join-${parentCardId}`;
      for (const child of sortedChildren) {
        const animatedParentToChild = isEdgeAnimated(parentCardId, child.id, cardList);
        edges.push({
          id: `approval-${parentCardId}-${child.id}`,
          source: parentCardId,
          target: child.id,
          sourceHandle: 'source-right',
          targetHandle: 'target-left',
          type: 'approval',
          animated: animatedParentToChild,
          style: edgeStyle(animatedParentToChild),
          deletable: false,
          selectable: false,
          data: { isApprovalEdge: true },
        });
        const animatedChildToJoin = isEdgeAnimated(child.id, joinNodeId, cardList);
        edges.push({
          id: `approval-${child.id}-${joinNodeId}`,
          source: child.id,
          target: joinNodeId,
          sourceHandle: 'source-right',
          targetHandle: 'target-left',
          type: 'approval',
          animated: animatedChildToJoin,
          style: edgeStyle(animatedChildToJoin),
          deletable: false,
          selectable: false,
          data: { isApprovalEdge: true },
        });
      }
    }
  }
  return edges;
}

const APPROVAL_NODE_HEIGHT = 90;

function buildJoinNodes(
  cardList: ApprovalCardMeta[],
  onAddChild: (cardId: string) => void,
): Node[] {
  const approvalCards = cardList.filter(c => c.taskIsApprovalTask && c.taskParentTaskId);
  const parentGroups = new Map<string, ApprovalCardMeta[]>();
  for (const c of approvalCards) {
    const key = c.taskParentTaskId!;
    if (!parentGroups.has(key)) parentGroups.set(key, []);
    parentGroups.get(key)!.push(c);
  }

  const joinNodes: Node[] = [];
  for (const [parentTaskId, children] of parentGroups) {
    if (children.length < 2) continue;
    const parentCard = cardList.find(c => c.taskId === parentTaskId);
    if (!parentCard) continue;
    const approvalMode = parentCard.taskApprovalMode ?? 'sequential';
    if (approvalMode !== 'parallel') continue;

    const joinNodeId = `join-${parentCard.id}`;
    const maxX = Math.max(...children.map(c => c.positionX));
    const avgCenterY =
      children.reduce((sum, c) => sum + c.positionY + APPROVAL_NODE_HEIGHT / 2, 0) /
      children.length;

    joinNodes.push({
      id: joinNodeId,
      type: 'joinnode',
      position: { x: maxX + 260, y: avgCenterY - 18 },
      data: { parentCardId: parentCard.id, onAddChild },
      draggable: false,
      deletable: false,
      selectable: false,
    });
  }
  return joinNodes;
}

function buildEdgeFromConn(
  conn: ConnectionWithHandles,
  cards: Array<{ id: string; statusVisual: string }>,
): Edge {
  const animated = isEdgeAnimated(conn.sourceCardId, conn.targetCardId, cards);
  return {
    id: conn.id,
    source: conn.sourceCardId,
    target: conn.targetCardId,
    sourceHandle: conn.sourceHandle ?? undefined,
    targetHandle: conn.targetHandle ?? undefined,
    ...EDGE_BASE,
    animated,
    style: edgeStyle(animated),
    data: {},
  };
}

/**
 * Sample N points along a cubic bezier curve.
 */
function sampleBezier(
  p0x: number, p0y: number,
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number,
  samples: number,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const mt = 1 - t;
    const x = mt * mt * mt * p0x + 3 * mt * mt * t * p1x + 3 * mt * t * t * p2x + t * t * t * p3x;
    const y = mt * mt * mt * p0y + 3 * mt * mt * t * p1y + 3 * mt * t * t * p2y + t * t * t * p3y;
    pts.push([x, y]);
  }
  return pts;
}

/**
 * Check if a bezier edge (defined by source/target positions) intersects the bounding box of a node.
 * Uses ReactFlow's default bezier control point offset heuristic.
 */
function edgeIntersectsNodeBBox(
  sourceX: number, sourceY: number,
  targetX: number, targetY: number,
  nodeCenterX: number, nodeCenterY: number,
  nodeWidth: number, nodeHeight: number,
): boolean {
  // Default bezier: source handle points right, target handle points left
  const offset = Math.abs(targetX - sourceX) * 0.5;
  const cp1x = sourceX + offset;
  const cp1y = sourceY;
  const cp2x = targetX - offset;
  const cp2y = targetY;

  const halfW = nodeWidth / 2;
  const halfH = nodeHeight / 2;
  const minX = nodeCenterX - halfW;
  const maxX = nodeCenterX + halfW;
  const minY = nodeCenterY - halfH;
  const maxY = nodeCenterY + halfH;

  const pts = sampleBezier(sourceX, sourceY, cp1x, cp1y, cp2x, cp2y, targetX, targetY, 40);
  for (const [px, py] of pts) {
    if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
      return true;
    }
  }
  return false;
}

function CanvasInner({ workspaceId, mapId }: { workspaceId: string; mapId: string }) {
  const queryClient = useQueryClient();
  const { getViewport, setViewport, screenToFlowPosition } = useReactFlow();
  const [textGhost, setTextGhost] = useState<{ x: number; y: number } | null>(null);
  const textDragRef = useRef<{ dragging: boolean; startX: number; startY: number } | null>(null);
  const [cardGhost, setCardGhost] = useState<{ x: number; y: number } | null>(null);
  const cardDragRef = useRef<{ dragging: boolean; startX: number; startY: number } | null>(null);
  const { data: mapData, isLoading } = useGetMap(workspaceId, mapId, {
    query: { refetchInterval: 3000 },
  });
  const editingCardIdRef = useRef<string | null>(null);
  const pendingUpdatesRef = useRef<Map<string, number>>(new Map());
  const connectingJoinNodeRef = useRef<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [autoFocusCardId, setAutoFocusCardId] = useState<string | null>(null);
  const autoFocusCardIdRef = useRef<string | null>(null);
  const [highlightedEdgeId, setHighlightedEdgeId] = useState<string | null>(null);
  const [pendingDeleteNodeIds, setPendingDeleteNodeIds] = useState<string[] | null>(null);
  const initializedRef = useRef(false);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const mapDataRef = useRef<typeof mapData>(undefined);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => { mapDataRef.current = mapData; }, [mapData]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const selectedNodes = nodesRef.current.filter(n => n.selected && n.type === 'mindmap' && n.deletable !== false);
      if (selectedNodes.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingDeleteNodeIds(selectedNodes.map(n => n.id));
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  useEffect(() => {
    if (!workspaceId || !mapId) return;
    customFetch(`/api/workspaces/${workspaceId}/maps/${mapId}/access`, { method: "POST" })
      .catch(() => {})
      .finally(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/maps/recent"] });
      });
  }, [workspaceId, mapId]);

  const handleOpenPanel = useCallback((cardId: string) => {
    setSelectedCardId(cardId);
  }, []);

  const handleInlineUpdate = useCallback((cardId: string, patch: Partial<{
    title: string;
    statusVisual: string;
    taskAssigneeName: string | null;
    taskAssigneeAvatarUrl: string | null;
    taskDueDate: string | null;
  }>) => {
    pendingUpdatesRef.current.set(cardId, Date.now());
    setNodes(prev => prev.map(n => {
      if (n.id !== cardId) return n;
      const updatedData = { ...n.data, ...patch };
      if ('statusVisual' in patch) {
        if (patch.statusVisual === 'completed') {
          if (!updatedData.taskCompletedAt) {
            updatedData.taskCompletedAt = new Date().toISOString();
          }
        } else {
          updatedData.taskCompletedAt = null;
        }
      }
      return { ...n, data: updatedData };
    }));
  }, [setNodes]);

  const handleEditingChange = useCallback((cardId: string, isEditing: boolean) => {
    editingCardIdRef.current = isEditing ? cardId : null;
  }, []);

  const handleAutoFocusDone = useCallback((cardId: string) => {
    autoFocusCardIdRef.current = null;
    setAutoFocusCardId(prev => (prev === cardId ? null : prev));
  }, []);

  const buildTextNode = useCallback((el: {
    id: string;
    mapId: string;
    content: string;
    positionX: number;
    positionY: number;
    width: number;
    height: number;
    fontSize: number;
    color: string;
  }, onDelete: (elementId: string) => void): Node => ({
    id: el.id,
    type: 'textnode',
    position: { x: el.positionX, y: el.positionY },
    data: {
      elementId: el.id,
      content: el.content,
      fontSize: el.fontSize,
      color: el.color,
      workspaceId,
      mapId,
      onDelete,
    },
  }), [workspaceId, mapId]);

  const handleDeleteTextNode = useCallback((elementId: string) => {
    setNodes(prev => prev.filter(n => n.id !== elementId));
  }, [setNodes]);

  useEffect(() => {
    if (!mapData) return;

    const mapDataWithText = mapData as typeof mapData & { textElements?: Array<{
      id: string;
      mapId: string;
      content: string;
      positionX: number;
      positionY: number;
      width: number;
      height: number;
      fontSize: number;
      color: string;
    }> };

    const terminalNodeMap = buildTerminalNodeMap(mapData.cards as ApprovalCardMeta[]);

    // Build set of parent task IDs where ALL approval children are approved
    const approvalCards = (mapData.cards as ApprovalCardMeta[]).filter(c => c.taskIsApprovalTask && c.taskParentTaskId);
    const approvalByParent = new Map<string, ApprovalCardMeta[]>();
    for (const c of approvalCards) {
      const pid = c.taskParentTaskId!;
      if (!approvalByParent.has(pid)) approvalByParent.set(pid, []);
      approvalByParent.get(pid)!.push(c);
    }
    const fullyApprovedParentTaskIds = new Set<string>();
    for (const [pid, children] of approvalByParent) {
      if (children.length > 0 && children.every(c => c.taskApprovalDecision === 'approved')) {
        fullyApprovedParentTaskIds.add(pid);
      }
    }

    // terminalCardId → parentCardId (for approval nodes that are terminal)
    const terminalApprovalParentMap = new Map<string, string>();
    for (const [parentId, terminalId] of terminalNodeMap) {
      if (terminalId !== parentId) terminalApprovalParentMap.set(terminalId, parentId);
    }
    // parentCardIds whose terminal is a virtual join node (parallel mode with 2+ approvals)
    const parallelJoinParentIds = new Set<string>();
    for (const [parentId, terminalId] of terminalNodeMap) {
      if (terminalId.startsWith('join-')) parallelJoinParentIds.add(parentId);
    }

    // taskId → cardId map, used to resolve approvalParentCardId for approval nodes
    const taskIdToCardId = new Map<string, string>();
    for (const c of mapData.cards) {
      if (c.taskId) taskIdToCardId.set(c.taskId, c.id);
    }

    if (!initializedRef.current) {
      const initialNodes: Node[] = mapData.cards.map(c => {
        const isApproval = (c as ApprovalCardMeta).taskIsApprovalTask === true;
        const isTerminalNode = !isApproval ? terminalNodeMap.get(c.id) === c.id : undefined;
        const isTerminalApproval = isApproval ? terminalApprovalParentMap.has(c.id) : false;
        const allSiblingsApproved = isApproval ? fullyApprovedParentTaskIds.has((c as ApprovalCardMeta).taskParentTaskId ?? '') : false;
        const approvalParentCardId = isApproval ? (taskIdToCardId.get((c as ApprovalCardMeta).taskParentTaskId ?? '') ?? null) : null;
        return {
          id: c.id,
          type: isApproval ? 'approvalnode' : 'mindmap',
          position: { x: c.positionX, y: c.positionY },
          data: isApproval
            ? { approverName: c.taskAssigneeName ?? null, approverAvatarUrl: c.taskAssigneeAvatarUrl ?? null, approvalStatus: c.statusVisual ?? null, approvalDecision: (c as ApprovalCardMeta).taskApprovalDecision ?? null, dueDate: c.taskDueDate ?? null, taskTitle: c.title, cardId: c.id, onOpen: handleOpenPanel, allSiblingsApproved, approvalParentCardId, ...(isTerminalApproval ? { onAddChild: handleAddChildCard, terminalParentCardId: terminalApprovalParentMap.get(c.id) } : {}) }
            : { title: c.title, statusVisual: c.statusVisual, taskId: c.taskId, taskDueDate: c.taskDueDate ?? null, taskAssigneeName: c.taskAssigneeName ?? null, taskAssigneeAvatarUrl: c.taskAssigneeAvatarUrl ?? null, taskDescription: c.description ?? null, taskCompletedAt: c.taskCompletedAt ?? null, taskParentApprovalStatus: (c as ApprovalCardMeta).taskParentApprovalStatus ?? null, workspaceId, mapId, onOpen: handleOpenPanel, onAddChild: handleAddChildCard, onInlineUpdate: handleInlineUpdate, onEditingChange: handleEditingChange, isTerminalNode },
          draggable: true,
          deletable: !isApproval,
        };
      });

      const textNodes: Node[] = (mapDataWithText.textElements ?? []).map(el =>
        buildTextNode(el, handleDeleteTextNode)
      );

      const joinNodes = buildJoinNodes(mapData.cards as ApprovalCardMeta[], handleAddChildCard);
      setNodes([...initialNodes, ...textNodes, ...joinNodes]);

      const regularEdges: Edge[] = mapData.connections.map(c => {
        const src = parallelJoinParentIds.has(c.sourceCardId)
          ? `join-${c.sourceCardId}`
          : c.sourceCardId;
        return { ...buildEdgeFromConn(c, mapData.cards), source: src };
      });
      const approvalEdges: Edge[] = buildApprovalEdges(mapData.cards as ApprovalCardMeta[]);
      const initialEdges: Edge[] = [...regularEdges, ...approvalEdges];
      setEdges(initialEdges);
      initializedRef.current = true;
    } else {
      setNodes(prev => {
        const serverCardIds = new Set(mapData.cards.map(c => c.id));
        const serverTextIds = new Set((mapDataWithText.textElements ?? []).map(el => el.id));

        const filtered = prev.filter(n => {
          if (n.type === 'textnode') return serverTextIds.has(n.id);
          return serverCardIds.has(n.id);
        });

        const existingCardIds = new Set(filtered.filter(n => n.type === 'mindmap' || n.type === 'approvalnode').map(n => n.id));
        const existingTextIds = new Set(filtered.filter(n => n.type === 'textnode').map(n => n.id));

        const newCardNodes: Node[] = mapData.cards
          .filter(c => !existingCardIds.has(c.id))
          .map(c => {
            const isApproval = (c as ApprovalCardMeta).taskIsApprovalTask === true;
            const isTerminalNode = !isApproval ? terminalNodeMap.get(c.id) === c.id : undefined;
            const isTerminalApproval = isApproval ? terminalApprovalParentMap.has(c.id) : false;
            const allSiblingsApproved = isApproval ? fullyApprovedParentTaskIds.has((c as ApprovalCardMeta).taskParentTaskId ?? '') : false;
            const shouldAutoFocus = !isApproval && c.id === autoFocusCardIdRef.current;
            const approvalParentCardId = isApproval ? (taskIdToCardId.get((c as ApprovalCardMeta).taskParentTaskId ?? '') ?? null) : null;
            return {
              id: c.id,
              type: isApproval ? 'approvalnode' : 'mindmap',
              position: { x: c.positionX, y: c.positionY },
              data: isApproval
                ? { approverName: c.taskAssigneeName ?? null, approverAvatarUrl: c.taskAssigneeAvatarUrl ?? null, approvalStatus: c.statusVisual ?? null, approvalDecision: (c as ApprovalCardMeta).taskApprovalDecision ?? null, dueDate: c.taskDueDate ?? null, taskTitle: c.title, cardId: c.id, onOpen: handleOpenPanel, allSiblingsApproved, approvalParentCardId, ...(isTerminalApproval ? { onAddChild: handleAddChildCard, terminalParentCardId: terminalApprovalParentMap.get(c.id) } : {}) }
                : { title: c.title, statusVisual: c.statusVisual, taskId: c.taskId, taskDueDate: c.taskDueDate ?? null, taskAssigneeName: c.taskAssigneeName ?? null, taskAssigneeAvatarUrl: c.taskAssigneeAvatarUrl ?? null, taskDescription: c.description ?? null, taskCompletedAt: c.taskCompletedAt ?? null, taskParentApprovalStatus: (c as ApprovalCardMeta).taskParentApprovalStatus ?? null, workspaceId, mapId, onOpen: handleOpenPanel, onAddChild: handleAddChildCard, onInlineUpdate: handleInlineUpdate, onEditingChange: handleEditingChange, onAutoFocusDone: handleAutoFocusDone, isTerminalNode, autoFocusTitle: shouldAutoFocus },
              draggable: true,
              deletable: !isApproval,
            };
          });

        const newTextNodes: Node[] = (mapDataWithText.textElements ?? [])
          .filter(el => !existingTextIds.has(el.id))
          .map(el => buildTextNode(el, handleDeleteTextNode));

        const currentlyEditingId = editingCardIdRef.current;
        const now = Date.now();
        const PENDING_GUARD_MS = 5000;
        pendingUpdatesRef.current.forEach((ts, id) => {
          if (now - ts > PENDING_GUARD_MS) pendingUpdatesRef.current.delete(id);
        });
        const freshJoinNodes = buildJoinNodes(mapData.cards as ApprovalCardMeta[], handleAddChildCard);
        return [
          ...filtered.map(n => {
            if (n.type === 'textnode') {
              const serverEl = (mapDataWithText.textElements ?? []).find(el => el.id === n.id);
              if (!serverEl) return n;
              return n;
            }
            const s = mapData.cards.find(c => c.id === n.id);
            if (!s) return n;
            const sApproval = s as ApprovalCardMeta;
            if (sApproval.taskIsApprovalTask) {
              const isTerminalApproval = terminalApprovalParentMap.has(s.id);
              const allSiblingsApproved = fullyApprovedParentTaskIds.has(sApproval.taskParentTaskId ?? '');
              return { ...n, data: { approverName: s.taskAssigneeName ?? null, approverAvatarUrl: s.taskAssigneeAvatarUrl ?? null, approvalStatus: s.statusVisual ?? null, approvalDecision: sApproval.taskApprovalDecision ?? null, dueDate: s.taskDueDate ?? null, taskTitle: s.title, cardId: s.id, onOpen: handleOpenPanel, allSiblingsApproved, ...(isTerminalApproval ? { onAddChild: handleAddChildCard, terminalParentCardId: terminalApprovalParentMap.get(s.id) } : { onAddChild: undefined, terminalParentCardId: undefined }) } };
            }
            const isTerminalNode = terminalNodeMap.get(n.id) === n.id;
            const hasPendingUpdate = pendingUpdatesRef.current.has(n.id);
            if (n.id === currentlyEditingId || hasPendingUpdate) {
              return { ...n, data: { ...n.data, isTerminalNode, workspaceId, mapId, onOpen: handleOpenPanel, onAddChild: handleAddChildCard, onInlineUpdate: handleInlineUpdate, onEditingChange: handleEditingChange, onAutoFocusDone: handleAutoFocusDone } };
            }
            return { ...n, data: { title: s.title, statusVisual: s.statusVisual, taskId: s.taskId, taskDueDate: s.taskDueDate ?? null, taskAssigneeName: s.taskAssigneeName ?? null, taskAssigneeAvatarUrl: s.taskAssigneeAvatarUrl ?? null, taskDescription: s.description ?? null, taskCompletedAt: s.taskCompletedAt ?? null, taskParentApprovalStatus: (s as ApprovalCardMeta).taskParentApprovalStatus ?? null, workspaceId, mapId, onOpen: handleOpenPanel, onAddChild: handleAddChildCard, onInlineUpdate: handleInlineUpdate, onEditingChange: handleEditingChange, onAutoFocusDone: handleAutoFocusDone, isTerminalNode } };
          }),
          ...newCardNodes,
          ...newTextNodes,
          ...freshJoinNodes,
        ];
      });

      setEdges(prev => {
        const serverIds = new Set(mapData.connections.map(c => c.id));
        const filtered = prev.filter(e => serverIds.has(e.id) || e.id.startsWith('temp-'));
        const existingIds = new Set(filtered.map(e => e.id));
        const tempPairs = new Set(
          filtered
            .filter(e => e.id.startsWith('temp-'))
            .map(e => `${e.source}__${e.target}`),
        );
        const connById = new Map(mapData.connections.map(c => [c.id, c]));
        const newEdges: Edge[] = mapData.connections
          .filter(c => {
            if (existingIds.has(c.id)) return false;
            const src = parallelJoinParentIds.has(c.sourceCardId)
              ? `join-${c.sourceCardId}`
              : c.sourceCardId;
            return !tempPairs.has(`${src}__${c.targetCardId}`);
          })
          .map(c => {
            const src = parallelJoinParentIds.has(c.sourceCardId)
              ? `join-${c.sourceCardId}`
              : c.sourceCardId;
            return { ...buildEdgeFromConn(c, mapData.cards), source: src };
          });
        const updatedFiltered = filtered.map(e => {
          if (e.id.startsWith('temp-')) return e;
          const serverConn = connById.get(e.id);
          const rawSrc = serverConn ? serverConn.sourceCardId : e.source;
          const src = parallelJoinParentIds.has(rawSrc) ? `join-${rawSrc}` : rawSrc;
          const tgt = serverConn ? serverConn.targetCardId : e.target;
          const animated = isEdgeAnimated(src, tgt, mapData.cards);
          return { ...e, source: src, target: tgt, animated, style: edgeStyle(animated) };
        });
        const freshApprovalEdges = buildApprovalEdges(mapData.cards as ApprovalCardMeta[]);
        const freshApprovalIds = new Set(freshApprovalEdges.map(e => e.id));
        const withoutStaleApproval = updatedFiltered.filter(e => !e.id.startsWith('approval-') || freshApprovalIds.has(e.id));
        return [...withoutStaleApproval, ...newEdges, ...freshApprovalEdges];
      });
    }
  }, [mapData]);

  const updateCardMut = useUpdateCard();
  const createConnMut = useCreateConnection();
  const deleteConnMut = useDeleteConnection();
  const createCardMut = useCreateCard();
  const createTextMut = useCreateTextElement();
  const updateTextMut = useUpdateTextElement();
  const deleteTextMut = useDeleteTextElement();

  const handleAddChildCard = useCallback((parentCardId: string) => {
    // For parallel mode, prefer the join node position (to the right of the join circle)
    const joinNode = nodesRef.current.find(n => n.id === `join-${parentCardId}`);
    const parentNode = joinNode ?? nodesRef.current.find(n => n.id === parentCardId);
    const newX = parentNode ? parentNode.position.x + 280 : 200;
    const newY = parentNode ? parentNode.position.y : 200;
    createCardMut.mutate(
      { workspaceId, mapId, data: { title: "nova tarefa", positionX: newX, positionY: newY } },
      {
        onSuccess: (newCard) => {
          createConnMut.mutate(
            { workspaceId, mapId, data: { sourceCardId: parentCardId, targetCardId: newCard.id, sourceHandle: 'source-right', targetHandle: 'target-left' } as CreateConnectionRequestWithHandles },
            {
              onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] }),
              onError: () => {
                toast({ title: "Erro ao criar conexão", description: "Não foi possível criar a conexão. Tente novamente.", variant: "destructive" });
              },
            }
          );
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          autoFocusCardIdRef.current = newCard.id;
          setAutoFocusCardId(newCard.id);
        },
      }
    );
  }, [workspaceId, mapId, createCardMut, createConnMut, queryClient]);

  const onNodeDrag = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // Text nodes, approval nodes, and join nodes are excluded from edge insertion logic
      if (node.type === 'textnode' || node.type === 'approvalnode' || node.type === 'joinnode') return;

      const currentEdges = edgesRef.current;
      const currentNodes = nodesRef.current;

      const nodeWidth = node.width ?? 200;
      const nodeHeight = node.height ?? 80;
      const nodeCenterX = node.position.x + nodeWidth / 2;
      const nodeCenterY = node.position.y + nodeHeight / 2;

      let found: string | null = null;

      for (const edge of currentEdges) {
        // Skip edges connected to the dragged node itself
        if (edge.source === node.id || edge.target === node.id) continue;
        // Skip temp edges
        if (edge.id.startsWith('temp-')) continue;
        // Skip approval edges — they are auto-generated and cannot be inserted into
        if (edge.type === 'approval') continue;

        const sourceNode = currentNodes.find(n => n.id === edge.source);
        const targetNode = currentNodes.find(n => n.id === edge.target);
        if (!sourceNode || !targetNode) continue;

        // Skip edges involving text, approval, or join nodes
        if (sourceNode.type === 'textnode' || targetNode.type === 'textnode') continue;
        if (sourceNode.type === 'approvalnode' || targetNode.type === 'approvalnode') continue;
        if (sourceNode.type === 'joinnode' || targetNode.type === 'joinnode') continue;

        const srcW = sourceNode.width ?? 200;
        const srcH = sourceNode.height ?? 80;
        const tgtW = targetNode.width ?? 200;
        const tgtH = targetNode.height ?? 80;

        // Source handle: right side of source node
        const sourceX = sourceNode.position.x + srcW;
        const sourceY = sourceNode.position.y + srcH / 2;
        // Target handle: left side of target node
        const targetX = targetNode.position.x;
        const targetY = targetNode.position.y + tgtH / 2;

        if (edgeIntersectsNodeBBox(sourceX, sourceY, targetX, targetY, nodeCenterX, nodeCenterY, nodeWidth, nodeHeight)) {
          found = edge.id;
          break;
        }
      }

      if (found !== highlightedEdgeId) {
        setHighlightedEdgeId(found);
        setEdges(eds => eds.map(e => ({
          ...e,
          data: { ...e.data, highlighted: e.id === found },
        })));
      }
    },
    [highlightedEdgeId, setEdges],
  );

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // If this is a text node, use the text element update mutation
      if (node.type === 'textnode') {
        updateTextMut.mutate({
          workspaceId, mapId, elementId: node.id,
          data: { positionX: node.position.x, positionY: node.position.y },
        });
        return;
      }

      // Always save position
      updateCardMut.mutate({
        workspaceId, mapId, cardId: node.id,
        data: { positionX: node.position.x, positionY: node.position.y },
      });

      // Approval nodes and join nodes are not part of the edge-insertion flow
      if (node.type === 'approvalnode' || node.type === 'joinnode') return;

      const currentHighlightedEdgeId = highlightedEdgeId;

      // Clear highlight regardless
      setHighlightedEdgeId(null);
      setEdges(eds => eds.map(e => ({
        ...e,
        data: { ...e.data, highlighted: false },
      })));

      if (!currentHighlightedEdgeId) return;

      const currentEdges = edgesRef.current;
      const targetEdge = currentEdges.find(e => e.id === currentHighlightedEdgeId);
      if (!targetEdge) return;

      const sourceId = targetEdge.source; // B
      const targetId = targetEdge.target; // C
      const insertedId = node.id;          // A

      // Remove original edge optimistically
      setEdges(eds => eds.filter(e => e.id !== currentHighlightedEdgeId));

      const cards = mapData?.cards ?? [];

      const baAlreadyExists = currentEdges.some(
        e => e.source === sourceId && e.target === insertedId,
      );
      const acAlreadyExists = currentEdges.some(
        e => e.source === insertedId && e.target === targetId,
      );

      const newEdgesToAdd: Edge[] = [];

      const tempIdBA = `temp-${Date.now()}-BA`;
      const tempIdAC = `temp-${Date.now()}-AC`;

      if (!baAlreadyExists) {
        const animatedBA = isEdgeAnimated(sourceId, insertedId, cards);
        newEdgesToAdd.push({
          id: tempIdBA,
          source: sourceId,
          target: insertedId,
          sourceHandle: 'source-right',
          targetHandle: 'target-left',
          ...EDGE_BASE,
          animated: animatedBA,
          style: edgeStyle(animatedBA),
          data: {},
        });
      }

      if (!acAlreadyExists) {
        const animatedAC = isEdgeAnimated(insertedId, targetId, cards);
        newEdgesToAdd.push({
          id: tempIdAC,
          source: insertedId,
          target: targetId,
          sourceHandle: 'source-right',
          targetHandle: 'target-left',
          ...EDGE_BASE,
          animated: animatedAC,
          style: edgeStyle(animatedAC),
          data: {},
        });
      }

      if (newEdgesToAdd.length > 0) {
        setEdges(eds => [...eds, ...newEdgesToAdd]);
      }

      if (!currentHighlightedEdgeId.startsWith('temp-')) {
        deleteConnMut.mutate({ workspaceId, mapId, connectionId: currentHighlightedEdgeId });
      }

      if (!baAlreadyExists) {
        createConnMut.mutate(
          { workspaceId, mapId, data: { sourceCardId: sourceId, targetCardId: insertedId, sourceHandle: 'source-right', targetHandle: 'target-left' } as CreateConnectionRequestWithHandles },
          {
            onSuccess: (conn) => {
              setEdges(eds => eds.map(e => e.id === tempIdBA ? { ...e, id: conn.id } : e));
              queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
            },
            onError: () => {
              setEdges(eds => eds.filter(e => e.id !== tempIdBA));
            },
          }
        );
      }

      if (!acAlreadyExists) {
        createConnMut.mutate(
          { workspaceId, mapId, data: { sourceCardId: insertedId, targetCardId: targetId, sourceHandle: 'source-right', targetHandle: 'target-left' } as CreateConnectionRequestWithHandles },
          {
            onSuccess: (conn) => {
              setEdges(eds => eds.map(e => e.id === tempIdAC ? { ...e, id: conn.id } : e));
              queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
            },
            onError: () => {
              setEdges(eds => eds.filter(e => e.id !== tempIdAC));
            },
          }
        );
      }

      if (!baAlreadyExists || !acAlreadyExists) {
        queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
      }
    },
    [workspaceId, mapId, updateCardMut, updateTextMut, highlightedEdgeId, deleteConnMut, createConnMut, queryClient, mapData],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;

      // Reject connections involving text or approval nodes; join nodes can be source but not target
      const currentNodes = nodesRef.current;
      const sourceNode = currentNodes.find(n => n.id === params.source);
      const targetNode = currentNodes.find(n => n.id === params.target);
      if (sourceNode?.type === 'textnode' || targetNode?.type === 'textnode') return;
      if (sourceNode?.type === 'approvalnode' || targetNode?.type === 'approvalnode') return;
      if (targetNode?.type === 'joinnode') return;

      const srcHandle = params.sourceHandle ?? '';
      const tgtHandle = params.targetHandle ?? '';
      const srcIsRight = srcHandle.includes('right');
      const srcIsLeft  = srcHandle.includes('left');
      const tgtIsRight = tgtHandle.includes('right');
      const tgtIsLeft  = tgtHandle.includes('left');

      // Reject same-side connections (right→right or left→left)
      if ((srcIsRight && tgtIsRight) || (srcIsLeft && tgtIsLeft)) return;

      // Normalize direction: right side is always source, left side is always target
      let sourceNodeId: string;
      let targetNodeId: string;
      if (srcIsRight && tgtIsLeft) {
        sourceNodeId = params.source;
        targetNodeId = params.target;
      } else if (srcIsLeft && tgtIsRight) {
        // User dragged left→right: swap so connection goes right→left
        sourceNodeId = params.target;
        targetNodeId = params.source;
      } else {
        return;
      }

      // Reject self-connections
      if (sourceNodeId === targetNodeId) return;

      // Reject duplicate connections between the same pair of nodes
      const alreadyConnected = edges.some(
        e => e.source === sourceNodeId && e.target === targetNodeId,
      );
      if (alreadyConnected) return;

      const tempId = `temp-${Date.now()}`;
      const animated = mapData ? isEdgeAnimated(sourceNodeId, targetNodeId, mapData.cards) : true;
      const newEdge: Edge = {
        id: tempId,
        source: sourceNodeId,
        target: targetNodeId,
        sourceHandle: 'source-right',
        targetHandle: 'target-left',
        ...EDGE_BASE,
        animated,
        style: edgeStyle(animated),
        data: {},
      };
      setEdges((eds) => addEdge(newEdge, eds));

      // If source is a join node, store the actual parent card ID in the DB
      const dbSourceId = sourceNodeId.startsWith('join-')
        ? sourceNodeId.slice('join-'.length)
        : sourceNodeId;

      createConnMut.mutate(
        {
          workspaceId, mapId,
          data: { sourceCardId: dbSourceId, targetCardId: targetNodeId, sourceHandle: 'source-right', targetHandle: 'target-left' } as CreateConnectionRequestWithHandles,
        },
        {
          onSuccess: (conn) => {
            setEdges(eds => eds.map(e =>
              e.id === tempId ? { ...e, id: conn.id } : e,
            ));
            queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          },
          onError: () => {
            setEdges((eds) => eds.filter(e => e.id !== tempId));
            toast({ title: "Erro ao criar conexão", description: "A conexão já existe ou ocorreu um erro de rede.", variant: "destructive" });
          },
        },
      );
    },
    [setEdges, createConnMut, workspaceId, mapId, queryClient, mapData, edges],
  );

  const onConnectStart = useCallback(
    (_event: React.MouseEvent | React.TouchEvent, params: { nodeId?: string | null; handleId?: string | null }) => {
      const nodeId = params.nodeId ?? '';
      const handleId = params.handleId ?? '';
      const isPlusSource = nodeId.startsWith('join-') || handleId === 'plus-right';
      connectingJoinNodeRef.current = isPlusSource ? nodeId : null;
    },
    [],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const fromNodeId = connectingJoinNodeRef.current;
      connectingJoinNodeRef.current = null;
      if (!fromNodeId) return;

      const eventTarget = event.target as Element | null;
      const onHandle = eventTarget?.closest('.react-flow__handle') !== null;
      if (onHandle) return;

      const clientX = 'clientX' in event ? event.clientX : (event as TouchEvent).changedTouches[0]?.clientX ?? 0;
      const clientY = 'clientY' in event ? event.clientY : (event as TouchEvent).changedTouches[0]?.clientY ?? 0;

      const dbSourceId = fromNodeId.startsWith('join-') ? fromNodeId.slice('join-'.length) : fromNodeId;

      const nodeEl = eventTarget?.closest('[data-id]');
      const targetNodeId = nodeEl?.getAttribute('data-id') ?? null;

      if (targetNodeId && targetNodeId !== fromNodeId) {
        const targetNode = nodesRef.current.find(n => n.id === targetNodeId);
        if (!targetNode || targetNode.type === 'approvalnode' || targetNode.type === 'joinnode') return;
        const alreadyConnected = edgesRef.current.some(e => e.source === dbSourceId && e.target === targetNodeId);
        if (alreadyConnected) return;
        createConnMut.mutate(
          {
            workspaceId, mapId,
            data: { sourceCardId: dbSourceId, targetCardId: targetNodeId, sourceHandle: 'source-right', targetHandle: 'target-left' } as CreateConnectionRequestWithHandles,
          },
          {
            onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] }),
          },
        );
      } else if (!targetNodeId) {
        const flowPos = screenToFlowPosition({ x: clientX, y: clientY });
        createCardMut.mutate(
          { workspaceId, mapId, data: { title: 'nova tarefa', positionX: flowPos.x, positionY: flowPos.y } },
          {
            onSuccess: (newCard) => {
              createConnMut.mutate(
                {
                  workspaceId, mapId,
                  data: { sourceCardId: dbSourceId, targetCardId: newCard.id, sourceHandle: 'source-right', targetHandle: 'target-left' } as CreateConnectionRequestWithHandles,
                },
                {
                  onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] }),
                },
              );
              queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
              autoFocusCardIdRef.current = newCard.id;
              setAutoFocusCardId(newCard.id);
            },
          },
        );
      }
    },
    [workspaceId, mapId, screenToFlowPosition, createCardMut, createConnMut, queryClient],
  );

  const onEdgesChangeWithDelete = useCallback(
    (changes: EdgeChange[]) => {
      const removals = changes.filter(c => c.type === 'remove');
      removals.forEach(change => {
        if (change.type === 'remove' && !change.id.startsWith('temp-') && !change.id.startsWith('approval-')) {
          deleteConnMut.mutate({ workspaceId, mapId, connectionId: change.id });
        }
      });
      const nonApprovalChanges = changes.filter(c => c.type !== 'remove' || !c.id.startsWith('approval-'));
      onEdgesChange(nonApprovalChanges);
    },
    [onEdgesChange, deleteConnMut, workspaceId, mapId],
  );

  const createCardAt = useCallback((flowX: number, flowY: number) => {
    createCardMut.mutate(
      { workspaceId, mapId, data: { title: "nova tarefa", positionX: flowX, positionY: flowY } },
      {
        onSuccess: (newCard) => {
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          autoFocusCardIdRef.current = newCard.id;
          setAutoFocusCardId(newCard.id);
        },
      },
    );
  }, [workspaceId, mapId, createCardMut, queryClient]);

  const CARD_HALF_W = 90;
  const CARD_HALF_H = 36;

  const handleAddCard = useCallback(() => {
    const vp = getViewport();
    const el = document.querySelector('.react-flow__renderer');
    const w = el ? (el as HTMLElement).clientWidth : 800;
    const h = el ? (el as HTMLElement).clientHeight : 600;
    const centerX = (-vp.x + w / 2) / vp.zoom - CARD_HALF_W;
    const centerY = (-vp.y + h / 2) / vp.zoom - CARD_HALF_H;
    createCardAt(centerX, centerY);
  }, [getViewport, createCardAt]);

  const handleCardButtonMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const DRAG_THRESHOLD = 8;
    cardDragRef.current = { dragging: false, startX, startY };

    const handleMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        cardDragRef.current = { dragging: true, startX, startY };
        setCardGhost({ x: ev.clientX, y: ev.clientY });
      } else if (cardDragRef.current?.dragging) {
        setCardGhost({ x: ev.clientX, y: ev.clientY });
      }
    };

    const handleMouseUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      const wasDragging = cardDragRef.current?.dragging ?? false;
      cardDragRef.current = null;
      setCardGhost(null);

      if (wasDragging) {
        const flowPos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
        createCardAt(flowPos.x - CARD_HALF_W, flowPos.y - CARD_HALF_H);
      } else {
        handleAddCard();
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [screenToFlowPosition, createCardAt, handleAddCard]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'n') {
        const target = e.target as HTMLElement;
        const isEditable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
        if (isEditable) return;
        e.preventDefault();
        handleAddCard();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAddCard]);

  const reactFlowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = reactFlowRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaX === 0) return;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      const vp = getViewport();
      setViewport({ x: vp.x - e.deltaX, y: vp.y, zoom: vp.zoom });
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [getViewport, setViewport]);

  const createTextAt = useCallback((flowX: number, flowY: number) => {
    createTextMut.mutate(
      {
        workspaceId,
        mapId,
        data: {
          positionX: flowX,
          positionY: flowY,
          width: 200,
          height: 80,
          fontSize: 32,
          color: '#111827',
          content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
        },
      },
      {
        onSuccess: (newEl) => {
          const newNode: Node = {
            id: newEl.id,
            type: 'textnode',
            position: { x: newEl.positionX, y: newEl.positionY },
            data: {
              elementId: newEl.id,
              content: newEl.content,
              fontSize: newEl.fontSize,
              color: newEl.color,
              workspaceId,
              mapId,
              onDelete: handleDeleteTextNode,
              autoFocus: true,
            },
          };
          setNodes(prev => [...prev, newNode]);
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
        },
      },
    );
  }, [workspaceId, mapId, createTextMut, queryClient, setNodes, handleDeleteTextNode]);

  const handleTextButtonMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const DRAG_THRESHOLD = 8;
    textDragRef.current = { dragging: false, startX, startY };

    const handleMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        textDragRef.current = { dragging: true, startX, startY };
        setTextGhost({ x: ev.clientX, y: ev.clientY });
      } else if (textDragRef.current?.dragging) {
        setTextGhost({ x: ev.clientX, y: ev.clientY });
      }
    };

    const handleMouseUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      const wasDragging = textDragRef.current?.dragging ?? false;
      textDragRef.current = null;
      setTextGhost(null);

      if (wasDragging) {
        const flowPos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
        createTextAt(flowPos.x - 100, flowPos.y - 40);
      } else {
        const vp = getViewport();
        const el = document.querySelector('.react-flow__renderer');
        const w = el ? (el as HTMLElement).clientWidth : 800;
        const h = el ? (el as HTMLElement).clientHeight : 600;
        createTextAt((-vp.x + w / 2) / vp.zoom - 100, (-vp.y + h / 2) / vp.zoom - 40);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [getViewport, screenToFlowPosition, createTextAt]);

  const onPaneClick = useCallback(() => {
    setSelectedCardId(null);
  }, []);

  const deleteCardMut = useDeleteCard();
  const handleDeleteCard = useCallback((cardId: string) => {
    const toRemove = new Set<string>([cardId, `join-${cardId}`]);
    const allCards = (mapDataRef.current?.cards ?? []) as ApprovalCardMeta[];
    const deletedCard = allCards.find(c => c.id === cardId);
    if (deletedCard?.taskId) {
      for (const c of allCards) {
        if (c.taskIsApprovalTask && c.taskParentTaskId === deletedCard.taskId) {
          toRemove.add(c.id);
          toRemove.add(`join-${c.id}`);
        }
      }
    }
    setNodes(prev => prev.filter(n => !toRemove.has(n.id)));
    setEdges(prev => prev.filter(e => !toRemove.has(e.source) && !toRemove.has(e.target)));
    deleteCardMut.mutate(
      { workspaceId, mapId, cardId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          queryClient.invalidateQueries({ queryKey: ["/api/my-tasks"] });
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks`] });
        },
      }
    );
  }, [setNodes, setEdges, deleteCardMut, workspaceId, mapId, queryClient]);

  if (isLoading || !mapData) {
    return (
      <AppLayout>
        <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-background">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex-1 flex flex-col bg-slate-100 dark:bg-slate-950 relative overflow-hidden">
        <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
          <Link href={`/workspaces/${workspaceId}`}>
            <Button variant="outline" size="icon" className="rounded-xl h-10 w-10 bg-background shadow-md border-border/60">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="bg-background px-5 py-2.5 rounded-xl border border-border/60 shadow-md">
            <h2 className="font-display font-bold text-foreground text-lg leading-none">{mapData.name}</h2>
          </div>
        </div>

        {textGhost && (
          <div
            className="pointer-events-none fixed z-[9999] border-2 border-dashed border-blue-400 bg-blue-50/70 dark:bg-blue-950/50 rounded-lg"
            style={{ left: textGhost.x - 100, top: textGhost.y - 40, width: 200, height: 80 }}
          />
        )}

        {cardGhost && (
          <div
            className="pointer-events-none fixed z-[9999] border-2 border-dashed border-primary bg-primary/10 rounded-xl"
            style={{ left: cardGhost.x - 90, top: cardGhost.y - 36, width: 180, height: 72 }}
          />
        )}

        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
          <Button
            onMouseDown={handleCardButtonMouseDown}
            disabled={createCardMut.isPending}
            variant="outline"
            title="Clique para adicionar tarefa no centro • Arraste para posicionar"
            className="rounded-xl h-10 px-5 shadow-md bg-background border-border/60 select-none"
          >
            {createCardMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            <span className="lowercase">Tarefa</span>
          </Button>
          <Button
            onMouseDown={handleTextButtonMouseDown}
            disabled={createTextMut.isPending}
            variant="outline"
            title="Clique para adicionar texto no centro • Arraste para posicionar"
            className="rounded-xl h-10 px-5 shadow-md bg-background border-border/60 select-none"
          >
            {createTextMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Type className="w-4 h-4 mr-2" />}
            <span className="lowercase">Texto</span>
          </Button>
        </div>

        <div ref={reactFlowRef} className="flex-1 w-full h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChangeWithDelete}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onPaneClick={onPaneClick}
            onPaneContextMenu={(e) => e.preventDefault()}
            panOnDrag={[2]}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            connectionMode={ConnectionMode.Loose}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            onNodesDelete={(deletedNodes) => {
              deletedNodes.forEach(n => {
                if (n.type === 'textnode') {
                  handleDeleteTextNode(n.id);
                  deleteTextMut.mutate({ workspaceId, mapId, elementId: n.id });
                } else {
                  handleDeleteCard(n.id);
                }
              });
            }}
            deleteKeyCode="Delete"
            className="w-full h-full"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="hsl(var(--muted-foreground) / 0.15)" />
            <Controls className="bg-card border border-border shadow-md rounded-xl overflow-hidden" />
          </ReactFlow>
        </div>
      </div>

      <TaskDetailModal
        workspaceId={workspaceId}
        mapId={mapId}
        cardId={selectedCardId}
        open={!!selectedCardId}
        onClose={() => setSelectedCardId(null)}
        onDeleteCard={handleDeleteCard}
      />

      <AlertDialog open={!!pendingDeleteNodeIds} onOpenChange={(open) => { if (!open) setPendingDeleteNodeIds(null); }}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 lowercase">
              excluir {pendingDeleteNodeIds && pendingDeleteNodeIds.length > 1 ? `${pendingDeleteNodeIds.length} tarefas` : 'tarefa'}?
            </AlertDialogTitle>
            <AlertDialogDescription className="lowercase">
              essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl lowercase" onClick={() => setPendingDeleteNodeIds(null)}>cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 lowercase"
              onClick={() => {
                if (pendingDeleteNodeIds) {
                  pendingDeleteNodeIds.forEach(id => handleDeleteCard(id));
                }
                setPendingDeleteNodeIds(null);
              }}
            >
              excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

export default function CanvasPage() {
  const [, params] = useRoute("/workspaces/:wsId/maps/:mapId");
  const workspaceId = params?.wsId || "";
  const mapId = params?.mapId || "";

  return (
    <ReactFlowProvider>
      <CanvasInner workspaceId={workspaceId} mapId={mapId} />
    </ReactFlowProvider>
  );
}
