// artifacts/api-server/src/services/mapLayoutService.ts
import { Graph, layout } from "@dagrejs/dagre";
import { NODE_WIDTH, NODE_HEIGHT, type Point } from "../lib/collision";

export type LayoutNode = { id: string; width?: number; height?: number };
export type LayoutEdge = { source: string; target: string };

export type LayoutOpts = {
  rankdir?: "LR" | "TB";
  ranksep?: number;
  nodesep?: number;
  gridGap?: number;
};

/**
 * Posiciona os nós de um mapa minimizando cruzamento de arestas.
 *
 * Usa o dagre (método Sugiyama: camadas + ordenação por barycenter), com
 * rankdir=LR pra casar com os handles do canvas (source-right → target-left).
 * Nós sem nenhuma aresta ficariam em posições arbitrárias, então vão pra uma
 * grade compacta abaixo do grafo conectado.
 *
 * Função pura e determinística: mesma entrada → mesma saída.
 * Devolve o canto SUPERIOR-ESQUERDO de cada nó (o dagre trabalha com o centro).
 */
export function computeLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: LayoutOpts = {},
): Map<string, Point> {
  const rankdir = opts.rankdir ?? "LR";
  const ranksep = opts.ranksep ?? 120;
  const nodesep = opts.nodesep ?? 48;
  const gridGap = opts.gridGap ?? 48;

  const result = new Map<string, Point>();
  if (nodes.length === 0) return result;

  const known = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter(
    (e) => known.has(e.source) && known.has(e.target) && e.source !== e.target,
  );

  const connectedIds = new Set<string>();
  for (const e of validEdges) {
    connectedIds.add(e.source);
    connectedIds.add(e.target);
  }
  const connected = nodes.filter((n) => connectedIds.has(n.id));
  const isolated = nodes.filter((n) => !connectedIds.has(n.id));

  let graphBottom = 0;

  if (connected.length > 0) {
    const g = new Graph();
    g.setGraph({ rankdir, ranksep, nodesep, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of connected) {
      g.setNode(n.id, {
        width: n.width ?? NODE_WIDTH,
        height: n.height ?? NODE_HEIGHT,
      });
    }
    for (const e of validEdges) g.setEdge(e.source, e.target);
    layout(g);

    // dagre devolve o centro do nó; o banco guarda o canto superior-esquerdo.
    for (const n of connected) {
      const laid = g.node(n.id);
      result.set(n.id, {
        x: laid.x - (n.width ?? NODE_WIDTH) / 2,
        y: laid.y - (n.height ?? NODE_HEIGHT) / 2,
      });
    }

    // Normaliza pro canto (0,0) — o dagre pode devolver offsets negativos.
    let minX = Infinity;
    let minY = Infinity;
    for (const p of result.values()) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
    }
    for (const [id, p] of result) result.set(id, { x: p.x - minX, y: p.y - minY });

    for (const n of connected) {
      const bottom = result.get(n.id)!.y + (n.height ?? NODE_HEIGHT);
      if (bottom > graphBottom) graphBottom = bottom;
    }
  }

  if (isolated.length > 0) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(isolated.length)));
    const startY = connected.length > 0 ? graphBottom + gridGap * 2 : 0;
    isolated.forEach((n, i) => {
      result.set(n.id, {
        x: (i % cols) * (NODE_WIDTH + gridGap),
        y: startY + Math.floor(i / cols) * (NODE_HEIGHT + gridGap),
      });
    });
  }

  return result;
}
