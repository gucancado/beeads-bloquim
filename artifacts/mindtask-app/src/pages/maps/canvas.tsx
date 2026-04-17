import { useState, useCallback, useEffect, useRef } from "react";
import { usePositionHistory, NodePositionSnapshot } from "@/hooks/usePositionHistory";
import { useRoute, useLocation, useSearch } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { ReactFlow, Controls, ControlButton, Background, useNodesState, useEdgesState, addEdge, Connection, Edge, Node, BackgroundVariant, ReactFlowProvider, EdgeChange, ConnectionMode, SelectionMode, useReactFlow } from 'reactflow';
import 'reactflow/dist/style.css';
import MindMapNode from "@/components/maps/MindMapNode";
import TextNode from "@/components/maps/TextNode";
import ShapeNode from "@/components/maps/ShapeNode";
import DeletableEdge from "@/components/maps/DeletableEdge";
import ApprovalNode from "@/components/maps/ApprovalNode";
import ApprovalJoinNode from "@/components/maps/ApprovalJoinNode";
import ApprovalEdge from "@/components/maps/ApprovalEdge";
import { TaskDetailModal } from "@/components/tasks/TaskDetailModal";
import { useGetMap, useUpdateCard, useCreateCard, useCreateConnection, useDeleteConnection, useDeleteCard, customFetch, CreateConnectionRequest, useCreateTextElement, useUpdateTextElement, useDeleteTextElement, useUpdateTaskStatus, useCreateShape, useUpdateShape, useDeleteShape } from "@workspace/api-client-react";
import type { ShapeResponse } from "@workspace/api-client-react";
import { Loader2, ArrowLeft, Plus, Type, CheckSquare, Users, Image, Shapes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

interface CreateConnectionRequestWithHandles extends CreateConnectionRequest {
  sourceHandle?: string;
  targetHandle?: string;
}

const nodeTypes = { mindmap: MindMapNode, textnode: TextNode, shapenode: ShapeNode, approvalnode: ApprovalNode, joinnode: ApprovalJoinNode };
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
  taskAssigneeId?: string | null;
  taskAssigneeAvatarUrl?: string | null;
  taskDueDate?: string | null;
  taskParentApprovalStatus?: string | null;
  taskAttachmentCount?: number | null;
  taskSubtaskCount?: number | null;
  taskSubtaskCompletedCount?: number | null;
  taskCommentCount?: number | null;
  title?: string;
  description?: string | null;
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
  const [, navigate] = useLocation();
  const { getViewport, setViewport, screenToFlowPosition, zoomIn, zoomOut, fitView, setCenter } = useReactFlow();
  const [textGhost, setTextGhost] = useState<{ x: number; y: number } | null>(null);
  const textDragRef = useRef<{ dragging: boolean; startX: number; startY: number } | null>(null);
  const [cardGhost, setCardGhost] = useState<{ x: number; y: number } | null>(null);
  const cardDragRef = useRef<{ dragging: boolean; startX: number; startY: number } | null>(null);
  const [shapeTool, setShapeTool] = useState<'line' | 'rect' | 'ellipse' | null>(null);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const shapeDrawRef = useRef<{ startX: number; startY: number; flowX: number; flowY: number } | null>(null);
  const [shapeGhost, setShapeGhost] = useState<{ x: number; y: number; w: number; h: number; rawAbsW?: number; rawAbsH?: number; dxSign?: number; dySign?: number } | null>(null);
  const shapeToolRef = useRef<'line' | 'rect' | 'ellipse' | null>(null);
  const { data: mapData, isLoading } = useGetMap(workspaceId, mapId, {
    query: { refetchInterval: 3000, throwOnError: false, retry: false },
  });
  const editingCardIdRef = useRef<string | null>(null);
  const pendingUpdatesRef = useRef<Map<string, number>>(new Map());
  const connectingJoinNodeRef = useRef<string | null>(null);
  const { pushSnapshot, undo, redo } = usePositionHistory();
  const dragStartSnapshotRef = useRef<NodePositionSnapshot | null>(null);

  const search = useSearch();
  const canvasBasePath = `/workspaces/${workspaceId}/maps/${mapId}`;
  const cardIdFromUrl = new URLSearchParams(search).get("cardId");

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(cardIdFromUrl);
  const [autoFocusCardId, setAutoFocusCardId] = useState<string | null>(null);
  const autoFocusCardIdRef = useRef<string | null>(null);
  const [highlightedEdgeId, setHighlightedEdgeId] = useState<string | null>(null);
  const highlightedEdgeIdRef = useRef<string | null>(null);
  const [pendingDeleteNodeIds, setPendingDeleteNodeIds] = useState<string[] | null>(null);
  const initializedRef = useRef(false);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const mapDataRef = useRef<typeof mapData>(undefined);
  const selectedCardIdRef = useRef<string | null>(selectedCardId);
  const pendingDeleteNodeIdsRef = useRef<string[] | null>(pendingDeleteNodeIds);
  const focusOnLoadCardIdRef = useRef<string | null>(null);
  const focusOnLoadAppliedRef = useRef(false);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => { mapDataRef.current = mapData; }, [mapData]);
  useEffect(() => { selectedCardIdRef.current = selectedCardId; }, [selectedCardId]);
  useEffect(() => { pendingDeleteNodeIdsRef.current = pendingDeleteNodeIds; }, [pendingDeleteNodeIds]);
  useEffect(() => { highlightedEdgeIdRef.current = highlightedEdgeId; }, [highlightedEdgeId]);

  useEffect(() => {
    if (focusOnLoadAppliedRef.current) return;
    if (nodes.length === 0) return;
    const cardId = focusOnLoadCardIdRef.current;
    if (!cardId) return;
    focusOnLoadAppliedRef.current = true;
    const card = mapDataRef.current?.cards.find(c => c.id === cardId);
    if (!card) return;
    const NODE_W = 200;
    const NODE_H = 80;
    const centerX = card.positionX + NODE_W / 2;
    const centerY = card.positionY + NODE_H / 2;
    const timer = setTimeout(() => {
      setCenter(centerX, centerY, { duration: 400, zoom: Math.min(getViewport().zoom, 0.75) });
    }, 500);
    return () => clearTimeout(timer);
  }, [nodes, setCenter, getViewport]);

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
    const handleWASD = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key !== 'w' && key !== 'a' && key !== 's' && key !== 'd') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) return;

      if (editingCardIdRef.current !== null) return;
      if (selectedCardIdRef.current !== null) return;
      if (pendingDeleteNodeIdsRef.current !== null) return;

      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;

      const selectedMindmapNodes = currentNodes.filter(n => n.selected && n.type === 'mindmap');
      if (selectedMindmapNodes.length !== 1) return;

      const current = selectedMindmapNodes[0];

      let targetNode: typeof current | null = null;

      if (key === 'd') {
        const outEdges = currentEdges.filter(ed => ed.source === current.id);
        const children = outEdges
          .map(ed => currentNodes.find(n => n.id === ed.target && n.type === 'mindmap'))
          .filter(Boolean) as typeof currentNodes;
        if (children.length === 0) return;
        targetNode = children.reduce((closest, n) =>
          Math.abs(n.position.y - current.position.y) < Math.abs(closest.position.y - current.position.y) ? n : closest
        );
      } else if (key === 'a') {
        const inEdges = currentEdges.filter(ed => ed.target === current.id);
        const parents = inEdges
          .map(ed => currentNodes.find(n => n.id === ed.source && n.type === 'mindmap'))
          .filter(Boolean) as typeof currentNodes;
        if (parents.length === 0) return;
        targetNode = parents.reduce((closest, n) =>
          Math.abs(n.position.y - current.position.y) < Math.abs(closest.position.y - current.position.y) ? n : closest
        );
      } else if (key === 'w' || key === 's') {
        const siblingIds = new Set<string>();

        const parentEdges = currentEdges.filter(ed => ed.target === current.id);
        if (parentEdges.length > 0) {
          const parentIds = new Set(parentEdges.map(ed => ed.source));
          currentEdges
            .filter(ed => parentIds.has(ed.source) && ed.target !== current.id)
            .forEach(ed => siblingIds.add(ed.target));
        }

        const childEdges = currentEdges.filter(ed => ed.source === current.id);
        if (childEdges.length > 0) {
          const childIds = new Set(childEdges.map(ed => ed.target));
          currentEdges
            .filter(ed => childIds.has(ed.target) && ed.source !== current.id)
            .forEach(ed => siblingIds.add(ed.source));
        }

        const siblings = Array.from(siblingIds)
          .map(id => currentNodes.find(n => n.id === id && n.type === 'mindmap'))
          .filter(Boolean) as typeof currentNodes;
        if (key === 'w') {
          const above = siblings.filter(n => n.position.y < current.position.y);
          if (above.length === 0) return;
          targetNode = above.reduce((closest, n) =>
            current.position.y - n.position.y < current.position.y - closest.position.y ? n : closest
          );
        } else {
          const below = siblings.filter(n => n.position.y > current.position.y);
          if (below.length === 0) return;
          targetNode = below.reduce((closest, n) =>
            n.position.y - current.position.y < closest.position.y - current.position.y ? n : closest
          );
        }
      }

      if (!targetNode) return;

      e.preventDefault();

      const nodeWidth = targetNode.width ?? 200;
      const nodeHeight = targetNode.height ?? 80;
      const centerX = targetNode.position.x + nodeWidth / 2;
      const centerY = targetNode.position.y + nodeHeight / 2;

      const finalTarget = targetNode;
      setNodes(prev => prev.map(n => ({ ...n, selected: n.id === finalTarget.id })));
      setCenter(centerX, centerY, { duration: 300, zoom: Math.min(getViewport().zoom, 0.75) });
    };

    document.addEventListener('keydown', handleWASD);
    return () => document.removeEventListener('keydown', handleWASD);
  }, [setNodes, setCenter, getViewport]);

  useEffect(() => {
    if (!workspaceId || !mapId) return;
    customFetch(`/api/workspaces/${workspaceId}/maps/${mapId}/access`, { method: "POST" })
      .catch(() => {})
      .finally(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/maps/recent"] });
      });
  }, [workspaceId, mapId]);

  useEffect(() => {
    if (cardIdFromUrl && !selectedCardId) {
      setSelectedCardId(cardIdFromUrl);
    } else if (!cardIdFromUrl && selectedCardId) {
      setSelectedCardId(null);
    }
  }, [cardIdFromUrl]);

  const handleOpenPanel = useCallback((cardId: string) => {
    setSelectedCardId(cardId);
    navigate(`${canvasBasePath}?cardId=${cardId}`);
  }, [canvasBasePath, navigate]);

  const handleInlineUpdate = useCallback((cardId: string, patch: Partial<{
    title: string;
    statusVisual: string;
    taskAssigneeName: string | null;
    taskAssigneeId: string | null;
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

  const buildShapeNode = useCallback((shape: ShapeResponse): Node => ({
    id: shape.id,
    type: 'shapenode',
    position: { x: shape.positionX, y: shape.positionY },
    zIndex: -1,
    data: {
      type: shape.type,
      positionX: shape.positionX,
      positionY: shape.positionY,
      width: shape.width,
      height: shape.height,
        rotation: shape.rotation ?? 0,
      color: shape.color,
      filled: shape.filled,
      strokeStyle: shape.strokeStyle,
      x1: shape.x1 ?? null,
      y1: shape.y1 ?? null,
      x2: shape.x2 ?? null,
      y2: shape.y2 ?? null,
      workspaceId,
      mapId,
      onBeforeMutate: () => pendingUpdatesRef.current.set(shape.id, Date.now()),
    },
    draggable: true,
    selectable: true,
    deletable: true,
  }), [workspaceId, mapId]);

  const handleDeleteTextNode = useCallback((elementId: string) => {
    setNodes(prev => prev.filter(n => n.id !== elementId));
  }, [setNodes]);

  const handleDeleteShapeNode = useCallback((shapeId: string) => {
    setNodes(prev => prev.filter(n => n.id !== shapeId));
  }, [setNodes]);

  useEffect(() => { shapeToolRef.current = shapeTool; }, [shapeTool]);

  useEffect(() => {
    if (!shapeTool) return;
    const handleDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShapeTool(null);
        setShapeGhost(null);
        shapeDrawRef.current = null;
      }
    };
    document.addEventListener('keydown', handleDocKeyDown);
    return () => document.removeEventListener('keydown', handleDocKeyDown);
  }, [shapeTool]);

  useEffect(() => {
    if (!mapData) return;

    const mapDataWithText = mapData as typeof mapData & {
      textElements?: Array<{
        id: string;
        mapId: string;
        content: string;
        positionX: number;
        positionY: number;
        width: number;
        height: number;
        fontSize: number;
        color: string;
      }>;
      shapes?: ShapeResponse[];
    };

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
      if (!cardIdFromUrl) {
        type CardWithDates = typeof mapData.cards[0] & { createdAt?: string };
        const regularCards = (mapData.cards as CardWithDates[]).filter(
          c => !(c as ApprovalCardMeta).taskIsApprovalTask,
        );
        const inProgressWithDue = regularCards
          .filter(c => c.statusVisual === 'in_progress' && c.taskDueDate)
          .sort((a, b) => new Date(a.taskDueDate!).getTime() - new Date(b.taskDueDate!).getTime());
        if (inProgressWithDue.length > 0) {
          focusOnLoadCardIdRef.current = inProgressWithDue[0].id;
        } else {
          for (const status of ['draft', 'pending', 'in_progress', 'completed', 'blocked']) {
            const candidates = regularCards
              .filter(c => c.statusVisual === status)
              .sort((a, b) => {
                const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return tb - ta;
              });
            if (candidates.length > 0) {
              focusOnLoadCardIdRef.current = candidates[0].id;
              break;
            }
          }
        }
      }

      const focusCardId = focusOnLoadCardIdRef.current;

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
            : { title: c.title, statusVisual: c.statusVisual, taskId: c.taskId, taskDueDate: c.taskDueDate ?? null, taskAssigneeName: c.taskAssigneeName ?? null, taskAssigneeId: (c as ApprovalCardMeta).taskAssigneeId ?? null, taskAssigneeAvatarUrl: c.taskAssigneeAvatarUrl ?? null, taskDescription: c.description ?? null, taskCompletedAt: c.taskCompletedAt ?? null, taskParentApprovalStatus: (c as ApprovalCardMeta).taskParentApprovalStatus ?? null, taskAttachmentCount: (c as ApprovalCardMeta).taskAttachmentCount ?? 0, taskSubtaskCount: (c as ApprovalCardMeta).taskSubtaskCount ?? 0, taskSubtaskCompletedCount: (c as ApprovalCardMeta).taskSubtaskCompletedCount ?? 0, taskCommentCount: (c as ApprovalCardMeta).taskCommentCount ?? 0, workspaceId, mapId, onOpen: handleOpenPanel, onAddChild: handleAddChildCard, onInlineUpdate: handleInlineUpdate, onEditingChange: handleEditingChange, isTerminalNode },
          draggable: true,
          deletable: !isApproval,
          selected: !isApproval && c.id === focusCardId,
        };
      });

      const textNodes: Node[] = (mapDataWithText.textElements ?? []).map(el =>
        buildTextNode(el, handleDeleteTextNode)
      );

      const shapeNodes: Node[] = (mapDataWithText.shapes ?? []).map(sh =>
        buildShapeNode(sh)
      );

      const joinNodes = buildJoinNodes(mapData.cards as ApprovalCardMeta[], handleAddChildCard);

      setNodes([...shapeNodes, ...initialNodes, ...textNodes, ...joinNodes]);

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
        const serverShapeIds = new Set((mapDataWithText.shapes ?? []).map(sh => sh.id));

        const filtered = prev.filter(n => {
          if (n.type === 'textnode') return serverTextIds.has(n.id);
          if (n.type === 'shapenode') return serverShapeIds.has(n.id);
          return serverCardIds.has(n.id);
        });

        const existingCardIds = new Set(filtered.filter(n => n.type === 'mindmap' || n.type === 'approvalnode').map(n => n.id));
        const existingTextIds = new Set(filtered.filter(n => n.type === 'textnode').map(n => n.id));
        const existingShapeIds = new Set(filtered.filter(n => n.type === 'shapenode').map(n => n.id));

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
                : { title: c.title, statusVisual: c.statusVisual, taskId: c.taskId, taskDueDate: c.taskDueDate ?? null, taskAssigneeName: c.taskAssigneeName ?? null, taskAssigneeId: (c as ApprovalCardMeta).taskAssigneeId ?? null, taskAssigneeAvatarUrl: c.taskAssigneeAvatarUrl ?? null, taskDescription: c.description ?? null, taskCompletedAt: c.taskCompletedAt ?? null, taskParentApprovalStatus: (c as ApprovalCardMeta).taskParentApprovalStatus ?? null, taskAttachmentCount: (c as ApprovalCardMeta).taskAttachmentCount ?? 0, taskSubtaskCount: (c as ApprovalCardMeta).taskSubtaskCount ?? 0, taskSubtaskCompletedCount: (c as ApprovalCardMeta).taskSubtaskCompletedCount ?? 0, taskCommentCount: (c as ApprovalCardMeta).taskCommentCount ?? 0, workspaceId, mapId, onOpen: handleOpenPanel, onAddChild: handleAddChildCard, onInlineUpdate: handleInlineUpdate, onEditingChange: handleEditingChange, onAutoFocusDone: handleAutoFocusDone, isTerminalNode, autoFocusTitle: shouldAutoFocus },
              draggable: true,
              deletable: !isApproval,
            };
          });

        const newTextNodes: Node[] = (mapDataWithText.textElements ?? [])
          .filter(el => !existingTextIds.has(el.id))
          .map(el => buildTextNode(el, handleDeleteTextNode));

        const newShapeNodes: Node[] = (mapDataWithText.shapes ?? [])
          .filter(sh => !existingShapeIds.has(sh.id))
          .map(sh => buildShapeNode(sh));

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
            if (n.type === 'shapenode') {
              const serverShape = (mapDataWithText.shapes ?? []).find(sh => sh.id === n.id);
              if (!serverShape) return n;
              if (pendingUpdatesRef.current.has(n.id)) return n;
              return {
                ...n,
                position: { x: serverShape.positionX, y: serverShape.positionY },
                data: {
                  ...n.data,
                  positionX: serverShape.positionX,
                  positionY: serverShape.positionY,
                  rotation: serverShape.rotation ?? 0,
                  color: serverShape.color,
                  filled: serverShape.filled,
                  strokeStyle: serverShape.strokeStyle,
                  width: serverShape.width,
                  height: serverShape.height,
                  x1: serverShape.x1 ?? null,
                  y1: serverShape.y1 ?? null,
                  x2: serverShape.x2 ?? null,
                  y2: serverShape.y2 ?? null,
                },
              };
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
            return { ...n, data: { title: s.title, statusVisual: s.statusVisual, taskId: s.taskId, taskDueDate: s.taskDueDate ?? null, taskAssigneeName: s.taskAssigneeName ?? null, taskAssigneeId: (s as ApprovalCardMeta).taskAssigneeId ?? null, taskAssigneeAvatarUrl: s.taskAssigneeAvatarUrl ?? null, taskDescription: s.description ?? null, taskCompletedAt: s.taskCompletedAt ?? null, taskParentApprovalStatus: (s as ApprovalCardMeta).taskParentApprovalStatus ?? null, taskAttachmentCount: (s as ApprovalCardMeta).taskAttachmentCount ?? 0, taskSubtaskCount: (s as ApprovalCardMeta).taskSubtaskCount ?? 0, taskSubtaskCompletedCount: (s as ApprovalCardMeta).taskSubtaskCompletedCount ?? 0, taskCommentCount: (s as ApprovalCardMeta).taskCommentCount ?? 0, workspaceId, mapId, onOpen: handleOpenPanel, onAddChild: handleAddChildCard, onInlineUpdate: handleInlineUpdate, onEditingChange: handleEditingChange, onAutoFocusDone: handleAutoFocusDone, isTerminalNode } };
          }),
          ...newShapeNodes,
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
  const updateTaskStatusMut = useUpdateTaskStatus();
  const createShapeMut = useCreateShape();
  const updateShapeMut = useUpdateShape();
  const deleteShapeMut = useDeleteShape();

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

  const updateTaskStatusMutRef = useRef(updateTaskStatusMut);
  updateTaskStatusMutRef.current = updateTaskStatusMut;

  useEffect(() => {
    const handleNodeShortcuts = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) return;
      if (editingCardIdRef.current !== null) return;

      const key = e.key;
      const noMod = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;

      if (key === 'Escape' && noMod) {
        if (selectedCardIdRef.current !== null || pendingDeleteNodeIdsRef.current !== null) return;
        const anySelected = nodesRef.current.some(n => n.selected && n.type === 'mindmap');
        if (!anySelected) return;
        e.preventDefault();
        setNodes(prev => prev.map(n => ({ ...n, selected: false })));
        navigate(canvasBasePath);
        return;
      }

      if (selectedCardIdRef.current !== null || pendingDeleteNodeIdsRef.current !== null) return;

      const selectedMindmapNodes = nodesRef.current.filter(n => n.selected && n.type === 'mindmap');
      if (selectedMindmapNodes.length !== 1) return;
      const current = selectedMindmapNodes[0];
      const cardId = current.id;
      const taskId = current.data?.taskId as string | null | undefined;

      if (key === 'Enter' && noMod) {
        e.preventDefault();
        handleOpenPanel(cardId);
        return;
      }

      if (!noMod) return;

      const lkey = key.toLowerCase();

      if (lkey === 'n') {
        e.preventDefault();
        handleAddChildCard(cardId);
        return;
      }

      const STATUS_MAP: Record<string, 'draft' | 'pending' | 'in_progress' | 'completed' | 'blocked'> = {
        '1': 'draft',
        '2': 'pending',
        '3': 'in_progress',
        '4': 'completed',
        '5': 'blocked',
      };
      const newStatus = STATUS_MAP[lkey];
      if (newStatus) {
        e.preventDefault();
        handleInlineUpdate(cardId, { statusVisual: newStatus });
        if (taskId) {
          updateTaskStatusMutRef.current.mutate({
            workspaceId, mapId, cardId, data: { status: newStatus },
          });
        }
      }
    };

    document.addEventListener('keydown', handleNodeShortcuts);
    return () => document.removeEventListener('keydown', handleNodeShortcuts);
  }, [setNodes, navigate, canvasBasePath, handleOpenPanel, handleAddChildCard, handleInlineUpdate, workspaceId, mapId]);

  const onNodeDragStart = useCallback(
    (_event: React.MouseEvent, _node: Node) => {
      if (dragStartSnapshotRef.current) return;
      const snapshot: NodePositionSnapshot = {};
      for (const n of nodesRef.current) {
        snapshot[n.id] = { x: n.position.x, y: n.position.y };
      }
      dragStartSnapshotRef.current = snapshot;
    },
    [],
  );

  const onSelectionDragStart = useCallback(
    (_event: React.MouseEvent, _selectedNodes: Node[]) => {
      if (dragStartSnapshotRef.current) return;
      const snapshot: NodePositionSnapshot = {};
      for (const n of nodesRef.current) {
        snapshot[n.id] = { x: n.position.x, y: n.position.y };
      }
      dragStartSnapshotRef.current = snapshot;
    },
    [],
  );

  const onNodeDrag = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // Text nodes, shape nodes, approval nodes, and join nodes are excluded from edge insertion logic
      if (node.type === 'textnode' || node.type === 'shapenode' || node.type === 'approvalnode' || node.type === 'joinnode') return;

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

      if (found !== highlightedEdgeIdRef.current) {
        setHighlightedEdgeId(found);
        setEdges(eds => eds.map(e => ({
          ...e,
          data: { ...e.data, highlighted: e.id === found },
        })));
      }
    },
    [setEdges],
  );

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (dragStartSnapshotRef.current) {
        const snapshot = dragStartSnapshotRef.current;
        dragStartSnapshotRef.current = null;
        const prevPos = snapshot[node.id];
        const moved = !prevPos ||
          Math.abs(prevPos.x - node.position.x) > 0.5 ||
          Math.abs(prevPos.y - node.position.y) > 0.5;
        if (moved) pushSnapshot(snapshot);
      }

      // If this is a text node, use the text element update mutation
      if (node.type === 'textnode') {
        updateTextMut.mutate({
          workspaceId, mapId, elementId: node.id,
          data: { positionX: node.position.x, positionY: node.position.y },
        });
        return;
      }

      // If this is a shape node, use the shape update mutation
      if (node.type === 'shapenode') {
        pendingUpdatesRef.current.set(node.id, Date.now());
        updateShapeMut.mutate({
          workspaceId, mapId, shapeId: node.id,
          data: { positionX: node.position.x, positionY: node.position.y },
        });
        return;
      }

      // Approval nodes and join nodes are not draggable to meaningful positions
      if (node.type === 'approvalnode' || node.type === 'joinnode') return;

      // Always save position
      updateCardMut.mutate({
        workspaceId, mapId, cardId: node.id,
        data: { positionX: node.position.x, positionY: node.position.y },
      });

      const currentHighlightedEdgeId = highlightedEdgeIdRef.current;

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
    [workspaceId, mapId, updateCardMut, updateTextMut, updateShapeMut, deleteConnMut, createConnMut, queryClient, mapData],
  );

  const onSelectionDragStop = useCallback(
    (_event: React.MouseEvent, selectedNodes: Node[]) => {
      if (dragStartSnapshotRef.current) {
        const snapshot = dragStartSnapshotRef.current;
        dragStartSnapshotRef.current = null;
        const anyMoved = selectedNodes.some(n => {
          const prevPos = snapshot[n.id];
          return !prevPos ||
            Math.abs(prevPos.x - n.position.x) > 0.5 ||
            Math.abs(prevPos.y - n.position.y) > 0.5;
        });
        if (anyMoved) pushSnapshot(snapshot);
      }
      selectedNodes.forEach(node => {
        if (node.type === 'textnode') {
          updateTextMut.mutate({
            workspaceId, mapId, elementId: node.id,
            data: { positionX: node.position.x, positionY: node.position.y },
          });
        } else if (node.type === 'shapenode') {
          pendingUpdatesRef.current.set(node.id, Date.now());
          updateShapeMut.mutate({
            workspaceId, mapId, shapeId: node.id,
            data: { positionX: node.position.x, positionY: node.position.y },
          });
        } else {
          updateCardMut.mutate({
            workspaceId, mapId, cardId: node.id,
            data: { positionX: node.position.x, positionY: node.position.y },
          });
        }
      });
    },
    [workspaceId, mapId, updateCardMut, updateTextMut, updateShapeMut],
  );

  const updateCardMutRef = useRef(updateCardMut);
  updateCardMutRef.current = updateCardMut;
  const updateTextMutRef = useRef(updateTextMut);
  updateTextMutRef.current = updateTextMut;
  const updateShapeMutRef = useRef(updateShapeMut);
  updateShapeMutRef.current = updateShapeMut;

  useEffect(() => {
    const handleUndoRedo = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      if (!isCtrl) return;

      const isZ = e.key === 'z' || e.key === 'Z';
      const isY = e.key === 'y' || e.key === 'Y';
      const isShift = e.shiftKey;

      if (!isZ && !isY) return;

      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) return;

      const isUndo = isZ && !isShift;
      const isRedo = isY || (isZ && isShift);

      if (!isUndo && !isRedo) return;

      e.preventDefault();
      e.stopPropagation();

      const currentNodes = nodesRef.current;
      const currentSnapshot: NodePositionSnapshot = {};
      for (const n of currentNodes) {
        currentSnapshot[n.id] = { x: n.position.x, y: n.position.y };
      }

      const targetSnapshot = isUndo
        ? undo(currentSnapshot)
        : redo(currentSnapshot);

      if (!targetSnapshot) return;

      setNodes(prev =>
        prev.map(n => {
          const pos = targetSnapshot[n.id];
          if (!pos) return n;
          return { ...n, position: pos };
        }),
      );

      for (const n of currentNodes) {
        const pos = targetSnapshot[n.id];
        if (!pos) continue;
        if (Math.abs(pos.x - n.position.x) < 0.5 && Math.abs(pos.y - n.position.y) < 0.5) continue;

        if (n.type === 'textnode') {
          updateTextMutRef.current.mutate({
            workspaceId, mapId, elementId: n.id,
            data: { positionX: pos.x, positionY: pos.y },
          });
        } else if (n.type === 'shapenode') {
          pendingUpdatesRef.current.set(n.id, Date.now());
          updateShapeMutRef.current.mutate({
            workspaceId, mapId, shapeId: n.id,
            data: { positionX: pos.x, positionY: pos.y },
          });
        } else if (n.type === 'mindmap' || n.type === 'approvalnode') {
          updateCardMutRef.current.mutate({
            workspaceId, mapId, cardId: n.id,
            data: { positionX: pos.x, positionY: pos.y },
          });
        }
      }
    };

    document.addEventListener('keydown', handleUndoRedo, true);
    return () => document.removeEventListener('keydown', handleUndoRedo, true);
  }, [workspaceId, mapId, undo, redo, setNodes]);

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;

      // Reject connections involving text, shape, or approval nodes; join nodes can be source but not target
      const currentNodes = nodesRef.current;
      const sourceNode = currentNodes.find(n => n.id === params.source);
      const targetNode = currentNodes.find(n => n.id === params.target);
      if (sourceNode?.type === 'textnode' || targetNode?.type === 'textnode') return;
      if (sourceNode?.type === 'shapenode' || targetNode?.type === 'shapenode') return;
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
        if (!targetNode || targetNode.type === 'approvalnode' || targetNode.type === 'joinnode' || targetNode.type === 'textnode' || targetNode.type === 'shapenode') return;
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

  useEffect(() => {
    const el = reactFlowRef.current;
    if (!el) return;
    const handleMouseDown = () => {
      const snapshot: NodePositionSnapshot = {};
      for (const n of nodesRef.current) {
        snapshot[n.id] = { x: n.position.x, y: n.position.y };
      }
      dragStartSnapshotRef.current = snapshot;
    };
    el.addEventListener('mousedown', handleMouseDown);
    return () => el.removeEventListener('mousedown', handleMouseDown);
  }, []);

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

  const handleShapeDrawMouseDown = useCallback((e: React.MouseEvent) => {
    if (!shapeToolRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    shapeDrawRef.current = { startX: e.clientX, startY: e.clientY, flowX: flowPos.x, flowY: flowPos.y };
    setShapeGhost({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
  }, [screenToFlowPosition]);

  const handleShapeDrawMouseMove = useCallback((e: React.MouseEvent) => {
    if (!shapeDrawRef.current) return;
    const { startX, startY } = shapeDrawRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const rawAbsW = Math.abs(dx);
    const rawAbsH = Math.abs(dy);
    const w = rawAbsW;
    const h = shapeToolRef.current === 'line' ? Math.max(4, rawAbsH) : rawAbsH;
    const dxSign = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const dySign = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    setShapeGhost({ x, y, w, h, rawAbsW, rawAbsH, dxSign, dySign });
  }, []);

  const handleShapeDrawMouseUp = useCallback((e: React.MouseEvent) => {
    if (!shapeDrawRef.current) return;
    const { flowX, flowY } = shapeDrawRef.current;
    const tool = shapeToolRef.current;
    if (!tool) return;
    const flowEnd = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const posX = Math.min(flowX, flowEnd.x);
    const posY = Math.min(flowY, flowEnd.y);
    const rawW = Math.abs(flowEnd.x - flowX);
    const rawH = Math.abs(flowEnd.y - flowY);
    const w = tool === 'line' ? Math.max(1, rawW) : Math.max(40, rawW);
    const h = tool === 'line' ? Math.max(4, rawH) : Math.max(20, rawH);
    shapeDrawRef.current = null;
    setShapeGhost(null);
    setShapeTool(null);
    if (tool === 'line') {
      const dxSign = flowEnd.x > flowX ? 1 : flowEnd.x < flowX ? -1 : 0;
      const dySign = flowEnd.y > flowY ? 1 : flowEnd.y < flowY ? -1 : 0;
      const x1 = dxSign > 0 ? 0 : dxSign < 0 ? w : 0;
      const y1 = dySign > 0 ? 0 : dySign < 0 ? h : 0;
      const x2 = dxSign > 0 ? w : dxSign < 0 ? 0 : 0;
      const y2 = dySign > 0 ? h : dySign < 0 ? 0 : 0;
      createShapeMut.mutate(
        { workspaceId, mapId, data: { type: tool, positionX: posX, positionY: posY, width: w, height: h, x1, y1, x2, y2 } },
        {
          onSuccess: (shape) => {
            const newNode = buildShapeNode(shape);
            setNodes(prev => [newNode, ...prev]);
            queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          },
        },
      );
    } else {
      createShapeMut.mutate(
        { workspaceId, mapId, data: { type: tool, positionX: posX, positionY: posY, width: w, height: h } },
        {
          onSuccess: (shape) => {
            const newNode = buildShapeNode(shape);
            setNodes(prev => [newNode, ...prev]);
            queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          },
        },
      );
    }
  }, [screenToFlowPosition, workspaceId, mapId, createShapeMut, buildShapeNode, setNodes, queryClient]);

  const onPaneClick = useCallback(() => {
    setSelectedCardId(null);
    setShapeMenuOpen(false);
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
      <div className="flex-1 flex flex-col bg-slate-100 dark:bg-background relative overflow-hidden">
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

        {shapeGhost && (shapeGhost.w > 2 || (shapeTool === 'line' && shapeGhost.h > 2)) && (
          <div className="pointer-events-none fixed z-[9998]" style={{ left: shapeGhost.x, top: shapeGhost.y, width: Math.max(shapeGhost.w, shapeTool === 'line' ? 1 : 0), height: Math.max(shapeGhost.h, 4) }}>
            <svg width={Math.max(shapeGhost.w, shapeTool === 'line' ? 1 : 0)} height={Math.max(shapeGhost.h, 4)} style={{ overflow: 'visible' }}>
              {shapeTool === 'rect' && (
                <rect x={1} y={1} width={shapeGhost.w - 2} height={Math.max(shapeGhost.h - 2, 2)} rx={4} stroke="#6366f1" strokeWidth={2} strokeDasharray="6 4" fill="#6366f120" />
              )}
              {shapeTool === 'ellipse' && (
                <ellipse cx={shapeGhost.w / 2} cy={Math.max(shapeGhost.h, 4) / 2} rx={shapeGhost.w / 2 - 1} ry={Math.max(shapeGhost.h, 4) / 2 - 1} stroke="#6366f1" strokeWidth={2} strokeDasharray="6 4" fill="#6366f120" />
              )}
              {shapeTool === 'line' && (() => {
                const gw = Math.max(shapeGhost.rawAbsW ?? shapeGhost.w, 1);
                const rawH = shapeGhost.rawAbsH ?? shapeGhost.h;
                const gDxSign = shapeGhost.dxSign ?? 1;
                const gDySign = shapeGhost.dySign ?? 1;
                const lx1 = gDxSign > 0 ? 0 : gDxSign < 0 ? gw : 0;
                const lx2 = gDxSign > 0 ? gw : gDxSign < 0 ? 0 : 0;
                const ly1 = gDySign > 0 ? 0 : gDySign < 0 ? rawH : 0;
                const ly2 = gDySign > 0 ? rawH : gDySign < 0 ? 0 : 0;
                return <line x1={lx1} y1={ly1} x2={lx2} y2={ly2} stroke="#6366f1" strokeWidth={2} strokeLinecap="round" strokeDasharray="6 4" />;
              })()}
            </svg>
          </div>
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
            className="rounded-xl h-10 px-5 shadow-md bg-background border-border/60 select-none cursor-pointer"
          >
            {createCardMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            <span className="lowercase">Tarefa</span>
          </Button>
          <Button
            disabled
            variant="outline"
            title="funcionalidade vindoura"
            className="rounded-xl h-10 px-5 shadow-md bg-background border-border/60 select-none opacity-40 disabled:pointer-events-auto cursor-not-allowed"
          >
            <CheckSquare className="w-4 h-4 mr-2" />
            <span className="lowercase">Aprovação</span>
          </Button>
          <Button
            onMouseDown={handleTextButtonMouseDown}
            disabled={createTextMut.isPending}
            variant="outline"
            title="Clique para adicionar texto no centro • Arraste para posicionar"
            className="rounded-xl h-10 px-5 shadow-md bg-background border-border/60 select-none cursor-pointer"
          >
            {createTextMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Type className="w-4 h-4 mr-2" />}
            <span className="lowercase">Texto</span>
          </Button>
          <Button
            disabled
            variant="outline"
            title="funcionalidade vindoura"
            className="rounded-xl h-10 px-5 shadow-md bg-background border-border/60 select-none opacity-40 disabled:pointer-events-auto cursor-not-allowed"
          >
            <Users className="w-4 h-4 mr-2" />
            <span className="lowercase">Reunião</span>
          </Button>
          <Button
            disabled
            variant="outline"
            title="funcionalidade vindoura"
            className="rounded-xl h-10 px-5 shadow-md bg-background border-border/60 select-none opacity-40 disabled:pointer-events-auto cursor-not-allowed"
          >
            <Image className="w-4 h-4 mr-2" />
            <span className="lowercase">Imagem</span>
          </Button>
          <div className="relative">
            <Button
              variant={shapeMenuOpen || shapeTool ? "default" : "outline"}
              title="Inserir forma geométrica"
              className="rounded-xl h-10 px-5 shadow-md bg-background border-border/60 select-none cursor-pointer"
              onClick={() => { setShapeMenuOpen(o => !o); setShapeTool(null); }}
            >
              <Shapes className="w-4 h-4 mr-2" />
              <span className="lowercase">{shapeTool ?? 'Forma'}</span>
            </Button>
            {shapeMenuOpen && (
              <div className="absolute bottom-12 left-0 bg-background border border-border/60 rounded-xl shadow-lg overflow-hidden z-50 min-w-[130px]">
                {(['rect', 'ellipse', 'line'] as const).map(tool => (
                  <button
                    key={tool}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted transition-colors lowercase flex items-center gap-2"
                    onClick={() => { setShapeTool(tool); setShapeMenuOpen(false); }}
                  >
                    <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
                      {tool === 'rect' && <rect x="1" y="1" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />}
                      {tool === 'ellipse' && <ellipse cx="9" cy="7" rx="8" ry="6" stroke="currentColor" strokeWidth="1.5" />}
                      {tool === 'line' && <line x1="1" y1="7" x2="17" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
                    </svg>
                    {tool === 'rect' ? 'retângulo' : tool === 'ellipse' ? 'elipse' : 'linha'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {shapeTool && (
          <div
            className="absolute inset-0 z-20"
            style={{ cursor: 'crosshair' }}
            onMouseDown={handleShapeDrawMouseDown}
            onMouseMove={handleShapeDrawMouseMove}
            onMouseUp={handleShapeDrawMouseUp}
          />
        )}

        <div ref={reactFlowRef} className="flex-1 w-full h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChangeWithDelete}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onSelectionDragStart={onSelectionDragStart}
            onSelectionDragStop={onSelectionDragStop}
            onPaneClick={onPaneClick}
            onPaneContextMenu={(e) => e.preventDefault()}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
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
                } else if (n.type === 'shapenode') {
                  handleDeleteShapeNode(n.id);
                  deleteShapeMut.mutate({ workspaceId, mapId, shapeId: n.id });
                } else {
                  handleDeleteCard(n.id);
                }
              });
            }}
            deleteKeyCode="Delete"
            className="w-full h-full"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="hsl(var(--muted-foreground) / 0.15)" />
            <Controls className="bg-card border border-border shadow-md rounded-xl overflow-hidden" showZoom={false} showFitView={false} showInteractive={false}>
              <ControlButton title="aproximar" onClick={() => zoomIn()}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M32 18.133H18.133V32h-4.266V18.133H0v-4.266h13.867V0h4.266v13.867H32z" /></svg>
              </ControlButton>
              <ControlButton title="afastar" onClick={() => zoomOut()}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M32 18.133H0v-4.266h32z" /></svg>
              </ControlButton>
              <ControlButton title="enquadrar" onClick={() => fitView()}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M5.333 16c0-5.891 4.776-10.667 10.667-10.667S26.667 10.109 26.667 16 21.891 26.667 16 26.667 5.333 21.891 5.333 16zM16 0C7.163 0 0 7.163 0 16s7.163 16 16 16 16-7.163 16-16S24.837 0 16 0z" /></svg>
              </ControlButton>
            </Controls>
          </ReactFlow>
        </div>
      </div>

      <TaskDetailModal
        workspaceId={workspaceId}
        mapId={mapId}
        cardId={selectedCardId}
        open={!!selectedCardId}
        onClose={() => {
          setSelectedCardId(null);
          navigate(canvasBasePath, { replace: true });
        }}
        onDeleteCard={handleDeleteCard}
        onDuplicated={(_, newCardId) => {
          if (newCardId) {
            queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
            setSelectedCardId(newCardId);
            navigate(`${canvasBasePath}?cardId=${newCardId}`);
          } else {
            queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          }
        }}
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
