# Mapa Estratégico do Workspace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o Mapa Estratégico — um grafo tipado e livre, um por workspace, reusando o canvas ReactFlow do plano de ação via um componente base compartilhado, sem regressão no plano de ação.

**Architecture:** Canvas estratégico é uma linha em `maps` (`maps.kind='strategy'`) por workspace, para compartilhar literalmente formas/texto/imagem/presença (chaveadas por `map_id`). Um componente de canvas base parametrizado por `mode: 'action'|'strategy'` troca só renderer de nó e comportamento de aresta. Camada de estratégia em tabelas `strategy_*` (nós + satélites tipados 1:1 + arestas + ciclos). KR manual com saúde ciente de ritmo (vs. ciclo). Tudo aditivo.

**Tech Stack:** React 19 · Vite · ReactFlow 11 · TanStack Query v5 · Zustand · Express 5 · Drizzle (drizzle-kit) · Postgres/Supabase · Vitest+Supertest · OpenAPI→Orval codegen · `@beeads/ui`.

**Spec:** `docs/superpowers/specs/2026-06-07-mapa-estrategico-design-v2.md` (autoritativa — em conflito, a spec vence).

---

## Como o codex é usado neste plano (orquestração estratégica)

Dividir trabalho pela força de cada motor:

| Trabalho | Motor | Por quê |
|---|---|---|
| **Refactor do monolito** canvas.tsx (3007 linhas) → base compartilhada | **codex** dirige o refactor mecânico multi-arquivo; **Claude** escreve o gate de regressão ANTES e revisa o diff | codex é forte em refactor grande preservando comportamento; o risco (regressão) é controlado por testes que Claude possui |
| **Scaffolding de schema/migration** (tabelas `strategy_*`, openapi.yaml) | **codex** rascunha a partir das tabelas da spec; **Claude** revisa campo-a-campo contra §6 | volume mecânico; conformidade é de Claude |
| **Scaffolding de rotas CRUD** seguindo padrão `maps.ts` | **codex** scaffolda handlers; **Claude** escreve os smoke tests (TDD) e revisa | boilerplate repetitivo; corretude/teste é de Claude |
| **Matemática de floating edges** (interseção linha↔borda) | **codex** implementa a geometria; **Claude** verifica casos-limite | algoritmo isolado e bem-definido |
| **Validação final do plano e da implementação** | **codex** revisão adversarial; **Claude** triagem | segunda opinião independente |

**Regra de ouro:** codex produz volume; **Claude possui os testes, o gate de não-regressão e a conformidade com a spec.** Nenhum merge sem regressão verde.

**Como invocar codex:** subagente `codex:codex-rescue` (via Agent tool) com o arquivo-alvo e instruções precisas; ou skill `codex:rescue`. Sempre passar a spec como fonte de verdade.

---

## Pré-requisitos e comandos (verificados no repo)

```bash
# raiz do git: c:/Users/gusta/Projetos/beeads-bloquim/repo  (branch feature/mapa-estrategico-spec)
pnpm install

# Migrations (drizzle-kit): editar lib/db/src/schema/*.ts, depois:
pnpm --filter @workspace/db run generate     # gera SQL em lib/db/drizzle/ (próxima: 0038_*)
pnpm --filter @workspace/db run push         # aplica no Postgres local

# Testes (Vitest + Supertest): artifacts/api-server/src/__tests__/
pnpm --filter @workspace/api-server run test         # roda uma vez
pnpm --filter @workspace/api-server run test:watch   # watch

# Typecheck (lib + artifacts)
pnpm run typecheck

# Codegen (OpenAPI → Orval hooks + Zod)
pnpm --filter @workspace/api-spec run codegen   # após editar lib/api-spec/openapi.yaml

# Dev local
pnpm --filter @workspace/api-server run dev      # porta 5000
pnpm --filter @workspace/mindtask-app run dev    # porta 3000
```

**Padrões do repo a seguir:**
- Rotas: cada arquivo em `artifacts/api-server/src/routes/` faz `export default Router`; montadas em `routes/index.ts`. Aninhamento atual: `/workspaces/:workspaceId/maps/...`. Middlewares `requireAuth` + `requireWorkspaceRole([...])` de `../middlewares/`.
- Schema: `lib/db/src/schema/*.ts` (um arquivo por domínio), reexportado pelo index. Drizzle. Migrations numeradas, **nunca** hand-edited.
- Testes: helpers `registerAndLogin()`, `makeAgent()`, `deleteUser()` em `__tests__/helpers.ts`. Cleanup em `afterAll`.
- Front: hooks gerados pelo Orval consumidos via `@workspace/api-client-react`. Canvas em `pages/maps/canvas.tsx`; node/edgeTypes registrados perto da linha 35.

---

## File Structure (o que será criado/modificado)

**Schema (lib/db/src/schema/):**
- Modify `maps.ts` — coluna `kind` + índice único parcial.
- Create `strategyCycles.ts`, `strategyNodes.ts`, `strategyEntities.ts` (satélites objetivo/kr/tema/swot/recurso/plano), `strategyEdges.ts`.
- Modify `index.ts` (reexport).

**API (artifacts/api-server/src/):**
- Create `routes/strategy.ts` (nós, arestas, ciclos, GET grafo).
- Modify `routes/index.ts` (montar router).
- Create `services/strategyHealth.ts` (cálculo de saúde — §8.1).
- Create `services/mapsScope.ts` (guarda por escopo default `kind='action'` — gap #5) e aplicar nos pontos de listagem.
- Create `__tests__/strategy.smoke.test.ts`, `__tests__/mapsKindScope.smoke.test.ts`, `__tests__/strategyHealth.test.ts`.

**Codegen (lib/api-spec/):**
- Modify `openapi.yaml` (paths + schemas de strategy).

**Front (artifacts/mindtask-app/src/):**
- Create `components/canvas-base/` (componente base extraído — Fase 1).
- Modify `pages/maps/canvas.tsx` (passar a usar a base, `mode='action'`).
- Create `pages/strategy/canvas.tsx` (`mode='strategy'`).
- Create `components/strategy/` (ObjectiveNode, KrNode, ThemeNode, SwotNode, ResourceNode, PlanNode, FloatingEdge, SuggestionButton, OrphanBadge, HealthPill, CycleBar).
- Modify a aba do workspace (adicionar "Estratégia").

---

## FASE 0 — Rede de segurança e seam de extração

**Objetivo:** estabelecer o gate de não-regressão ANTES de tocar no canvas, e mapear o seam de extração. Nenhum código de produto ainda.

### Task 0.1 — Gate de regressão da **camada de dados** do canvas (API)

> **Escopo honesto (correção da revisão):** este gate cobre a **camada de dados** (CRUD que o canvas consome), **não** o render/interação do ReactFlow. Não chamar isto de "não-regressão do canvas" — a regressão de render é coberta pelo checklist manual 0.2 + testes de caracterização de componente (Task 1.1). Os dois juntos formam o gate.

**Files:**
- Test: `artifacts/api-server/src/__tests__/canvasDataLayer.smoke.test.ts`

- [ ] **Step 1: Escrever smoke tests cobrindo o CRUD que o canvas do plano de ação depende** (maps, cards, connections, shapes, text-elements) — cada um: criar→ler→atualizar→deletar, afirmando shape e status. Usar helpers existentes.

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser } from "./helpers";

describe("canvas data layer regression (action plan)", () => {
  const userIds: string[] = [];
  afterAll(async () => { for (const id of userIds) await deleteUser(id); });

  it("map + card + connection + shape + text CRUD survive", async () => {
    const { agent, user } = await registerAndLogin();
    userIds.push(user.id);
    const ws = (await agent.post("/api/workspaces").send({ name: "WS" })).body;
    const map = (await agent.post(`/api/workspaces/${ws.id}/maps`).send({ name: "M" })).body;
    expect(map.kind ?? "action").toBe("action"); // após Fase 2, kind existe e default action
    // ... card create/read/update/delete, connection, shape, text-element
    // (expandir cada recurso seguindo as rotas atuais; ver routes/cards.ts etc.)
  });
});
```

- [ ] **Step 2: Rodar e ver passar no estado atual** — `pnpm --filter @workspace/api-server run test -- canvasRegression` → PASS. Este é o baseline congelado.
- [ ] **Step 3: Commit** — `git commit -m "test: gate de regressão da camada de dados do canvas"`.

> **codex aqui:** dispare `codex:codex-rescue` para expandir os passos de CRUD de cada recurso (card/connection/shape/text) lendo as rotas reais em `routes/`. Claude revisa que cobre as operações que o canvas usa.

### Task 0.2 — Checklist manual de smoke do canvas (não automatizável sem Playwright)

**Files:** Create `docs/superpowers/plans/canvas-smoke-checklist.md`

- [ ] **Step 1: Escrever um checklist manual REPRODUTÍVEL** do plano de ação, executável por alguém sem contexto. Incluir: setup exato (criar workspace X, map Y, papel do usuário), nº de abas/browser, e por item um **critério de aprovação visual explícito**. Itens: abrir map, criar card, ligar 2 cards, arrastar nó, criar texto, forma, imagem, ver cursor de outro user em 2 abas, zoom, pan, seleção múltipla, deletar. Rodapé com campos: data, commit SHA, desvios observados.
- [ ] **Step 2: Commit.**

### Task 0.3 — Seam de extração + inspeção de undo/redo

**Files:** Create `docs/superpowers/plans/canvas-extraction-seam.md`

- [ ] **Step 1 (codex-assistido):** dispare `codex:codex-rescue` para ler `artifacts/mindtask-app/src/pages/maps/canvas.tsx` (3007 linhas) e produzir um mapa: que estado/handlers são **genéricos de canvas** (zoom, pan, seleção, formas, texto, imagem, presença, toolbar shell) vs. **específicos do plano de ação** (card↔task, conexões fixas esq/dir, aprovação). Saída = tabela função/bloco → categoria.
- [ ] **Step 2:** Claude revisa e marca o **seam** (interface `mode`): props que a base recebe, slots que o `mode` injeta (nodeTypes, edgeTypes, botões da toolbar, handler de criar nó). Sem código ainda — só o contrato.
- [ ] **Step 3 (undo/redo — §7.7):** inspecionar se o canvas atual tem undo/redo. **Se tem:** registrar que o CanvasBase deve preservá-lo para `action` e decidir se `strategy` herda (provável sim, de graça). **Se não tem:** marcar explicitamente fora do v1 com a nota da spec. Registrar a conclusão no doc de seam.
- [ ] **Step 4 (gap-to-verify — RTL):** verificar se `@testing-library/react` + setup vitest jsdom existe no `mindtask-app` (procurar em package.json + vitest config). Registrar SIM/NÃO — decide se a Fase 4 usa testes de componente (se SIM) ou só smoke manual + flag de débito (se NÃO).
- [ ] **Step 5: Commit** do documento de seam.

**Checkpoint Fase 0:** gate de dados verde + seam documentado + undo/redo e RTL resolvidos. Review antes da Fase 1.

---

## FASE 1 — Extração do canvas base compartilhado (refactor preservando comportamento)

**Objetivo:** extrair `components/canvas-base/` e fazer o plano de ação atual consumi-lo com `mode='action'`, **comportamento idêntico**. Nenhuma feature de estratégia ainda.

> **Esta é a fase mais arriscada. codex dirige o refactor mecânico; Claude possui o gate e revisa cada fatia.**
>
> **Invariante da Fase 1 (correção da revisão):** ZERO mudança de schema/API/codegen; ZERO chamada a rota de strategy; o `CanvasBase` renderiza comportamento `action` **só a partir dos dados de map já existentes**. Se qualquer coisa de estratégia vazar aqui, a fatia está errada.

### Task 1.0 — Testes de caracterização de unidades puras do canvas

**Files:** Test em `artifacts/mindtask-app/src/**/__tests__/` (criar se preciso; depende do resultado RTL/Task 0.4).

- [ ] **Step 1:** Para cada helper/redutor **puro** identificável no seam (cálculo de posição, normalização de nós/arestas, lógica de seleção), escrever teste de caracterização que congela a saída atual. (Se RTL não estiver configurado, cobrir só funções puras extraíveis; render fica no checklist 0.2.)
- [ ] **Step 2:** Rodar → PASS (baseline). **Commit.**

### Task 1.1 — Extração INCREMENTAL do canvas base (uma fatia por commit)

**Files:**
- Create: `artifacts/mindtask-app/src/components/canvas-base/` (CanvasBase.tsx + submódulos por fatia)
- Modify: `artifacts/mindtask-app/src/pages/maps/canvas.tsx` (vira wrapper `mode='action'`)

> **Extrair em fatias pequenas, NÃO num passo único** (correção: um passo de codex sobre 3007 linhas = rollback caro). Após **cada** fatia: `pnpm run typecheck` + testes de caracterização (1.0) + checklist manual 0.2 das partes afetadas + **commit**. codex executa a fatia, Claude revisa o diff e roda o gate.

- [ ] **Step 1 — Contrato:** definir `CanvasBaseProps` conforme o seam: `{ mode, mapId, nodeTypes, edgeTypes, toolbarItems, onCreateNode, edgeBehavior }`. Só o tipo. Commit.
- [ ] **Step 2 — Fatia A (utilidades/constantes puras):** mover utils e constantes genéricas para `canvas-base/`. Gate + commit.
- [ ] **Step 3 — Fatia B (toolbar shell):** extrair o shell da toolbar (posição/design), recebendo `toolbarItems` por prop. Gate + commit.
- [ ] **Step 4 — Fatia C (camadas formas/texto/imagem):** extrair render+handlers de shapes/text/image. Gate + commit.
- [ ] **Step 5 — Fatia D (viewport/presença):** extrair zoom/pan/seleção + camada de presença (cursores). Gate + commit.
- [ ] **Step 6 — Fatia E (montar a base + wrapper):** `canvas.tsx` passa a renderizar `<CanvasBase mode="action" .../>` injetando os nodeTypes/edgeTypes/toolbar **atuais** (nós card/aprovação, arestas fixas). Gate completo (testes + checklist inteiro) + commit.

Cada fatia: `git commit -m "refactor(canvas): extrai <fatia> para CanvasBase (sem regressão)"`.

**Checkpoint Fase 1:** plano de ação roda idêntico sobre a base, fatia a fatia. Review obrigatório a cada fatia (não só no fim).

---

## FASE 2 — Schema e migrations (aditivo)

**Objetivo:** todas as tabelas `strategy_*` + `maps.kind` + constraints. Nada de UI/rotas ainda. Migração protege prod (ordem §12.2).

### Task 2.1 — `maps.kind` + índice único parcial

**Files:** Modify `lib/db/src/schema/maps.ts`

- [ ] **Step 1:** Adicionar `kind` enum (`action` default | `strategy`) à tabela `maps` e o índice único parcial `UNIQUE (workspace_id) WHERE kind='strategy'`.

```typescript
// em maps.ts — seguir o estilo Drizzle já usado no arquivo
export const mapKindEnum = pgEnum("map_kind", ["action", "strategy"]);
// na definição de maps: kind: mapKindEnum("kind").notNull().default("action"),
// índice parcial (drizzle): uniqueIndex("maps_one_strategy_per_ws")
//   .on(maps.workspaceId).where(sql`kind = 'strategy'`)
```

- [ ] **Step 2:** `pnpm --filter @workspace/db run generate` → confere `lib/db/drizzle/0038_*.sql` (ADD COLUMN com default + CREATE UNIQUE INDEX ... WHERE).
- [ ] **Step 3:** `pnpm --filter @workspace/db run push` (local) + `pnpm run typecheck`.
- [ ] **Step 4: Commit** schema + SQL gerado.

### Task 2.2 — `strategy_cycles`, `strategy_nodes`, satélites, `strategy_edges`

**Files:** Create `lib/db/src/schema/strategyCycles.ts`, `strategyNodes.ts`, `strategyEntities.ts`, `strategyEdges.ts`; Modify `index.ts`.

- [ ] **Step 1 (codex):** dispare `codex:codex-rescue` com a §6 da spec (tabelas 6.2–6.5) e a instrução "gere os arquivos de schema Drizzle seguindo o estilo de lib/db/src/schema/cards.ts e tasks.ts. Exatamente os campos e constraints da spec: cycles (status enum, unique 1 ativo/map), nodes (kind enum, map_id, workspace_id, posição), satélites 1:1 por node_id (objectives com cycle_id+status; krs com cycle_id, target/current/baseline/direction, target_date com CHECK ≤ cycle.ends_on, health enum incl atingido/nao_atingido/sem_medicao, health_readings jsonb, SEM source_*; themes; swot_cards com swot_type; resources com resource_kind+binding jsonb; plans com action_map_id UNIQUE + CHECK kind=action + ON DELETE SET NULL), edges (relation_type nullable, label, metadata, mesma-map constraint, cascade)."
- [ ] **Step 2:** Claude revisa **campo-a-campo contra §6** (checklist: cada coluna, cada enum, cada constraint, cada cascade). Corrige divergências. Confere que `source_*` NÃO existe (gap #4) e `target_date` tem CHECK.
- [ ] **Step 3:** `pnpm --filter @workspace/db run generate` → revisar `0039_*.sql`. Conferir CHECKs, UNIQUE parciais, FKs, ON DELETE.
- [ ] **Step 4 — Constraints cross-table (correção da revisão):** vários "CHECK" da spec **cruzam tabelas** e **não cabem** num `CHECK` puro do Postgres/Drizzle: `target_date ≤ cycle.ends_on`, `source.map_id = target.map_id = edges.map_id`, `strategy_nodes.workspace_id = maps.workspace_id`, `strategy_plans.action_map_id` referencia `kind='action'`. Para cada um, **decidir e implementar**: (a) trigger/função no Postgres (via migration SQL custom adicional), OU (b) validação na camada de aplicação. Registrar a escolha por constraint. Os de coluna única (`target==baseline`, enums, unique parciais) ficam como CHECK/constraint normal.
- [ ] **Step 5:** `pnpm --filter @workspace/db run push` + `pnpm run typecheck`.
- [ ] **Step 6: Commit.**

**Checkpoint Fase 2:** schema aplicado local, typecheck verde. Review do SQL gerado + plano de enforcement das constraints cross-table (trigger vs app-level, com teste para cada).

> **⛔ ORDEM DE RELEASE EM PRODUÇÃO (correção da revisão, §12.2):** `maps.kind` (Task 2.1) **e** a guarda por escopo default (Task 3.1) devem ir pra produção **ANTES** de existir qualquer linha `strategy` (i.e., antes de habilitar a criação lazy da Task 3.2). Sequência obrigatória: deploy [2.1 + 3.1] → confirmar que nenhuma lista de maps `action` vaza `strategy` (teste de 3.1) → só então deploy [3.2 criação lazy]. Isto protege os maps de produção.

---

## FASE 3 — API (Express + codegen) com TDD

**Objetivo:** rotas do grafo, criação lazy, transações, pré-preenchimento de tipo, permissões (incl. escrita estreita do executor), guarda por escopo default. **Smoke tests primeiro (TDD).**

### Task 3.1 — Guarda por escopo default em `maps` (gap #5)

**Files:** Create `services/mapsScope.ts`; Modify pontos de listagem de maps (`routes/maps.ts`, `routes/sidebar.ts`, `routes/recentMaps.ts`, `routes/mapsSearch.ts`); Test `__tests__/mapsKindScope.smoke.test.ts`.

- [ ] **Step 1 (TDD):** escrever o teste: criar workspace, criar um map `action` e (via insert direto/helper) um map `strategy`; afirmar que **toda** listagem (`GET /maps`, sidebar, recent, search) retorna só o `action` e nunca o `strategy`.
- [ ] **Step 2:** rodar → FAIL (hoje vazaria o strategy quando existir).
- [ ] **Step 3:** implementar `mapsScope.ts` com um helper `actionMapsOnly(query)` (ou um `where kind='action'` central) e aplicá-lo nos pontos de listagem. Acesso a `strategy` só pela rota dedicada (§3.2).
- [ ] **Step 4:** rodar → PASS. `pnpm run typecheck`.
- [ ] **Step 5: Commit.**

> **codex aqui:** após o teste vermelho, dispare codex para localizar TODOS os call sites que listam `maps` e aplicar o escopo — Claude confere contra o checklist §12.1.

### Task 3.2 — OpenAPI + rotas do grafo (GET/POST/PATCH/DELETE nós, arestas, ciclos)

**Files:** Modify `lib/api-spec/openapi.yaml`; Create `routes/strategy.ts`; Modify `routes/index.ts`; Test `__tests__/strategy.smoke.test.ts`.

> **Granularidade (correção da revisão):** ao executar, **fatiar a 3.2** em sub-tarefas: (a) lazy GET + ciclo; (b) CRUD de nós; (c) CRUD de arestas + pré-preenchimento; (d) permissões; (e) OpenAPI + codegen. Cada uma com seu teste vermelho→verde→commit. Abaixo o conjunto de testes-alvo.

- [ ] **Step 1 (TDD):** escrever smoke tests cobrindo:
  - criação lazy do map `strategy`+1º ciclo no primeiro `GET /workspaces/:id/strategy`; idempotência (2 GETs ~concorrentes = 1 map, 1 ciclo ativo);
  - criar nó objetivo (afirmar que nó **e** satélite existem — transação; nó sem satélite é falha);
  - criar KR; criar aresta KR→Objetivo e afirmar `relation_type='mede'` **pré-preenchido**; Plano→KR = `move`; Tema→Objetivo = `serve`; Tema→Plano = `contem`;
  - criar aresta SWOT×SWOT e afirmar `relation_type=null` (dispara fluxo de Tema, não tipa);
  - deletar nó remove satélite + arestas incidentes;
  - **permissões do executor (expandido):** executor recebe **403** ao criar/editar/mover nó, criar/editar aresta, editar `target_value`/`title`/posição do KR, mudar `status` do objetivo, abrir/fechar ciclo, vincular Plano; e **200** SÓ ao `PATCH` de `current_value` do KR. Afirmar que um PATCH de executor tentando alterar qualquer campo além de `current_value` é rejeitado.
- [ ] **Step 2:** rodar → FAIL (rota inexistente).
- [ ] **Step 3 (codex scaffolda):** dispare `codex:codex-rescue` com o padrão de `routes/maps.ts`, a §10 (tabela de rotas), §10.2 (permissões), §10.3 (transações) e §6.5 (pré-preenchimento). codex gera `routes/strategy.ts` + as adições no `openapi.yaml`. Instruir: usar `requireAuth`+`requireWorkspaceRole`; transação para nó+satélite; lazy create idempotente via ON CONFLICT; pré-preencher `relation_type` pela tabela da gramática; executor só PATCH `current_value`.
- [ ] **Step 4:** Claude revisa contra a spec, monta o router em `index.ts`, roda codegen `pnpm --filter @workspace/api-spec run codegen`.
- [ ] **Step 5:** rodar testes → PASS. `pnpm run typecheck`.
- [ ] **Step 6: Commit.**

### Task 3.3 — Serviço de saúde do KR e do Objetivo (§8.1) com TDD

**Files:** Create `services/strategyHealth.ts`; Test `__tests__/strategyHealth.test.ts`.

- [ ] **Step 1 (TDD — casos-limite da revisão codex):** escrever testes unitários puros da função de saúde cobrindo: progresso normal; `target==baseline` → modo booleano; `direction='descer'` (target<baseline); over-target → clamp 1; ciclo de 1 dia (piso); KR criado perto do fim (`max(starts_on, created_at)`); início do ciclo → `no_prazo`; objetivo sem aresta `mede` → `sem_medicao`; agregação pior-caso; aresta sem `mede` não conta; suavização: 1 snapshot ruim **não** vira `fora`, N consecutivos viram (N configurável/injetado).
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar `strategyHealth.ts` exatamente como §8.1 (fórmulas de progresso real/esperado, clamp, ε, modo booleano, agregação pior-caso por arestas `mede`, suavização via `health_readings`). `N` e limiares **injetados como config** (decisão de produto pendente — default documentado, não cravado).
- [ ] **Step 4:** rodar → PASS. `pnpm run typecheck`.
- [ ] **Step 5:** ligar o serviço no GET do grafo (calcular `health` na leitura) e no PATCH de `current_value` (empurrar snapshot em `health_readings`, trim a N).
- [ ] **Step 5b (assertions de fiação — correção da revisão):** estender `strategy.smoke.test.ts` afirmando: PATCH de `current_value` **anexa** a `health_readings` e **trima** ao tamanho N; **um** snapshot ruim **não** vira `fora` (continua na faixa anterior); N snapshots ruins consecutivos **viram**; o `GET` do grafo devolve a saúde **já suavizada** de KR e do Objetivo.
- [ ] **Step 6: Commit.**

**Checkpoint Fase 3:** API completa, testes verdes, gate 0.1 ainda verde. Review.

---

## FASE 4 — Frontend do canvas estratégico

**Objetivo:** aba Estratégia + `mode='strategy'` sobre o CanvasBase: 6 nós, floating edges, toolbar, sugestões, saúde, badges de órfão, barra de ciclo. Consome hooks gerados.

### Task 4.1 — Aba Estratégia + página `mode='strategy'` (esqueleto)

**Files:** Modify a aba do workspace (detalhe); Create `pages/strategy/canvas.tsx`.

- [ ] **Step 1:** adicionar aba "Estratégia" no detalhe do workspace (seguir o padrão das abas existentes Mapas/Dashboard/Membros). Rota que renderiza `pages/strategy/canvas.tsx`.
- [ ] **Step 2:** `pages/strategy/canvas.tsx` renderiza `<CanvasBase mode="strategy" mapId={strategyMapId} ... />`, buscando o grafo via hook gerado `useGetWorkspaceStrategy(workspaceId)` (cria lazy no backend). Sem node types ainda → canvas vazio com toolbar shell.
- [ ] **Step 3:** typecheck + smoke manual (aba abre, canvas vazio renderiza, zoom/pan funcionam — reuso da base).
- [ ] **Step 4: Commit.**

### Task 4.2 — Os seis nós tipados + toolbar de estratégia

**Files:** Create `components/strategy/{ObjectiveNode,KrNode,ThemeNode,SwotNode,ResourceNode,PlanNode}.tsx`, `HealthPill.tsx`; wire `nodeTypes` + `toolbarItems` no `mode='strategy'`.

> **Fatiar (correção da revisão):** não fazer os 6 nós + toolbar num passo. Ordem: (1) **um nó de referência** (Objetivo) ponta a ponta com seu teste; (2) KR + `HealthPill`; (3) SWOT/Tema/Recurso/Plano; (4) fluxos de criação na toolbar. Commit por fatia.

- [ ] **Step 1 — Nó de referência (Objetivo):** componente visual via `@beeads/ui`/tokens, edição inline autosave (PATCH otimista). Se RTL configurado (Task 0.3/Step 4), **teste de componente** (render + callback de edição); senão, smoke manual + registrar débito de teste. Commit.
- [ ] **Step 2 — KR + HealthPill:** KR mostra `HealthPill` com os estados `no_prazo/risco/fora/atingido/nao_atingido`; Objetivo mostra saúde agregada ou `sem_medicao`. Teste de componente dos estados do HealthPill (se RTL). Commit.
- [ ] **Step 3 — SWOT/Tema/Recurso/Plano:** SWOT com 4 variantes por `swot_type`; Recurso com `resource_kind`; Plano com link pro `action_map_id`. codex pode scaffoldar a partir do arquétipo do Objetivo; Claude ajusta tokens. Commit.
- [ ] **Step 4 — Toolbar de estratégia:** registrar `nodeTypes` + botões (um por tipo) no wrapper `mode='strategy'`; criar nó via botão e duplo-clique chamando o POST. Commit.
- [ ] **Step 5:** typecheck + smoke manual (criar cada tipo, editar, persiste após refresh — polling 5s/otimista, paridade §7.6). Commit.

### Task 4.3 — Floating edges (interseção dinâmica)

**Files:** Create `components/strategy/FloatingEdge.tsx` (+ util de geometria); registrar `edgeTypes` no `mode='strategy'`.

- [ ] **Step 1 — Geometria pura + testes (correção da revisão):** extrair a interseção como **função pura** `getEdgeAnchor(nodeA, nodeB)` num util, com **testes unitários** (Vitest, sem React): retângulos lado a lado, sobrepostos, par grande/pequeno, rejeição de self-loop, simetria. Vermelho→verde.
- [ ] **Step 2 (codex implementa o componente):** dispare `codex:codex-rescue` com o exemplo oficial "Floating Edges" do ReactFlow 11 + a util do Step 1, instrução: "FloatingEdge usando getEdgeAnchor; recalcula no movimento; seleção/edição da aresta (abrir rótulo+tipo); performance (memoizar, recalcular só nós movidos)."
- [ ] **Step 3:** Claude integra `edgeTypes` no `mode='strategy'` e roda os testes da util.
- [ ] **Step 4:** smoke manual — ligar nós de qualquer borda, mover, a âncora segue.
- [ ] **Step 5: Commit.**

### Task 4.4 — Sugestões, badges de órfão, barra de ciclo

**Files:** Create `components/strategy/{SuggestionButton,OrphanBadge,CycleBar}.tsx`.

- [ ] **Step 1:** Sugestão SWOT×SWOT → botão flutuante na aresta "criar Tema" (cria Tema pré-ligado aos 2 SWOT). Regra determinística (§7.4).
- [ ] **Step 2:** Badges de órfão dispensáveis (§7.8): objetivo sem `mede`, KR sem Plano, Plano sem map, **aresta KR→Objetivo sem `mede`** (aviso de "não conta na saúde").
- [ ] **Step 3:** `CycleBar` — mostra ciclo ativo, abrir novo ciclo (POST cycles, arquiva o ativo), histórico read-only do ciclo arquivado.
- [ ] **Step 4:** typecheck + smoke manual de cada um.
- [ ] **Step 5: Commit.**

**Checkpoint Fase 4:** mapa estratégico funcional ponta a ponta; plano de ação ainda idêntico (gate 0.1 + checklist 0.2). Review.

---

## FASE 5 — Integração, leitura por agentes e fecho

### Task 5.1 — Endpoint de leitura para agentes (forma legível)

**Files:** confirmar/ajustar `GET /workspaces/:id/strategy` para devolver o grafo com `relation_type` resolvido; Test estende `strategy.smoke.test.ts`.

- [ ] **Step 1:** teste afirmando que o GET devolve `{ map, cycle, nodes[], edges[] }` e (correção da revisão): **payload tipado embutido por kind** de nó (objetivo traz status; KR traz target/current/health/target_date; swot traz swot_type/text; etc.); cada aresta traz `relation_type`; o grafo é **filtrado pelo ciclo ativo** e os nós de ciclo arquivado vêm marcados **read-only**; a cadeia (KR `mede` Objetivo, Plano `move` KR) é reconstruível sem heurística.
- [ ] **Step 2:** ajustar serializer se necessário. PASS.
- [ ] **Step 3: Commit.** (Wrappers MCP ficam fora do v1 — endpoint já alcançável.)

### Task 5.2 — Regressão final + typecheck + revisão codex da implementação

- [ ] **Step 1:** rodar **toda** a suíte `pnpm --filter @workspace/api-server run test` + testes de componente/util do front + `pnpm run typecheck` → tudo verde. Re-rodar checklist manual 0.2 inteiro.
- [ ] **Step 2 (checklist de conformidade — propriedade de Claude):** Claude preenche uma tabela §5–§12 da spec → (teste automatizado | evidência manual) que a cobre. Lacuna sem evidência = tarefa nova, não "pronto". (Conformidade com a spec é de Claude, não delegável.)
- [ ] **Step 3 (codex como revisor APENAS):** dispare `codex:codex-rescue` para revisão adversarial **independente** do diff completo contra a spec v2 (foco: não-regressão, transações cross-table, permissões, matemática de saúde). codex **não decide** — Claude faz triagem das achados contra o checklist do Step 2 e corrige o relevante.
- [ ] **Step 4:** abrir PR da branch `feature/mapa-estrategico-spec` (a partir do master), descrição linkando spec+plano + o checklist de conformidade. **Não** mergear sem aprovação humana (memória `bloquim_git_workflow`).

**Checkpoint Fase 5:** feature completa, regressão verde, revisada por codex, PR aberto.

---

## Decisões de produto pendentes (NÃO cravar — deixar configurável)
- Limiares de saúde (`≥0.9`/`0.7–0.9`/`<0.7` são provisórios) — §8.1.
- `N` da suavização (snapshots consecutivos) — §8.1.
- Mecanismo de carry-over/clonagem de ciclo — §6.2 (v1 mínimo: ciclo novo começa vazio).

## Invariante de não-regressão (gate de TODO merge)
`pnpm --filter @workspace/api-server run test` (incl. gate 0.1) verde **+** checklist manual 0.2 sem desvio, antes de qualquer merge que toque o CanvasBase ou rotas de `maps`.

## Self-review (cobertura da spec → tarefas)
- §5 arquitetura (maps.kind + base compartilhada) → F1, T2.1, T3.1.
- §6 modelo de dados (todas as tabelas/constraints) → F2 (T2.1, T2.2).
- §7 nós/arestas/floating/sugestões/órfão/sync/undo → F4 (T4.2–4.4); undo fora do v1 (§7.7).
- §8 saúde (ritmo, clamp, booleano, suavização, agregação `mede`, `sem_medicao`) → T3.3.
- §9 integração/agentes → T5.1.
- §10 API/permissões/transações → F3 (T3.1–3.3).
- §11 escopo v1 → todas as fases; itens "fora" não viram tarefa.
- §12 não-regressão/ordem migration → F0, F1, T2.x (ordem), invariante global.
- gaps #1–#9 → rastreáveis no changelog da spec e nas tarefas citadas.
