import { useState, useCallback, useEffect, useRef } from "react";
import { useRoute } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { ReactFlow, Controls, Background, useNodesState, useEdgesState, addEdge, Connection, Edge, Node, BackgroundVariant, ReactFlowProvider, EdgeChange, ConnectionMode } from 'reactflow';
import 'reactflow/dist/style.css';
import MindMapNode from "@/components/maps/MindMapNode";
import DeletableEdge from "@/components/maps/DeletableEdge";
import { CardPanel } from "@/components/maps/CardPanel";
import { useGetMap, useUpdateCard, useCreateCard, useCreateConnection, useDeleteConnection, useDeleteCard, customFetch, CreateConnectionRequest } from "@workspace/api-client-react";
import { Loader2, ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

interface CreateConnectionRequestWithHandles extends CreateConnectionRequest {
  sourceHandle?: string;
  targetHandle?: string;
}

const nodeTypes = { mindmap: MindMapNode };
const edgeTypes = { deletable: DeletableEdge };

const INACTIVE_STATUSES = new Set(['blocked', 'pending']);

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
  const { data: mapData, isLoading } = useGetMap(workspaceId, mapId, {
    query: { refetchInterval: 3000 },
  });
  const editingCardIdRef = useRef<string | null>(null);
  const pendingUpdatesRef = useRef<Map<string, number>>(new Map());

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [highlightedEdgeId, setHighlightedEdgeId] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

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
    setNodes(prev => prev.map(n =>
      n.id === cardId
        ? { ...n, data: { ...n.data, ...patch } }
        : n,
    ));
  }, [setNodes]);

  const handleEditingChange = useCallback((cardId: string, isEditing: boolean) => {
    editingCardIdRef.current = isEditing ? cardId : null;
  }, []);

  useEffect(() => {
    if (!mapData) return;

    if (!initializedRef.current) {
      const initialNodes: Node[] = mapData.cards.map(c => ({
        id: c.id,
        type: 'mindmap',
        position: { x: c.positionX, y: c.positionY },
        data: { title: c.title, statusVisual: c.statusVisual, taskId: c.taskId, taskDueDate: c.taskDueDate ?? null, taskAssigneeName: c.taskAssigneeName ?? null, taskAssigneeAvatarUrl: c.taskAssigneeAvatarUrl ?? null, taskDescription: c.description ?? null, workspaceId, mapId, onOpen: handleOpenPanel, onAddChild: handleAddChildCard, onInlineUpdate: handleInlineUpdate, onEditingChange: handleEditingChange },
      }));
      setNodes(initialNodes);

      const initialEdges: Edge[] = mapData.connections.map(c => buildEdgeFromConn(c, mapData.cards));
      setEdges(initialEdges);
      initializedRef.current = true;
    } else {
      setNodes(prev => {
        const serverIds = new Set(mapData.cards.map(c => c.id));
        const filtered = prev.filter(n => serverIds.has(n.id));
        const existingIds = new Set(filtered.map(n => n.id));
        const newNodes: Node[] = mapData.cards
          .filter(c => !existingIds.has(c.id))
          .map(c => ({
            id: c.id,
            type: 'mindmap',
            position: { x: c.positionX, y: c.positionY },
            data: { title: c.title, statusVisual: c.statusVisual, taskId: c.taskId, taskDueDate: c.taskDueDate ?? null, taskAssigneeName: c.taskAssigneeName ?? null, taskAssigneeAvatarUrl: c.taskAssigneeAvatarUrl ?? null, taskDescription: c.description ?? null, workspaceId, mapId, onOpen: handleOpenPanel, onAddChild: handleAddChildCard, onInlineUpdate: handleInlineUpdate, onEditingChange: handleEditingChange },
          }));
        const currentlyEditingId = editingCardIdRef.current;
        const now = Date.now();
        const PENDING_GUARD_MS = 5000;
        pendingUpdatesRef.current.forEach((ts, id) => {
          if (now - ts > PENDING_GUARD_MS) pendingUpdatesRef.current.delete(id);
        });
        return [
          ...filtered.map(n => {
            const s = mapData.cards.find(c => c.id === n.id);
            if (!s) return n;
            const hasPendingUpdate = pendingUpdatesRef.current.has(n.id);
            if (n.id === currentlyEditingId || hasPendingUpdate) {
              return { ...n, data: { ...n.data, workspaceId, mapId, onOpen: handleOpenPanel, onAddChild: handleAddChildCard, onInlineUpdate: handleInlineUpdate, onEditingChange: handleEditingChange } };
            }
            return { ...n, data: { title: s.title, statusVisual: s.statusVisual, taskId: s.taskId, taskDueDate: s.taskDueDate ?? null, taskAssigneeName: s.taskAssigneeName ?? null, taskAssigneeAvatarUrl: s.taskAssigneeAvatarUrl ?? null, taskDescription: s.description ?? null, workspaceId, mapId, onOpen: handleOpenPanel, onAddChild: handleAddChildCard, onInlineUpdate: handleInlineUpdate, onEditingChange: handleEditingChange } };
          }),
          ...newNodes,
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
        const newEdges: Edge[] = mapData.connections
          .filter(c => !existingIds.has(c.id) && !tempPairs.has(`${c.sourceCardId}__${c.targetCardId}`))
          .map(c => buildEdgeFromConn(c, mapData.cards));
        const updatedFiltered = filtered.map(e => {
          if (e.id.startsWith('temp-')) return e;
          const animated = isEdgeAnimated(e.source, e.target, mapData.cards);
          return { ...e, animated, style: edgeStyle(animated) };
        });
        return [...updatedFiltered, ...newEdges];
      });
    }
  }, [mapData]);

  const updateCardMut = useUpdateCard();
  const createConnMut = useCreateConnection();
  const deleteConnMut = useDeleteConnection();
  const createCardMut = useCreateCard();

  const handleAddChildCard = useCallback((parentCardId: string) => {
    const parentNode = nodesRef.current.find(n => n.id === parentCardId);
    const newX = parentNode ? parentNode.position.x + 350 : 200;
    const newY = parentNode ? parentNode.position.y : 200;
    createCardMut.mutate(
      { workspaceId, mapId, data: { title: "Novo Nó", positionX: newX, positionY: newY } },
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
          setSelectedCardId(newCard.id);
        },
      }
    );
  }, [workspaceId, mapId, createCardMut, createConnMut, queryClient]);

  const onNodeDrag = useCallback(
    (_event: React.MouseEvent, node: Node) => {
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

        const sourceNode = currentNodes.find(n => n.id === edge.source);
        const targetNode = currentNodes.find(n => n.id === edge.target);
        if (!sourceNode || !targetNode) continue;

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
      // Always save position
      updateCardMut.mutate({
        workspaceId, mapId, cardId: node.id,
        data: { positionX: node.position.x, positionY: node.position.y },
      });

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
    [workspaceId, mapId, updateCardMut, highlightedEdgeId, deleteConnMut, createConnMut, queryClient, mapData],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;

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

      createConnMut.mutate(
        {
          workspaceId, mapId,
          data: { sourceCardId: sourceNodeId, targetCardId: targetNodeId, sourceHandle: 'source-right', targetHandle: 'target-left' } as CreateConnectionRequestWithHandles,
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

  const onEdgesChangeWithDelete = useCallback(
    (changes: EdgeChange[]) => {
      const removals = changes.filter(c => c.type === 'remove');
      removals.forEach(change => {
        if (change.type === 'remove' && !change.id.startsWith('temp-')) {
          deleteConnMut.mutate({ workspaceId, mapId, connectionId: change.id });
        }
      });
      onEdgesChange(changes);
    },
    [onEdgesChange, deleteConnMut, workspaceId, mapId],
  );

  const handleAddCard = useCallback(() => {
    const centerX = 200 + Math.random() * 200;
    const centerY = 200 + Math.random() * 200;
    createCardMut.mutate(
      { workspaceId, mapId, data: { title: "Novo Nó", positionX: centerX, positionY: centerY } },
      {
        onSuccess: (newCard) => {
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          setSelectedCardId(newCard.id);
        },
      },
    );
  }, [workspaceId, mapId, createCardMut, queryClient]);


  const onPaneClick = useCallback(() => {
    setSelectedCardId(null);
  }, []);

  const deleteCardMut = useDeleteCard();
  const handleDeleteCard = useCallback((cardId: string) => {
    setNodes(prev => prev.filter(n => n.id !== cardId));
    setEdges(prev => prev.filter(e => e.source !== cardId && e.target !== cardId));
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

        <div className="absolute top-4 right-4 z-10">
          <Button onClick={handleAddCard} disabled={createCardMut.isPending} className="rounded-xl h-10 px-5 shadow-lg shadow-primary/20">
            {createCardMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            <span className="lowercase">Adicionar Nó</span>
          </Button>
        </div>

        <div className="absolute bottom-4 left-4 z-10">
          <p className="text-xs text-muted-foreground bg-background/80 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-border/40 shadow-sm">
            <span className="lowercase">Passe o mouse e clique no lápis para editar • Arraste para conectar • Clique na ligação para removê-la</span>
          </p>
        </div>

        <div className="flex-1 w-full h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChangeWithDelete}
            onConnect={onConnect}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            connectionMode={ConnectionMode.Loose}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            onNodesDelete={(deletedNodes) => {
              deletedNodes.forEach(n => handleDeleteCard(n.id));
            }}
            deleteKeyCode="Delete"
            className="w-full h-full"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="hsl(var(--muted-foreground) / 0.15)" />
            <Controls className="bg-card border border-border shadow-md rounded-xl overflow-hidden" />
          </ReactFlow>
        </div>
      </div>

      <CardPanel
        workspaceId={workspaceId}
        mapId={mapId}
        cardId={selectedCardId}
        onClose={() => setSelectedCardId(null)}
        onDeleteCard={handleDeleteCard}
      />
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
