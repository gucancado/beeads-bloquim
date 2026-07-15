# Canvas Auto-Layout (Fase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cards do mapa de ação nunca nascem sobrepostos, e um comando único ("reorganizar") rearranja o mapa minimizando cruzamento de linhas — acionável pelo botão no canvas e automaticamente quando o MCP altera conexões.

**Architecture:** Uma engine de layout server-side (dagre, `rankdir=LR`) é a fonte única da verdade, exposta em `POST /api/workspaces/:wId/maps/:mId/layout`. O botão da UI e o MCP chamam o mesmo endpoint. Separadamente, `POST /cards` passa a resolver colisão a partir da posição pedida, então card novo nunca nasce em cima de outro — sem duplicar lógica no front.

**Tech Stack:** TypeScript 5.9, Express 5, Drizzle ORM, PostgreSQL, Zod v4 (api-server) / Zod v3 (bloquim-mcp), Vitest + Supertest (api-server), node:test (bloquim-mcp), React 19 + ReactFlow, Orval (OpenAPI codegen), `@dagrejs/dagre@3`.

**Spec:** `docs/superpowers/specs/2026-07-14-canvas-auto-layout-design.md`

## Desvio consciente da spec (aprovado no plano)

A spec previa free-slot **em dois lugares** (servidor + cliente). Durante o planejamento ficou claro que isso duplicaria lógica sem ganho:

> **Decisão:** free-slot é **server-side apenas**. `POST /cards` resolve colisão a partir da posição *pedida* (a que o caller mandou, ou `(0,0)` quando omitida). A UI continua mandando o ponto que já manda hoje; o servidor empurra se estiver ocupado.

Por que é seguro e cobre os dois cenários da spec:
- `handleAddChildCard` manda `parent.x + 280, parent.y` pros **dois** filhos → o 2º colide → servidor desloca. Resolve o bug de sobreposição de irmãos **sem tocar no front**.
- `create_task(planId)` / `create_tasks` não mandam posição → desejado `(0,0)` → cards ladrilham ao redor da origem em vez de empilhar.
- `PUT /cards/:cardId` (persistência de arrasto) **não** é tocado — o usuário continua livre pra sobrepor manualmente.
- Não há inserção otimista de card no canvas (`createCardAt` só insere após resposta do servidor) → **sem "pulo"** visual.

Consequência: **não existe Task de free-slot no front**, e não é preciso criar lib compartilhada.

## Global Constraints

- **Branches:** `feat/canvas-auto-layout` já existe e está alinhada com `origin/master` no repo `beeads-bloquim`. No repo `bloquim-mcp` (`c:/Users/gusta/Projetos/bloquim-mcp`, hoje em `master`) criar `feat/canvas-auto-layout`. **Nunca** commitar em `master`.
- **Zod:** api-server usa Zod v4 (`import { z } from "zod"` resolve v4; em arquivo novo prefira `import { z } from "zod/v4"`). O `bloquim-mcp` usa **Zod v3** (`^3.24.1`) — não misturar.
- **Express 5:** handlers são async nativos, sem wrapper try/catch.
- **Arquivos gerados:** nunca editar `lib/api-client-react/src/generated/` nem `lib/api-zod/src/generated/`. Após alterar `openapi.yaml`, rodar `pnpm --filter @workspace/api-spec run codegen`.
- **Dimensões nominais do card:** `NODE_WIDTH = 200`, `NODE_HEIGHT = 80` (constantes reais do canvas, `canvas.tsx:442-443`).
- **Idioma:** comentários e strings de UI em português (padrão do repo).
- **Testes api-server:** Vitest **não** lê `.env`. Rodar de dentro de `artifacts/api-server` com env inline:
  ```
  DATABASE_URL='postgresql://postgres.dzhdnaemauvtdchbkppp:8ffEOVU11yv3rEio@aws-1-sa-east-1.pooler.supabase.com:5432/postgres' JWT_SECRET='7396043fd27a4b1c4868c4bf8329a944b50410fe8d7847ff999122813450ea0d' npx vitest run <pattern>
  ```
  Se a suíte inteira falhar por timeout, **re-rode antes de suspeitar de regressão** (flakiness ambiental conhecida contra o DB remoto).
- **pnpm/lockfile (deploy-crítico):** pnpm local é **11.4.0**, mas o Dockerfile fixa **9.15.9**. Qualquer mudança em `pnpm-lock.yaml` precisa ser regerada com 9.15.9 ou o build do Coolify quebra com `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. Comando exato na Task 1.
- **Migration de banco:** nenhuma. Reusa `cards.position_x` / `cards.position_y` (já `doublePrecision NOT NULL DEFAULT 0`).

---

## File Structure

**Repo `beeads-bloquim` (branch `feat/canvas-auto-layout`):**

| Arquivo | Responsabilidade |
|---|---|
| `artifacts/api-server/src/lib/collision.ts` **(novo)** | Geometria pura: `boxesOverlap`, `findFreeSlot`, e as constantes `NODE_WIDTH`/`NODE_HEIGHT`. Módulo de baixo nível, sem I/O. |
| `artifacts/api-server/src/services/mapLayoutService.ts` **(novo)** | `computeLayout` — envelopa o dagre. Importa as dimensões de `lib/collision`. Sem I/O. |
| `artifacts/api-server/src/__tests__/collision.test.ts` **(novo)** | Unit da geometria. |
| `artifacts/api-server/src/__tests__/mapLayout.test.ts` **(novo)** | Unit da engine de layout. |
| `artifacts/api-server/src/routes/maps.ts` **(modificar)** | Endpoint `POST /:mapId/layout`. |
| `artifacts/api-server/src/routes/cards.ts` **(modificar)** | Free-slot no `POST /`. |
| `artifacts/api-server/src/__tests__/mapLayout.smoke.test.ts` **(novo)** | Smoke do endpoint + do free-slot na criação. |
| `lib/api-spec/openapi.yaml` **(modificar)** | Path `/layout` + schema `LayoutMapResponse`. |
| `artifacts/mindtask-app/src/pages/maps/canvas.tsx` **(modificar)** | Botão "reorganizar". |

Direção de dependência: `routes` → `services` → `lib`. `lib/collision.ts` não importa nada do projeto.

**Repo `bloquim-mcp` (branch `feat/canvas-auto-layout`):**

| Arquivo | Responsabilidade |
|---|---|
| `src/tools/create_task_dependencies.ts` **(modificar)** | Param `autoLayout` + chamada ao endpoint após criar arestas. |
| `src/tools/scaffold_plan.ts` **(modificar)** | Trocar `topologicalLayout` local pela chamada ao endpoint. |
| `src/lib/plan-graph.ts` **(modificar)** | Remover `topologicalLayout` (fica morto). |
| `tests/plan-graph.test.ts` **(modificar)** | Remover os 2 testes de `topologicalLayout`. |

---

### Task 1: Engine de layout (dagre)

**Files:**
- Create: `artifacts/api-server/src/lib/collision.ts`
- Create: `artifacts/api-server/src/services/mapLayoutService.ts`
- Create: `artifacts/api-server/src/__tests__/mapLayout.test.ts`
- Modify: `artifacts/api-server/package.json` (dep `@dagrejs/dagre`)
- Modify: `pnpm-lock.yaml` (regen com pnpm 9.15.9)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `lib/collision.ts` → `export const NODE_WIDTH = 200`, `export const NODE_HEIGHT = 80`, `export type Point = { x: number; y: number }`, `export type Box = { x: number; y: number; width: number; height: number }`
  - `services/mapLayoutService.ts` → `export function computeLayout(nodes: LayoutNode[], edges: LayoutEdge[], opts?: LayoutOpts): Map<string, Point>`, `export type LayoutNode = { id: string; width?: number; height?: number }`, `export type LayoutEdge = { source: string; target: string }`

**Contexto verificado (não re-descobrir):** `@dagrejs/dagre@3.0.0` traz tipos próprios (`dist/types/index.d.ts`) e só depende de `@dagrejs/graphlib` — pure-JS, **não** precisa de `@types/dagre`. A API v3 exporta `Graph` e `layout` como **named exports**. `g.node(id)` devolve `{x, y, width, height}` com **x/y no CENTRO** do nó — o banco guarda o canto superior-esquerdo, então precisa converter.

- [ ] **Step 1: Instalar o dagre**

Rodar da raiz do repo (`c:/Users/gusta/Projetos/beeads-bloquim/repo`):

```bash
pnpm --config.verify-deps-before-run=false --filter @workspace/api-server add @dagrejs/dagre@^3.0.0
```

(O `--config.verify-deps-before-run=false` é necessário: o `preinstall` do repo quebra no pnpm 11.)

- [ ] **Step 2: Regerar o lockfile com pnpm 9.15.9 (deploy-crítico)**

O pnpm local (11.4.0) grava overrides no lockfile de um jeito que o Dockerfile (pnpm 9.15.9) rejeita. Da raiz do repo:

```bash
corepack prepare pnpm@9.15.9 --activate
CI=1 pnpm install --no-frozen-lockfile --lockfile-only
```

Depois confirme que o lockfile passa como o container vê:

```bash
pnpm install --frozen-lockfile
```

Esperado: termina sem `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.

- [ ] **Step 3: Criar `lib/collision.ts` com as constantes (a geometria vem na Task 2)**

Este arquivo é o módulo de baixo nível. Nesta task ele só carrega as dimensões nominais; `findFreeSlot`/`boxesOverlap` entram na Task 2.

```typescript
// artifacts/api-server/src/lib/collision.ts

/**
 * Dimensões nominais de um card no canvas. O card renderizado pode crescer com
 * o conteúdo, mas layout e detecção de colisão trabalham com a caixa nominal —
 * é o que o servidor consegue saber sem medir o DOM.
 * Espelha NODE_W/NODE_H de mindtask-app/src/pages/maps/canvas.tsx.
 */
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 80;

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };
```

- [ ] **Step 4: Escrever o teste que falha**

```typescript
// artifacts/api-server/src/__tests__/mapLayout.test.ts
import { describe, it, expect } from "vitest";
import { computeLayout } from "../services/mapLayoutService";
import { NODE_WIDTH, NODE_HEIGHT } from "../lib/collision";

// Valores conferidos rodando o dagre de verdade com os defaults deste módulo
// (rankdir=LR, ranksep=120, nodesep=48, nó 200x80): as colunas ficam 320 apart
// (200 de largura + 120 de ranksep).
describe("computeLayout", () => {
  it("mapa vazio devolve mapa vazio", () => {
    expect(computeLayout([], []).size).toBe(0);
  });

  it("cadeia linear a→b→c vira 3 colunas na mesma linha", () => {
    const pos = computeLayout(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [{ source: "a", target: "b" }, { source: "b", target: "c" }],
    );
    expect(pos.get("a")).toEqual({ x: 0, y: 0 });
    expect(pos.get("b")).toEqual({ x: 320, y: 0 });
    expect(pos.get("c")).toEqual({ x: 640, y: 0 });
  });

  it("diamante: 3 ranks, e os dois nós do meio não se sobrepõem", () => {
    const pos = computeLayout(
      [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      [
        { source: "a", target: "b" },
        { source: "a", target: "c" },
        { source: "b", target: "d" },
        { source: "c", target: "d" },
      ],
    );
    expect(pos.get("a")!.x).toBe(0);
    expect(pos.get("b")!.x).toBe(320);
    expect(pos.get("c")!.x).toBe(320);
    expect(pos.get("d")!.x).toBe(640);
    // b e c dividem a coluna → precisam estar separados verticalmente
    expect(Math.abs(pos.get("b")!.y - pos.get("c")!.y)).toBeGreaterThanOrEqual(NODE_HEIGHT);
  });

  it("é determinístico: mesma entrada → mesma saída", () => {
    const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const edges = [{ source: "a", target: "b" }, { source: "b", target: "c" }];
    expect([...computeLayout(nodes, edges)]).toEqual([...computeLayout(nodes, edges)]);
  });

  it("normaliza pro canto: menor x e menor y são 0", () => {
    const pos = computeLayout(
      [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      [
        { source: "a", target: "b" },
        { source: "a", target: "c" },
        { source: "b", target: "d" },
        { source: "c", target: "d" },
      ],
    );
    expect(Math.min(...[...pos.values()].map((p) => p.x))).toBe(0);
    expect(Math.min(...[...pos.values()].map((p) => p.y))).toBe(0);
  });

  it("nós isolados vão pra uma grade e não se sobrepõem", () => {
    const pos = computeLayout([{ id: "x" }, { id: "y" }, { id: "z" }], []);
    expect(pos.size).toBe(3);
    const pts = [...pos.values()];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const apart =
          Math.abs(pts[i].x - pts[j].x) >= NODE_WIDTH ||
          Math.abs(pts[i].y - pts[j].y) >= NODE_HEIGHT;
        expect(apart).toBe(true);
      }
    }
  });

  it("nós isolados ficam abaixo do grafo conectado, sem colidir com ele", () => {
    const pos = computeLayout(
      [{ id: "a" }, { id: "b" }, { id: "solto" }],
      [{ source: "a", target: "b" }],
    );
    const graphBottom = Math.max(pos.get("a")!.y, pos.get("b")!.y) + NODE_HEIGHT;
    expect(pos.get("solto")!.y).toBeGreaterThanOrEqual(graphBottom);
  });

  it("ignora arestas que apontam pra nó desconhecido e self-loops", () => {
    const pos = computeLayout(
      [{ id: "a" }, { id: "b" }],
      [
        { source: "a", target: "fantasma" },
        { source: "b", target: "b" },
        { source: "a", target: "b" },
      ],
    );
    expect(pos.get("a")).toEqual({ x: 0, y: 0 });
    expect(pos.get("b")).toEqual({ x: 320, y: 0 });
  });

  it("tolera ciclo sem quebrar (aciclicidade é responsabilidade do MCP, não daqui)", () => {
    const pos = computeLayout(
      [{ id: "a" }, { id: "b" }],
      [{ source: "a", target: "b" }, { source: "b", target: "a" }],
    );
    expect(pos.size).toBe(2);
  });
});
```

- [ ] **Step 5: Rodar o teste e confirmar que falha**

De dentro de `artifacts/api-server`:

```bash
npx vitest run src/__tests__/mapLayout.test.ts
```

Esperado: FAIL — `Cannot find module '../services/mapLayoutService'`.

(Este teste é puro, não toca o banco → não precisa de `DATABASE_URL`/`JWT_SECRET`.)

- [ ] **Step 6: Implementar `mapLayoutService.ts`**

```typescript
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
```

- [ ] **Step 7: Rodar o teste e confirmar que passa**

De dentro de `artifacts/api-server`:

```bash
npx vitest run src/__tests__/mapLayout.test.ts
```

Esperado: PASS, 9 testes.

- [ ] **Step 8: Typecheck**

```bash
pnpm --config.verify-deps-before-run=false --filter @workspace/api-server run typecheck
```

Esperado: sem erros.

- [ ] **Step 9: Commit**

```bash
git add artifacts/api-server/src/lib/collision.ts artifacts/api-server/src/services/mapLayoutService.ts artifacts/api-server/src/__tests__/mapLayout.test.ts artifacts/api-server/package.json pnpm-lock.yaml
git commit -m "feat(api): engine de layout de mapa com dagre (LR, minimiza cruzamento)"
```

---

### Task 2: Free-slot (geometria de colisão)

**Files:**
- Modify: `artifacts/api-server/src/lib/collision.ts`
- Create: `artifacts/api-server/src/__tests__/collision.test.ts`

**Interfaces:**
- Consumes: `NODE_WIDTH`, `NODE_HEIGHT`, `Point`, `Box` de `lib/collision.ts` (Task 1).
- Produces:
  - `export function boxesOverlap(a: Box, b: Box, gap?: number): boolean`
  - `export function findFreeSlot(desired: Point, size: { width: number; height: number }, occupied: Box[], opts?: FreeSlotOpts): Point`
  - `export type FreeSlotOpts = { gap?: number; stepX?: number; stepY?: number; maxRings?: number }`

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// artifacts/api-server/src/__tests__/collision.test.ts
import { describe, it, expect } from "vitest";
import { boxesOverlap, findFreeSlot, NODE_WIDTH, NODE_HEIGHT } from "../lib/collision";

const SIZE = { width: NODE_WIDTH, height: NODE_HEIGHT };

describe("boxesOverlap", () => {
  const a = { x: 0, y: 0, width: 200, height: 80 };

  it("caixas idênticas se sobrepõem", () => {
    expect(boxesOverlap(a, { ...a })).toBe(true);
  });

  it("caixas bem separadas não se sobrepõem", () => {
    expect(boxesOverlap(a, { x: 1000, y: 1000, width: 200, height: 80 })).toBe(false);
  });

  it("encostadas sem gap não se sobrepõem", () => {
    expect(boxesOverlap(a, { x: 200, y: 0, width: 200, height: 80 })).toBe(false);
  });

  it("encostadas COM gap contam como sobrepostas", () => {
    expect(boxesOverlap(a, { x: 200, y: 0, width: 200, height: 80 }, 24)).toBe(true);
  });
});

describe("findFreeSlot", () => {
  it("sem nada ocupado devolve o ponto pedido", () => {
    expect(findFreeSlot({ x: 50, y: 60 }, SIZE, [])).toEqual({ x: 50, y: 60 });
  });

  it("ponto pedido livre devolve o próprio ponto", () => {
    const occupied = [{ x: 1000, y: 1000, width: NODE_WIDTH, height: NODE_HEIGHT }];
    expect(findFreeSlot({ x: 0, y: 0 }, SIZE, occupied)).toEqual({ x: 0, y: 0 });
  });

  it("ponto ocupado desloca pra baixo (vizinho mais próximo)", () => {
    const occupied = [{ x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT }];
    // gap default 24 → stepY = 80 + 24 = 104
    expect(findFreeSlot({ x: 0, y: 0 }, SIZE, occupied)).toEqual({ x: 0, y: 104 });
  });

  it("resultado nunca sobrepõe o que já está ocupado", () => {
    const occupied = [
      { x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT },
      { x: 0, y: 104, width: NODE_WIDTH, height: NODE_HEIGHT },
      { x: 0, y: -104, width: NODE_WIDTH, height: NODE_HEIGHT },
    ];
    const slot = findFreeSlot({ x: 0, y: 0 }, SIZE, occupied);
    const box = { x: slot.x, y: slot.y, width: NODE_WIDTH, height: NODE_HEIGHT };
    for (const o of occupied) expect(boxesOverlap(box, o, 24)).toBe(false);
  });

  it("é determinístico", () => {
    const occupied = [{ x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT }];
    expect(findFreeSlot({ x: 0, y: 0 }, SIZE, occupied)).toEqual(
      findFreeSlot({ x: 0, y: 0 }, SIZE, occupied),
    );
  });

  it("sem vaga dentro do limite de anéis, degrada pro ponto pedido", () => {
    const occupied = [{ x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT }];
    expect(findFreeSlot({ x: 0, y: 0 }, SIZE, occupied, { maxRings: 0 })).toEqual({ x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

De dentro de `artifacts/api-server`:

```bash
npx vitest run src/__tests__/collision.test.ts
```

Esperado: FAIL — `boxesOverlap is not a function` / não exportado.

- [ ] **Step 3: Implementar (append em `lib/collision.ts`, abaixo das constantes da Task 1)**

```typescript
/** Duas caixas se sobrepõem, considerando um respiro `gap` obrigatório entre elas. */
export function boxesOverlap(a: Box, b: Box, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

export type FreeSlotOpts = {
  gap?: number;
  stepX?: number;
  stepY?: number;
  maxRings?: number;
};

/**
 * Acha o ponto livre mais próximo de `desired` pra uma caixa `size`, varrendo
 * anéis concêntricos e, dentro de cada anel, testando os candidatos do mais
 * perto pro mais longe (empate → prefere abaixo, depois à direita, que é a
 * ordem natural de irmãos no canvas).
 *
 * Determinístico. Se não achar vaga em `maxRings` anéis, devolve `desired` —
 * degrada pro comportamento antigo em vez de travar a criação do card.
 */
export function findFreeSlot(
  desired: Point,
  size: { width: number; height: number },
  occupied: Box[],
  opts: FreeSlotOpts = {},
): Point {
  const gap = opts.gap ?? 24;
  const stepX = opts.stepX ?? size.width + gap;
  const stepY = opts.stepY ?? size.height + gap;
  const maxRings = opts.maxRings ?? 12;

  const fits = (x: number, y: number): boolean =>
    !occupied.some((o) =>
      boxesOverlap({ x, y, width: size.width, height: size.height }, o, gap),
    );

  if (fits(desired.x, desired.y)) return { x: desired.x, y: desired.y };

  for (let ring = 1; ring <= maxRings; ring++) {
    const candidates: Array<{ x: number; y: number; dx: number; dy: number; dist: number }> = [];
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue; // só o perímetro
        const x = desired.x + dx * stepX;
        const y = desired.y + dy * stepY;
        candidates.push({ x, y, dx, dy, dist: Math.hypot(x - desired.x, y - desired.y) });
      }
    }
    candidates.sort((a, b) => a.dist - b.dist || b.dy - a.dy || b.dx - a.dx);
    for (const c of candidates) if (fits(c.x, c.y)) return { x: c.x, y: c.y };
  }

  return { x: desired.x, y: desired.y };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

De dentro de `artifacts/api-server`:

```bash
npx vitest run src/__tests__/collision.test.ts
```

Esperado: PASS, 11 testes.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/collision.ts artifacts/api-server/src/__tests__/collision.test.ts
git commit -m "feat(api): findFreeSlot — acha vaga livre mais próxima pra um card"
```

---

### Task 3: Endpoint `POST /maps/:mapId/layout`

**Files:**
- Modify: `artifacts/api-server/src/routes/maps.ts`
- Create: `artifacts/api-server/src/__tests__/mapLayout.smoke.test.ts`

**Interfaces:**
- Consumes: `computeLayout` de `services/mapLayoutService` (Task 1). As dimensões dos nós ficam no default do `computeLayout` — esta rota não precisa importar `NODE_WIDTH`/`NODE_HEIGHT`.
- Produces: `POST /api/workspaces/:workspaceId/maps/:mapId/layout` → `200 { cards: Array<{ id: string; positionX: number; positionY: number }> }`. O array traz **só os cards que se moveram**.

**Contexto verificado:** `maps.ts` já importa `cards`, `cardConnections`, `tasks` (linha 3) e `requireMapInWorkspace` (linha 7). Falta importar `asc` do `drizzle-orm` (hoje importa `eq, and, sql, isNull, ilike, desc`).

- [ ] **Step 1: Escrever o smoke que falha**

```typescript
// artifacts/api-server/src/__tests__/mapLayout.smoke.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

/**
 * Trava o comportamento do endpoint de auto-layout
 * `POST /api/workspaces/:wId/maps/:mId/layout` e do free-slot no
 * `POST /api/workspaces/:wId/maps/:mId/cards`.
 */
describe("map layout smoke", () => {
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  afterAll(async () => {
    await deleteWorkspaces(createdWorkspaceIds);
    for (const id of createdUserIds) await deleteUser(id);
  });

  async function setupMap(name: string) {
    const { agent, user } = await registerAndLogin(`Layout ${name}`);
    createdUserIds.push(user.id);
    const ws = await agent.post("/api/workspaces").send({ name: `Layout WS ${name}`, colorIndex: 0 });
    expect(ws.status).toBe(201);
    const workspaceId = ws.body.id as string;
    createdWorkspaceIds.push(workspaceId);
    const map = await agent.post(`/api/workspaces/${workspaceId}/maps`).send({ name: `Layout Map ${name}` });
    expect(map.status).toBe(201);
    return { agent, user, workspaceId, mapId: map.body.id as string };
  }

  it("reposiciona cards conectados em colunas e não sobrepõe", async () => {
    const { agent, workspaceId, mapId } = await setupMap("chain");

    // Três cards empilhados de propósito no mesmo ponto pedido.
    const ids: string[] = [];
    for (const title of ["a", "b", "c"]) {
      const res = await agent
        .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
        .send({ title, positionX: 0, positionY: 0 });
      expect(res.status).toBe(201);
      ids.push(res.body.id as string);
    }
    const [a, b, c] = ids;

    for (const [source, target] of [[a, b], [b, c]]) {
      const conn = await agent
        .post(`/api/workspaces/${workspaceId}/maps/${mapId}/connections`)
        .send({ sourceCardId: source, targetCardId: target, sourceHandle: "source-right", targetHandle: "target-left" });
      expect(conn.status).toBe(201);
    }

    const layout = await agent.post(`/api/workspaces/${workspaceId}/maps/${mapId}/layout`);
    expect(layout.status).toBe(200);
    expect(Array.isArray(layout.body.cards)).toBe(true);

    const map = await agent.get(`/api/workspaces/${workspaceId}/maps/${mapId}`);
    expect(map.status).toBe(200);
    const byId = new Map<string, { positionX: number; positionY: number }>(
      (map.body.cards as Array<{ id: string; positionX: number; positionY: number }>).map((k) => [k.id, k]),
    );
    // Cadeia a→b→c com rankdir=LR: uma coluna por nível, 320 de passo.
    expect(byId.get(a)!.positionX).toBe(0);
    expect(byId.get(b)!.positionX).toBe(320);
    expect(byId.get(c)!.positionX).toBe(640);
    expect(byId.get(a)!.positionY).toBe(byId.get(b)!.positionY);
  });

  it("é idempotente: a segunda chamada seguida não move mais nada", async () => {
    const { agent, workspaceId, mapId } = await setupMap("idem");

    // Posições espalhadas de propósito, pra 1ª chamada ter o que mover.
    const ids: string[] = [];
    for (const [title, x, y] of [["p", 900, 900], ["q", 40, 700]] as const) {
      const res = await agent
        .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
        .send({ title, positionX: x, positionY: y });
      expect(res.status).toBe(201);
      ids.push(res.body.id as string);
    }
    const conn = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/connections`)
      .send({ sourceCardId: ids[0], targetCardId: ids[1], sourceHandle: "source-right", targetHandle: "target-left" });
    expect(conn.status).toBe(201);

    const first = await agent.post(`/api/workspaces/${workspaceId}/maps/${mapId}/layout`);
    expect(first.status).toBe(200);
    expect(first.body.cards.length).toBeGreaterThan(0);

    const second = await agent.post(`/api/workspaces/${workspaceId}/maps/${mapId}/layout`);
    expect(second.status).toBe(200);
    expect(second.body.cards).toEqual([]);
  });

  it("cards de aprovação mantêm a posição (ficam fora do relayout)", async () => {
    const { agent, user, workspaceId, mapId } = await setupMap("approval");

    // Card pai no mapa; adicionar um aprovador cria um card de aprovação junto.
    const parent = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "Pai", positionX: 0, positionY: 0 });
    expect(parent.status).toBe(201);
    const parentTaskId = parent.body.taskId as string;

    const ap = await agent
      .post(`/api/workspaces/${workspaceId}/tasks/${parentTaskId}/approvals`)
      .send({ approverId: user.id, dueDate: null });
    expect(ap.status).toBe(201);

    type MapCard = { id: string; positionX: number; positionY: number; taskIsApprovalTask: boolean };
    const before = await agent.get(`/api/workspaces/${workspaceId}/maps/${mapId}`);
    expect(before.status).toBe(200);
    const approvalBefore = (before.body.cards as MapCard[]).find((c) => c.taskIsApprovalTask);
    expect(approvalBefore).toBeTruthy();

    const layout = await agent.post(`/api/workspaces/${workspaceId}/maps/${mapId}/layout`);
    expect(layout.status).toBe(200);
    // Nem aparece na lista de movidos...
    expect((layout.body.cards as Array<{ id: string }>).some((c) => c.id === approvalBefore!.id)).toBe(false);

    // ...nem mudou de lugar no banco.
    const after = await agent.get(`/api/workspaces/${workspaceId}/maps/${mapId}`);
    const approvalAfter = (after.body.cards as MapCard[]).find((c) => c.id === approvalBefore!.id);
    expect(approvalAfter!.positionX).toBe(approvalBefore!.positionX);
    expect(approvalAfter!.positionY).toBe(approvalBefore!.positionY);
  });

  it("mapa sem cards devolve lista vazia", async () => {
    const { agent, workspaceId, mapId } = await setupMap("empty");
    const res = await agent.post(`/api/workspaces/${workspaceId}/maps/${mapId}/layout`);
    expect(res.status).toBe(200);
    expect(res.body.cards).toEqual([]);
  });

  it("executor não pode reorganizar o mapa", async () => {
    const { agent: adminAgent, workspaceId, mapId } = await setupMap("role");
    const { agent: execAgent, user: execUser } = await registerAndLogin("Layout Executor");
    createdUserIds.push(execUser.id);

    const inv = await adminAgent
      .post(`/api/workspaces/${workspaceId}/members`)
      .send({ email: execUser.email, role: "executor" });
    expect(inv.status).toBe(201);

    const res = await execAgent.post(`/api/workspaces/${workspaceId}/maps/${mapId}/layout`);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar o smoke e confirmar que falha**

De dentro de `artifacts/api-server`:

```bash
DATABASE_URL='postgresql://postgres.dzhdnaemauvtdchbkppp:8ffEOVU11yv3rEio@aws-1-sa-east-1.pooler.supabase.com:5432/postgres' JWT_SECRET='7396043fd27a4b1c4868c4bf8329a944b50410fe8d7847ff999122813450ea0d' npx vitest run src/__tests__/mapLayout.smoke.test.ts
```

Esperado: FAIL — o POST em `/layout` devolve 404 (rota não existe).

- [ ] **Step 3: Adicionar os imports em `maps.ts`**

Trocar a linha 4 de:

```typescript
import { eq, and, sql, isNull, ilike, desc } from "drizzle-orm";
```

para:

```typescript
import { eq, and, sql, isNull, ilike, desc, asc } from "drizzle-orm";
```

E adicionar, junto dos outros imports do topo do arquivo:

```typescript
import { computeLayout } from "../services/mapLayoutService";
```

- [ ] **Step 4: Implementar o endpoint em `maps.ts`**

Inserir logo **antes** de `router.post("/:mapId/access", ...)` (linha ~226):

```typescript
router.post(
  "/:mapId/layout",
  requireAuth,
  requireWorkspaceRole(["admin", "editor"]),
  requireMapInWorkspace,
  async (req: AuthRequest, res) => {
    const { mapId } = req.params;

    const cardRows = await db
      .select({
        id: cards.id,
        positionX: cards.positionX,
        positionY: cards.positionY,
        isApprovalTask: tasks.isApprovalTask,
      })
      .from(cards)
      .leftJoin(tasks, eq(cards.taskId, tasks.id))
      .where(eq(cards.mapId, mapId))
      .orderBy(asc(cards.createdAt));

    // Cards de aprovação têm posição derivada do próprio fluxo (join nodes e
    // edges são geradas no front, não persistidas como conexões). Reposicioná-los
    // quebraria o agrupamento visual — ficam de fora e mantêm a posição atual.
    const movable = cardRows.filter((c) => c.isApprovalTask !== true);
    if (movable.length === 0) {
      res.json({ cards: [] });
      return;
    }
    const movableIds = new Set(movable.map((c) => c.id));

    const connRows = await db
      .select({
        sourceCardId: cardConnections.sourceCardId,
        targetCardId: cardConnections.targetCardId,
      })
      .from(cardConnections)
      .where(eq(cardConnections.mapId, mapId));

    const positions = computeLayout(
      movable.map((c) => ({ id: c.id })),
      connRows
        .filter((c) => movableIds.has(c.sourceCardId) && movableIds.has(c.targetCardId))
        .map((c) => ({ source: c.sourceCardId, target: c.targetCardId })),
    );

    const updated: Array<{ id: string; positionX: number; positionY: number }> = [];
    await db.transaction(async (tx) => {
      for (const c of movable) {
        const p = positions.get(c.id);
        if (!p) continue;
        // Só grava o que realmente mudou → a 2ª chamada seguida vira no-op.
        if (Math.abs(p.x - c.positionX) < 0.5 && Math.abs(p.y - c.positionY) < 0.5) continue;
        await tx
          .update(cards)
          .set({ positionX: p.x, positionY: p.y, updatedAt: new Date() })
          .where(eq(cards.id, c.id));
        updated.push({ id: c.id, positionX: p.x, positionY: p.y });
      }
    });

    res.json({ cards: updated });
  },
);
```

- [ ] **Step 5: Rodar o smoke e confirmar que passa**

De dentro de `artifacts/api-server`:

```bash
DATABASE_URL='postgresql://postgres.dzhdnaemauvtdchbkppp:8ffEOVU11yv3rEio@aws-1-sa-east-1.pooler.supabase.com:5432/postgres' JWT_SECRET='7396043fd27a4b1c4868c4bf8329a944b50410fe8d7847ff999122813450ea0d' npx vitest run src/__tests__/mapLayout.smoke.test.ts
```

Esperado: PASS, 5 testes. Se falhar por **timeout**, re-rode antes de investigar (flakiness conhecida contra o DB remoto).

- [ ] **Step 6: Typecheck**

```bash
pnpm --config.verify-deps-before-run=false --filter @workspace/api-server run typecheck
```

Esperado: sem erros.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/maps.ts artifacts/api-server/src/__tests__/mapLayout.smoke.test.ts
git commit -m "feat(api): POST /maps/:mapId/layout — reorganiza cards do plano"
```

---

### Task 4: Free-slot na criação de card

**Files:**
- Modify: `artifacts/api-server/src/routes/cards.ts:18-23` (schema) e `:74-110` (handler do POST)
- Modify: `artifacts/api-server/src/__tests__/mapLayout.smoke.test.ts` (novo caso)

**Interfaces:**
- Consumes: `findFreeSlot`, `NODE_WIDTH`, `NODE_HEIGHT` de `lib/collision` (Tasks 1-2).
- Produces: `POST /cards` passa a devolver um card cuja posição pode ter sido **deslocada** em relação à pedida, quando a pedida estava ocupada. Posição omitida → resolve a partir de `(0,0)`.

- [ ] **Step 1: Escrever o teste que falha (append no `describe` de `mapLayout.smoke.test.ts`)**

Adicionar estes dois casos dentro do `describe("map layout smoke", ...)`, antes do fechamento:

```typescript
  it("card novo não nasce em cima de outro no mesmo ponto pedido", async () => {
    const { agent, workspaceId, mapId } = await setupMap("freeslot");

    const first = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "primeiro", positionX: 500, positionY: 500 });
    expect(first.status).toBe(201);
    expect(first.body.positionX).toBe(500);
    expect(first.body.positionY).toBe(500);

    const second = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "segundo", positionX: 500, positionY: 500 });
    expect(second.status).toBe(201);
    // Mesmo ponto pedido → o servidor empurra pro vizinho livre mais próximo.
    const dx = Math.abs(second.body.positionX - 500);
    const dy = Math.abs(second.body.positionY - 500);
    expect(dx >= 200 || dy >= 80).toBe(true);
  });

  it("cards sem posição (caso MCP) não empilham todos em (0,0)", async () => {
    const { agent, workspaceId, mapId } = await setupMap("mcp");

    const positions: Array<{ x: number; y: number }> = [];
    for (const title of ["t1", "t2", "t3"]) {
      const res = await agent
        .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
        .send({ title });
      expect(res.status).toBe(201);
      positions.push({ x: res.body.positionX as number, y: res.body.positionY as number });
    }

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const apart =
          Math.abs(positions[i].x - positions[j].x) >= 200 ||
          Math.abs(positions[i].y - positions[j].y) >= 80;
        expect(apart).toBe(true);
      }
    }
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

De dentro de `artifacts/api-server`:

```bash
DATABASE_URL='postgresql://postgres.dzhdnaemauvtdchbkppp:8ffEOVU11yv3rEio@aws-1-sa-east-1.pooler.supabase.com:5432/postgres' JWT_SECRET='7396043fd27a4b1c4868c4bf8329a944b50410fe8d7847ff999122813450ea0d' npx vitest run src/__tests__/mapLayout.smoke.test.ts
```

Esperado: FAIL nos 2 casos novos — hoje o 2º card fica em (500,500) e os cards sem posição empilham em (0,0).

- [ ] **Step 3: Adicionar o import em `cards.ts`**

Junto dos outros imports do topo:

```typescript
import { findFreeSlot, NODE_WIDTH, NODE_HEIGHT } from "../lib/collision";
```

- [ ] **Step 4: Tirar o default do schema (`cards.ts:18-23`)**

Trocar:

```typescript
const createCardSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  positionX: z.number().optional().default(0),
  positionY: z.number().optional().default(0),
});
```

por:

```typescript
// Sem .default(0): posição omitida significa "escolha por mim" e é resolvida
// pelo free-slot no handler, em vez de empilhar todo mundo na origem.
const createCardSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
});
```

- [ ] **Step 5: Resolver colisão no handler do POST (`cards.ts:74-110`)**

Trocar o bloco que hoje é:

```typescript
  const { workspaceId, mapId } = req.params;
  const userId = (req as AuthRequest).user!.userId;

  const [card] = await db
    .insert(cards)
    .values({ mapId, ...parsed.data })
    .returning();
```

por:

```typescript
  const { workspaceId, mapId } = req.params;
  const userId = (req as AuthRequest).user!.userId;

  // A posição pedida é um desejo, não uma ordem: se estiver ocupada, o card vai
  // pra vaga livre mais próxima. Card novo nunca nasce em cima de outro — nem
  // pela UI (que manda um ponto fixo pros irmãos) nem pelo MCP (que não manda
  // posição nenhuma). Arrastar depois continua livre pra sobrepor: o PUT não
  // passa por aqui.
  const existing = await db
    .select({ positionX: cards.positionX, positionY: cards.positionY })
    .from(cards)
    .where(eq(cards.mapId, mapId));

  const slot = findFreeSlot(
    { x: parsed.data.positionX ?? 0, y: parsed.data.positionY ?? 0 },
    { width: NODE_WIDTH, height: NODE_HEIGHT },
    existing.map((c) => ({
      x: c.positionX,
      y: c.positionY,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
  );

  const [card] = await db
    .insert(cards)
    .values({
      mapId,
      title: parsed.data.title,
      description: parsed.data.description,
      positionX: slot.x,
      positionY: slot.y,
    })
    .returning();
```

- [ ] **Step 6: Rodar o smoke inteiro e confirmar que passa**

De dentro de `artifacts/api-server`:

```bash
DATABASE_URL='postgresql://postgres.dzhdnaemauvtdchbkppp:8ffEOVU11yv3rEio@aws-1-sa-east-1.pooler.supabase.com:5432/postgres' JWT_SECRET='7396043fd27a4b1c4868c4bf8329a944b50410fe8d7847ff999122813450ea0d' npx vitest run src/__tests__/mapLayout.smoke.test.ts
```

Esperado: PASS, 7 testes.

- [ ] **Step 7: Rodar os smokes que já criavam cards, pra garantir que nada regrediu**

De dentro de `artifacts/api-server`:

```bash
DATABASE_URL='postgresql://postgres.dzhdnaemauvtdchbkppp:8ffEOVU11yv3rEio@aws-1-sa-east-1.pooler.supabase.com:5432/postgres' JWT_SECRET='7396043fd27a4b1c4868c4bf8329a944b50410fe8d7847ff999122813450ea0d' npx vitest run src/__tests__/cardTaskOwner.smoke.test.ts src/__tests__/approvalFlow.smoke.test.ts
```

Esperado: PASS. Em caso de falha por timeout, re-rode.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/routes/cards.ts artifacts/api-server/src/__tests__/mapLayout.smoke.test.ts
git commit -m "feat(api): card novo nasce em vaga livre em vez de sobrepor"
```

---

### Task 5: Contrato OpenAPI + codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Generated (não editar à mão): `lib/api-client-react/src/generated/`, `lib/api-zod/src/generated/`

**Interfaces:**
- Consumes: o contrato do endpoint da Task 3.
- Produces: hook `useLayoutMap` exportado de `@workspace/api-client-react`, usado pela Task 6.

- [ ] **Step 1: Adicionar o path no `openapi.yaml`**

Inserir logo **antes** da linha `  /workspaces/{workspaceId}/maps/{mapId}/cards:` (~linha 501):

```yaml
  /workspaces/{workspaceId}/maps/{mapId}/layout:
    post:
      operationId: layoutMap
      tags: [maps]
      summary: Auto-arrange map cards (dagre, minimizes edge crossings)
      parameters:
        - name: workspaceId
          in: path
          required: true
          schema:
            type: string
            format: uuid
        - name: mapId
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Cards repositioned
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/LayoutMapResponse"
```

- [ ] **Step 2: Adicionar o schema em `components.schemas`**

Localize o bloco `components:` → `schemas:` e adicione o schema abaixo, ao lado de `CardResponse` (para achar: procure por `    CardResponse:` no arquivo):

```yaml
    LayoutMapResponse:
      type: object
      required: [cards]
      properties:
        cards:
          type: array
          description: Only the cards whose position actually changed.
          items:
            type: object
            required: [id, positionX, positionY]
            properties:
              id:
                type: string
                format: uuid
              positionX:
                type: number
              positionY:
                type: number
```

- [ ] **Step 3: Rodar o codegen**

Da raiz do repo:

```bash
pnpm --config.verify-deps-before-run=false --filter @workspace/api-spec run codegen
```

Esperado: termina sem erro e cria/atualiza arquivos em `lib/api-client-react/src/generated/` e `lib/api-zod/src/generated/`.

- [ ] **Step 4: Confirmar que o hook foi gerado e anotar a assinatura**

```bash
grep -rn "useLayoutMap" lib/api-client-react/src/generated/ | head -5
```

Esperado: pelo menos um match (a definição do hook).

Agora **leia** a assinatura gerada de `layoutMap`/`useLayoutMap` e anote a forma exata das variáveis da mutation. Como o endpoint **não tem requestBody**, o Orval normalmente gera variáveis `{ workspaceId, mapId }` (sem `data`). A Task 6 depende disso — se a forma gerada for diferente, use a real.

- [ ] **Step 5: Typecheck dos pacotes gerados**

Da raiz do repo:

```bash
pnpm --config.verify-deps-before-run=false --filter @workspace/api-server run typecheck
```

Esperado: sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "feat(api-spec): contrato do POST /maps/:mapId/layout + codegen"
```

---

### Task 6: Botão "reorganizar" no canvas

**Files:**
- Modify: `artifacts/mindtask-app/src/pages/maps/canvas.tsx`

**Interfaces:**
- Consumes: `useLayoutMap` de `@workspace/api-client-react` (Task 5); `pushSnapshot` de `usePositionHistory` (já existe, `canvas.tsx:403`); `nodesRef` (`canvas.tsx:419`); `toast` (já importado e usado em `canvas.tsx:1031`).
- Produces: nada consumido por outras tasks.

**Contexto verificado:** o Ctrl+Z existente (`canvas.tsx:1620-1682`) lê `nodesRef.current`, chama `undo(currentSnapshot)`, aplica via `setNodes` **e persiste** cada nó movido via mutation. Então basta empurrar o snapshot ANTES do relayout que o Ctrl+Z desfaz e grava sozinho — sem código de undo novo.

- [ ] **Step 1: Importar o hook e o ícone**

No bloco de imports do topo do arquivo, adicionar `useLayoutMap` ao import existente de `@workspace/api-client-react` (o arquivo já importa vários hooks de lá, ex.: `useUpdateCard`, `useCreateCard`).

E adicionar o ícone `Wand2` ao import existente de `lucide-react` (o arquivo já importa `Image` de lá).

- [ ] **Step 2: Instanciar a mutation**

Logo abaixo de `const deleteShapeMut = useDeleteShape();` (~linha 1014):

```typescript
  const layoutMapMut = useLayoutMap();
```

- [ ] **Step 3: Implementar o handler**

Inserir logo após o bloco das mutations (antes de `const handleAddChildCard = useCallback(...)`, ~linha 1016):

```typescript
  // Reorganiza o mapa inteiro pelo layout do servidor. Empurra o snapshot das
  // posições atuais ANTES de chamar, então Ctrl+Z desfaz (e re-persiste) tudo —
  // por isso não há diálogo de confirmação.
  const handleAutoLayout = useCallback(() => {
    const snapshot: NodePositionSnapshot = {};
    for (const n of nodesRef.current) {
      snapshot[n.id] = { x: n.position.x, y: n.position.y };
    }
    pushSnapshot(snapshot);

    layoutMapMut.mutate(
      { workspaceId, mapId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
        },
        onError: () => {
          toast({
            title: "Erro ao reorganizar",
            description: "Não foi possível reorganizar o mapa. Tente novamente.",
            variant: "destructive",
          });
        },
      },
    );
  }, [workspaceId, mapId, layoutMapMut, pushSnapshot, queryClient]);
```

> Se o Step 4 da Task 5 mostrou uma assinatura diferente pra mutation, ajuste o objeto passado ao `.mutate()` pra bater com a gerada.

- [ ] **Step 4: Adicionar o botão no cluster de Controls**

Em `canvas.tsx` (~linha 2929), adicionar um `ControlButton` logo depois do botão "enquadrar", ainda dentro do `<Controls>`:

```tsx
              <ControlButton title="reorganizar" onClick={handleAutoLayout}>
                <Wand2 />
              </ControlButton>
```

- [ ] **Step 5: Subir o app e verificar na mão**

Em dois terminais, da raiz do repo:

```bash
pnpm --config.verify-deps-before-run=false --filter @workspace/api-server run dev
```

```bash
pnpm --config.verify-deps-before-run=false --filter @workspace/mindtask-app run dev
```

Abrir `http://localhost:3000`, entrar num mapa com pelo menos 3 cards conectados em cadeia, arrastar os cards pra posições bagunçadas e clicar no botão "reorganizar" (o da varinha, no cluster de zoom).

Esperado, e **confirme cada um**:
1. Os cards se reorganizam em colunas da esquerda pra direita, sem sobreposição.
2. `Ctrl+Z` devolve os cards às posições de antes do clique.
3. Recarregar a página (F5) mantém as posições reorganizadas (persistiu no banco).

- [ ] **Step 6: Commit**

```bash
git add artifacts/mindtask-app/src/pages/maps/canvas.tsx
git commit -m "feat(web): botão reorganizar no canvas do plano de ação"
```

---

### Task 7: Triggers no MCP

**Files (repo `c:/Users/gusta/Projetos/bloquim-mcp`):**
- Modify: `src/tools/create_task_dependencies.ts`
- Modify: `src/tools/scaffold_plan.ts`
- Modify: `src/lib/plan-graph.ts:41-78` (remover `topologicalLayout`)
- Modify: `tests/plan-graph.test.ts:37-48` (remover os testes de `topologicalLayout`)

**Interfaces:**
- Consumes: `POST /workspaces/:workspaceId/maps/:planId/layout` (Task 3).
- Produces: nada consumido por outras tasks.

**Contexto verificado:**
- Este repo usa **Zod v3** (`^3.24.1`) e roda testes com `node:test` (`pnpm test` → `node --import tsx --test tests/*.test.ts`).
- `topologicalLayout` é usado **só** pelo `scaffold_plan.ts` → depois desta task vira código morto e sai junto. `longestPath` continua em uso (`src/lib/plan-progress-compute.ts:102`) — **não remover**. `detectCycle` e `findUnknownRefs` continuam em uso pelo `scaffold_plan` — **não remover**.

- [ ] **Step 1: Criar a branch**

```bash
git -C "c:/Users/gusta/Projetos/bloquim-mcp" checkout -b feat/canvas-auto-layout
```

- [ ] **Step 2: Remover os testes de `topologicalLayout`**

Em `tests/plan-graph.test.ts`, apagar os dois testes das linhas 37-48 (`'topologicalLayout: camadas por profundidade'` e `'topologicalLayout: sem edges → grid (todos x=0 escalonando y)'`) e remover `topologicalLayout` da lista de imports no topo do arquivo.

- [ ] **Step 3: Rodar os testes e confirmar que falha**

Da raiz do `bloquim-mcp`:

```bash
pnpm test
```

Esperado: FAIL no typecheck/import — `src/tools/scaffold_plan.ts` ainda importa `topologicalLayout`, que a Step 4 vai remover. (Se passar, siga mesmo assim: o gate real é o Step 8.)

- [ ] **Step 4: Remover `topologicalLayout` de `src/lib/plan-graph.ts`**

Apagar a função inteira (linhas 41-78, do comentário `// Layout por nível topológico...` até o `}` que fecha a função). Manter `findUnknownRefs`, `detectCycle`, `longestPath` e as constantes de handle.

- [ ] **Step 5: Ajustar `scaffold_plan.ts` — imports e layout**

Trocar o bloco de import (linhas 5-12) de:

```typescript
import {
  detectCycle,
  findUnknownRefs,
  topologicalLayout,
  CASCADE_SOURCE_HANDLE,
  CASCADE_TARGET_HANDLE,
  type Edge,
} from "../lib/plan-graph.js";
```

para:

```typescript
import {
  detectCycle,
  findUnknownRefs,
  CASCADE_SOURCE_HANDLE,
  CASCADE_TARGET_HANDLE,
  type Edge,
} from "../lib/plan-graph.js";
```

Trocar o bloco de layout (linhas 94-96) de:

```typescript
    // --- Layout ---
    const useAuto = args.autoLayout ?? args.tasks.every((t) => t.positionX === undefined && t.positionY === undefined);
    const layout = useAuto ? topologicalLayout(refs, edges) : null;
```

para:

```typescript
    // --- Layout ---
    // Quando autoLayout, o posicionamento final vem do endpoint /layout no fim
    // (dagre, minimiza cruzamento de linhas) — um algoritmo só, compartilhado
    // com o botão da UI. Cards criados sem posição caem em vaga livre pelo
    // próprio servidor, então nada empilha enquanto o plano é montado.
    const useAuto = args.autoLayout ?? args.tasks.every((t) => t.positionX === undefined && t.positionY === undefined);
```

- [ ] **Step 6: Ajustar `scaffold_plan.ts` — payload do card**

Trocar o trecho dentro do loop de criação (linhas ~128-134) de:

```typescript
        const pos = layout?.get(t.ref);
        const cardPayload: Record<string, unknown> = { title: t.title };
        if (t.description !== undefined) cardPayload.description = t.description === null ? null : markdownToHtml(t.description);
        const px = t.positionX ?? pos?.x;
        const py = t.positionY ?? pos?.y;
        if (px !== undefined) cardPayload.positionX = px;
        if (py !== undefined) cardPayload.positionY = py;
```

para:

```typescript
        const cardPayload: Record<string, unknown> = { title: t.title };
        if (t.description !== undefined) cardPayload.description = t.description === null ? null : markdownToHtml(t.description);
        if (t.positionX !== undefined) cardPayload.positionX = t.positionX;
        if (t.positionY !== undefined) cardPayload.positionY = t.positionY;
```

- [ ] **Step 7: Ajustar `scaffold_plan.ts` — chamar o layout no fim**

Inserir logo **antes** do `return {` final do bloco `try` (linha ~192, depois do loop que cria as arestas):

```typescript
    // Relayout final: com todos os cards e arestas no lugar, o dagre arruma o
    // plano inteiro. Falhar aqui NÃO derruba o scaffold — plano e tarefas já
    // existem e são o efeito primário; layout é cosmético.
    let layoutFailed: string | undefined;
    if (useAuto && createdTasks.length > 0) {
      try {
        await getBloquimClient().post(`/workspaces/${args.workspaceId}/maps/${planId}/layout`, {});
      } catch (e) {
        layoutFailed = formatBloquimError(e);
      }
    }
```

E no objeto do `JSON.stringify` do return, adicionar a chave logo depois de `failedDeps`:

```typescript
              failedDeps,
              ...(layoutFailed ? { layoutFailed } : {}),
```

- [ ] **Step 8: Rodar os testes e o typecheck do MCP**

Da raiz do `bloquim-mcp`:

```bash
pnpm test
```

Esperado: PASS (os testes restantes de `plan-graph`, `plan-progress-compute`, `group-gate`, `tool-result`, `whatsapp-context`).

```bash
pnpm typecheck
```

Esperado: sem erros.

- [ ] **Step 9: Commit do scaffold**

```bash
git -C "c:/Users/gusta/Projetos/bloquim-mcp" add src/tools/scaffold_plan.ts src/lib/plan-graph.ts tests/plan-graph.test.ts
git -C "c:/Users/gusta/Projetos/bloquim-mcp" commit -m "feat: scaffold_plan usa o layout do servidor (dagre) em vez do topológico local"
```

- [ ] **Step 10: Adicionar `autoLayout` ao schema do `create_task_dependencies.ts`**

Trocar o schema (linhas 11-26) — adicionar a chave `autoLayout` ao final do objeto, depois de `dependencies`:

```typescript
  autoLayout: z
    .boolean()
    .optional()
    .describe(
      "Se true (default), reorganiza o layout do plano depois de criar as arestas, minimizando cruzamento de linhas. Passe false pra preservar as posições atuais dos cards.",
    ),
```

E trocar o type (linha 29) de:

```typescript
type Args = { workspaceId: string; planId: string; dependencies: Dep[] };
```

para:

```typescript
type Args = { workspaceId: string; planId: string; dependencies: Dep[]; autoLayout?: boolean };
```

- [ ] **Step 11: Chamar o layout depois de criar as arestas**

Inserir logo **antes** do `return {` do bloco `try` (linha ~106, depois do loop `for (const dep of args.dependencies)`):

```typescript
    // As conexões mudaram → o arranjo dos cards muda junto. Falhar aqui NÃO
    // derruba a operação: as arestas já foram criadas e são o efeito primário;
    // layout é cosmético.
    let layoutFailed: string | undefined;
    if ((args.autoLayout ?? true) && created.length > 0) {
      try {
        await getBloquimClient().post(
          `/workspaces/${args.workspaceId}/maps/${args.planId}/layout`,
          {},
        );
      } catch (err) {
        layoutFailed = formatBloquimError(err);
      }
    }
```

E no objeto do `JSON.stringify` do return, adicionar a chave logo depois de `failed`:

```typescript
              failed,
              ...(layoutFailed ? { layoutFailed } : {}),
```

- [ ] **Step 12: Rodar testes + typecheck do MCP**

Da raiz do `bloquim-mcp`:

```bash
pnpm test
```

Esperado: PASS.

```bash
pnpm typecheck
```

Esperado: sem erros.

- [ ] **Step 13: Commit**

```bash
git -C "c:/Users/gusta/Projetos/bloquim-mcp" add src/tools/create_task_dependencies.ts
git -C "c:/Users/gusta/Projetos/bloquim-mcp" commit -m "feat: create_task_dependencies reorganiza o plano ao mudar conexões"
```

---

## Gate final (antes de abrir PR)

- [ ] **Suíte api-server inteira**

De dentro de `artifacts/api-server`:

```bash
DATABASE_URL='postgresql://postgres.dzhdnaemauvtdchbkppp:8ffEOVU11yv3rEio@aws-1-sa-east-1.pooler.supabase.com:5432/postgres' JWT_SECRET='7396043fd27a4b1c4868c4bf8329a944b50410fe8d7847ff999122813450ea0d' npx vitest run
```

Esperado: verde. Falha por **timeout** nos testes pesados de aprovação é flakiness ambiental — **re-rode** antes de tratar como regressão.

- [ ] **Typecheck do front (gate relativo)**

```bash
pnpm --config.verify-deps-before-run=false --filter @workspace/mindtask-app run typecheck
```

O `mindtask-app` tem ~71 erros de tsc **pré-existentes** no baseline e o deploy usa `vite build` (sem tsc). O gate é **não introduzir erro novo** — compare a contagem/os arquivos com o baseline em `master`, não espere zero.

- [ ] **Build do front**

```bash
pnpm --config.verify-deps-before-run=false --filter @workspace/mindtask-app run build
```

Esperado: build conclui sem erro.

- [ ] **Lockfile bate com o que o container espera**

Da raiz do repo:

```bash
pnpm install --frozen-lockfile
```

Esperado: sem `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. Se falhar, refaça o Step 2 da Task 1 (regen com corepack pnpm@9.15.9).

---

## Notas de deploy (execução humana — Gustavo)

- Sem migration de banco.
- `beeads-bloquim`: merge da branch → deploy dos **dois** apps via Coolify API (push no master não auto-deploya): `POST /deploy?uuid=vtam7v68bqpnqgn5abg367su` (api) e `POST /deploy?uuid=w13ao41nt7n4jc3mhekk73mb` (web).
- `bloquim-mcp`: ciclo próprio de deploy.
- **Ordem importa:** o MCP passa a chamar `/layout`, que só existe depois do deploy da api. Deployar `beeads-bloquim` **antes** do `bloquim-mcp`. Enquanto o endpoint não existir, o MCP degrada de forma limpa (`layoutFailed` no payload, arestas criadas normalmente).
