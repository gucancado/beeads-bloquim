// artifacts/api-server/src/services/mapLayoutService.ts
import * as dagreModule from "@dagrejs/dagre";
import { NODE_WIDTH, NODE_HEIGHT, type Point } from "../lib/collision";

// dagre@3 é dual ESM/CJS e os dois builds são inconsistentes entre si: no ESM real
// (Vitest, node .mjs) o named export `Graph` existe mas o `default` do pacote NÃO
// inclui Graph (bug de packaging do dagre); no CJS-interop do tsx (dev) é o oposto —
// o named import quebra ("does not provide an export named 'Graph'") e só o `default`
// carrega Graph. Nem named import puro nem default import puro funcionam nos dois
// runners ao mesmo tempo — namespace import + fallback pro `.default` cobre ambos.
const dagreDefault = dagreModule.default as unknown as typeof dagreModule | undefined;
const Graph = dagreModule.Graph ?? dagreDefault?.Graph;
const layout = dagreModule.layout ?? dagreDefault?.layout;

export type LayoutNode = { id: string; width?: number; height?: number };
export type LayoutEdge = { source: string; target: string };

export type CardMeta = {
  id: string;
  taskId?: string | null;
  isApprovalTask?: boolean | null;
  parentTaskId?: string | null;
};

/**
 * Constrói as arestas pro layout a partir das conexões persistidas, roteando as
 * que tocam cards de aprovação através do card do task PAI.
 *
 * Um card de aprovação fica FORA do dagre (é satélite do pai, andando junto com
 * ele). Mas ele pode ser um nó ESTRUTURAL do fluxo — ex.: EDITAR → aprovação →
 * Subir, onde "aprovação → Subir" é uma conexão real. Descartar essa aresta só
 * porque a ponta é aprovação deixava o card seguinte (Subir) sem nenhuma conexão
 * → o dagre o tratava como isolado e o jogava na grade de sobras, com a linha
 * cruzando o mapa. Roteando "aprovação → X" pra "pai → X" (e "X → aprovação" pra
 * "X → pai"), a cadeia continua conectada e o layout sai limpo.
 *
 * Devolve só arestas entre cards NÃO-aprovação. Descarta: pontas de aprovação
 * sem pai resolvível, auto-loops (aprovação → próprio pai) e duplicatas que
 * colapsam pro mesmo par.
 */
export function buildLayoutEdges(
  cards: CardMeta[],
  connections: Array<{ source: string; target: string }>,
): LayoutEdge[] {
  const byId = new Map<string, CardMeta>(cards.map((c) => [c.id, c]));
  const cardByTaskId = new Map<string, CardMeta>();
  for (const c of cards) if (c.taskId) cardByTaskId.set(c.taskId, c);

  // Resolve um card pro nó que ele representa no grafo do layout: ele mesmo se
  // for card normal; o card do task pai se for aprovação; null se não resolve
  // (aprovação sem pai, ou pai que também é aprovação — casos raros, descartados).
  const resolve = (cardId: string): string | null => {
    const c = byId.get(cardId);
    if (!c) return null;
    if (c.isApprovalTask !== true) return c.id;
    if (!c.parentTaskId) return null;
    const parent = cardByTaskId.get(c.parentTaskId);
    if (!parent || parent.isApprovalTask === true) return null;
    return parent.id;
  };

  const out: LayoutEdge[] = [];
  const seen = new Set<string>();
  for (const conn of connections) {
    const s = resolve(conn.source);
    const t = resolve(conn.target);
    if (!s || !t || s === t) continue;
    const key = `${s}->${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: s, target: t });
  }
  return out;
}

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
