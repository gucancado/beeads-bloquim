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
  approvalMode?: string | null;
  approvalOrder?: number | null;
};

// Cards de aprovação renderizam como um nó redondo pequeno (~90px), não como um
// card cheio. No layout eles recebem uma caixa menor pra ocuparem um "gap"
// enxuto entre o pai e o próximo card, em vez de uma coluna inteira.
const APPROVAL_LAYOUT_WIDTH = 150;
const APPROVAL_LAYOUT_HEIGHT = 100;

/**
 * Monta o grafo do layout (nós + arestas) COM os cards de aprovação como nós de
 * verdade — eles são waypoints do fluxo (pai → aprovação → próximo), então
 * precisam de espaço próprio na cadeia em vez de ficar sobrepostos ao card
 * seguinte.
 *
 * - Nós: todos os cards. Aprovações recebem uma caixa menor (APPROVAL_LAYOUT_*).
 * - Arestas: as conexões persistidas MAIS as arestas de aprovação derivadas
 *   (pai → aprovação), espelhando o buildApprovalEdges do front — sequencial
 *   encadeia por `approvalOrder`, paralelo faz fan-out do pai pra cada aprovação.
 *   Descarta pontas fora do mapa, auto-loops e duplicatas.
 *
 * O join node do modo paralelo é virtual (não é card, é derivado no front das
 * posições das aprovações), então não entra aqui — ele segue as aprovações.
 */
export function buildApprovalLayoutGraph(
  cards: CardMeta[],
  connections: Array<{ source: string; target: string }>,
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const ids = new Set(cards.map((c) => c.id));
  const cardByTaskId = new Map<string, CardMeta>();
  for (const c of cards) if (c.taskId) cardByTaskId.set(c.taskId, c);

  const nodes: LayoutNode[] = cards.map((c) =>
    c.isApprovalTask === true
      ? { id: c.id, width: APPROVAL_LAYOUT_WIDTH, height: APPROVAL_LAYOUT_HEIGHT }
      : { id: c.id },
  );

  // Arestas de aprovação derivadas (pai → aprovação).
  const derived: LayoutEdge[] = [];
  const groups = new Map<string, CardMeta[]>();
  for (const c of cards) {
    if (c.isApprovalTask === true && c.parentTaskId) {
      const g = groups.get(c.parentTaskId);
      if (g) g.push(c);
      else groups.set(c.parentTaskId, [c]);
    }
  }
  for (const [parentTaskId, children] of groups) {
    const parent = cardByTaskId.get(parentTaskId);
    if (!parent || parent.isApprovalTask === true) continue;
    const sorted = [...children].sort(
      (a, b) => (a.approvalOrder ?? 0) - (b.approvalOrder ?? 0),
    );
    if ((parent.approvalMode ?? "sequential") === "sequential") {
      let prev = parent.id;
      for (const child of sorted) {
        derived.push({ source: prev, target: child.id });
        prev = child.id;
      }
    } else {
      for (const child of sorted) derived.push({ source: parent.id, target: child.id });
    }
  }

  const edges: LayoutEdge[] = [];
  const seen = new Set<string>();
  for (const e of [...connections, ...derived]) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    const key = `${e.source}->${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: e.source, target: e.target });
  }

  return { nodes, edges };
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
  // ranksep = gap horizontal entre pai e filho (ranks) no layout LR. Com 120 os
  // cards ficavam ~100px de distância (o card real tem ~220px de largura, então
  // a coluna 200+120=320 deixava só 100px de folga) — visualmente "colado". 240
  // dá ~220px de respiro entre pai e filho.
  const ranksep = opts.ranksep ?? 240;
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
