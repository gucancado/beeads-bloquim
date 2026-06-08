import { useState, useCallback, useEffect, useRef } from "react";
import { usePositionHistory, NodePositionSnapshot } from "@/hooks/usePositionHistory";
import { useRoute, useLocation, useSearch } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { ReactFlow, Background, useNodesState, useEdgesState, addEdge, Connection, Edge, Node, BackgroundVariant, ReactFlowProvider, EdgeChange, ConnectionMode, SelectionMode, useReactFlow } from 'reactflow';
import 'reactflow/dist/style.css';
import MindMapNode from "@/components/maps/MindMapNode";
import TextNode from "@/components/maps/TextNode";
import ShapeNode from "@/components/maps/ShapeNode";
import DeletableEdge from "@/components/maps/DeletableEdge";
import ApprovalNode from "@/components/maps/ApprovalNode";
import ApprovalJoinNode from "@/components/maps/ApprovalJoinNode";
import ApprovalEdge from "@/components/maps/ApprovalEdge";
import { LAYER_EDGE, LAYER_TASK, LAYER_TEXT, shapeNodeZIndex, type ShapeKind } from "@/components/maps/layerOrder";
import { TaskDetailModal } from "@/components/tasks/TaskDetailModal";
import { getApprovalDisplayTitle } from "@/lib/approvalTaskTitle";
import { useGetMap, useGetWorkspace, useUpdateCard, useCreateCard, useCreateConnection, useDeleteConnection, useDeleteCard, customFetch, CreateConnectionRequest, useCreateTextElement, useUpdateTextElement, useDeleteTextElement, useUpdateTaskStatus, useCreateShape, useUpdateShape, useDeleteShape } from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { PageBreadcrumb } from "@/components/layout/PageBreadcrumb";
import type { ShapeResponse } from "@workspace/api-client-react";
import { Loader2, ArrowLeft, Plus, Type, Users, Image, Shapes } from "lucide-react";
import { Button } from "@beeads/ui";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@beeads/ui";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { usePresenceChannel } from "@/realtime/usePresenceChannel";
import { PresenceCursorsOverlay } from "@/realtime/PresenceCursorsOverlay";
import { sampleBezier, edgeIntersectsNodeBBox } from "@/components/canvas-base/geometry";
import { CanvasToolbar } from "@/components/canvas-base/CanvasToolbar";
import { CanvasDrawGhosts } from "@/components/canvas-base/CanvasDrawGhosts";
import { CanvasControls } from "@/components/canvas-base/CanvasControls";

interface CreateConnectionRequestWithHandles extends CreateConnectionRequest {
  sourceHandle?: string;
  targetHandle?: string;
}

const nodeTypes = { mindmap: MindMapNode, textnode: TextNode, shapenode: ShapeNode, approvalnode: ApprovalNode, joinnode: ApprovalJoinNode };
const edgeTypes = { deletable: DeletableEdge, approval: ApprovalEdge };

const INACTIVE_STATUSES = new Set(['blocked', 'pending', 'draft']);

const EDGE_BASE = {
  type: 'deletable' as const,
  zIndex: LAYER_EDGE,
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
  parentTaskTitle?: string | null;
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
          zIndex: LAYER_EDGE,
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
        zIndex: LAYER_EDGE,
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
          zIndex: LAYER_EDGE,
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
          zIndex: LAYER_EDGE,
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
      draggable: true,
      deletable: false,
      selectable: true,
      zIndex: LAYER_TASK,
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

function CanvasInner({ workspaceId, mapId }: { workspaceId: string; mapId: string }) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { getViewport, setViewport, screenToFlowPosition, setCenter } = useReactFlow();
  const [textGhost, setTextGhost] = useState<{ x: number; y: number } | null>(null);
  const textDragRef = useRef<{ dragging: boolean; startX: number; startY: number } | null>(null);
  const [cardGhost, setCardGhost] = useState<{ x: number; y: number } | null>(null);
  const cardDragRef = useRef<{ dragging: boolean; startX: number; startY: number } | null>(null);
  const [shapeTool, setShapeTool] = useState<'line' | 'rect' | 'ellipse' | null>(null);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const shapeDrawRef = useRef<{ startX: number; startY: number; flowX: number; flowY: number } | null>(null);
  const [shapeGhost, setShapeGhost] = useState<{ x: number; y: number; w: number; h: number; rawAbsW?: number; rawAbsH?: number; dxSign?: number; dySign?: number } | null>(null);
  // Alt+drag ghosts: dashed-outline placeholders that follow the cursor
  // without moving the underlying nodes; duplication happens on mouseup.
  // `shapeKind` is set for shapenodes so we can render an ellipse / line
  // outline that matches the source shape (default is a rectangle).
  // For lines, `lineCoords` carries the endpoints already scaled to screen px.
  const [altDrag, setAltDrag] = useState<{
    cursor: { x: number; y: number };
    ghosts: Array<{
      nodeId: string;
      dx: number;
      dy: number;
      width: number;
      height: number;
      shapeKind?: 'rect' | 'ellipse' | 'line' | 'image';
      lineCoords?: { x1: number; y1: number; x2: number; y2: number };
    }>;
  } | null>(null);
  const shapeToolRef = useRef<'line' | 'rect' | 'ellipse' | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const { uploadFile } = useUpload();
  const lastMouseFlowPosRef = useRef<{ x: number; y: number } | null>(null);
  const { data: mapData, isLoading } = useGetMap(workspaceId, mapId, {
    query: { refetchInterval: 3000, throwOnError: false, retry: false },
  });
  const { data: canvasWorkspace } = useGetWorkspace(workspaceId);
  const editingCardIdRef = useRef<string | null>(null);
  const pendingUpdatesRef = useRef<Map<string, number>>(new Map());
  const connectingJoinNodeRef = useRef<string | null>(null);
  const dropTargetElRef = useRef<Element | null>(null);
  const connectPointerMoveRef = useRef<((ev: PointerEvent) => void) | null>(null);
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
    taskStartAt: string | null;
    taskScheduleMode: "ate" | "entre" | "em" | "sem_prazo" | null;
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
    zIndex: LAYER_TEXT,
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
    zIndex: shapeNodeZIndex(shape.type as ShapeKind),
    className: shape.type === 'image'
      ? 'shape-image-node'
      : shape.type === 'line'
        ? 'shape-line-node'
        : undefined,
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
      attachmentId: shape.attachmentId ?? null,
      fileName: shape.fileName ?? null,
      mimeType: shape.mimeType ?? null,
      downloadUrl: shape.attachmentId
        ? `/api/workspaces/${workspaceId}/maps/${mapId}/shapes/${shape.id}/download`
        : null,
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

    // Single source of truth for an approval node's data payload.
    // Used in initial node build, new-card insertion, and incremental update.
    const mapApprovalCardToNodeData = (card: typeof mapData.cards[0]) => {
      const a = card as ApprovalCardMeta;
      const isTerminalApproval = terminalApprovalParentMap.has(card.id);
      const allSiblingsApproved = fullyApprovedParentTaskIds.has(a.taskParentTaskId ?? '');
      const approvalParentCardId = taskIdToCardId.get(a.taskParentTaskId ?? '') ?? null;
      return {
        approverName: card.taskAssigneeName ?? null,
        approverAvatarUrl: card.taskAssigneeAvatarUrl ?? null,
        approvalStatus: card.statusVisual ?? null,
        approvalDecision: a.taskApprovalDecision ?? null,
        dueDate: card.taskDueDate ?? null,
        taskTitle: getApprovalDisplayTitle({
          isApprovalTask: true,
          parentTaskTitle: a.parentTaskTitle ?? null,
          title: card.title,
        }),
        cardId: card.id,
        onOpen: handleOpenPanel,
        allSiblingsApproved,
        approvalParentCardId,
        onAddChild: isTerminalApproval ? handleAddChildCard : undefined,
        terminalParentCardId: isTerminalApproval ? terminalApprovalParentMap.get(card.id) : undefined,
      };
    };

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
        return {
          id: c.id,
          type: isApproval ? 'approvalnode' : 'mindmap',
          position: { x: c.positionX, y: c.positionY },
          zIndex: LAYER_TASK,
          data: isApproval
            ? mapApprovalCardToNodeData(c)
            : { title: c.title, statusVisual: c.statusVisual, taskId: c.taskId, taskDueDate: c.taskDueDate ?? null, taskStartAt: c.taskStartAt ?? null, taskScheduleMode: c.taskScheduleMode ?? null, taskAssigneeName: c.taskAssigneeName ?? null, taskAssigneeId: (c as ApprovalCardMeta).taskAssigneeId ?? null, taskAssigneeAvatarUrl: c.taskAssigneeAvatarUrl ?? null, taskDescription: c.description ?? null, taskCompletedAt: c.taskCompletedAt ?? null, taskParentApprovalStatus: (c as ApprovalCardMeta).taskParentApprovalStatus ?? null, taskAttachmentCount: (c as ApprovalCardMeta).taskAttachmentCount ?? 0, taskSubtaskCount: (c as ApprovalCardMeta).taskSubtaskCount ?? 0, taskSubtaskCompletedCount: (c as ApprovalCardMeta).taskSubtaskCompletedCount ?? 0, taskCommentCount: (c as ApprovalCardMeta).taskCommentCount ?? 0, workspaceId, mapId, onOpen: handleOpenPanel, onAddChild: handleAddChildCard, onInlineUpdate: handleInlineUpdate, onEditingChange: handleEditingChange, isTerminalNode },
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
            const shouldAutoFocus = !isApproval && c.id === autoFocusCardIdRef.current;
            return {
              id: c.id,
              type: isApproval ? 'approvalnode' : 'mindmap',
              position: { x: c.positionX, y: c.positionY },
              zIndex: LAYER_TASK,
              data: isApproval
                ? mapApprovalCardToNodeData(c)
                : { title: c.title, statusVisual: c.statusVisual, taskId: c.taskId, taskDueDate: c.taskDueDate ?? null, taskStartAt: c.taskStartAt ?? null, taskScheduleMode: c.taskScheduleMode ?? null, taskAssigneeName: c.taskAssigneeName ?? null, taskAssigneeId: (c as ApprovalCardMeta).taskAssigneeId ?? null, taskAssigneeAvatarUrl: c.taskAssigneeAvatarUrl ?? null, taskDescription: c.description ?? null, taskCompletedAt: c.taskCompletedAt ?? null, taskParentApprovalStatus: (c as ApprovalCardMeta).taskParentApprovalStatus ?? null, taskAttachmentCount: (c as ApprovalCardMeta).taskAttachmentCount ?? 0, taskSubtaskCount: (c as ApprovalCardMeta).taskSubtaskCount ?? 0, taskSubtaskCompletedCount: (c as ApprovalCardMeta).taskSubtaskCompletedCount ?? 0, taskCommentCount: (c as ApprovalCardMeta).taskCommentCount ?? 0, workspaceId, mapId, onOpen: handleOpenPanel, onAddChild: handleAddChildCard, onInlineUpdate: handleInlineUpdate, onEditingChange: handleEditingChange, onAutoFocusDone: handleAutoFocusDone, isTerminalNode, autoFocusTitle: shouldAutoFocus },
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
              return { ...n, data: mapApprovalCardToNodeData(s) };
            }
            const isTerminalNode = terminalNodeMap.get(n.id) === n.id;
            const hasPendingUpdate = pendingUpdatesRef.current.has(n.id);
            if (n.id === currentlyEditingId || hasPendingUpdate) {
              return { ...n, data: { ...n.data, isTerminalNode, workspaceId, mapId, onOpen: handleOpenPanel, onAddChild: handleAddChildCard, onInlineUpdate: handleInlineUpdate, onEditingChange: handleEditingChange, onAutoFocusDone: handleAutoFocusDone } };
            }
            return { ...n, data: { title: s.title, statusVisual: s.statusVisual, taskId: s.taskId, taskDueDate: s.taskDueDate ?? null, taskStartAt: s.taskStartAt ?? null, taskScheduleMode: s.taskScheduleMode ?? null, taskAssigneeName: s.taskAssigneeName ?? null, taskAssigneeId: (s as ApprovalCardMeta).taskAssigneeId ?? null, taskAssigneeAvatarUrl: s.taskAssigneeAvatarUrl ?? null, taskDescription: s.description ?? null, taskCompletedAt: s.taskCompletedAt ?? null, taskParentApprovalStatus: (s as ApprovalCardMeta).taskParentApprovalStatus ?? null, taskAttachmentCount: (s as ApprovalCardMeta).taskAttachmentCount ?? 0, taskSubtaskCount: (s as ApprovalCardMeta).taskSubtaskCount ?? 0, taskSubtaskCompletedCount: (s as ApprovalCardMeta).taskSubtaskCompletedCount ?? 0, taskCommentCount: (s as ApprovalCardMeta).taskCommentCount ?? 0, workspaceId, mapId, onOpen: handleOpenPanel, onAddChild: handleAddChildCard, onInlineUpdate: handleInlineUpdate, onEditingChange: handleEditingChange, onAutoFocusDone: handleAutoFocusDone, isTerminalNode } };
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

  // Track Alt key globally so the canvas can show a "copy" cursor over
  // draggable nodes, signaling that the next drag will duplicate.
  useEffect(() => {
    const handleAltDown = (e: KeyboardEvent) => {
      if (e.altKey) document.body.dataset.altKey = 'true';
    };
    const handleAltUp = (e: KeyboardEvent) => {
      if (!e.altKey) delete document.body.dataset.altKey;
    };
    const handleBlur = () => { delete document.body.dataset.altKey; };
    window.addEventListener('keydown', handleAltDown);
    window.addEventListener('keyup', handleAltUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleAltDown);
      window.removeEventListener('keyup', handleAltUp);
      window.removeEventListener('blur', handleBlur);
      delete document.body.dataset.altKey;
    };
  }, []);

  // Alt+drag duplication: clones the node at the drop position.
  // Tasks reuse the deep-duplicate endpoint (subtasks + approvers), then
  // override the card position. Shapes/texts copy all visual fields and
  // post a fresh element. Approval/join nodes are skipped silently.
  const duplicateNodeAtDrop = useCallback(
    (node: Node, dropPos: { x: number; y: number }) => {
      if (node.type === 'approvalnode' || node.type === 'joinnode') return;

      const mapDataWithText = mapDataRef.current as
        | (typeof mapDataRef.current & {
            textElements?: Array<{
              id: string;
              content: string;
              positionX: number;
              positionY: number;
              width: number;
              height: number;
              fontSize: number;
              color: string;
            }>;
            shapes?: ShapeResponse[];
          })
        | undefined;

      if (node.type === 'textnode') {
        const source = mapDataWithText?.textElements?.find(el => el.id === node.id);
        if (!source) return;
        createTextMut.mutate(
          {
            workspaceId,
            mapId,
            data: {
              positionX: dropPos.x,
              positionY: dropPos.y,
              width: source.width,
              height: source.height,
              fontSize: source.fontSize,
              color: source.color,
              content: source.content,
            },
          },
          {
            onSuccess: (newEl) => {
              const newNode: Node = {
                id: newEl.id,
                type: 'textnode',
                position: { x: newEl.positionX, y: newEl.positionY },
                zIndex: LAYER_TEXT,
                data: {
                  elementId: newEl.id,
                  content: newEl.content,
                  fontSize: newEl.fontSize,
                  color: newEl.color,
                  workspaceId,
                  mapId,
                  onDelete: handleDeleteTextNode,
                },
              };
              setNodes(prev => [...prev, newNode]);
              queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
            },
            onError: () => {
              toast({ title: 'Erro ao duplicar texto', variant: 'destructive' });
            },
          },
        );
        return;
      }

      if (node.type === 'shapenode') {
        const source = mapDataWithText?.shapes?.find(sh => sh.id === node.id);
        if (!source) return;
        const sourceAny = source as ShapeResponse & { attachmentId?: string | null };
        createShapeMut.mutate(
          {
            workspaceId,
            mapId,
            data: {
              type: source.type,
              positionX: dropPos.x,
              positionY: dropPos.y,
              width: source.width,
              height: source.height,
              rotation: source.rotation ?? 0,
              color: source.color,
              filled: source.filled,
              strokeStyle: source.strokeStyle,
              x1: source.x1 ?? null,
              y1: source.y1 ?? null,
              x2: source.x2 ?? null,
              y2: source.y2 ?? null,
              ...(sourceAny.attachmentId ? { attachmentId: sourceAny.attachmentId } : {}),
            } as Parameters<typeof createShapeMut.mutate>[0]['data'],
          },
          {
            onSuccess: (shape) => {
              const newNode = buildShapeNode(shape);
              setNodes(prev => [newNode, ...prev]);
              queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
            },
            onError: () => {
              toast({ title: 'Erro ao duplicar forma', variant: 'destructive' });
            },
          },
        );
        return;
      }

      // Mindmap card (task or plain card).
      const sourceCard = mapDataRef.current?.cards.find(c => c.id === node.id);
      if (!sourceCard) return;
      const taskId = (sourceCard as { taskId?: string | null }).taskId ?? null;

      if (!taskId) {
        // Plain card without a linked task — shallow copy.
        createCardMut.mutate(
          {
            workspaceId,
            mapId,
            data: {
              title: sourceCard.title,
              positionX: dropPos.x,
              positionY: dropPos.y,
            },
          },
          {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
            },
            onError: () => {
              toast({ title: 'Erro ao duplicar card', variant: 'destructive' });
            },
          },
        );
        return;
      }

      // Task card — deep duplicate via the existing endpoint, then override position.
      (async () => {
        try {
          const result = await customFetch<{ id: string; cardId?: string | null }>(
            `/api/workspaces/${workspaceId}/tasks/${taskId}/duplicate`,
            { method: 'POST' },
          );
          const newCardId = result.cardId ?? null;
          if (newCardId) {
            updateCardMut.mutate({
              workspaceId,
              mapId,
              cardId: newCardId,
              data: { positionX: dropPos.x, positionY: dropPos.y },
            });
          }
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks`] });
        } catch {
          toast({ title: 'Erro ao duplicar tarefa', variant: 'destructive' });
        }
      })();
    },
    [
      workspaceId,
      mapId,
      createCardMut,
      createTextMut,
      createShapeMut,
      updateCardMut,
      buildShapeNode,
      handleDeleteTextNode,
      setNodes,
      queryClient,
    ],
  );

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

      // Approval nodes use auto-derived positions and are not user-movable.
      if (node.type === 'approvalnode') return;

      // Join nodes are user-draggable (individually and in group selections),
      // but their position is derived from approval children and is not
      // persisted. The drag lifecycle (snapshot/undo) above still applies.
      if (node.type === 'joinnode') {
        // Still clear any edge highlight that may have been left over.
        if (highlightedEdgeIdRef.current) {
          setHighlightedEdgeId(null);
          setEdges(eds => eds.map(e => ({
            ...e,
            data: { ...e.data, highlighted: false },
          })));
        }
        return;
      }

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
        } else if (node.type === 'joinnode') {
          // Position is derived from approval children; do not persist.
        } else {
          updateCardMut.mutate({
            workspaceId, mapId, cardId: node.id,
            data: { positionX: node.position.x, positionY: node.position.y },
          });
        }
      });
    },
    [workspaceId, mapId, updateCardMut, updateTextMut, updateShapeMut, pushSnapshot],
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

  const clearDropTarget = useCallback(() => {
    if (dropTargetElRef.current) {
      dropTargetElRef.current.classList.remove('mindmap-drop-target');
      dropTargetElRef.current = null;
    }
  }, []);

  const stopConnectPointerTracking = useCallback(() => {
    if (connectPointerMoveRef.current) {
      window.removeEventListener('pointermove', connectPointerMoveRef.current);
      connectPointerMoveRef.current = null;
    }
    clearDropTarget();
  }, [clearDropTarget]);

  const onConnectStart = useCallback(
    (_event: React.MouseEvent | React.TouchEvent, params: { nodeId?: string | null; handleId?: string | null }) => {
      const nodeId = params.nodeId ?? '';
      const handleId = params.handleId ?? '';
      const isPlusSource = nodeId.startsWith('join-') || handleId === 'plus-right';
      connectingJoinNodeRef.current = isPlusSource ? nodeId : null;
      stopConnectPointerTracking();
      if (!isPlusSource) return;
      const fromNodeId = nodeId;
      const dbSourceId = fromNodeId.startsWith('join-') ? fromNodeId.slice('join-'.length) : fromNodeId;
      const handler = (ev: PointerEvent) => {
        const target = ev.target as Element | null;
        if (target?.closest('.react-flow__handle')) {
          clearDropTarget();
          return;
        }
        const nodeEl = target?.closest('[data-id]') as HTMLElement | null;
        const candidateId = nodeEl?.getAttribute('data-id') ?? null;
        if (!nodeEl || !candidateId || candidateId === fromNodeId || candidateId === dbSourceId) {
          clearDropTarget();
          return;
        }
        const candidate = nodesRef.current.find(n => n.id === candidateId);
        if (!candidate || candidate.type === 'approvalnode' || candidate.type === 'joinnode' || candidate.type === 'textnode' || candidate.type === 'shapenode') {
          clearDropTarget();
          return;
        }
        const alreadyConnected = edgesRef.current.some(e => e.source === dbSourceId && e.target === candidateId);
        if (alreadyConnected) {
          clearDropTarget();
          return;
        }
        if (dropTargetElRef.current === nodeEl) return;
        clearDropTarget();
        nodeEl.classList.add('mindmap-drop-target');
        dropTargetElRef.current = nodeEl;
      };
      connectPointerMoveRef.current = handler;
      window.addEventListener('pointermove', handler);
    },
    [stopConnectPointerTracking, clearDropTarget],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const fromNodeId = connectingJoinNodeRef.current;
      connectingJoinNodeRef.current = null;
      stopConnectPointerTracking();
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

  const { peers: presencePeers, sendCursor: sendPresenceCursor } = usePresenceChannel(mapId);

  useEffect(() => {
    const el = reactFlowRef.current;
    if (!el) return;
    const handleMove = (e: MouseEvent) => {
      const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      sendPresenceCursor(flow.x, flow.y);
    };
    el.addEventListener('mousemove', handleMove);
    return () => el.removeEventListener('mousemove', handleMove);
  }, [screenToFlowPosition, sendPresenceCursor]);

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

  // Latest-value refs so the alt-drag effect can stay mounted once and still
  // reach updated callback identities without re-attaching every render.
  const getViewportRef = useRef(getViewport);
  getViewportRef.current = getViewport;
  const setViewportRef = useRef(setViewport);
  setViewportRef.current = setViewport;
  const duplicateNodeAtDropRef = useRef(duplicateNodeAtDrop);
  duplicateNodeAtDropRef.current = duplicateNodeAtDrop;

  // Alt+drag duplication: intercept mousedown in capture phase so React Flow
  // never starts its own drag. Render dashed-outline "ghost" placeholders that
  // follow the cursor; on mouseup, duplicate each node at the dropped flow
  // position (preserving relative offsets for multi-selection). The move/up
  // listeners are attached imperatively inside the mousedown handler — no
  // useEffect timing race.
  //
  // Attached at the document level (not reactFlowRef.current) so the listener
  // is wired up on the first mount of CanvasInner, even while the canvas is
  // still rendering its loading state and the wrapper div doesn't exist yet.
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (!event.altKey) return;
      if (event.button !== 0) return;
      const target = event.target as Element | null;
      const nodeEl = target?.closest('.react-flow__node') as HTMLElement | null;
      if (!nodeEl) return;
      const clickedId = nodeEl.getAttribute('data-id');
      if (!clickedId) return;

      const clickedNode = nodesRef.current.find(n => n.id === clickedId);
      if (!clickedNode) return;
      if (clickedNode.type === 'approvalnode' || clickedNode.type === 'joinnode') return;

      // If the clicked node is in the current selection, drag the whole
      // selection; otherwise drag only the clicked node. Approval/join
      // nodes are always filtered out.
      const isClickedSelected = clickedNode.selected === true;
      const targets = (
        isClickedSelected
          ? nodesRef.current.filter(n => n.selected === true)
          : [clickedNode]
      ).filter(n => n.type !== 'approvalnode' && n.type !== 'joinnode');
      if (targets.length === 0) return;

      // Block React Flow's d3-drag and the sibling snapshot listener.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const startCursor = { x: event.clientX, y: event.clientY };

      const ghostDescriptors = targets.map(n => {
        const domEl = document.querySelector(`.react-flow__node[data-id="${n.id}"]`) as HTMLElement | null;
        const rect = domEl?.getBoundingClientRect();
        const width = rect?.width ?? 200;
        const height = rect?.height ?? 80;
        const dx = (rect?.left ?? startCursor.x) - startCursor.x;
        const dy = (rect?.top ?? startCursor.y) - startCursor.y;
        const shapeData = n.type === 'shapenode'
          ? (n.data as { type?: 'rect' | 'ellipse' | 'line' | 'image'; width?: number; height?: number; x1?: number | null; y1?: number | null; x2?: number | null; y2?: number | null })
          : null;
        const shapeKind = shapeData?.type;
        let lineCoords: { x1: number; y1: number; x2: number; y2: number } | undefined;
        if (
          shapeKind === 'line' &&
          shapeData?.width && shapeData.width > 0 &&
          shapeData.height && shapeData.height > 0 &&
          shapeData.x1 != null && shapeData.y1 != null &&
          shapeData.x2 != null && shapeData.y2 != null
        ) {
          // Endpoints are stored in flow units (relative to the shape's flow
          // bbox); scale to the screen-px ghost size.
          const sx = width / shapeData.width;
          const sy = height / shapeData.height;
          lineCoords = {
            x1: shapeData.x1 * sx,
            y1: shapeData.y1 * sy,
            x2: shapeData.x2 * sx,
            y2: shapeData.y2 * sy,
          };
        }
        return { nodeId: n.id, dx, dy, width, height, shapeKind, lineCoords };
      });

      // Snapshot of the source nodes — closed over by the handlers below so
      // we don't depend on state by the time mouseup fires.
      const dragData = {
        startCursor,
        nodes: targets.map(n => ({
          node: n,
          flowOriginX: n.position.x,
          flowOriginY: n.position.y,
        })),
      };

      setAltDrag({ cursor: startCursor, ghosts: ghostDescriptors });

      const handleMove = (ev: MouseEvent) => {
        setAltDrag(s => (s ? { ...s, cursor: { x: ev.clientX, y: ev.clientY } } : s));
      };

      const cleanup = () => {
        document.removeEventListener('mousemove', handleMove, true);
        document.removeEventListener('mouseup', handleUp, true);
        document.removeEventListener('keydown', handleEscape, true);
        setAltDrag(null);
      };

      const handleUp = (ev: MouseEvent) => {
        cleanup();
        const dxScreen = ev.clientX - dragData.startCursor.x;
        const dyScreen = ev.clientY - dragData.startCursor.y;
        const zoom = getViewportRef.current().zoom || 1;
        const dxFlow = dxScreen / zoom;
        const dyFlow = dyScreen / zoom;
        dragData.nodes.forEach(({ node, flowOriginX, flowOriginY }) => {
          duplicateNodeAtDropRef.current(node, {
            x: flowOriginX + dxFlow,
            y: flowOriginY + dyFlow,
          });
        });
      };

      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') cleanup();
      };

      // Capture-phase document listeners — guaranteed to run before any other
      // mousemove/mouseup logic the page might have (e.g. shape drawing).
      document.addEventListener('mousemove', handleMove, true);
      document.addEventListener('mouseup', handleUp, true);
      document.addEventListener('keydown', handleEscape, true);
    };

    document.addEventListener('mousedown', handleMouseDown, { capture: true });
    return () => document.removeEventListener('mousedown', handleMouseDown, { capture: true });
  }, []);

  // Right-button drag panning over nodes/edges. React Flow's panOnDrag={[2]}
  // already handles right-drag on the empty pane; this extends it so the user
  // can start the drag with the cursor over any element (card, text, shape,
  // edge) and still pan the whole map. We track deltas at the document level
  // and apply them directly via setViewport.
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 2) return;
      const target = event.target as Element | null;
      if (!target) return;
      // Only intercept when the right-click starts on an element. Pane drags
      // already work natively — letting React Flow keep handling them avoids
      // double-handling and preserves selection-box behavior.
      const onElement = target.closest('.react-flow__node, .react-flow__edge');
      if (!onElement) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      let lastX = event.clientX;
      let lastY = event.clientY;
      let moved = false;
      const previousBodyCursor = document.body.style.cursor;
      document.body.style.cursor = 'grabbing';

      const handleMove = (ev: MouseEvent) => {
        const dx = ev.clientX - lastX;
        const dy = ev.clientY - lastY;
        lastX = ev.clientX;
        lastY = ev.clientY;
        if (dx !== 0 || dy !== 0) moved = true;
        const vp = getViewportRef.current();
        setViewportRef.current({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom });
      };

      const handleUp = () => {
        document.removeEventListener('mousemove', handleMove, true);
        document.removeEventListener('mouseup', handleUp, true);
        document.body.style.cursor = previousBodyCursor;
        // If the user actually dragged, swallow the contextmenu that fires
        // after a right-drag (it would otherwise pop up at the release point).
        // A pure right-click without movement is left alone — the existing
        // pane onContextMenu handler still prevents it elsewhere.
        if (moved) {
          const swallow = (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            document.removeEventListener('contextmenu', swallow, true);
          };
          document.addEventListener('contextmenu', swallow, { capture: true, once: true });
        }
      };

      document.addEventListener('mousemove', handleMove, true);
      document.addEventListener('mouseup', handleUp, true);
    };

    document.addEventListener('mousedown', handleMouseDown, { capture: true });
    return () => document.removeEventListener('mousedown', handleMouseDown, { capture: true });
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
            zIndex: LAYER_TEXT,
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

  const insertImageFromFile = useCallback(async (file: File, dropFlowPos?: { x: number; y: number }) => {
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Tipo de arquivo inválido', description: 'Selecione uma imagem.', variant: 'destructive' });
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast({ title: 'Arquivo muito grande', description: 'O limite é de 50 MB.', variant: 'destructive' });
      return;
    }

    setImageUploading(true);
    try {
      const uploadResult = await uploadFile(file, {
        bucket: 'attachments',
        entityKind: 'map',
        entityId: mapId,
      });
      if (!uploadResult) {
        toast({
          title: 'Falha no upload',
          description: 'Não foi possível enviar a imagem para o storage.',
          variant: 'destructive',
        });
        return;
      }
      const attachmentId = uploadResult.attachmentId;

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('read fail'));
        reader.readAsDataURL(file);
      });
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new window.Image();
        img.onload = () => resolve({ w: img.naturalWidth || 320, h: img.naturalHeight || 240 });
        img.onerror = () => resolve({ w: 320, h: 240 });
        img.src = dataUrl;
      });
      const maxDim = 400;
      let w = dims.w;
      let h = dims.h;
      if (w > maxDim || h > maxDim) {
        const scale = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      let posX: number;
      let posY: number;
      if (dropFlowPos) {
        posX = dropFlowPos.x - w / 2;
        posY = dropFlowPos.y - h / 2;
      } else {
        const vp = getViewport();
        const reactFlowEl = reactFlowRef.current;
        const rect = reactFlowEl?.getBoundingClientRect();
        const centerScreenX = (rect?.left ?? 0) + (rect?.width ?? window.innerWidth) / 2;
        const centerScreenY = (rect?.top ?? 0) + (rect?.height ?? window.innerHeight) / 2;
        const center = screenToFlowPosition({ x: centerScreenX, y: centerScreenY });
        posX = center.x - w / 2;
        posY = center.y - h / 2;
        void vp;
      }

      createShapeMut.mutate(
        { workspaceId, mapId, data: { type: 'image', positionX: posX, positionY: posY, width: w, height: h, attachmentId } },
        {
          onSuccess: (shape) => {
            const newNode = buildShapeNode(shape);
            setNodes(prev => [newNode, ...prev]);
            queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          },
          onError: () => {
            toast({ title: 'Falha ao inserir imagem', description: 'Não foi possível adicionar a imagem ao mapa.', variant: 'destructive' });
          },
        },
      );
    } finally {
      setImageUploading(false);
    }
  }, [workspaceId, mapId, createShapeMut, buildShapeNode, setNodes, queryClient, screenToFlowPosition, getViewport, uploadFile]);

  const handleImageButtonClick = useCallback(() => {
    imageFileInputRef.current?.click();
  }, []);

  const insertImagesFromFiles = useCallback(async (files: File[], dropFlowPos?: { x: number; y: number }) => {
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      toast({ title: 'Tipo de arquivo inválido', description: 'Solte apenas imagens.', variant: 'destructive' });
      return;
    }
    if (imageFiles.length === 1 || !dropFlowPos) {
      for (const file of imageFiles) {
        await insertImageFromFile(file, dropFlowPos);
      }
      return;
    }

    const MAX_DIM = 400;
    const FALLBACK_W = 320;
    const measuredWidths = await Promise.all(imageFiles.map(file => new Promise<number>((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new window.Image();
      img.onload = () => {
        let w = img.naturalWidth || FALLBACK_W;
        const h = img.naturalHeight || w;
        if (w > MAX_DIM || h > MAX_DIM) {
          const scale = Math.min(MAX_DIM / w, MAX_DIM / h);
          w = Math.round(w * scale);
        }
        URL.revokeObjectURL(url);
        resolve(w);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(FALLBACK_W);
      };
      img.src = url;
    })));

    const GAP = 16;
    const totalW = measuredWidths.reduce((s, w) => s + w, 0) + GAP * (imageFiles.length - 1);
    let cursorX = dropFlowPos.x - totalW / 2;
    for (let i = 0; i < imageFiles.length; i++) {
      const w = measuredWidths[i];
      const centerX = cursorX + w / 2;
      await insertImageFromFile(imageFiles[i], { x: centerX, y: dropFlowPos.y });
      cursorX += w + GAP;
    }
  }, [insertImageFromFile]);

  const [isImageDragOver, setIsImageDragOver] = useState(false);
  const imageDragCounterRef = useRef(0);

  const handleCanvasDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    imageDragCounterRef.current += 1;
    setIsImageDragOver(true);
  }, []);

  const handleCanvasDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleCanvasDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    imageDragCounterRef.current = Math.max(0, imageDragCounterRef.current - 1);
    if (imageDragCounterRef.current === 0) setIsImageDragOver(false);
  }, []);

  const handleCanvasDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    imageDragCounterRef.current = 0;
    setIsImageDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    let flowPos: { x: number; y: number } | undefined;
    try {
      flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    } catch {
      flowPos = undefined;
    }
    void insertImagesFromFiles(files, flowPos);
  }, [insertImagesFromFiles, screenToFlowPosition]);

  const handleImageFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void insertImageFromFile(file);
  }, [insertImageFromFile]);

  // Track last mouse position over the canvas so paste lands at the cursor.
  useEffect(() => {
    const el = reactFlowRef.current;
    if (!el) return;
    const onMove = (ev: MouseEvent) => {
      try {
        lastMouseFlowPosRef.current = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      } catch {
        // ignore until ReactFlow is ready
      }
    };
    const onLeave = () => {
      lastMouseFlowPosRef.current = null;
    };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, [screenToFlowPosition]);

  // Ctrl+V paste image (lands at cursor when available, otherwise center)
  useEffect(() => {
    const onPaste = (ev: ClipboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const items = ev.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            ev.preventDefault();
            const cursorPos = lastMouseFlowPosRef.current ?? undefined;
            void insertImageFromFile(file, cursorPos);
            return;
          }
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [insertImageFromFile]);

  // Ctrl+C copy selected image to clipboard
  useEffect(() => {
    const onCopy = async (ev: ClipboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const selectedImage = nodesRef.current.find(n => n.selected && n.type === 'shapenode' && n.data?.type === 'image');
      if (!selectedImage) return;
      const downloadUrl = (selectedImage.data as { downloadUrl?: string | null }).downloadUrl;
      if (!downloadUrl) return;
      ev.preventDefault();
      try {
        const res = await fetch(downloadUrl, { credentials: 'include' });
        if (!res.ok) return;
        const blob = await res.blob();
        const mime = blob.type || 'image/png';
        if (typeof window.ClipboardItem === 'undefined' || !navigator.clipboard?.write) return;
        await navigator.clipboard.write([
          new window.ClipboardItem({ [mime]: blob }),
        ]);
      } catch {
        // ignored
      }
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
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
          <div className="bg-background px-4 py-2 rounded-xl border border-border/60 shadow-md">
            <PageBreadcrumb
              items={[
                { label: (canvasWorkspace?.name ?? "espaço").toLowerCase(), href: `/workspaces/${workspaceId}` },
                { label: mapData.name.toLowerCase() },
              ]}
            />
          </div>
        </div>

        <CanvasDrawGhosts textGhost={textGhost} shapeGhost={shapeGhost} shapeTool={shapeTool} />

        {cardGhost && (
          <div
            className="pointer-events-none fixed z-overlay border-2 border-dashed border-primary bg-primary/10 rounded-xl"
            style={{ left: cardGhost.x - 90, top: cardGhost.y - 36, width: 180, height: 72 }}
          />
        )}

        {altDrag && altDrag.ghosts.map(g => {
          const left = altDrag.cursor.x + g.dx;
          const top = altDrag.cursor.y + g.dy;
          if (g.shapeKind === 'ellipse') {
            return (
              <svg
                key={g.nodeId}
                className="pointer-events-none fixed z-overlay"
                style={{ left, top, width: g.width, height: g.height, overflow: 'visible' }}
                width={g.width}
                height={g.height}
              >
                <ellipse
                  cx={g.width / 2}
                  cy={g.height / 2}
                  rx={Math.max(g.width / 2 - 1, 1)}
                  ry={Math.max(g.height / 2 - 1, 1)}
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  fill="hsl(var(--primary) / 0.1)"
                />
              </svg>
            );
          }
          if (g.shapeKind === 'line' && g.lineCoords) {
            return (
              <svg
                key={g.nodeId}
                className="pointer-events-none fixed z-overlay"
                style={{ left, top, width: g.width, height: g.height, overflow: 'visible' }}
                width={g.width}
                height={g.height}
              >
                <line
                  x1={g.lineCoords.x1}
                  y1={g.lineCoords.y1}
                  x2={g.lineCoords.x2}
                  y2={g.lineCoords.y2}
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeDasharray="6 4"
                />
              </svg>
            );
          }
          return (
            <div
              key={g.nodeId}
              className="pointer-events-none fixed z-overlay border-2 border-dashed border-primary bg-primary/10 rounded-xl"
              style={{ left, top, width: g.width, height: g.height }}
            />
          );
        })}

        <CanvasToolbar>
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
          <input
            ref={imageFileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageFileChange}
          />
          <Button
            onClick={handleImageButtonClick}
            disabled={imageUploading || createShapeMut.isPending}
            variant="outline"
            title="Inserir imagem (clique ou cole com Ctrl+V)"
            className="rounded-xl h-10 px-5 shadow-md bg-background border-border/60 select-none cursor-pointer"
          >
            {imageUploading
              ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              : <Image className="w-4 h-4 mr-2" />}
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
        </CanvasToolbar>

        {shapeTool && (
          <div
            className="absolute inset-0 z-20"
            style={{ cursor: 'crosshair' }}
            onMouseDown={handleShapeDrawMouseDown}
            onMouseMove={handleShapeDrawMouseMove}
            onMouseUp={handleShapeDrawMouseUp}
          />
        )}

        <div
          ref={reactFlowRef}
          className="flex-1 w-full h-full relative"
          onDragEnter={handleCanvasDragEnter}
          onDragOver={handleCanvasDragOver}
          onDragLeave={handleCanvasDragLeave}
          onDrop={handleCanvasDrop}
        >
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
            elevateNodesOnSelect={false}
            elevateEdgesOnSelect={false}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
            maxZoom={2.5}
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
            <CanvasControls />
            <PresenceCursorsOverlay peers={presencePeers} />
          </ReactFlow>
          {isImageDragOver && (
            <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/10">
              <div className="flex flex-col items-center gap-2 text-primary">
                <Image className="w-8 h-8" />
                <p className="text-sm font-semibold lowercase">solte para adicionar imagem</p>
              </div>
            </div>
          )}
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
