# Canvas Auto-Layout — Fase 1

**Data:** 2026-07-14
**Branch:** `feat/canvas-auto-layout` (repo `beeads-bloquim`) + branch equivalente no repo `bloquim-mcp`
**Status:** design aprovado, pronto pra plano de implementação

## Problema

Reorganizar cards no mapa de ação (canvas ReactFlow) consome tempo e esforço manual do usuário:

1. **Criação avulsa na UI** — um card novo nasce no centro do viewport (`handleAddCard`) ou em offset fixo `parent.x + 280, parent.y` (`handleAddChildCard`), sem checar ocupação. O segundo filho de um mesmo pai cai exatamente em cima do primeiro.
2. **Criação via MCP** — `POST /cards` tem default `positionX/Y = 0`. `create_task(planId)`, `create_tasks` e `attach_task_to_plan` não calculam posição → todo card empilha em `(0,0)`.
3. **Sem reorganização** — não existe engine de layout no app (só um `topologicalLayout` simples dentro do `bloquim-mcp`, usado uma única vez no `scaffold_plan`). Depois que dependências mudam, nada reposiciona; linhas conectoras se cruzam e cards se sobrepõem.

O objetivo é reduzir esse trabalho manual: cards nascem sem sobrepor, e há um comando ("arrumar tudo") que reorganiza minimizando cruzamento de linhas — acionável pelo usuário (botão) e automaticamente quando o workflow muda via MCP.

## Escopo (Fase 1)

**Inclui:**
- Engine de layout server-side (dagre) como fonte única da verdade, exposta por endpoint.
- Placement de vaga livre na criação de card (UI + API) quando não há posição explícita.
- Botão "reorganizar" no canvas (undoable).
- Triggers de relayout no MCP quando **conexões** mudam.

**Não inclui (fases posteriores, fora deste doc):**
- Snap-to-grid (Fase 2).
- Física de empurrar cards ao arrastar (Fase 3).
- Layout específico/refinado de subgrafos de aprovação.

## Decisões de design (aprovadas)

| Decisão | Escolha | Razão |
|---|---|---|
| Onde roda o layout | Server-side, endpoint REST | Único jeito do botão da UI **e** do MCP compartilharem o mesmo algoritmo. |
| Algoritmo | **dagre** (`@dagrejs/dagre`) | Sugiyama minimiza cruzamento de arestas por barycenter — exatamente o objetivo. Pure-JS, sem binário nativo (seguro no build alpine/musl). O `topologicalLayout` atual só empilha por nível, não minimiza cruzamento. |
| Direção | **LR** (horizontal) | Casa com os handles atuais `source-right` → `target-left`. |
| Cards de aprovação | **Excluídos** do relayout | Posições derivadas do sistema de aprovação (join nodes + edges auto-geradas em FE, não persistidas como `card_connections`). Mexer quebraria o agrupamento. |
| Granularidade do trigger MCP | Full relayout **só** em mudança de conexão | Casa com "sempre que houver alteração nas conexões". Ops que só adicionam nó (create/attach) usam free-slot, não relayout — não bagunçam arranjo manual a cada card. |
| Botão de reorganizar | Sem diálogo de confirmação | Reversível via Ctrl+Z (sistema de snapshot `usePositionHistory` já existe). |

## Arquitetura

Três componentes independentes sobre uma engine compartilhada.

```
┌─────────────────────────────────────────────────────────────┐
│ api-server                                                   │
│                                                              │
│  mapLayoutService.ts  ── dagre (LR) ──► posições dos cards   │
│         ▲                                                    │
│         │ usado por                                          │
│  ┌──────┴───────────────────────┐                            │
│  │ POST .../maps/:mId/layout     │ ◄── botão UI              │
│  │ (relayout completo, persiste) │ ◄── MCP (conexão mudou)   │
│  └───────────────────────────────┘                          │
│                                                              │
│  collision.ts (free-slot)                                    │
│         ▲                                                    │
│         │ usado por                                          │
│  POST .../cards  (quando positionX/Y omitidos)               │
└─────────────────────────────────────────────────────────────┘
        ▲                                    ▲
        │ REST                               │ REST
┌───────┴─────────┐                 ┌────────┴──────────┐
│ mindtask-app     │                 │ bloquim-mcp       │
│ - botão canvas   │                 │ - deps → relayout │
│ - free-slot na   │                 │ - scaffold → relay│
│   criação (client)│                 │ - create/attach → │
└──────────────────┘                 │   free-slot only  │
                                     └───────────────────┘
```

### Componente 1 — Engine de layout (server)

**`artifacts/api-server/src/services/mapLayoutService.ts`** (módulo puro, testável isolado).

Interface:
```ts
type LayoutNode = { id: string; width: number; height: number };
type LayoutEdge = { source: string; target: string };
type LayoutResult = Map<string, { x: number; y: number }>;

function computeLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts?: { rankdir?: 'LR' | 'TB'; ranksep?: number; nodesep?: number },
): LayoutResult;
```

- Usa dagre: `rankdir='LR'`, `ranksep≈120`, `nodesep≈48`, dimensões nominais do card `200×80` (constantes `NODE_W`/`NODE_H` do canvas). dagre já entrega posição de centro → converter pra top-left (`x - width/2`, `y - height/2`) pra casar com a convenção `positionX/Y` (top-left) do banco.
- Nós **isolados** (sem aresta) — incluindo cards que não são aprovação — são dispostos numa grade compacta abaixo/ao lado do subgrafo principal (dagre os empilharia arbitrariamente; a grade evita sobreposição).
- Função pura, sem I/O. Determinística (mesma entrada → mesma saída) pra ser testável.

**Endpoint:** `POST /api/workspaces/:workspaceId/maps/:mapId/layout`
- Adicionado ao `maps.ts` router (`requireAuth` + `requireWorkspaceRole(["admin","editor"])` + `requireMapInWorkspace`).
- Handler:
  1. Carrega cards + `card_connections` do mapa.
  2. Separa cards de aprovação (`tasks.isApprovalTask` / `parentTaskId`) — ficam de fora, mantêm posição atual.
  3. Chama `computeLayout` com os cards restantes e as conexões entre eles.
  4. Persiste novas posições em lote (um UPDATE por card, ou `CASE`/batch numa transação).
  5. Retorna `{ cards: [{ id, positionX, positionY }] }` (só os movidos).
- Idempotente: rodar duas vezes seguidas produz o mesmo resultado.

### Componente 2 — Free-slot placement na criação

**Helper de colisão** (busca vaga livre perto de um ponto pretendido, espiral/scan por offsets):
```ts
function findFreeSlot(
  desired: { x: number; y: number },
  occupied: Array<{ x: number; y: number; width: number; height: number }>,
  box: { width: number; height: number },
  step?: number,
): { x: number; y: number };
```

- **API** — `artifacts/api-server/src/routes/cards.ts` POST: quando `positionX`/`positionY` **omitidos** (hoje default `(0,0)`), carrega bboxes dos cards existentes no mapa e chama `findFreeSlot` a partir de um ponto base (ex.: origem ou centro do bounding box atual). Se posição vier explícita, respeita como hoje.
  - Muda o schema: `positionX/Y` deixam de ter `.default(0)`; passam a `optional()` sem default, e o handler decide (mantém compat: quem manda posição continua igual).
- **UI** — `mindtask-app` `handleAddCard`, `handleAddChildCard`, `createCardAt`: computam vaga livre client-side a partir do `nodesRef.current` (já tem todas as posições/dimensões) antes do `createCardMut.mutate`. Dá placement preciso perto do viewport/pai sem round-trip. O servidor continua sendo a rede de segurança pro caso do MCP.

### Componente 3 — Botão no canvas + triggers MCP

**Botão UI** — no cluster de `Controls` do canvas (`canvas.tsx`), ícone de "reorganizar":
1. Monta snapshot de todas as posições atuais → `pushSnapshot(snapshot)` (undo).
2. Chama o endpoint de layout (novo hook React Query `useLayoutMap` via Orval).
3. `invalidateQueries` do mapa → cards refazem posição. (Animação de transição é nice-to-have, não requisito.)
- Reversível com Ctrl+Z já existente.

**Triggers MCP** (`bloquim-mcp`):
- `create_task_dependencies` → após criar as arestas, `POST .../maps/:planId/layout`. Novo param `autoLayout?: boolean` (default `true`) pra opt-out.
- `scaffold_plan` → após criar cards + arestas, chama o mesmo endpoint no fim (substitui o `topologicalLayout` local pelo dagre — algoritmo único, melhor anti-cruzamento). Mantém `autoLayout` já existente como gate.
- `create_task(planId)` / `create_tasks` / `attach_task_to_plan` → **sem** relayout completo. Dependem do free-slot placement do servidor (Componente 2). Nenhuma mudança de comportamento além de não empilhar mais em `(0,0)`.

## Fluxo de dados

**Criar card via MCP (`create_task` com planId):**
```
MCP → POST /cards (sem positionX/Y)
      → handler detecta posição omitida
      → carrega bboxes do mapa, findFreeSlot()
      → insere card em vaga livre
```

**Adicionar dependência via MCP:**
```
MCP create_task_dependencies → POST /connections (N arestas)
      → POST /maps/:id/layout (autoLayout=true)
      → computeLayout(cards, edges) → persiste
      → retorna posições novas
```

**Botão reorganizar (UI):**
```
click → pushSnapshot(posições atuais)  [undo]
      → useLayoutMap.mutate()
      → invalidateQueries(map)
      → cards remontam nas posições do dagre
```

## Contrato OpenAPI / codegen

- Adicionar `POST /workspaces/{workspaceId}/maps/{mapId}/layout` ao `lib/api-spec/openapi.yaml` (response: array de `{id, positionX, positionY}`).
- Rodar `pnpm --filter @workspace/api-spec run codegen` → gera hook `useLayoutMap` + schema Zod.
- Nunca editar arquivos gerados.

## Tratamento de erros

- Endpoint com mapa vazio (0 cards) → retorna `{cards:[]}`, no-op.
- Card sem dimensão conhecida → usa nominal `200×80`.
- Ciclo em `card_connections` — dagre tolera ciclos (não quebra), mas o produto trata dependências como DAG. Não validamos aciclicidade aqui (é responsabilidade do MCP no `create_task_dependencies`); layout apenas posiciona o que existe.
- Falha do relayout no MCP após criar arestas → **não** falha a operação inteira; retorna as arestas criadas + um aviso `layoutFailed` no payload. A criação de dependência é o efeito primário; layout é cosmético.
- Free-slot que não acha vaga em N iterações → cai no ponto pretendido (degrada pra comportamento atual, sem travar).

## Testes

- **`mapLayoutService` (unit, api-server):** função pura → grafo linear (A→B→C) vira 3 colunas; grafo em diamante (A→B, A→C, B→D, C→D) sem sobreposição; nós isolados vão pra grade; determinismo (2 chamadas = mesma saída); conversão center→top-left correta.
- **`findFreeSlot` (unit):** ponto livre retorna o próprio ponto; ponto ocupado retorna vizinho não-sobreposto; sem vaga em N iter retorna o pretendido.
- **Endpoint `/layout` (smoke, api-server):** cria mapa com cards+conexões, POST layout, assert posições mudaram e não sobrepõem; cards de aprovação mantêm posição; role executor recebe 403.
- **MCP (manual/smoke):** `create_task_dependencies` reposiciona; `scaffold_plan` usa dagre; `create_task(planId)` não empilha em (0,0).

## Deploy

- Nova dep `@dagrejs/dagre` no `api-server` (pure-JS, sem binário nativo — não bate no gotcha rollup-musl do Dockerfile).
- Migration de banco: **nenhuma** (reusa colunas `positionX/Y` existentes).
- Deploy do `beeads-bloquim` via Coolify (push → rebuild); MCP (`bloquim-mcp`) tem seu próprio ciclo.
- Regenerar lockfile com pnpm 9.15.9 se `@dagrejs/dagre` alterar o `pnpm-lock.yaml` (gotcha conhecido do Dockerfile).

## Arquivos afetados

**beeads-bloquim:**
- `artifacts/api-server/src/services/mapLayoutService.ts` (novo)
- `artifacts/api-server/src/lib/collision.ts` (novo — `findFreeSlot`)
- `artifacts/api-server/src/routes/maps.ts` (endpoint `/layout`)
- `artifacts/api-server/src/routes/cards.ts` (free-slot no POST)
- `lib/api-spec/openapi.yaml` (+ codegen gerado)
- `artifacts/mindtask-app/src/pages/maps/canvas.tsx` (botão + free-slot client)
- testes unit + smoke

**bloquim-mcp:**
- `src/tools/create_task_dependencies.ts` (trigger + `autoLayout`)
- `src/tools/scaffold_plan.ts` (usa endpoint de layout)
- `src/lib/bloquim.ts` (helper de chamada ao endpoint, se necessário)
