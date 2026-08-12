# Mapa Estratégico do Workspace — Spec de Design

> **Status:** rascunho para revisão · **Data:** 2026-06-07 · **Branch:** `feature/mapa-estrategico-spec`
> **Origem:** Mapa Estratégico — Norte do Projeto (documento de visão) + sessão de brainstorming 2026-06-07.
> **Escopo deste doc:** o quê e por quê em nível de design (entidades, arquitetura, integração com o ecossistema). Detalhes de implementação fina (queries exatas, props de componente) ficam para o plano de implementação.

---

## 1. Resumo executivo

Transformar o workspace do Bloquim numa **tela visual de planejamento estratégico**: um grafo tipado onde diagnóstico (SWOT), objetivos, resultados (KR), temas estratégicos, planos e recursos vivem conectados num só lugar. O poder está nas **ligações** — ler o grafo conta a história estratégica inteira do cliente.

A construção reaproveita o canvas ReactFlow que o Bloquim já tem (o "plano de ação"/`maps`), extraindo um **componente de canvas base compartilhado** entre os dois mapas. As ferramentas globais (zoom, cursor, formas, texto, imagem, cursores multiplayer, toolbar) são **um código só** e refletem nos dois mapas. Só a camada de nós e arestas é específica de cada mapa.

O mapa estratégico é **puramente aditivo**: tabelas novas (`strategy_*`), uma coluna aditiva em `maps`, e uma nova aba no workspace. **Zero regressão** no plano de ação atual é invariante de projeto.

---

## 2. Problema

A estratégia de um cliente vive em pedaços desconectados (SWOT num doc, objetivos numa planilha, tarefas noutra ferramenta). A lógica que liga diagnóstico → meta → ação evapora; meses depois ninguém lembra o raciocínio. Este mapa mantém a cadeia de raciocínio inteira visível e viva num lugar só.

---

## 3. Conceito central

Um **mapa de estratégia como grafo tipado e livre**, um por workspace. Os elementos:

- **Objetivo** — a meta de negócio; a direção. Poucos por mapa.
- **SWOT** — o diagnóstico, em quatro tipos: força, fraqueza, oportunidade, ameaça.
- **Tema estratégico** — a política norteadora (resposta estratégica); agrupa planos sob uma mesma aposta. Nasce, idealmente, do cruzamento de cards SWOT (estilo TOWS).
- **KR** — resultado mensurável (número + alvo) que define se o objetivo foi atingido. Resultado, nunca tarefa.
- **Plano** — a aposta concreta para mover um KR; carrega uma hipótese ("acreditamos que fazendo X movemos Y porque Z"). **Um Plano é um `map` operacional existente do Bloquim** (a camada de execução), referenciado como nó no mapa estratégico.
- **Recurso** — ativo do cliente cartografado no mapa: conta de anúncios Meta, conta Google Ads, site, perfil Instagram, etc. É a **âncora do dado vivo** (pós-v1): um KR ligado a um Recurso "conta Meta" puxará a métrica da central-de-dados.

As **tarefas não vivem neste mapa** — são a camada operacional, dentro dos `maps` (planos de ação).

---

## 4. Princípios invioláveis

1. **As ligações são a estratégia.** O raciocínio mora nos fios, não nos cards.
2. **KR é resultado, não atividade.** "Lançar o canal" é tarefa; "30% das vendas fora do Meta" é KR.
3. **O mapa é vivo.** Nós de resultado mostram saúde no próprio mapa. No v1 a saúde vem de números manuais; pós-v1, de dado real da central-de-dados. A arquitetura nasce pronta pra isso.
4. **Grafo livre + sugestões inteligentes.** Qualquer nó liga em qualquer nó (ou em nenhum). Arestas podem carregar tipo/rótulo, sempre opcional. A gramática (cruzar 2 SWOT → tema; KR mede objetivo; plano move KR) é **sugerida** pelo sistema, nunca obrigatória.
5. **Foco.** Poucos objetivos, poucos temas, poucos KRs. O mapa resiste ao acúmulo.
6. **O objetivo é provisório até o diagnóstico validar.** A análise pode reescrever a meta — o objetivo tem estado (`provisorio` → `validado`).
7. **Dados conectados e vivos, não rótulos num desenho.** Os nós são entidades tipadas legíveis por agentes desde o começo.
8. **Não-regressão.** O plano de ação (`maps`) atual e suas funções permanecem intocados em comportamento. Qualquer refatoração de padronização preserva funcionalidade, com testes de regressão verdes antes do merge.

---

## 5. Arquitetura

### 5.1 Superfície

- Nova aba **"Estratégia"** no detalhe do workspace (ao lado de Mapas, Dashboard, Membros).
- **Um canvas estratégico por workspace.** Conceitualmente, "o workspace é o mapa estratégico".

### 5.2 O canvas estratégico é uma linha em `maps`

Para que as ferramentas globais (formas, texto, imagem, presença) — todas hoje chaveadas por `map_id` — sejam **literalmente compartilhadas**, o canvas estratégico **é uma linha na tabela `maps`**, uma por workspace:

- Coluna nova **`maps.kind`** (`action` default | `strategy`). Aditiva, não-quebra.
- A linha `strategy` é **criada automaticamente** (lazy) na primeira abertura da aba e **escondida da lista de Mapas** (filtro por `kind = 'action'` na listagem existente).
- `map_shapes`, `map_text_elements`, presença WebSocket e attachments seguem chaveados por `map_id` → funcionam no canvas estratégico **sem mudança de schema**.
- A tabela `cards` fica **vazia** para mapas `strategy` (a camada de nós de estratégia usa `strategy_nodes`, não `cards`).

### 5.3 Componente de canvas base compartilhado

Extrair um **componente de canvas base** (refactor preservando comportamento) usado pelos dois mapas, parametrizado por `mode: 'action' | 'strategy'`.

| Camada | Compartilhada (mesmo código, reflete nos dois mapas) | Específica do `mode` |
|---|---|---|
| Zoom / pan / cursor / seleção | ✓ | |
| Formas (`map_shapes`) | ✓ | |
| Imagem (`map_shapes type=image` + `attachments`) | ✓ | |
| Texto (`map_text_elements`) | ✓ | |
| Cursores multiplayer (presença WebSocket) | ✓ | |
| Toolbar (posição + design) | ✓ (só troca o conjunto de botões) | |
| Renderer de nó | | ✗ cards ↔ `strategy_nodes` |
| Comportamento de aresta | | ✗ handles fixos esq/dir ↔ flutuantes |

**Princípio de manutenção:** toda ferramenta de canvas mora no componente base e vale para os dois mapas; só nós/arestas são específicos do `mode`. Qualquer ferramenta global futura nasce automaticamente nos dois.

### 5.4 Pilha técnica (reuso)

React 19 · Vite · ReactFlow 11 · TanStack Query · Zustand · `@beeads/ui` · Express 5 · Drizzle · Supabase · presença WebSocket (`presenceServer`). Nada novo de infra.

---

## 6. Modelo de dados

Padrão: `strategy_nodes` cuida do canvas (posição, mapa); satélites tipados 1:1 (`node_id`) cuidam da semântica. Arestas referenciam `strategy_nodes` (espaço de id unificado, grafo livre). Todas as tabelas novas com prefixo `strategy_`.

### 6.1 `maps` (alteração aditiva)

| Coluna | Tipo | Nota |
|---|---|---|
| `kind` | enum `action` \| `strategy`, default `action` | filtro de listagem; 1 linha `strategy` por workspace |

**Constraints:**
- **Índice único parcial** `UNIQUE (workspace_id) WHERE kind = 'strategy'` — garante no máximo uma linha `strategy` por workspace, mesmo sob criação concorrente (resolve a corrida da criação lazy).
- A criação lazy usa `INSERT ... ON CONFLICT DO NOTHING` por `workspace_id` (idempotente) seguido de `SELECT`.

### 6.2 `strategy_nodes`

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps.id (cascade) | a linha `strategy` do workspace |
| `workspace_id` | uuid → workspaces.id | denormalizado p/ auth/consulta |
| `kind` | enum `objetivo`·`swot`·`tema`·`kr`·`plano`·`recurso` | |
| `position_x` / `position_y` | numeric | |
| `width` / `color` | opcional | paridade visual com cards |
| `created_by` | uuid → users.id | |
| `created_at` / `updated_at` | timestamptz | |

### 6.3 Satélites tipados (1:1 por `node_id`)

**`strategy_objectives`** — `node_id` PK/FK, `title`, `description`, `status` (`provisorio`·`validado`·`arquivado`). *Saúde derivada da agregação dos KRs ligados; não bindeia métrica direto.*

**`strategy_krs`** — `node_id` PK/FK, `title`, `unit`, `target_value` numeric, `current_value` numeric, `baseline_value` numeric null, `direction` (`subir`·`descer`), `source_kind` (`manual` default · `metrica`), `source_config` jsonb null, `last_synced_at` timestamptz null, `health` (`no_prazo`·`risco`·`fora`, computado). No v1, `current_value` é manual e `source_kind` é sempre `manual`. **Colunas v2-inertes** (`source_config`, `last_synced_at`, e o valor `metrica` de `source_kind`) existem desde o v1 — nuláveis, sem comportamento — por decisão de produto: a integração viva com a central-de-dados deve ser puramente aditiva (sem migration de schema no v2). Mantidas conscientemente apesar do custo de superfície de migration/codegen.

**`strategy_themes`** — `node_id` PK/FK, `title`, `description`.

**`strategy_swot_cards`** — `node_id` PK/FK, `swot_type` (`forca`·`fraqueza`·`oportunidade`·`ameaca`), `text`.

**`strategy_resources`** — `node_id` PK/FK, `resource_kind` (`meta_ads`·`google_ads`·`site`·`instagram`·`outro`), `label`, `binding` jsonb null *(ex.: `{client_platform_id}` p/ Meta; `{url}` p/ site; `{handle}` p/ instagram — preenchido no v1, consumido no v2)*.

**`strategy_plans`** — `node_id` PK/FK, `action_map_id` uuid → maps.id *(o `map` operacional, `kind='action'`, que materializa o plano)*, `hypothesis` text (a hipótese "X→Y porque Z"). Nome `action_map_id` (não `map_id`) para desambiguar do `strategy_nodes.map_id` (o canvas estratégico). CHECK/validação na app de que o map referenciado tem `kind='action'`. `ON DELETE`: se o `map` operacional for apagado, o nó Plano perde o vínculo — `action_map_id` vira `NULL` (`SET NULL`); o nó permanece no mapa estratégico com a hipótese, sinalizado como "sem plano de ação vinculado".

### 6.4 `strategy_edges`

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps.id | o canvas estratégico |
| `source_node_id` / `target_node_id` | uuid → strategy_nodes.id | grafo livre, sem restrição de kind |
| `relation_type` | text null | vocabulário sugerido: `gera`·`serve`·`contem`·`move`·`mede`; livre |
| `label` | text null | rótulo livre |
| `metadata` | jsonb null | |
| `created_by` | uuid → users.id | |
| `created_at` | timestamptz | |

**Constraints:** ambos os nós da aresta devem pertencer ao mesmo canvas — validação `source_node.map_id = target_node.map_id = edges.map_id` (CHECK via trigger ou na camada de aplicação). `ON DELETE CASCADE` de `strategy_nodes` → arestas que tocam um nó apagado somem.

**Decisões embutidas:**
- Objetivo não bindeia métrica; saúde = agregação dos KRs ligados.
- KR é o nó vivo de verdade. v1 manual; v2 plugga `source_kind=metrica` sem migration (colunas já existem).
- Recurso é a âncora externa via `binding` (v1: preenchido/editável, **inerte** — sem pull).
- Plano = `map` operacional + hipótese.

### 6.5 Integridade, consistência e deleção

- **kind ↔ satélite:** cada `strategy_nodes` tem exatamente um satélite, da tabela que casa com seu `kind` (nó `kr` ⇒ linha em `strategy_krs`, e só nela). Garantido na criação transacional (§10.2) e por validação na app.
- **workspace consistente:** `strategy_nodes.workspace_id` deve igualar `maps.workspace_id` do `map_id`. Trigger/validação impede drift que burlaria a autorização por workspace.
- **Deleção em cascata:**
  - apagar um `strategy_nodes` ⇒ cascade no satélite + nas `strategy_edges` que o tocam.
  - apagar a linha `maps` `strategy` (raro; só com o workspace) ⇒ cascade em `strategy_nodes`, `strategy_edges`, e nas formas/textos/imagens daquele `map_id` (comportamento já existente de `maps`).
  - apagar o `map` operacional referenciado por um Plano ⇒ `strategy_plans.action_map_id` vira `NULL` (não apaga o nó Plano).
- **Satélites:** PK = FK = `node_id`, `ON DELETE CASCADE` a partir de `strategy_nodes`.

---

## 7. Nós e arestas (comportamento)

### 7.1 Tipos de nó

Seis kinds, cada um com card visual próprio (cor/ícone por tipo, paleta `@beeads/tokens`). SWOT tem 4 subtipos por `swot_type`. Criação por **botão na toolbar** (um por tipo) ou duplo-clique no canvas.

### 7.2 Arestas flutuantes

Diferente do plano de ação (handles fixos esquerda/direita, fluxo L→R), no mapa estratégico:
- A ligação parte de **qualquer ponto da borda** do card.
- O ponto de encontro linha↔card é **dinâmico**: ancora no ponto da borda mais próximo do outro nó e **recalcula ao mover** os cards (padrão *floating edges* do ReactFlow).

### 7.3 Arestas com relação

Clicar numa aresta abre edição de `label` livre + escolha opcional de `relation_type` (vocabulário da gramática). Sempre opcional — uma aresta sem tipo é válida.

### 7.4 Sugestões inteligentes (não-trava)

Regras de UI **determinísticas** (não usam IA): disparam por padrão de tipos ligados. O sistema **oferece**, nunca bloqueia:
- Ligar 2 cards SWOT → botão flutuante na aresta: "criar Tema a partir deste cruzamento?" (cria nó Tema pré-ligado aos dois SWOT).
- Ligar KR a Objetivo → sugerir `relation_type = mede`.
- Ligar Plano a KR → sugerir `move`; Tema a Objetivo → `serve`; Tema a Plano → `contem`.

Sugestões são dispensáveis e nunca impedem uma ligação livre.

### 7.5 Edição / autosave

Segue a convenção de autosave do Bloquim: edição inline, salva no `onBlur`/`onChange`, sem botões Salvar/Cancelar. (Ver memória `bloquim_autosave_convention`.)

### 7.6 Sincronização em tempo real

A camada de presença (`presenceServer`) é **só cursores/usuários** — não sincroniza dados. Decisão de co-edição dos nós/arestas no v1:

- **v1 = paridade com o plano de ação.** O canvas estratégico usa o **mesmo mecanismo de sincronização de dados que os `cards`/conexões do plano de ação já usam hoje** (a verificar no plano de implementação: se há broadcast WebSocket de mutações ou só invalidação de query/optimistic update via TanStack Query). Não inventar mecanismo novo — espelhar o existente garante consistência e não-regressão.
- Se o plano de ação hoje **não** tem co-edição ao vivo de dados (só presença de cursor), então o mapa estratégico também não terá no v1: mutações via REST otimista + invalidação; co-edição simultânea de dados fica fora do v1. Cursores multiplayer **continuam** ao vivo (camada de presença, compartilhada).

### 7.7 Undo/redo

Espelhar o comportamento do plano de ação: se o canvas atual tem undo/redo, o componente base compartilhado o herda para os dois mapas; se não tem, fica **fora do v1** (mutações são autosave + deleção explícita). Decisão final no plano, após inspecionar o canvas atual.

---

## 8. Vivacidade e saúde

### 8.1 v1 (manual)

- **KR:** `current_value` digitado. `health` computado de `target_value`, `current_value`, `baseline_value`, `direction`:
  - progresso = `(current − baseline) / (target − baseline)` ajustado por `direction`.
  - faixa → `no_prazo` · `risco` · `fora` (limiares definidos no plano de implementação).
- **Objetivo:** `health` = agregação da saúde dos KRs ligados (arestas para nós kind=`kr`). Regra de agregação (pior-caso vs média) definida no plano.

### 8.2 Pós-v1 (central-de-dados) — fora do escopo v1

- KR com `source_kind=metrica` puxa valor da central-de-dados via `source_config` + `binding` do Recurso ligado.
- A central-de-dados já mapeia `clients.bloquim_workspace_id` → workspace e expõe RPCs (`meta_daily_totals`, `meta_entities_aggregated`, etc.). O desenho da consulta fica para o v2; as colunas (`source_kind`, `source_config`, `last_synced_at`) já existem para que a adição seja puramente aditiva.

---

## 9. Integração com o ecossistema

- **Central-de-dados** (pós-v1): fonte de métricas vivas para KRs via Recursos. Ligação por `clients.bloquim_workspace_id`.
- **Agentes** (`agentes-beeads`, mercurio, etc.): leem o grafo estratégico via endpoint REST do Bloquim (§10), usando o SSO `__beeads_session`. O grafo é desenhado para reconstruir a cadeia de raciocínio sem heurística.
- **SSO:** sem mudança. Auth pelo cookie `__beeads_session` (JWT HS256 compartilhado), middleware `requireAuth` existente.

---

## 10. API

Rotas novas no `api-server`, sob a permissão de membro do workspace (middleware existente).

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/workspaces/:wId/strategy` | grafo inteiro: `{ map, nodes[], edges[] }` com entidades tipadas embutidas por nó. Cria lazy a linha `strategy` se inexistente. |
| `POST` | `/api/workspaces/:wId/strategy/nodes` | cria nó (kind + payload tipado + posição) |
| `PATCH` | `/api/workspaces/:wId/strategy/nodes/:nodeId` | atualiza posição / campos tipados (autosave) |
| `DELETE` | `/api/workspaces/:wId/strategy/nodes/:nodeId` | remove nó (+ arestas órfãs) |
| `POST` | `/api/workspaces/:wId/strategy/edges` | cria aresta (source, target, relation_type?, label?) |
| `PATCH` | `/api/workspaces/:wId/strategy/edges/:edgeId` | atualiza relation_type/label/metadata |
| `DELETE` | `/api/workspaces/:wId/strategy/edges/:edgeId` | remove aresta |

Formas/texto/imagem reusam as rotas existentes de `map_shapes`/`map_text_elements`/storage (chave `map_id` = canvas estratégico). Codegen: as rotas entram no `openapi.yaml` → Orval → hooks React Query + Zod (pipeline existente).

### 10.1 Leitura por agentes

- O `GET .../strategy` já deixa o grafo alcançável no v1.
- Wrappers MCP (`get_strategy_map`, etc.) no `bloquim-mcp` entram quando um agente precisar — mesmo padrão dos `plan tools` (que hoje envolvem `/maps`).

### 10.2 Permissões

Reusa os papéis de `workspace_members` (`admin` · `editor` · `executor`) com o middleware de permissão existente. Mapeamento v1:

| Ação | admin | editor | executor |
|---|---|---|---|
| Ver o mapa estratégico | ✓ | ✓ | ✓ |
| Criar/editar/mover nós e arestas | ✓ | ✓ | ✗ (só leitura) |
| Editar valor de KR / status de Objetivo | ✓ | ✓ | ✗ |
| Vincular Plano a um `map` operacional | ✓ | ✓ | ✗ |
| Apagar nós/arestas | ✓ | ✓ | ✗ |

(Alinhar com a política de permissão já aplicada aos `maps`/cards; se a do plano de ação diferir, seguir a dela para consistência — verificar no plano.)

### 10.3 Semântica transacional

- **Criação de nó:** `INSERT strategy_nodes` + `INSERT` no satélite tipado numa **única transação** (nó sem satélite, ou vice-versa, é estado inválido).
- **Criação lazy do mapa `strategy`:** `INSERT ... ON CONFLICT (workspace_id) WHERE kind='strategy' DO NOTHING` + `SELECT`, idempotente, protegido pelo índice único parcial (§6.1).
- **Aresta entre nós:** valida (na mesma transação) que ambos os nós existem e pertencem ao `map_id`.
- **Deleção de nó:** transação que remove satélite + arestas incidentes + o nó (ou via `ON DELETE CASCADE`).

---

## 11. Escopo

### Dentro do v1
- Aba Estratégia; canvas `strategy` por workspace (linha `maps` lazy + `maps.kind`).
- Componente de canvas base compartilhado (refactor preservando comportamento) com `mode`.
- Ferramentas globais compartilhadas: zoom/pan/cursor, formas, imagem, texto, cursores multiplayer, toolbar.
- Nós: objetivo · swot(4) · tema · kr (manual) · plano (→ map) · recurso (cartografia, `binding` guardado, sem pull).
- Grafo livre · arestas flutuantes · rótulo/tipo opcional.
- Sugestões inteligentes (cruzamento SWOT → tema; rotulagem da gramática).
- Saúde do KR (manual) e do Objetivo (agregação).
- Endpoints de leitura/escrita do grafo, com permissões por papel (`admin`/`editor` editam; `executor` lê).
- Sincronização de dados espelhando o plano de ação (§7.6).

### Fora (depois)
- Pull vivo da central-de-dados (KR `source_kind=metrica`) — aditivo.
- Camada missão/visão da empresa.
- Tarefas/execução (vivem nos `maps`).
- Wrappers MCP para agentes (endpoint já existe no v1).

---

## 12. Não-regressão e estratégia de refactor

- O mapa estratégico é aditivo: tabelas `strategy_*`, coluna `maps.kind` (default preserva semântica atual), nova aba.
- O nó Plano só **referencia** um `map` (FK de leitura); não altera comportamento do `map`.
- Extrair o canvas base é refactor **comportamento-preservante**: a UI do plano de ação atual deve funcionar idêntica.
- **Gate:** suíte de regressão do plano de ação (cards, conexões, formas, texto, imagem, presença, zoom) verde antes de qualquer merge que toque o canvas compartilhado.

### 12.1 Checklist de pontos de integração em risco

Cada item deve ser verificado e tratado explicitamente no plano de implementação:

1. **Queries/rotas de listagem de `maps`** — todas precisam filtrar `kind='action'` (ou default) para não vazar o canvas `strategy` na lista de Mapas, busca, sidebar, recent maps, dashboard.
2. **Rotas de `map_shapes` / `map_text_elements` / storage** — confirmar que nenhuma assume `cards`/`tasks` no map; devem operar por `map_id` agnóstico ao `kind`.
3. **Payload da presença WebSocket** — garantir que é agnóstico ao `mode` (não pressupõe IDs de card); cursores funcionam nos dois mapas.
4. **Guards da toolbar** — ações específicas de `action` (criar card/conexão fixa) não disparam em `strategy` e vice-versa.
5. **Isolamento do render de nó** — comportamento card↔task fica 100% atrás do `mode='action'`; nenhum código de estratégia toca a renderização de cards.
6. **MCP `plan tools`** — continuam envolvendo só `/maps` `kind='action'`; não devem enxergar o map `strategy`.

### 12.2 Ordem de migration (produção)

1. Migration DB: adicionar `maps.kind` com default `action` (backfill implícito) + tabelas `strategy_*` + índices/constraints.
2. Server: aplicar filtros `kind='action'` nas queries existentes de `maps` (item 1 do checklist) **antes** de qualquer linha `strategy` existir.
3. Server: novas rotas `/strategy/*` + criação lazy.
4. Codegen (`openapi.yaml` → Orval → Zod) + release da UI (aba Estratégia).

Passos 1–2 protegem os maps de produção; a aba só aparece após 3–4.

---

## 13. Riscos e questões abertas

- **Polimorfismo de nó:** `strategy_nodes` + satélites 1:1 vs colunas inline. Optado por satélites (dado tipado limpo p/ agentes); custo = joins na leitura. Mitigado pelo endpoint que monta o grafo de uma vez.
- **Floating edges em ReactFlow 11 (ponto técnico mais novo):** exige edge type custom + cálculo de interseção linha↔borda do nó (exemplo oficial "Floating Edges" do RF11 é a base). Pontos a resolver no plano: hit-testing/seleção da aresta, edição da aresta selecionada (rótulo/tipo), reconexão, e performance do recálculo durante o drag (memoizar interseção, recalcular só nos nós movidos).
- **Limiares de saúde** (faixas `no_prazo`/`risco`/`fora`) e **regra de agregação** do Objetivo (pior-caso vs média ponderada): definir no plano de implementação.
- **Mecanismo de sincronização de dados** (§7.6) e **undo/redo** (§7.7): decisão final depende de inspecionar o que o plano de ação já faz — espelhar, não inventar.
- **Conjunto inicial de `relation_type`** e vocabulário de sugestões: validar com uso real.

---

## 14. Referências conceituais

Kernel de estratégia de Richard Rumelt (diagnóstico → política norteadora → ação coerente) · Strategy Map de Kaplan & Norton (estratégia como rede de objetivos ligados) · matriz TOWS (cruzamento de SWOT gera estratégias) · OKR (separar resultado mensurável do trabalho).
