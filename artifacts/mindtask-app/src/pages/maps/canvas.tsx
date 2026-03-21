import { useState, useCallback, useEffect, useRef } from "react";
import { useRoute } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { ReactFlow, Controls, Background, useNodesState, useEdgesState, addEdge, Connection, Edge, Node, BackgroundVariant, ReactFlowProvider, EdgeChange, ConnectionMode } from 'reactflow';
import 'reactflow/dist/style.css';
import MindMapNode from "@/components/maps/MindMapNode";
import DeletableEdge from "@/components/maps/DeletableEdge";
import { CardPanel } from "@/components/maps/CardPanel";
import { useGetMap, useUpdateCard, useCreateCard, useCreateConnection, useDeleteConnection, customFetch } from "@workspace/api-client-react";
import { Loader2, ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

const nodeTypes = { mindmap: MindMapNode };
const edgeTypes = { deletable: DeletableEdge };

const INACTIVE_STATUSES = new Set(['blocked', 'pending']);

const EDGE_BASE = {
  type: 'deletable' as const,
};

const EDGE_STYLE_ACTIVE = { strokeWidth: 2, stroke: 'hsl(var(--primary))' };
const EDGE_STYLE_INACTIVE = { strokeWidth: 2, stroke: '#4b5563', strokeDasharray: '5 5' };

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
  };
}

function CanvasInner({ workspaceId, mapId }: { workspaceId: string; mapId: string }) {
  const queryClient = useQueryClient();
  const { data: mapData, isLoading } = useGetMap(workspaceId, mapId);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const nodesRef = useRef<Node[]>([]);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

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

  useEffect(() => {
    if (!mapData) return;

    if (!initializedRef.current) {
      const initialNodes: Node[] = mapData.cards.map(c => ({
        id: c.id,
        type: 'mindmap',
        position: { x: c.positionX, y: c.positionY },
        data: { title: c.title, statusVisual: c.statusVisual, taskId: c.taskId, taskDueDate: (c as any).taskDueDate ?? null, taskAssigneeName: (c as any).taskAssigneeName ?? null, onOpen: handleOpenPanel, onAddChild: handleAddChildCard },
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
            data: { title: c.title, statusVisual: c.statusVisual, taskId: c.taskId, taskDueDate: (c as any).taskDueDate ?? null, taskAssigneeName: (c as any).taskAssigneeName ?? null, onOpen: handleOpenPanel, onAddChild: handleAddChildCard },
          }));
        return [
          ...filtered.map(n => {
            const s = mapData.cards.find(c => c.id === n.id);
            if (!s) return n;
            return { ...n, data: { title: s.title, statusVisual: s.statusVisual, taskId: s.taskId, taskDueDate: (s as any).taskDueDate ?? null, taskAssigneeName: (s as any).taskAssigneeName ?? null, onOpen: handleOpenPanel, onAddChild: handleAddChildCard } };
          }),
          ...newNodes,
        ];
      });

      setEdges(prev => {
        const serverIds = new Set(mapData.connections.map(c => c.id));
        const filtered = prev.filter(e => serverIds.has(e.id) || e.id.startsWith('temp-'));
        const existingIds = new Set(filtered.map(e => e.id));
        const newEdges: Edge[] = mapData.connections
          .filter(c => !existingIds.has(c.id))
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
            { workspaceId, mapId, data: { sourceCardId: parentCardId, targetCardId: newCard.id, sourceHandle: 'source-right', targetHandle: 'target-left' } as any },
            { onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] }) }
          );
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          setSelectedCardId(newCard.id);
        },
      }
    );
  }, [workspaceId, mapId, createCardMut, createConnMut, queryClient]);

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      updateCardMut.mutate({
        workspaceId, mapId, cardId: node.id,
        data: { positionX: node.position.x, positionY: node.position.y },
      });
    },
    [workspaceId, mapId, updateCardMut],
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
      };
      setEdges((eds) => addEdge(newEdge, eds));

      createConnMut.mutate(
        {
          workspaceId, mapId,
          data: { sourceCardId: sourceNodeId, targetCardId: targetNodeId, sourceHandle: 'source-right', targetHandle: 'target-left' } as any,
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
            Adicionar Nó
          </Button>
        </div>

        <div className="absolute bottom-4 left-4 z-10">
          <p className="text-xs text-muted-foreground bg-background/80 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-border/40 shadow-sm">
            Passe o mouse e clique no lápis para editar • Arraste para conectar • Clique na ligação para removê-la
          </p>
        </div>

        <div className="flex-1 w-full h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChangeWithDelete}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            connectionMode={ConnectionMode.Loose}
            fitView
            fitViewOptions={{ padding: 0.2 }}
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
