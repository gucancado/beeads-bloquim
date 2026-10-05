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
- Endpoints `GET/PATCH/DELETE /api/plan-templates`, `POST /api/plan-templates/from-map`, `POST /api/plan-templates/:id/apply`.
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
| D4 | **Aprovações ignoradas.** Cards de aprovação e nós de junção não entram no modelo. Conexão que sai de um card de aprovação é **remapeada pro card pai** da cadeia. | O modelo de tarefa não guarda pessoas; aprovador é pessoa. O remapeamento mantém o encadeamento das tarefas. |
| D5 | Tarefas criadas pela aplicação nascem como um card novo nasce hoje: `status=draft`, `scheduleMode=sem_prazo`, `assigned_to`/`owner_id`/`created_by` = quem aplica. Prioridade vem do modelo. | Mesma regra do `POST /cards`. |
| D6 | Captura e aplicação rodam **no servidor, em transação**. | Não existe endpoint em lote; o `GET` do mapa não traz checklist nem descrição da tarefa; atomicidade. |
| D7 | Área livre = **à direita** da caixa envolvente de todos os elementos atuais, com folga de 120px, alinhada ao topo. Mapa vazio: origem `(0,0)`. | Garantidamente livre, coerente com o fluxo LR do layout. |
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

`title` do card = `tasks.title` (fallback `cards.title` quando o card não tem tarefa). `description` = `tasks.description ?? cards.description`.

### B2. Captura — `POST /api/plan-templates/from-map`

Body `{ workspaceId: uuid, mapId: uuid, cardIds?: uuid[], textElementIds?: uuid[], shapeIds?: uuid[] }`. `requireAuth` + membro do workspace (qualquer papel) + mapa pertence ao workspace (404 caso contrário).

Service `captureFromMap(userId, input)`:
1. Carrega cards do mapa com `tasks` (left join) e `task_subtasks`; conexões; textos; formas.
2. **Filtro de conjunto.** Sem ids → todos. Com ids → só os listados (ids desconhecidos no mapa são ignorados). Em ambos os casos exclui: cards cuja tarefa tem `isApprovalTask = true`; formas `type = "image"`. Conta `skipped.approvals` e `skipped.images` (sobre o conjunto considerado).
3. **Conexões.** Pra cada `card_connections` do mapa: `source' = sourceCardId` se não é aprovação, senão o card do `parentTaskId` da aprovação (card cujo `taskId = parentTaskId`); `target'` idem. Mantém se `source' ≠ target'` e ambos estão no conjunto. Dedupe por `(source', target')`. Handles: `source-right` / `target-left` quando remapeada; os originais caso contrário.
4. **Posições relativas.** `minX = min(x)` e `minY = min(y)` sobre cards, textos e formas incluídos (linhas usam `positionX/Y` como os demais). Grava `x - minX`, `y - minY`.
5. Conjunto vazio (nenhum card, texto ou forma) → 400 `{ error: "nada pra salvar no modelo" }`.
6. Nome: `map.name` sem ids; `"<map.name> (seleção)"` com ids.
7. Insere `plan_templates`. Retorna 201 `{ template: { id, name, counts: { cards, connections, texts, shapes }, createdAt }, skipped: { approvals, images } }`.

Funções puras, testáveis sem banco, em `services/planTemplates/capture.ts`: `selectElements`, `remapConnections`, `normalizePositions`, `buildPayload`.

### B3. Aplicação — `POST /api/plan-templates/:id/apply`

Body `{ workspaceId: uuid, mapId: uuid }`. `requireAuth` + `requireWorkspaceRole(["admin","editor"])` + mapa pertence ao workspace. Modelo precisa ser do usuário (404 caso contrário). Payload inválido pelo Zod → 422.

Service `applyToMap(userId, templateId, input)`:
1. Carrega caixas dos elementos atuais do mapa: cards (`NODE_WIDTH × NODE_HEIGHT` de `lib/collision.ts`), textos e formas (`width × height`).
2. **Origem** (`computeOrigin`, pura): `{ x: maxRight + 120, y: minTop }`; mapa sem elementos → `{ x: 0, y: 0 }`.
3. Em **uma transação**, na ordem:
   - Pra cada card: insere `tasks` (`title`, `description`, `priority`, `status: "draft"`, `scheduleMode: "sem_prazo"`, `mapId`, `workspaceId`, `assignedTo`/`ownerId`/`createdBy` = userId); insere `cards` (`title`, `description`, `positionX = origin.x + x`, `positionY = origin.y + y`, `statusVisual: "draft"`, `taskId`); insere `task_subtasks` do checklist (`text`, `completed: false`, `order`); `recordTaskActivity` `task_created` (com `actorName`, `source` do request). Guarda `key → cardId`.
   - Conexões: insere `card_connections` resolvendo chaves. Chave inexistente no mapa de ids → ignora.
   - Textos e formas: insere com posição deslocada pela origem; demais campos copiados.
4. `bounds` absolutos dos elementos criados: `x = origin.x`, `y = origin.y`, `width = max(x_rel + w)`, `height = max(y_rel + h)` sobre os elementos do payload, usando a caixa nominal (`NODE_WIDTH × NODE_HEIGHT`) pros cards e `width × height` pra textos e formas.
5. Retorna 200 `{ cardIds, connectionIds, textElementIds, shapeIds, bounds: { x, y, width, height } }`.

Sem `findFreeSlot`: a área é livre por construção e as posições são explícitas.

### B4. Gestão — `GET` / `PATCH` / `DELETE`

- `GET /api/plan-templates` → `[{ id, name, counts, createdAt, updatedAt }]` do usuário, ordenado por `createdAt`. `counts` calculado a partir do payload no servidor (não serializa o payload inteiro na lista).
- `PATCH /api/plan-templates/:id` body `{ name: string (min 1) }`.
- `DELETE /api/plan-templates/:id`.
- Todos 404 quando o modelo não é do usuário.

Rotas em `routes/planTemplates.ts`, montadas em `routes/index.ts` em `/api/plan-templates`.

### B5. UI — canvas

Em `pages/maps/canvas.tsx`, novo componente `components/maps/PlanTemplateMenu.tsx`:
- Botão flutuante `absolute top-4 right-16 z-20` (a busca global fica em `right-4 z-30`; quando ela expande, cobre o botão, o que é aceitável). Mesmo estilo do botão de busca (`w-10 h-10 rounded-xl bg-card border border-border shadow-sm ...`), ícone `FileText` `w-4 h-4`, `title="modelos de plano de ação"`.
- `DropdownMenu` do `@beeads/ui` com trigger via `render` (não `asChild`). Ao abrir, lê a seleção de `nodesRef.current`: nós `selected` dos tipos `mindmap`, `textnode`, `shapenode` (exclui `approvalnode`, `joinnode` e shape `image`).
- Itens:
  1. "aplicar modelo de plano de ação" → troca pra lista (`GET /api/plan-templates`, loading / "você ainda não tem modelos de plano de ação" / itens por nome). Clique → `POST .../apply`.
  2. "criar modelo de plano de ação" → `POST /from-map` sem ids.
  3. "criar modelo a partir da seleção" → só renderizado quando a seleção lida ao abrir tem ≥1 elemento aproveitável. Envia `cardIds` / `textElementIds` / `shapeIds`. Os ids dos nós `mindmap`, `textnode` e `shapenode` são os UUIDs do banco sem prefixo (ver `buildTextNode`/`buildShapeNode` em `canvas.tsx`); o `node.type` separa os três arrays.
- Pós-criação: `toast({ title: "novo modelo de plano de ação criado", description })`, onde `description` só existe quando `skipped.approvals + skipped.images > 0` (ex.: "2 aprovações e 1 imagem ficaram de fora"). Invalida `["/api/plan-templates"]`.
- Pós-aplicação: `await refetch` do mapa (o efeito de sync insere os nós novos) → `setNodes` marcando `selected: true` nos ids retornados e `false` nos demais → `fitBounds(bounds, { duration: 400, padding: 0.2 })` → `toast({ title: "modelo de plano de ação aplicado" })`. Erro → toast destrutivo com `body.error`.
- Enquanto uma mutação roda, o botão mostra `Loader2 animate-spin` e o menu fica fechado.

### B6. UI — página `/my-templates`

- Item do menu lateral "modelos de tarefas" → "modelos". Breadcrumb "modelos".
- Duas abas (`Tabs` do `@beeads/ui`): "tarefas" (conteúdo atual, inalterado) e "planos de ação".
- Aba planos: lista `GET /api/plan-templates`. Linha: nome em `Input` inline com autosave em blur/Enter (`PATCH`), subtítulo com contagens em minúsculas ("5 tarefas · 2 textos · 1 forma"), botão excluir com `TaskDeleteDialog` (label "Excluir modelo de plano?", descrição "O modelo será removido permanentemente. Planos já criados a partir dele não serão afetados."). Estado vazio: "você ainda não tem modelos de plano de ação. crie um a partir de um plano no mapa."
- Sem botão "novo" na aba planos: modelo de plano só nasce a partir de um mapa.

## Permissões

| Operação | Quem |
|---|---|
| `from-task` | membro do workspace da tarefa, ou responsável em standalone |
| `from-map` | qualquer membro do workspace do mapa |
| `apply` | admin ou editor do workspace de destino |
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
- `planTemplatesCapture.test.ts` (puro): seleção com/sem ids; exclusão de aprovações e imagens com contagem; remapeamento aprovação → pai (sequencial e paralelo), dedupe, descarte de self-loop; normalização de posições (mínimo vira 0, linhas incluídas); conjunto vazio.
- `planTemplatesApply.test.ts` (puro): `computeOrigin` com mapa vazio, só cards, mistura de tipos; `bounds` dos criados.
- `planTemplates.smoke.test.ts` (banco dev): from-map do mapa inteiro e de subconjunto; apply cria contagens esperadas, tarefas em `draft` com dono/responsável = caller, conexões resolvidas, checklist copiado; apply em mapa com elementos posiciona à direita sem sobreposição; falha forçada não deixa resíduo; 403 pra executor no apply; 404 pra modelo de outro usuário.
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
