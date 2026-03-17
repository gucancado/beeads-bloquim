import { useState, useCallback, useEffect } from "react";
import { useRoute } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { ReactFlow, Controls, Background, useNodesState, useEdgesState, addEdge, Connection, Edge, Node, BackgroundVariant, Panel } from 'reactflow';
import MindMapNode from "@/components/maps/MindMapNode";
import { CardPanel } from "@/components/maps/CardPanel";
import { useGetMap, useUpdateCard, useCreateCard, useCreateConnection, useDeleteConnection } from "@workspace/api-client-react";
import { Loader2, ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

const nodeTypes = {
  mindmap: MindMapNode,
};

export default function CanvasPage() {
  const [, params] = useRoute("/workspaces/:wsId/maps/:mapId");
  const workspaceId = params?.wsId || "";
  const mapId = params?.mapId || "";
  const queryClient = useQueryClient();

  const { data: mapData, isLoading } = useGetMap(workspaceId, mapId);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // Sync server data to ReactFlow state once when loaded
  useEffect(() => {
    if (mapData) {
      const initialNodes: Node[] = mapData.cards.map(c => ({
        id: c.id,
        type: 'mindmap',
        position: { x: c.positionX, y: c.positionY },
        data: { 
          title: c.title, 
          description: c.description, 
          statusVisual: c.statusVisual, 
          taskId: c.taskId 
        }
      }));
      setNodes(initialNodes);

      const initialEdges: Edge[] = mapData.connections.map(c => ({
        id: c.id,
        source: c.sourceCardId,
        target: c.targetCardId,
        animated: true,
        style: { strokeWidth: 2 }
      }));
      setEdges(initialEdges);
    }
  }, [mapData, setNodes, setEdges]);

  const updateCardMut = useUpdateCard();
  const createConnMut = useCreateConnection();
  const createCardMut = useCreateCard();

  const onNodeDragStop = useCallback(
    (event: React.MouseEvent, node: Node) => {
      updateCardMut.mutate({
        workspaceId,
        mapId,
        cardId: node.id,
        data: { positionX: node.position.x, positionY: node.position.y }
      });
    },
    [workspaceId, mapId, updateCardMut]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      
      // Optimistic update
      const newEdge: Edge = { id: `temp-${Date.now()}`, source: params.source, target: params.target, animated: true };
      setEdges((eds) => addEdge(newEdge, eds));
      
      // API Call
      createConnMut.mutate(
        { workspaceId, mapId, data: { sourceCardId: params.source, targetCardId: params.target } },
        {
          onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] }),
          onError: () => setEdges((eds) => eds.filter(e => e.id !== newEdge.id)) // Revert on fail
        }
      );
    },
    [setEdges, createConnMut, workspaceId, mapId, queryClient]
  );

  const handleAddCard = useCallback(() => {
    // Add in center roughly
    createCardMut.mutate(
      { workspaceId, mapId, data: { title: "New Node", positionX: 250, positionY: 250 } },
      {
        onSuccess: (newCard) => {
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
          setSelectedCardId(newCard.id); // Open panel immediately
        }
      }
    );
  }, [workspaceId, mapId, createCardMut, queryClient]);

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    setSelectedCardId(node.id);
  }, []);

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
      <div className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-950 relative">
        <div className="absolute top-4 left-4 z-10 flex items-center gap-4">
          <Link href={`/workspaces/${workspaceId}`}>
            <Button variant="outline" size="icon" className="rounded-xl h-10 w-10 bg-background shadow-md">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="bg-background px-5 py-2 rounded-xl border shadow-md">
            <h2 className="font-display font-bold text-foreground text-lg">{mapData.name}</h2>
          </div>
        </div>

        <div className="absolute top-4 right-4 z-10">
          <Button onClick={handleAddCard} disabled={createCardMut.isPending} className="rounded-xl h-10 px-5 shadow-lg shadow-primary/20">
            {createCardMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Add Node
          </Button>
        </div>

        <div className="flex-1 w-full h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            className="w-full h-full"
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={2} color="hsl(var(--muted-foreground) / 0.2)" />
            <Controls className="bg-card border shadow-lg rounded-xl overflow-hidden" />
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
