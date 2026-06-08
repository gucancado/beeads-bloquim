import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeChange,
} from "reactflow";
import "reactflow/dist/style.css";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageBreadcrumb } from "@/components/layout/PageBreadcrumb";
import { Button } from "@beeads/ui";
import { Loader2, Plus } from "lucide-react";
import { CanvasToolbar } from "@/components/canvas-base/CanvasToolbar";
import { CanvasControls } from "@/components/canvas-base/CanvasControls";
import { StrategyNodeView } from "@/components/strategy/StrategyNodeView";
import { FloatingEdge } from "@/components/strategy/FloatingEdge";
import {
  useStrategyGraph,
  useCreateStrategyNode,
  useUpdateStrategyNode,
  useCreateStrategyEdge,
  useDeleteStrategyNode,
  useOpenStrategyCycle,
  type StrategyNodeKind,
} from "@/hooks/useStrategy";
import type { Connection } from "reactflow";

const nodeTypes = { strategy: StrategyNodeView };
const edgeTypes = { floating: FloatingEdge };

const NODE_BUTTONS: { kind: StrategyNodeKind; label: string }[] = [
  { kind: "objetivo", label: "Objetivo" },
  { kind: "kr", label: "KR" },
  { kind: "tema", label: "Tema" },
  { kind: "swot", label: "SWOT" },
  { kind: "plano", label: "Plano" },
  { kind: "recurso", label: "Recurso" },
];

function StrategyCanvasInner({ workspaceId }: { workspaceId: string }) {
  const { data: graph, isLoading } = useStrategyGraph(workspaceId);
  const createNode = useCreateStrategyNode(workspaceId);
  const updateNode = useUpdateStrategyNode(workspaceId);
  const createEdge = useCreateStrategyEdge(workspaceId);
  const deleteNode = useDeleteStrategyNode(workspaceId);
  const openCycle = useOpenStrategyCycle(workspaceId);
  const { screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges] = useEdgesState([]);
  const [cycleFormOpen, setCycleFormOpen] = useState(false);
  const [cycleLabelInput, setCycleLabelInput] = useState("");
  const editingRef = useRef(false);
  const updateNodeRef = useRef(updateNode);
  updateNodeRef.current = updateNode;

  // Hidrata nós/arestas do grafo (sem pisar numa edição/drag em andamento).
  useEffect(() => {
    if (!graph || editingRef.current) return;
    const kindById = new Map(graph.nodes.map((n) => [n.id, n.kind]));
    // Detector de órfãos (§7.8): sinal dispensável p/ padrões incompletos.
    const orphanOf = (n: (typeof graph.nodes)[number]): string | null => {
      if (n.readOnly) return null;
      if (n.kind === "objetivo") {
        const hasMede = graph.edges.some((e) => e.relationType === "mede" && e.targetNodeId === n.id);
        return hasMede ? null : "sem KR";
      }
      if (n.kind === "kr") {
        const hasPlano = graph.edges.some(
          (e) => e.relationType === "move" && e.targetNodeId === n.id && kindById.get(e.sourceNodeId) === "plano",
        );
        return hasPlano ? null : "sem plano";
      }
      if (n.kind === "plano") {
        return n.data.actionMapId ? null : "sem mapa";
      }
      return null;
    };
    setNodes(
      graph.nodes.map<Node>((n) => ({
        id: n.id,
        type: "strategy",
        position: { x: n.positionX, y: n.positionY },
        data: {
          kind: n.kind,
          readOnly: n.readOnly,
          orphan: orphanOf(n),
          ...n.data,
          // autosave inline (§7.5): o nó chama isto no blur de um campo editado.
          onPatchData: (patch: Record<string, any>) =>
            updateNodeRef.current.mutate({ nodeId: n.id, data: patch }),
        },
        draggable: !n.readOnly,
      })),
    );
    setEdges(
      graph.edges.map<Edge>((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        type: "floating",
        data: { label: e.relationType ?? e.label ?? undefined },
      })),
    );
  }, [graph, setNodes, setEdges]);

  const onNodesChangeWrapped = useCallback(
    (changes: NodeChange[]) => {
      if (changes.some((c) => c.type === "position" && c.dragging)) editingRef.current = true;
      onNodesChange(changes);
    },
    [onNodesChange],
  );

  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      editingRef.current = false;
      updateNode.mutate({ nodeId: node.id, positionX: node.position.x, positionY: node.position.y });
    },
    [updateNode],
  );

  // Liga 2 nós — relation_type é pré-preenchido pela gramática no backend (§6.5).
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      createEdge.mutate({ sourceNodeId: c.source, targetNodeId: c.target });
    },
    [createEdge],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      for (const n of deleted) deleteNode.mutate(n.id);
    },
    [deleteNode],
  );

  const addNode = useCallback(
    (kind: StrategyNodeKind) => {
      // cria no centro aproximado do viewport
      const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const data: Record<string, any> =
        kind === "kr"
          ? { title: "Novo KR", targetValue: 100 }
          : kind === "swot"
            ? { swotType: "forca", text: "" }
            : kind === "recurso"
              ? { resourceKind: "outro", label: "" }
              : kind === "plano"
                ? { hypothesis: "" }
                : { title: kind === "objetivo" ? "Novo objetivo" : "Novo tema" };
      createNode.mutate({ kind, positionX: pos.x, positionY: pos.y, data });
    },
    [createNode, screenToFlowPosition],
  );

  const cycleLabel = graph?.cycle?.label;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
        <PageBreadcrumb items={[{ label: "estratégia" }]} />
        {cycleLabel && (
          <span className="rounded-full bg-honey/15 px-3 py-1 text-xs font-medium text-fg lowercase">{cycleLabel}</span>
        )}
        {!cycleFormOpen ? (
          <Button variant="ghost" className="h-7 px-2 text-xs lowercase" onClick={() => { setCycleLabelInput(""); setCycleFormOpen(true); }}>
            novo ciclo
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              aria-label="rótulo do ciclo"
              value={cycleLabelInput}
              onChange={(e) => setCycleLabelInput(e.target.value)}
              placeholder="ex: Q3 2026"
              className="h-7 w-28 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-honey"
            />
            <Button
              className="h-7 px-2 text-xs lowercase"
              disabled={!cycleLabelInput.trim() || openCycle.isPending}
              onClick={() => {
                openCycle.mutate({ label: cycleLabelInput.trim() }, { onSuccess: () => setCycleFormOpen(false) });
              }}
            >
              abrir
            </Button>
            <Button variant="ghost" className="h-7 px-2 text-xs lowercase" onClick={() => setCycleFormOpen(false)}>
              cancelar
            </Button>
          </div>
        )}
      </div>

      <CanvasToolbar>
        {NODE_BUTTONS.map((b) => (
          <Button
            key={b.kind}
            onClick={() => addNode(b.kind)}
            disabled={createNode.isPending}
            variant="outline"
            className="rounded-xl h-10 px-4 shadow-md bg-background border-border/60 select-none cursor-pointer"
          >
            <Plus className="w-4 h-4 mr-2" />
            <span className="lowercase">{b.label}</span>
          </Button>
        ))}
      </CanvasToolbar>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChangeWrapped}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onNodesDelete={onNodesDelete}
        deleteKeyCode="Delete"
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.2}
        maxZoom={2.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="hsl(var(--muted-foreground) / 0.15)" />
        <CanvasControls />
      </ReactFlow>
    </div>
  );
}

export default function StrategyCanvasPage() {
  const [, params] = useRoute("/workspaces/:wsId/strategy");
  const workspaceId = params?.wsId ?? "";
  return (
    <AppLayout>
      <ReactFlowProvider>
        <StrategyCanvasInner workspaceId={workspaceId} />
      </ReactFlowProvider>
    </AppLayout>
  );
}
