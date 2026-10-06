# Modelos de tarefa (menu criar/aplicar) e modelos de plano de ação

**Data:** 2026-10-05
**Branch:** `feat/modelos-de-plano` (repo `beeads-bloquim`)
**Status:** design aprovado em conversa, pronto pra plano de implementação

## Problema

1. O botão "modelo" do modal de tarefa só **aplica** um modelo. Criar um modelo exige ir até `/my-templates`, criar um vazio e preencher à mão o que já está na tarefa aberta.
2. Não existe modelo de **plano de ação**: uma cadeia de tarefas conectadas, com textos e formas, só pode ser reproduzida refazendo tudo no canvas ou via MCP.

## Objetivo

- No modal de tarefa, o botão "modelo" abre um menu com "aplicar modelo" (fluxo atual) e "criar modelo" (gera um modelo a partir da tarefa aberta, toast "novo modelo de tarefa criado").
- No canvas, um botão "modelo" ao lado da busca abre um menu com "aplicar modelo de plano de ação", "criar modelo de plano de ação" e, quando há seleção, "criar modelo a partir da seleção". Aplicar insere os elementos do modelo numa área livre do mapa, sem alterar o que já existe, e enquadra o viewport nos elementos criados.

## Escopo

**Inclui**
- Endpoint `POST /api/task-templates/from-task` + menu no `TaskApplyTemplateButton`.
- Tabela `plan_templates` (snapshot JSON versionado, posições relativas).
- Endpoints `GET/PATCH/DELETE /api/plan-templates` (gestão, escopo do usuário) e, no escopo do mapa, `POST /api/workspaces/:wId/maps/:mId/plan-templates/capture` e `POST /api/workspaces/:wId/maps/:mId/plan-templates/:templateId/apply`.
- Botão + menu no canvas; aplicação com seleção dos novos nós e `fitBounds`.
- Aba "planos de ação" em `/my-templates` (renomear, excluir).
- Testes unitários das funções puras e smoke dos endpoints no api-server.

**Não inclui (v1)**
- Aprovadores e cadeias de aprovação (decisão: ignorar; ver D4).
- Formas do tipo imagem (referenciam anexos em R2).
- Responsável, dono, datas, modalidade de prazo, recorrência, anexos, comentários.
- Edição elemento a elemento de um modelo de plano.
- Tools MCP `list_plan_templates` / `apply_plan_template` (follow-up trivial sobre o REST).
- OpenAPI/Orval pras rotas novas (segue o precedente de `/api/task-templates`: `customFetch` + React Query).

## Decisões de design

| # | Decisão | Razão |
|---|---|---|
| D1 | Modelo de plano é **privado por usuário** (`user_id`), como o modelo de tarefa. | Mesma regra do mecanismo existente. |
| D2 | Armazenamento em **1 tabela com `payload jsonb` versionado** (`v: 1`), não tabelas normalizadas. | Gestão na v1 é só renomear/excluir; snapshot opaco basta. Versão no payload permite evoluir o formato. |
| D3 | Posições gravadas **relativas** ao canto superior esquerdo da caixa envolvente do conjunto capturado. | Reposicionar em qualquer área livre preservando o arranjo. |
| D4 | **Aprovações ignoradas.** Cards de aprovação e nós de junção não entram no modelo. Conexão persistida que toca um card de aprovação (origem ou destino) é **remapeada pro card pai** da cadeia. | O modelo de tarefa não guarda pessoas; aprovador é pessoa. As arestas internas da cadeia (pai → aprovação → junção) são derivadas no frontend e nunca persistidas, então toda `card_connections` que toca uma aprovação é externa à cadeia: no modo sequencial sai do último aprovador (terminal), no paralelo sai do próprio pai. Remapear pro pai cobre os dois casos e mantém o encadeamento. |
| D5 | Tarefas criadas pela aplicação nascem como um card novo nasce hoje: `status=draft`, `scheduleMode=sem_prazo`, `assigned_to`/`owner_id` = quem aplica. Prioridade vem do modelo. Além disso grava `created_by` = quem aplica. | Mesma regra do `POST /cards` pra status, prazo, responsável e dono. O `POST /cards` **não** grava `created_by` (lacuna pré-existente; fora do escopo corrigir); o apply grava porque o `DELETE` de tarefa depende disso. |
| D6 | Captura e aplicação rodam **no servidor, em transação**, com **advisory lock por mapa** (`pg_advisory_xact_lock(hashtext(mapId))`) no apply. | Não existe endpoint em lote; o `GET` do mapa não traz checklist nem descrição da tarefa; atomicidade; dois applies simultâneos no mesmo mapa não calculam a mesma origem. |
| D7 | Área livre = **à direita** da caixa envolvente de todos os elementos atuais, com folga de 120px, alinhada ao topo. Mapa vazio: origem `(0,0)`. | Livre na prática: a caixa nominal do card (`NODE_WIDTH=200`) subestima o render (~220px), e a folga de 120px absorve essa diferença. Coerente com o fluxo LR do layout. |
| D8 | Aplicar **não pede confirmação**; os novos elementos nascem **selecionados**. | Nada do plano atual é alterado; Delete desfaz em um gesto (diálogo de exclusão já existente). |
| D9 | Menu do modal de tarefa continua no **popover artesanal** existente; menu do canvas usa **`DropdownMenu` do `@beeads/ui`**. | O popover do modal existe por causa do portal dentro do Dialog e do iframe `/embed/task` (commit `9ec0da0`). O canvas não tem essa restrição; vale a regra do DS. |
| D10 | Nome automático: título da tarefa; nome do plano; `"<nome do plano> (seleção)"`. Sem diálogo de nome. | Pedido explícito: clique → criado → toast. Renomear fica na página de gestão. |

## Parte A — Modelo de tarefa: menu "aplicar" / "criar"

### A1. Backend

`POST /api/task-templates/from-task` — body `{ taskId: uuid }`. `requireAuth`.

Service `createTemplateFromTask(userId, taskId)` em `taskTemplatesService.ts`:
1. Carrega a tarefa. 404 se não existe.
2. Acesso: mesma regra do `applyTemplateToTask` (membro do workspace da tarefa, ou `assignedTo === userId` em standalone). 403 caso contrário. Tarefa de aprovação (`isApprovalTask`) retorna 400.
3. Em transação: insere `task_templates` com `name = title`, `title`, `description`, `priority`; insere `task_template_subtasks` a partir de `task_subtasks` da tarefa (`title = text`, `order` preservado, ordenado por `order, createdAt`).
4. Retorna 201 `{ ...template, subtasks }` (mesmo shape do `GET /:templateId`).

Qualquer status de tarefa serve. Lê os campos **persistidos** (o modal autosalva em blur/change).

### A2. Frontend

`TaskApplyTemplateButton` passa a ter dois níveis no mesmo popover:
- Nível 1 (menu): "aplicar modelo" e "criar modelo".
  - "aplicar modelo": desabilitado quando `status !== "draft"`, com `title` "só é possível aplicar modelo em tarefas em rascunho". Clique troca o conteúdo do popover pela lista atual (loading / vazio / itens). Confirmação e `skipConfirm` inalterados.
  - "criar modelo": `POST /api/task-templates/from-task`; sucesso → fecha o popover, `toast({ title: "novo modelo de tarefa criado" })`, invalida `["/api/task-templates"]`. Erro → toast destrutivo com `body.error`.
- O botão fica **habilitado sempre que houver `taskId`** (hoje exige `draft`). `title` do botão: "modelo". Ícone `FileText` mantido.
- Prop `status` continua sendo usada só pra habilitar/desabilitar o item "aplicar modelo".
- Largura do popover sobe pra `w-60`; cálculo de posição (`portalContainer`) inalterado.

## Parte B — Modelos de plano de ação

### B1. Dados

Migration aditiva `lib/db/drizzle/0041_add_plan_templates.sql` + schema `lib/db/src/schema/planTemplates.ts` (exportado em `schema/index.ts`):

```sql
CREATE TABLE IF NOT EXISTS "plan_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_plan_templates_user" ON "plan_templates" ("user_id");
```

Payload (tipos em `artifacts/api-server/src/services/planTemplates/types.ts`, validados com Zod na leitura do apply):

```ts
type PlanTemplatePayloadV1 = {
  v: 1;
  cards: Array<{
    key: string;              // "c1", "c2"... local ao payload
    x: number; y: number;     // relativos (ver D3)
    title: string;
    description: string | null;
    task: {
      priority: "low" | "medium" | "high" | "critical";
      checklist: Array<{ text: string; order: number }>;
    };
  }>;
  connections: Array<{
    sourceKey: string; targetKey: string;
    sourceHandle: string | null; targetHandle: string | null;
  }>;
  texts: Array<{
    x: number; y: number; width: number; height: number;
    fontSize: number; color: string; content: string; // JSON Tiptap
  }>;
  shapes: Array<{
    type: "rect" | "ellipse" | "line";
    x: number; y: number; width: number; height: number; rotation: number;
    color: string; filled: boolean; strokeStyle: "solid" | "dashed";
    x1: number | null; y1: number | null; x2: number | null; y2: number | null;
  }>;
};
```

`title` do card = `tasks.title` (fallback `cards.title` quando o card não tem tarefa). `description` = `tasks.description ?? cards.description`. Card legado **sem tarefa** (`cards.taskId IS NULL`, `statusVisual = no_task`) entra com `task.priority = "medium"` e `checklist = []`; na aplicação todo card ganha tarefa (regra do `POST /cards`). `texts[].content` é copiado **literalmente** (string JSON do Tiptap), sem parse.

### B2. Captura — `POST /api/workspaces/:workspaceId/maps/:mapId/plan-templates/capture`

Body `{ cardIds?: uuid[], textElementIds?: uuid[], shapeIds?: uuid[] }`. Middlewares: `requireAuth` + `requireWorkspaceRole(["admin","editor","executor"])` + `requireMapInWorkspace` (ambos leem `req.params`, por isso a rota fica no escopo do mapa).

Service `captureFromMap(userId, { mapId, mapName, cardIds?, textElementIds?, shapeIds? })`:
1. Carrega cards do mapa com `tasks` (left join) e `task_subtasks`; conexões do mapa; textos; formas.
2. **Filtro de conjunto.** Sem nenhum array → todos os elementos do mapa. Com arrays → só os ids listados (ids que não existem no mapa são ignorados). Em ambos os casos exclui: cards cuja tarefa tem `isApprovalTask = true`; formas `type = "image"`. Conta `skipped.approvals` e `skipped.images` sobre o conjunto considerado (no mapa inteiro, todas as aprovações do mapa; na seleção, as aprovações cujos ids vieram em `cardIds`). O pai de uma aprovação selecionada **não** entra implicitamente.
3. **Conexões.** Só `card_connections` cujas duas pontas existem entre os cards carregados do mapa (integridade não é garantida pelo schema). Pra cada uma: `source' = sourceCardId` se não é aprovação, senão o card do pai (card cujo `taskId = tasks.parentTaskId` da aprovação, resolvido com os dados do mapa inteiro, não só da seleção); `target'` idem. Mantém se `source' ≠ target'` e ambos estão no conjunto. Dedupe por `(source', target')`. Handles: `source-right` / `target-left` quando remapeada; os originais caso contrário.
4. **Posições relativas.** `minX = min(positionX)` e `minY = min(positionY)` sobre cards, textos e formas incluídos (linhas usam `positionX/Y` como os demais; `x1..y2` são locais ao nó e copiados sem alteração). Grava `x - minX`, `y - minY`.
5. Conjunto vazio (nenhum card, texto ou forma) → 400 `{ error: "nada pra salvar no modelo" }`.
6. Nome: `map.name` sem arrays; `"<map.name> (seleção)"` com arrays.
7. Insere `plan_templates`. Retorna 201 `{ template: { id, name, counts: { cards, connections, texts, shapes }, createdAt }, skipped: { approvals, images } }`.

Funções puras, testáveis sem banco, em `services/planTemplates/capture.ts`: `selectElements`, `remapConnections`, `normalizePositions`, `buildPayload`.

### B3. Aplicação — `POST /api/workspaces/:workspaceId/maps/:mapId/plan-templates/:templateId/apply`

Sem body. Middlewares: `requireAuth` + `requireWorkspaceRole(["admin","editor"])` + `requireMapInWorkspace`. Modelo precisa ser do usuário (404 caso contrário). Payload fora do schema Zod `v:1` → 422.

Service `applyToMap({ userId, actorName, source, templateId, mapId, workspaceId })` (`source` = `req.user.source`, como o `POST /cards` passa pro activity):
1. Abre **uma transação** e toma `SELECT pg_advisory_xact_lock(hashtext(<mapId>))` antes de ler qualquer coisa.
2. Dentro da transação, carrega as caixas dos elementos atuais do mapa: cards (`NODE_WIDTH × NODE_HEIGHT` de `lib/collision.ts`), textos (`width × height`) e formas (`shapeAabb`: caixa alinhada aos eixos da forma rotacionada em torno do centro, `w' = |w·cosθ| + |h·sinθ|`, `h' = |w·sinθ| + |h·cosθ|`; linhas usam `position + width × height`).
3. **Origem** (`computeOrigin`, pura): `{ x: maxRight + 120, y: minTop }`; mapa sem elementos → `{ x: 0, y: 0 }`.
4. Ainda na transação, na ordem:
   - Pra cada card: insere `tasks` (`title`, `description`, `priority`, `status: "draft"`, `scheduleMode: "sem_prazo"`, `mapId`, `workspaceId`, `assignedTo`/`ownerId`/`createdBy` = userId); insere `cards` (`title`, `description`, `positionX = origin.x + x`, `positionY = origin.y + y`, `statusVisual: "draft"`, `taskId`); insere `task_subtasks` do checklist (`text`, `completed: false`, `order`); insere `task_activities` **via `tx`** (`type: "task_created"`, `metadata: { actorName, source? }`, mesmo shape que `recordTaskActivity` produz; o helper usa o `db` global e por isso não serve aqui). Guarda `key → cardId`.
   - Conexões: insere `card_connections` resolvendo chaves, **sem dedupe** (par duplicado no payload viola a unique `(source, target)` e derruba a transação; a captura já deduplica). Chave inexistente no mapa de ids → ignora.
   - Textos e formas: insere com posição deslocada pela origem; demais campos copiados.
5. `bounds` absolutos dos elementos criados: `x = origin.x`, `y = origin.y`, `width = max(x_rel + w)`, `height = max(y_rel + h)` sobre os elementos do payload, usando a caixa nominal (`NODE_WIDTH × NODE_HEIGHT`) pros cards, `width × height` pra textos e `shapeAabb` pra formas.
6. Retorna 200 `{ cardIds, connectionIds, textElementIds, shapeIds, bounds: { x, y, width, height } }`.

Sem `findFreeSlot`: a área é livre por construção e as posições são explícitas. `computeOrigin`, `shapeAabb` e o cálculo de `bounds` ficam em `services/planTemplates/apply.ts` como funções puras.

### B4. Gestão — `GET` / `PATCH` / `DELETE`

- `GET /api/plan-templates` → `[{ id, name, counts, createdAt, updatedAt }]` do usuário, ordenado por `createdAt`. `counts` calculado a partir do payload no servidor (não serializa o payload inteiro na lista).
- `PATCH /api/plan-templates/:id` body `{ name: string (min 1) }`.
- `DELETE /api/plan-templates/:id`.
- Todos 404 quando o modelo não é do usuário.

Rotas de gestão em `routes/planTemplates.ts`, montadas em `routes/index.ts` em `/api/plan-templates`. As rotas `capture` e `apply` ficam em `routes/mapPlanTemplates.ts` (router com `mergeParams: true`), montado em `/api/workspaces/:workspaceId/maps/:mapId/plan-templates`, seguindo o padrão de `cards.ts`/`connections.ts`.

### B5. UI — canvas

Em `pages/maps/canvas.tsx`, novo componente `components/maps/PlanTemplateMenu.tsx`:
- Botão flutuante `absolute top-4 right-16 z-20` (a busca global fica em `right-4 z-30`; quando ela expande, cobre o botão, o que é aceitável). Mesmo estilo do botão de busca (`w-10 h-10 rounded-xl bg-card border border-border shadow-sm ...`), ícone `FileText` `w-4 h-4`, `title="modelos de plano de ação"`.
- `DropdownMenu` do `@beeads/ui` com trigger via `render` (não `asChild`). Ao abrir, lê a seleção de `nodesRef.current` (nós com `selected === true`):
  - **aproveitáveis** (decidem se o item 3 aparece): `mindmap`, `textnode`, `shapenode` com `data.type !== "image"`;
  - **enviados** no item 3: `cardIds` = ids dos nós `mindmap` **e** `approvalnode` (aprovação também é card; o servidor exclui e conta em `skipped.approvals`), `textElementIds` = ids dos `textnode`, `shapeIds` = ids dos `shapenode` (incluindo imagem; o servidor exclui e conta). `joinnode` é virtual e nunca é enviado.
  - Os ids dos nós `mindmap`, `approvalnode`, `textnode` e `shapenode` são os UUIDs do banco sem prefixo (ver `buildTextNode`/`buildShapeNode`/`mapApprovalCardToNodeData` em `canvas.tsx`); o `node.type` separa os arrays.
- Itens:
  1. "aplicar modelo de plano de ação" → troca pra lista (`GET /api/plan-templates`, loading / "você ainda não tem modelos de plano de ação" / itens por nome). Clique → `POST .../plan-templates/:templateId/apply`.
  2. "criar modelo de plano de ação" → `POST .../plan-templates/capture` com body `{}`.
  3. "criar modelo a partir da seleção" → só renderizado quando há ≥1 elemento aproveitável selecionado. `POST .../capture` com os três arrays.
- Pós-criação: `toast({ title: "novo modelo de plano de ação criado", description })`, onde `description` só existe quando `skipped.approvals + skipped.images > 0` (ex.: "2 aprovações e 1 imagem ficaram de fora"). Invalida `["/api/plan-templates"]`.
- Pós-aplicação, nesta ordem:
  1. `pendingSelectIdsRef.current = new Set([...cardIds, ...textElementIds, ...shapeIds])`.
  2. `fitBounds(bounds, { duration: 400, padding: 0.2 })` imediatamente (não depende dos nós existirem).
  3. `invalidateQueries` do mapa. O **efeito de sync** (que hoje insere nós ausentes e preserva `selected` dos existentes) passa a: ao inserir um nó cujo id está em `pendingSelectIdsRef`, marcar `selected: true`; na mesma passada em que consome o conjunto, marcar `selected: false` nos nós existentes; esvaziar o ref ao fim. Assim a seleção acontece no mesmo `setNodes` que cria os nós, sem corrida com o `refetch`.
  4. `toast({ title: "modelo de plano de ação aplicado" })`. Erro → toast destrutivo com `body.error`.
- Enquanto uma mutação roda, o botão mostra `Loader2 animate-spin` e o menu fica fechado.

### B6. UI — página `/my-templates`

- Item do menu lateral "modelos de tarefas" → "modelos". Breadcrumb "modelos".
- Duas abas (`Tabs` do `@beeads/ui`): "tarefas" (conteúdo atual, inalterado) e "planos de ação".
- Aba planos: lista `GET /api/plan-templates`. Linha: nome em `Input` inline com autosave em blur/Enter (`PATCH`), subtítulo com contagens em minúsculas ("5 tarefas · 2 textos · 1 forma"), botão excluir com `TaskDeleteDialog` (label "Excluir modelo de plano?", descrição "O modelo será removido permanentemente. Planos já criados a partir dele não serão afetados."). Estado vazio: "você ainda não tem modelos de plano de ação. crie um a partir de um plano no mapa."
- Sem botão "novo" na aba planos: modelo de plano só nasce a partir de um mapa.

## Permissões

| Operação | Quem |
|---|---|
| `from-task` | membro do workspace da tarefa, ou responsável em standalone (checado no service, rota global) |
| `capture` | qualquer membro do workspace do mapa (`requireWorkspaceRole` + `requireMapInWorkspace`) |
| `apply` | admin ou editor do workspace de destino (`requireWorkspaceRole` + `requireMapInWorkspace`); modelo do próprio usuário |
| `GET/PATCH/DELETE` de modelos | dono do modelo |

## Erros

- Validação Zod → 400 `{ error: "Validation error", message }` (padrão do repo).
- Tarefa/mapa/modelo inexistente ou de outro usuário → 404.
- Sem papel → 403 (middleware existente).
- Captura vazia → 400 com mensagem exibível no toast.
- Payload de modelo fora do schema `v:1` → 422 `{ error: "modelo em formato não suportado" }`.
- Falha no meio da aplicação → rollback da transação, 500; nada parcial no mapa.

## Testes

**api-server (vitest):**
- `planTemplatesCapture.test.ts` (puro): seleção com/sem ids; exclusão de aprovações e imagens com contagem; remapeamento aprovação → pai (sequencial: conexão sai do último aprovador; paralelo: sai do pai), pai fora da seleção descarta a conexão, dedupe, descarte de self-loop, conexão com ponta fora do mapa descartada; card sem tarefa vira `priority: "medium"` + checklist vazio; normalização de posições (mínimo vira 0, linhas incluídas, `x1..y2` intactos); conjunto vazio.
- `planTemplatesApply.test.ts` (puro): `computeOrigin` com mapa vazio, só cards, mistura de tipos, forma rotacionada (`shapeAabb` a 90° troca largura e altura); `bounds` dos criados.
- `planTemplates.smoke.test.ts` (banco dev, helpers de `__tests__/helpers.ts`): capture do mapa inteiro e de subconjunto (contagens e `skipped`); apply cria contagens esperadas, tarefas em `draft` com dono/responsável/`created_by` = caller, activity `task_created` por tarefa, conexões resolvidas, checklist copiado, posições deslocadas pela origem; apply em mapa com elementos posiciona à direita (todo `positionX` novo ≥ `maxRight + 120`); **rollback**: modelo inserido direto no banco com o mesmo par de conexão duas vezes → apply falha e o mapa fica com as mesmas contagens de antes (cards, tasks, activities, connections); 403 pra executor no apply; 404 pra modelo de outro usuário; 404 pra mapa de outro workspace.
- `taskTemplatesFromTask.smoke.test.ts`: copia campos e checklist; 403 pra não-membro; 400 pra tarefa de aprovação.

**mindtask-app:** sem teste automatizado novo obrigatório (typecheck relativo: sem erro novo; ver memória `bloquim_fe_typecheck_debt`). Smoke manual no browser: menu do modal, criar/aplicar modelo de tarefa, botão do canvas com e sem seleção, aplicação enquadra e seleciona, aba de gestão.

**Gates:** `pnpm --filter @workspace/api-server run test` 100%; typecheck api e web sem erro novo; `pnpm install --frozen-lockfile` OK; build do web.

## Rollout

- Migration aditiva; aplicar em prod com `drizzle-kit push` (padrão do repo) antes do deploy do api.
- Sem flag de feature. Sem mudança de contrato nas rotas existentes.
- Deploy: push na branch → PR → merge em `master` só com pedido explícito (regra do projeto).

## Follow-ups (fora desta spec)

- MCP: `list_plan_templates` + `apply_plan_template` (wrap do REST, ~30 linhas no `bloquim-mcp`).
- Modelos de plano com aprovadores (opção (b) da discussão) e imagens.
- Edição de elementos de um modelo de plano.
