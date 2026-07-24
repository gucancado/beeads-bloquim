# Mapa Estratégico — Checklist de conformidade (PR 1: backend + infra)

> Propriedade de Claude (plano Task 5.2 step 2). Mapeia a spec v2 (§5–§12) →
> evidência. **Escopo deste PR:** schema, API, saúde, guarda de escopo, gate de
> não-regressão (dados + e2e), e as fatias seguras de extração do canvas
> (geometria/toolbar/ghosts). **Fora deste PR (vai pro PR 2):** Fase 1 núcleo
> (extração stateful do CanvasBase) e Fase 4 (canvas estratégico visual).

| Spec | Item | Evidência | Status |
|---|---|---|---|
| §5.2 | `maps.kind` aditiva, default action | `0038_add_map_kind.sql`, `schema/maps.ts` | ✅ |
| §5.2/§6.1 | 1 map strategy/workspace (índice único parcial) | `maps_one_strategy_per_ws` | ✅ |
| §5.2/§12.1 | guarda por escopo default (gap #5) | `services/mapsScope.ts` + `mapsKindScope.smoke` (vermelho→verde) | ✅ |
| §6.2 | `strategy_cycles` (1 ativo/map, status) | `schema/strategyCycles.ts`, `0039` | ✅ |
| §6.3 | `strategy_nodes` (kind enum, workspace denorm) | `schema/strategyNodes.ts` | ✅ |
| §6.4 | 6 satélites 1:1 por node_id | `schema/strategyEntities.ts` | ✅ |
| §6.4/gap#4 | KR sem `source_*` | ausência verificada no schema | ✅ |
| §6.4/gap#7 | Plano UNIQUE(action_map_id) | `strategy_plans_action_map_unique` | ✅ |
| §6.5/gap#2 | `relation_type` pré-preenchido pela gramática | `prefillRelation` + `strategy.smoke` (mede/move/serve/contem; SWOT×SWOT=null) | ✅ |
| §6.6/§2.2-s4 | constraints cross-table (app-level) | validações em `routes/strategy.ts` (target_date≤ciclo, edge same-map, plano→action, direction) | ✅ |
| §8.1 | saúde KR ciente de ritmo (clamp, booleano, ε, piso 1d, início=no_prazo) | `services/strategyHealth.ts` + 19 unit | ✅ |
| §8.1/gap#3 | suavização N consecutivos (configurável) | `smoothHealth` + smoke de fiação | ✅ |
| §8.1/gap#2 | objetivo = pior-caso por `mede`; sem mede=sem_medicao | `aggregateObjectiveHealth` + GET | ✅ |
| §10 | rotas grafo (GET lazy, CRUD nós/arestas/ciclos) | `routes/strategy.ts` + `strategy.smoke` (7) | ✅ |
| §10.2/gap#6 | executor só PATCH current_value de KR | smoke de permissões | ✅ |
| §10.3 | criação transacional nó+satélite; lazy idempotente | smoke (2 GETs=1 map/ciclo; nó+satélite) | ✅ |
| §9/5.1 | leitura por agentes (payload tipado, relation_type, readOnly ciclo arquivado) | GET + `strategy.smoke` agent-read | ✅ |
| §12 | não-regressão do plano de ação | `canvasDataLayer.smoke` (5) + Playwright e2e (8) + suíte 52→53 verde | ✅ |
| §5.3 | CanvasBase compartilhado | **PARCIAL** — fatias seguras (geometria/toolbar/ghosts); núcleo stateful = PR 2 | 🚧 |
| §7 | nós/arestas/floating/sugestões/órfão UI | **PR 2** (Fase 4) | ⬜ |

## Decisões de produto pendentes (não cravadas — configuráveis)
- Limiares de saúde (`0.9`/`0.7`) e `N` da suavização (`3`) — `DEFAULT_HEALTH_CONFIG`, injetáveis.
- Carry-over/clonagem de ciclo — v1 mínimo: ciclo novo começa vazio (`POST /cycles`).

## Lacunas conscientes (registradas)
- `attachments.strategy_node_id` (anexo em nó) — adiado (§13/gap#9).
- Pull vivo da central-de-dados (`source_*`) — bundle v2 (§8.2/gap#4).
- OpenAPI/codegen das rotas strategy — entram no PR 2 (hooks de front).
- Wrappers MCP — fora do v1 (endpoint REST já alcançável).

## Ordem de release em produção (§12.2) — IMPORTANTE
Deploy **[maps.kind (0038) + guarda de escopo 3.1]** ANTES de habilitar criação
de linhas strategy. As migrations 0038+0039 são aditivas (sem lock). A criação
lazy (GET /strategy) só deve ir a prod após a guarda de escopo estar live —
ambas estão neste PR, então deployar este PR inteiro de uma vez já respeita a
ordem (guarda + criação lazy juntas; nenhuma linha strategy existe até o 1º GET).
