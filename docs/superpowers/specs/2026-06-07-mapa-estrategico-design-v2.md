# Mapa Estratégico do Workspace — Spec de Design (v2)

> **Status:** rascunho consolidado pós-revisão · **Data:** 2026-06-07 · **Branch:** `feature/mapa-estrategico-spec`
> **Supersede:** `2026-06-07-mapa-estrategico-design.md` (v1).
> **Escopo deste doc:** o quê e por quê em nível de design. Detalhes de implementação fina ficam para o plano.

## Changelog v1 → v2 (por gap aceito na revisão)

- **#1 — Dimensão temporal + saúde por ritmo.** Nova entidade `strategy_cycles` (período no nível do mapa). KR ganha `cycle_id` + `target_date`. Saúde deixa de ser ratio absoluto e passa a ser **progresso real vs. esperado no tempo decorrido do ciclo**. → §5.2, §6.2, §6.3, §8.
- **#2 — Pré-preencher tipo de aresta + agregação por `mede`.** `relation_type` é pré-preenchido deterministicamente nos padrões da gramática (editável/apagável); agregação de saúde do objetivo chaveia por arestas `mede`. Aresta KR→Objetivo **sem tipo não conta** no rollup. → §6.4, §7.4, §8.1.
- **#3 — Limiares = decisão de produto + suavização anti-ruído.** Agregação pior-caso; limiares provisórios marcados como decisão de produto; transição para `risco`/`fora` só após persistência (média móvel / N períodos), nunca num snapshot. → §8.
- **#4 — Cortar `source_*` do KR.** `source_kind`, `source_config`, `last_synced_at` saem do v1 — o "source" inteiro vira bundle aditivo no v2. `binding` do Recurso mantido. → §6.3, §8.2.
- **#5 — Guarda por escopo default.** Camada de repository de `maps` filtra `kind='action'` por padrão; canvas `strategy` só por caminho explícito. → §5.2, §12.1.
- **#6 — Escrita estreita do executor.** `executor` escreve só `current_value` do KR. → §10.2.
- **#7 — Plano↔map 1:1.** Unique em `action_map_id`. → §6.3.
- **#8 — Detector de órfãos como sinal.** Badge dispensável para padrões incompletos; nunca trava. → §7.8.
- **#9 — Proveniência de SWOT.** Por aresta (SWOT→Recurso) no v1; anexo em nó de estratégia (`attachments.strategy_node_id`) adiado mas registrado. → §6.3, §13.

> **Validação adversarial:** a matemática temporal/saúde (§6.2, §6.4, §8.1) passou por uma rodada de revisão do codex; correções de corretude (divisor zero, datas-limite, `descer`, clamp, saúde sem `mede`, suavização sobre dado manual) já estão incorporadas. Detalhe das resoluções no §8.1 e §13.
> **Decisões de produto pendentes** (não chutar valor definitivo): limiares de saúde (§8.1); N da suavização (§8.1); mecanismo de carry-over/clonagem de ciclo (§6.2).
> **Item borderline (#4):** dropar `source_kind` junto com o resto do bundle. Se o dono preferir manter só o enum como documentação de intenção, é a única linha a reverter.

---

## 1. Resumo executivo

Transformar o workspace do Bloquim numa **tela visual de planejamento estratégico**: um grafo tipado e livre onde diagnóstico (SWOT), objetivos, resultados (KR), temas, planos e recursos vivem conectados. O poder está nas **ligações** — ler o grafo conta a história estratégica inteira do cliente.

A construção reaproveita o canvas ReactFlow do "plano de ação" (`maps`), extraindo um **componente de canvas base compartilhado**. Ferramentas globais (zoom, cursor, formas, texto, imagem, cursores multiplayer, toolbar) são **um código só** e refletem nos dois mapas. Só nós/arestas são específicos.

O mapa estratégico é **puramente aditivo**: tabelas `strategy_*`, uma coluna aditiva em `maps`, nova aba. **Zero regressão** no plano de ação é invariante de projeto.

---

## 2. Problema

A estratégia de um cliente vive em pedaços desconectados (SWOT num doc, objetivos numa planilha, tarefas noutra ferramenta). A lógica diagnóstico → meta → ação evapora; meses depois ninguém lembra o raciocínio. Este mapa mantém a cadeia inteira visível e viva num só lugar.

---

## 3. Conceito central

Grafo tipado e livre, **um por workspace**:

- **Objetivo** — a meta de negócio; a direção. Poucos por mapa. Pertence a um ciclo.
- **SWOT** — diagnóstico em quatro tipos: força, fraqueza, oportunidade, ameaça.
- **Tema estratégico** — política norteadora; agrupa planos sob uma aposta. Nasce, idealmente, do cruzamento de cards SWOT (TOWS).
- **KR** — resultado mensurável (número + alvo + prazo) que define se o objetivo foi atingido. Resultado, nunca tarefa. Pertence a um ciclo.
- **Plano** — aposta concreta para mover um KR, com hipótese "X→Y porque Z". **Um Plano é um `map` operacional existente** (camada de execução), referenciado como nó.
- **Recurso** — ativo cartografado: conta Meta Ads, Google Ads, site, perfil Instagram, etc. Âncora do dado vivo (pós-v1) e da proveniência de SWOT (v1, por aresta).

As **tarefas não vivem neste mapa** — são a camada operacional, dentro dos `maps`.

---

## 4. Princípios invioláveis

1. **As ligações são a estratégia.** O raciocínio mora nos fios.
2. **KR é resultado, não atividade.**
3. **O mapa é vivo.** Nós de resultado mostram saúde no próprio mapa. v1: saúde de números manuais, ciente de ritmo. Pós-v1: dado real da central-de-dados.
4. **Grafo livre + sugestões inteligentes.** Qualquer nó liga em qualquer nó. Tipo de aresta é pré-preenchido nos padrões da gramática mas sempre editável/apagável; gramática sugere, nunca obriga.
5. **Foco.** Poucos objetivos, temas, KRs. O mapa resiste ao acúmulo.
6. **O objetivo é provisório até o diagnóstico validar.** Estado `provisorio` → `validado`.
7. **Dados conectados e vivos, não rótulos num desenho.** Nós são entidades tipadas legíveis por agentes desde o começo.
8. **Não-regressão.** O plano de ação atual permanece intocado em comportamento; refator de padronização preserva funcionalidade, com regressão verde antes do merge.

---

## 5. Arquitetura

### 5.1 Superfície
- Nova aba **"Estratégia"** no detalhe do workspace.
- **Um canvas estratégico por workspace** — "o workspace é o mapa estratégico".

### 5.2 O canvas estratégico é uma linha em `maps`
Para que formas, texto, imagem e presença (todas chaveadas por `map_id`) sejam **literalmente compartilhadas**, o canvas estratégico **é uma linha em `maps`**, uma por workspace:

- Coluna nova **`maps.kind`** (`action` default | `strategy`). Aditiva.
- Linha `strategy` criada **lazy**, idempotente, protegida por índice único parcial (§6.1).
- `map_shapes`, `map_text_elements`, presença e attachments seguem por `map_id` → funcionam sem mudança de schema.
- `cards` fica **vazia** para mapas `strategy`.
- **Guarda por escopo default (gap #5):** a camada de repository/query de `maps` filtra `kind='action'` por padrão; o canvas `strategy` só é acessível por caminho explícito (opt-in). Vira "opte por enxergar `strategy`" em vez de "lembre de filtrar" — features futuras de `maps` ficam seguras por construção. (Detalhe operacional no §12.1.)

### 5.3 Componente de canvas base compartilhado
Extrair um componente base (refactor preservando comportamento) usado pelos dois mapas, parametrizado por `mode: 'action' | 'strategy'`.

| Camada | Compartilhada | Específica do `mode` |
|---|---|---|
| Zoom / pan / cursor / seleção | ✓ | |
| Formas (`map_shapes`) | ✓ | |
| Imagem (`map_shapes type=image` + `attachments`) | ✓ | |
| Texto (`map_text_elements`) | ✓ | |
| Cursores multiplayer (presença WebSocket) | ✓ | |
| Toolbar (posição + design) | ✓ (só troca botões) | |
| Renderer de nó | | ✗ cards ↔ `strategy_nodes` |
| Comportamento de aresta | | ✗ handles fixos ↔ flutuantes |

**Princípio de manutenção:** toda ferramenta de canvas mora no base e vale para os dois mapas; só nós/arestas são específicos do `mode`. Qualquer ferramenta global futura nasce nos dois.

### 5.4 Pilha técnica (reuso)
React 19 · Vite · ReactFlow 11 · TanStack Query · Zustand · `@beeads/ui` · Express 5 · Drizzle · Supabase · presença WebSocket. Nada novo de infra.

---

## 6. Modelo de dados

Padrão: `strategy_nodes` cuida do canvas; satélites tipados 1:1 (`node_id`) cuidam da semântica; arestas referenciam `strategy_nodes`. Prefixo `strategy_`.

### 6.1 `maps` (alteração aditiva)

| Coluna | Tipo | Nota |
|---|---|---|
| `kind` | enum `action` \| `strategy`, default `action` | filtro de listagem; 1 linha `strategy` por workspace |

**Constraints:** índice único parcial `UNIQUE (workspace_id) WHERE kind = 'strategy'`. Criação lazy via `INSERT ... ON CONFLICT DO NOTHING` + `SELECT`.

### 6.2 `strategy_cycles` (novo — gap #1)

Período de planejamento no **nível do mapa** (não por objetivo). A cadência OKR (fechar → arquivar → reabrir) age sobre o ciclo como unidade; objetivos e KRs compartilham o ciclo.

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps.id (cascade) | o canvas `strategy` |
| `label` | text | ex.: "Q3 2026" |
| `starts_on` / `ends_on` | date | janela do ciclo |
| `status` | enum `ativo` · `arquivado` | |
| `created_at` | timestamptz | |

**Constraint:** no máximo um ciclo `ativo` por mapa — `UNIQUE (map_id) WHERE status = 'ativo'`. Fechar um ciclo = `arquivado`; abrir o próximo = novo registro `ativo`.

**Cadência ao fechar/abrir (resolve gap apontado na validação):** objetivos e KRs guardam `cycle_id`. Ao arquivar o ciclo ativo e abrir o próximo:
- Objetivos/KRs do ciclo arquivado **permanecem visíveis como histórico read-only** (filtrados pelo `cycle_id` arquivado); não somem.
- A view ativa do mapa **filtra pelo ciclo `ativo`** — SWOT/Tema/Recurso/Plano (sem `cycle_id`) seguem visíveis nos dois.
- **Carry-over (clonar objetivos/KRs do ciclo anterior para o novo) é ação explícita do usuário**, não automática — e o *mecanismo de clonagem* fica como **decisão de produto pendente** (não inventar agora). No v1 mínimo, abrir ciclo começa o conjunto de objetivos/KRs vazio; o usuário recria ou (futuro) clona.

### 6.3 `strategy_nodes`

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps.id (cascade) | a linha `strategy` do workspace |
| `workspace_id` | uuid → workspaces.id | denormalizado p/ auth; deve casar com `maps.workspace_id` |
| `kind` | enum `objetivo`·`swot`·`tema`·`kr`·`plano`·`recurso` | |
| `position_x` / `position_y` | numeric | |
| `width` / `color` | opcional | paridade visual com cards |
| `created_by` | uuid → users.id | |
| `created_at` / `updated_at` | timestamptz | |

### 6.4 Satélites tipados (1:1 por `node_id`)

**`strategy_objectives`** — `node_id` PK/FK, `cycle_id` uuid → strategy_cycles.id *(gap #1)*, `title`, `description`, `status` (`provisorio`·`validado`·`arquivado`). Saúde **derivada da agregação pior-caso dos KRs ligados por aresta `mede`** (§8.1); sem nenhuma aresta `mede`, saúde = **`sem_medicao`** (não `fora`). Não bindeia métrica direto.

**`strategy_krs`** — `node_id` PK/FK, `cycle_id` uuid → strategy_cycles.id, `title`, `unit`, `target_value` numeric, `current_value` numeric (manual no v1), `baseline_value` numeric null, `direction` (`subir`·`descer`), **`target_date` date** *(gap #1 — nasce puxando `cycle.ends_on`, sobrescrevível; **CHECK `target_date ≤ cycle.ends_on`** para preservar a cadência do ciclo)*, `health_readings` jsonb *(array circular dos últimos N snapshots de saúde — base da suavização §8.1; não é tabela nova)*, `health` (`no_prazo`·`risco`·`fora`·`atingido`·`nao_atingido`, computado — §8). Validação: `direction` coerente com `baseline`/`target`; `target == baseline` ⇒ KR entra em **modo booleano** (§8.1). **Sem `source_*` no v1** *(gap #4 — o bundle source kind/config/last_synced entra como adição única no v2)*.

**`strategy_themes`** — `node_id` PK/FK, `title`, `description`.

**`strategy_swot_cards`** — `node_id` PK/FK, `swot_type` (`forca`·`fraqueza`·`oportunidade`·`ameaca`), `text`. *Proveniência (gap #9): no v1, por aresta livre SWOT→Recurso (de graça). Anexo de documento ao nó (precisa `attachments.strategy_node_id`) é omissão consciente, adiada e registrada (§13).*

**`strategy_resources`** — `node_id` PK/FK, `resource_kind` (`meta_ads`·`google_ads`·`site`·`instagram`·`outro`), `label`, `binding` jsonb null *(preenchido/editável no v1; consumido no pull v2)*.

**`strategy_plans`** — `node_id` PK/FK, `action_map_id` uuid → maps.id *(o `map` operacional, `kind='action'`)*, `hypothesis` text. CHECK/validação de que o map referenciado tem `kind='action'`. `ON DELETE SET NULL` (apagar o map operacional zera o vínculo, preserva o nó). **`UNIQUE (action_map_id)`** *(gap #7 — um map operacional referenciado por no máximo um nó Plano)*. `action_map_id` (não `map_id`) desambigua do `strategy_nodes.map_id`.

### 6.5 `strategy_edges`

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `map_id` | uuid → maps.id | o canvas estratégico |
| `source_node_id` / `target_node_id` | uuid → strategy_nodes.id | grafo livre, sem restrição de kind |
| `relation_type` | text null | vocabulário: `gera`·`serve`·`contem`·`move`·`mede`; **pré-preenchido nos padrões da gramática (gap #2)**, editável/apagável |
| `label` | text null | rótulo livre |
| `metadata` | jsonb null | |
| `created_by` | uuid → users.id | |
| `created_at` | timestamptz | |

**Pré-preenchimento determinístico (gap #2):** ao criar a aresta, se o par de kinds casa a gramática, `relation_type` nasce preenchido — KR→Objetivo = `mede`, Plano→KR = `move`, Tema→Objetivo = `serve`, Tema→Plano = `contem`. Fora da gramática / ambíguo → `null`. SWOT×SWOT **não** recebe tipo: dispara o nascimento de Tema (§7.4).

**Constraints:** ambos os nós no mesmo canvas (`source.map_id = target.map_id = edges.map_id`, via trigger/app). `ON DELETE CASCADE` de `strategy_nodes`.

### 6.6 Integridade, consistência e deleção
- **kind ↔ satélite:** cada nó tem exatamente um satélite, da tabela que casa com seu `kind`. Garantido na criação transacional (§10.3) e por validação.
- **workspace consistente:** `strategy_nodes.workspace_id` = `maps.workspace_id` do `map_id`. Trigger/validação impede drift de autorização.
- **ciclo ↔ nó:** `objetivos` e `krs` referenciam `cycle_id` do mesmo `map_id`.
- **Deleção em cascata:** apagar nó ⇒ cascade no satélite + arestas incidentes. Apagar a linha `maps` `strategy` ⇒ cascade em ciclos, nós, arestas, formas/textos/imagens. Apagar o `map` operacional de um Plano ⇒ `action_map_id` = `NULL`.

---

## 7. Nós e arestas (comportamento)

### 7.1 Tipos de nó
Seis kinds, card visual próprio (cor/ícone, paleta `@beeads/tokens`). SWOT com 4 subtipos. Criação por botão na toolbar (um por tipo) ou duplo-clique.

### 7.2 Arestas flutuantes
Diferente do plano de ação (handles fixos esq/dir, fluxo L→R): a ligação parte de **qualquer ponto da borda**, e o ponto de encontro é **dinâmico** — ancora no ponto mais próximo do outro nó e **recalcula ao mover** (floating edges do ReactFlow).

### 7.3 Arestas com relação
Clicar na aresta abre `label` livre + `relation_type` (pré-preenchido se casar a gramática, §6.5). Sempre editável/apagável — aresta sem tipo é válida.

### 7.4 Sugestões inteligentes (não-trava)
Regras de UI **determinísticas** (não usam IA), por padrão de tipos ligados. Oferece, nunca bloqueia:
- Ligar 2 cards SWOT → botão flutuante na aresta: "criar Tema a partir deste cruzamento?" (cria Tema pré-ligado aos dois SWOT). A aresta SWOT×SWOT em si fica sem `relation_type`.
- Padrões da gramática (KR→Objetivo etc.) já nascem com tipo pré-preenchido (§6.5) — não precisam de sugestão, só de edição opcional.

### 7.5 Edição / autosave
Convenção autosave do Bloquim: edição inline, salva no `onBlur`/`onChange`, sem botões Salvar/Cancelar. (Memória `bloquim_autosave_convention`.)

### 7.6 Sincronização em tempo real
Presença (`presenceServer`) é só cursores — não sincroniza dados. **v1 = paridade com o plano de ação:** o canvas estratégico usa o mesmo mecanismo de sync de dados que `cards`/conexões já usam (a verificar no plano: broadcast WS de mutações vs. invalidação de query/optimistic). Espelhar, não inventar. Cursores multiplayer continuam ao vivo (presença compartilhada).

### 7.7 Undo/redo
Espelhar o plano de ação: se o canvas atual tem undo/redo, o base herda para os dois; se não, fica fora do v1. Decisão final após inspecionar o canvas atual.

### 7.8 Detector de órfãos (gap #8)
Sinal visual leve e **dispensável** (badge sutil), nunca trava, para padrões incompletos conhecidos:
- Objetivo sem KR ligado por `mede`.
- KR sem Plano (sem aresta `move` de um Plano).
- Plano sem `action_map_id` vinculado.
- **Aresta KR→Objetivo sem `mede`** — aviso visível de que o KR **não está contando** na saúde do objetivo (efeito colateral consciente do gap #2; evita "sumiço silencioso" do KR no rollup).
Mesma filosofia das sugestões (§7.4): oferece foco (princípio 5) sem violar o grafo livre (princípio 4).

---

## 8. Vivacidade e saúde

### 8.1 v1 (manual, ciente de ritmo) — gaps #1, #2, #3

> As regras abaixo incorporam a validação adversarial do codex sobre casos-limite da matemática temporal. Onde resta um número, é **decisão de produto pendente** (não cravar).

**KR — progresso real** (clampado a `[0, 1]` para fins de saúde; pode exibir `>1` como "superou", mas a saúde teto é `no_prazo`):
```
progresso_real = clamp( (current − baseline) / (target − baseline), 0, 1 )
```
- **`direction`** não inverte a fórmula: ela já se auto-normaliza se `baseline`/`target` refletirem a direção. `direction` **valida** a coerência (`subir` ⇒ `target > baseline`; `descer` ⇒ `target < baseline`) e dirige o texto da UI. Validar na criação/edição do KR.
- **`target == baseline` (divisor zero):** proibido na validação. KR sem range mensurável vira **modo booleano** — `atingido`/`não atingido` por `current ≥ target` (subir) ou `current ≤ target` (descer) —, sem cálculo de ritmo. Evita NaN/Infinity poluindo o rollup.

**KR — progresso esperado** (ritmo no ciclo):
```
inicio   = max(cycle.starts_on, kr.created_at)        # início efetivo
fim      = kr.target_date                              # ≤ cycle.ends_on (constraint §6.4)
decorrido_frac = clamp( (hoje − inicio) / max(fim − inicio, 1 dia), 0, 1 )
progresso_esperado = decorrido_frac
razao = progresso_real / max(progresso_esperado, ε)   # ε protege divisor ~0 no início do ciclo
```
- **Datas:** semântica de dia inteiro (`inicio` = começo do dia; `fim` = fim do dia). Denominador com piso de **1 dia** (resolve ciclo de 1 dia / KR criado perto do fim). No início do ciclo (`decorrido_frac ≈ 0`) a razão é alta por construção → saúde `no_prazo` (correto: cedo demais para cobrar).

**Limiares provisórios sobre a razão** *(decisão de produto, calibrável — não cravar):* `≥0.9` → `no_prazo`, `0.7–0.9` → `risco`, `<0.7` → `fora`.

**Suavização anti-ruído (gap #3, obrigatória).** Como o `current_value` é **manual e esporádico**, "período" = **evento de atualização** (snapshot), não dia de calendário. A saúde só transiciona para `risco`/`fora` após **N snapshots consecutivos** abaixo da faixa; um único snapshot ruim não vira vermelho. Isso exige reter os últimos snapshots de saúde do KR — campo `health_readings` jsonb em `strategy_krs` (array circular dos últimos N, **não** tabela nova). **N = decisão de produto pendente; deixar configurável.** *(Mecanismo definido aqui resolve a contradição "média móvel × valor único manual" apontada na revisão; o valor de N fica em aberto.)*

**Objetivo.** Saúde = agregação **pior-caso** dos KRs ligados **por aresta `relation_type='mede'`** (gap #2): tão saudável quanto seu KR mais fraco.
- **Aresta KR→Objetivo sem `mede` NÃO conta** no rollup — limpar/trocar o tipo remove o KR do cálculo. Consciente; a UI sinaliza (§7.8).
- **Objetivo sem nenhuma aresta `mede`:** saúde = **`sem_medicao`** (estado próprio, não `fora`), **excluído** de qualquer rollup acima. O badge de órfão (§7.8) cobre o caso visualmente; saúde e badge são sinais separados.

### 8.2 Pós-v1 (central-de-dados) — fora do escopo v1
KR com fonte automática puxará valor da central-de-dados. O "source" inteiro (discriminador + config + último sync) entra como **bundle aditivo único** no v2 (gap #4) — nada disso existe no schema v1. A central já mapeia `clients.bloquim_workspace_id` → workspace e expõe RPCs; o desenho da consulta fica para o v2. Como coluna nullable no Postgres é adição barata (sem lock/downtime), não há custo em adiar.

---

## 9. Integração com o ecossistema
- **Central-de-dados** (pós-v1): fonte de métricas vivas via Recursos. Ligação por `clients.bloquim_workspace_id`.
- **Agentes:** leem o grafo via endpoint REST + SSO `__beeads_session`. Com `relation_type` pré-preenchido nos padrões da gramática (§6.5), a cadeia de raciocínio é reconstruída sem heurística para as ligações canônicas; arestas livres sem tipo permanecem como contexto.
- **SSO:** sem mudança. Cookie `__beeads_session`, middleware `requireAuth`.

---

## 10. API

Rotas novas no `api-server`, sob permissão de membro do workspace.

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/workspaces/:wId/strategy` | grafo inteiro: `{ map, cycle, nodes[], edges[] }` com entidades tipadas embutidas. Cria lazy o map `strategy` (e o primeiro ciclo) se inexistente. |
| `POST` | `/api/workspaces/:wId/strategy/nodes` | cria nó (kind + payload + posição) |
| `PATCH` | `/api/workspaces/:wId/strategy/nodes/:nodeId` | atualiza posição / campos tipados (autosave) |
| `DELETE` | `/api/workspaces/:wId/strategy/nodes/:nodeId` | remove nó (+ satélite + arestas) |
| `POST` | `/api/workspaces/:wId/strategy/edges` | cria aresta (com pré-preenchimento de `relation_type`) |
| `PATCH` | `/api/workspaces/:wId/strategy/edges/:edgeId` | atualiza relation_type/label/metadata |
| `DELETE` | `/api/workspaces/:wId/strategy/edges/:edgeId` | remove aresta |
| `POST` | `/api/workspaces/:wId/strategy/cycles` | abre novo ciclo (arquiva o ativo) |

Formas/texto/imagem reusam rotas existentes (`map_id` = canvas estratégico). Codegen: `openapi.yaml` → Orval → hooks + Zod.

### 10.1 Leitura por agentes
`GET .../strategy` deixa o grafo alcançável no v1. Wrappers MCP (`get_strategy_map`) entram quando um agente precisar — mesmo padrão dos `plan tools`.

### 10.2 Permissões
Reusa papéis de `workspace_members` (`admin`·`editor`·`executor`) com o middleware existente.

| Ação | admin | editor | executor |
|---|---|---|---|
| Ver o mapa estratégico | ✓ | ✓ | ✓ |
| **Atualizar `current_value` de KR** *(gap #6)* | ✓ | ✓ | **✓ (escrita estreita)** |
| Criar/editar/mover nós e arestas | ✓ | ✓ | ✗ |
| Editar `target`/estrutura do KR, status do Objetivo | ✓ | ✓ | ✗ |
| Vincular Plano a `map` operacional | ✓ | ✓ | ✗ |
| Abrir/fechar ciclo | ✓ | ✓ | ✗ |
| Apagar nós/arestas | ✓ | ✓ | ✗ |

`executor` escreve **só** `current_value` (quem está mais perto do dado alimenta o número); todo o resto é leitura. (Alinhar com a política dos `maps` se diferir.)

### 10.3 Semântica transacional
- **Criação de nó:** `INSERT strategy_nodes` + `INSERT` no satélite numa única transação.
- **Criação lazy do map `strategy` + primeiro ciclo:** idempotente, protegida pelo índice único parcial (§6.1, §6.2).
- **Aresta:** valida na mesma transação que ambos os nós existem e pertencem ao `map_id`; aplica pré-preenchimento de tipo.
- **Deleção de nó:** transação remove satélite + arestas incidentes + nó (ou via cascade).

---

## 11. Escopo

### Dentro do v1
- Aba Estratégia; canvas `strategy` por workspace (`maps.kind` + linha lazy + primeiro ciclo).
- `strategy_cycles` (período no nível do mapa) + cadência abrir/arquivar.
- Componente de canvas base compartilhado (refactor preservando comportamento), `mode`.
- Ferramentas globais compartilhadas: zoom/pan/cursor, formas, imagem, texto, cursores multiplayer, toolbar.
- Nós: objetivo · swot(4) · tema · kr (manual, com `target_date`) · plano (→ map, 1:1) · recurso (cartografia, `binding` guardado, sem pull).
- Grafo livre · arestas flutuantes · `relation_type` pré-preenchido nos padrões, editável.
- Sugestões determinísticas (cruzamento SWOT → tema).
- Saúde do KR ciente de ritmo (vs. ciclo) com suavização; saúde do Objetivo por agregação pior-caso de arestas `mede`.
- Detector de órfãos (badge dispensável).
- Endpoints de leitura/escrita do grafo, com permissões por papel (incl. escrita estreita do executor).
- Sincronização de dados espelhando o plano de ação (§7.6).

### Fora (depois)
- Pull vivo da central-de-dados — bundle `source_*` aditivo no v2.
- Anexo de documento em nó de estratégia (`attachments.strategy_node_id`).
- Camada missão/visão da empresa.
- Tarefas/execução (vivem nos `maps`).
- Wrappers MCP para agentes (endpoint já existe no v1).

---

## 12. Não-regressão e estratégia de refactor

- Mapa estratégico aditivo: tabelas `strategy_*`, coluna `maps.kind` (default preserva semântica), nova aba.
- Nó Plano só **referencia** um `map` (FK de leitura); não altera comportamento do `map`.
- Extrair o canvas base é refactor **comportamento-preservante**: a UI do plano de ação funciona idêntica.
- **Gate:** suíte de regressão do plano de ação (cards, conexões, formas, texto, imagem, presença, zoom) verde antes de qualquer merge que toque o canvas compartilhado.

### 12.1 Checklist de pontos de integração em risco
1. **Listagem de `maps`** — implementar a **guarda por escopo default (gap #5)**: o repository de `maps` filtra `kind='action'` por padrão; toda listagem (Mapas, busca, sidebar, recent, dashboard) herda isso sem precisar lembrar. Acesso a `strategy` é opt-in explícito.
2. **Rotas de `map_shapes`/`map_text_elements`/storage** — confirmar que nenhuma assume `cards`/`tasks`; operam por `map_id` agnóstico ao `kind`.
3. **Payload de presença WebSocket** — agnóstico ao `mode` (não pressupõe IDs de card).
4. **Guards da toolbar** — ações de `action` (card/conexão fixa) não disparam em `strategy` e vice-versa.
5. **Isolamento do render de nó** — comportamento card↔task 100% atrás de `mode='action'`.
6. **MCP `plan tools`** — continuam envolvendo só `/maps` `kind='action'`.

### 12.2 Ordem de migration (produção)
1. Migration DB: `maps.kind` default `action` + tabelas `strategy_*` (incl. `strategy_cycles`) + índices/constraints.
2. Server: guarda por escopo default + filtros `kind='action'` **antes** de existir qualquer linha `strategy`.
3. Server: rotas `/strategy/*` + criação lazy (map + primeiro ciclo).
4. Codegen + release da UI (aba Estratégia).

Passos 1–2 protegem os maps de produção; a aba só aparece após 3–4.

---

## 13. Riscos e questões abertas

- **Polimorfismo de nó:** `strategy_nodes` + satélites 1:1; custo = joins na leitura, mitigado pelo endpoint que monta o grafo de uma vez.
- **Floating edges em ReactFlow 11 (ponto técnico mais novo):** edge type custom + interseção linha↔borda. Resolver no plano: hit-testing/seleção, edição da aresta selecionada, reconexão, performance no drag (memoizar interseção, recalcular só nós movidos).
- **Saúde ciente de ritmo (gap #1):** casos-limite **resolvidos no §8.1** (ciclo de 1 dia via piso de 1 dia no denominador; KR criado no fim via `max(starts_on, created_at)`; `target=baseline` via modo booleano; over-target via clamp `[0,1]`; `descer` via auto-normalização + validação). Risco residual: implementar a aritmética de datas exatamente como especificado (dia inteiro).
- **Suavização sobre dado manual (gap #3):** mecanismo resolvido (§8.1 — "período" = snapshot de atualização, `health_readings` jsonb); **N permanece decisão de produto pendente**, configurável.
- **Limiares de saúde (gaps #1, #3):** **decisão de produto pendente** — não cravar; deixar configurável e calibrar com uso.
- **Carry-over de ciclo (gap #1):** comportamento mínimo definido (§6.2 — arquivado vira histórico read-only, view filtra ciclo ativo); **mecanismo de clonagem é decisão de produto pendente**.
- **Agregação por `mede` (gap #2):** efeito colateral consciente — limpar o tipo de uma aresta KR→Objetivo tira o KR do rollup; precisa estar visível na UI para não confundir.
- **Anexo em nó de estratégia (gap #9):** omissão consciente; quando necessário, fiar `attachments.strategy_node_id`.
- **Item borderline (#4):** dropar `source_kind` junto do bundle; reverter só esta linha se o dono quiser o enum como documentação de intenção.
- **Sincronização de dados (§7.6) e undo/redo (§7.7):** espelhar o plano de ação; decisão final após inspeção.
- **Conjunto inicial de `relation_type`:** validar com uso real.

---

## 14. Referências conceituais
Kernel de estratégia de Richard Rumelt (diagnóstico → política norteadora → ação coerente) · Strategy Map de Kaplan & Norton · matriz TOWS · OKR (resultado mensurável separado do trabalho; ciclo set→review→reset).
