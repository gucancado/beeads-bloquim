# Grupo rígido tarefa+aprovações no canvas de planos — Design

**Data:** 2026-08-18
**Escopo:** frontend only (`artifacts/mindtask-app`), canvas de planos de ação (`src/pages/maps/canvas.tsx`). Zero mudança de backend/schema.

## Problema

No mapa de planos, os cards de tarefa de aprovação (`approvalnode`) têm mobilidade inconsistente e indesejada:

- O node é `draggable: true`, então o drag individual move o card **localmente**; `onNodeDragStop` faz early-return pra `approvalnode` (não persiste), e o poll de 3s nunca sobrescreve posição de node existente → o card fica deslocado do pai até o reload.
- **Box-selection + drag persiste** a posição avulsa da aprovação (cai no `else` de `onSelectionDragStop`, que chama `updateCardMut`), assim como o undo/redo (`canvas.tsx` linha ~1717 inclui `approvalnode`).
- Arrastar a tarefa-pai move só o pai; as aprovações (e o join node) ficam pra trás.

## Comportamento desejado

Card de aprovação tem **posicionamento fixo em relação à tarefa principal**. Tarefa-pai + cards de aprovação + join node (modo paralelo) formam um **bloco rígido**: arrastar qualquer membro move o grupo inteiro junto, preservando os offsets relativos atuais. Nenhum drag do usuário altera o arranjo interno do grupo.

## Contexto do código atual

- Tarefa de aprovação = row real em `tasks` (`isApprovalTask=true`, `parentTaskId`) com card real em `cards` (posição absoluta). Criada com offset determinístico do card-pai (`approvalCrudService.ts:171-174`: `+350+order*50`, `+150+order*120`).
- Modo `parallel` com 2+ aprovações gera um **join node virtual** (`join-<parentCardId>`), derivado das posições das aprovações em `buildJoinNodes` (canvas.tsx:248), nunca persistido, reconstruído a cada poll.
- Auto-layout ("reorganizar") recomputa todas as posições no servidor (`mapLayoutService`) — inclusive das aprovações — e aplica/persiste. Continua sendo o dono do arranjo intra-grupo.
- ReactFlow **v11** (`reactflow@^11.11.4`). Nodes de card são top-level (sem `parentNode`). `selectionOnDrag` + `SelectionMode.Partial` ativos.

## Design: propagação de delta via interceptor de `onNodesChange`

Grupo rígido implementado **sem** mudar o modelo de posições (absolutas no banco):

1. **Módulo puro novo** `src/lib/approvalGroups.ts`:
   - `buildApprovalGroupIndex(cards)` → `Map<nodeId, string[]>`: para cada card-pai com ≥1 aprovação, membros = `[paiCardId, ...approvalCardIds, 'join-<paiCardId>'?]` (join só em `parallel` com ≥2 filhos, espelhando `buildJoinNodes`). Cada membro (inclusive o id do join) vira chave do índice apontando pro mesmo array. Cards sem aprovações ficam fora. Aprovação órfã (sem card-pai no mapa) fica fora (fallback seguro: move livre).
   - `expandPositionChanges(changes, getPosition, groupIndex)` → pra cada `NodeChange` de posição num membro de grupo, gera changes adicionais com o **mesmo delta** pros demais membros (dedup de ids já explícitos/já propagados; propaga a flag `dragging`; change de posição sem `position` mas com `dragging` definido propaga só a flag — é o formato real do evento de fim de drag do ReactFlow v11, confirmado no source instalado; delta zero ainda propaga, pra manter as flags do grupo em sincronia).
   - Contrato de ordem do índice: `[cardPai, ...aprovações, join?]` — pai sempre no índice 0, join sempre por último quando existe. `join-` é namespace reservado (ids de card são UUIDs).
2. **Wiring em canvas.tsx**:
   - `groupIndexRef` atualizado no efeito de `mapData` (que já agrupa aprovações).
   - Wrapper `handleNodesChange` aplica `expandPositionChanges` antes do `onNodesChange` do `useNodesState` → **qualquer** movimento (drag individual, drag de seleção, setas do teclado) move o bloco ao vivo, porque todos passam por `onNodesChange`.
   - `onNodeDragStop`: remove o early-return de `approvalnode`; qualquer membro arrastado persiste a posição final de **todos os cards do grupo** (`persistGroupPositions`); join node não persiste (derivado) mas ganha guard em `pendingUpdatesRef`. A lógica de inserção-em-aresta continua exclusiva do card-pai (`mindmap`).
   - **Persistência por snapshot+delta**: as posições dos membros persistidos são calculadas como `snapshot do início do drag + delta do node de origem` (posição autoritativa entregue pelo ReactFlow no callback de stop), não lidas do `nodesRef` — que sincroniza via `useEffect` e pode estar 1 frame atrasado num solta-rápido. `nodesRef` fica só como fallback sem snapshot.
   - `onSelectionDragStop`: expande a persistência pros membros de grupo não-selecionados (dedup, 1 PATCH por card), com o mesmo esquema snapshot+delta.
   - **`nodeDragActiveRef` dedicado**: predicado de drag ativo pros guards. `dragStartSnapshotRef` NÃO serve — o canvas seta esse snapshot em QUALQUER mousedown do wrapper (~linha 2055) e só os drag-stops limpam, então após um clique simples ele fica não-nulo indefinidamente e congelaria o rebuild dos joins.
   - Rebuild de join nodes no poll: preserva a posição local quando há drag REAL ativo (`nodeDragActiveRef`) ou guard pendente (`pendingUpdatesRef`), evitando "pulo" com payload stale do poll de 3s. O guard por timeout (5s) segue o padrão já estabelecido pra shapes; posições de cards existentes nunca são sobrescritas pelo poll (o sync só troca `data`), então o join é o único vetor de regressão de posição.
   - **Auto-layout**: `handleAutoLayout` passa a reposicionar os join nodes na MESMA transação de `setNodes`, derivando das posições novas das aprovações (`deriveJoinPosition`, fórmula extraída de `buildJoinNodes`) — sem isso o join ficaria pra trás até o refetch.
   - Undo/redo: snapshots já são completos (grupo restaura rígido e persiste); acrescenta só a marcação de `pendingUpdatesRef` pro join no loop de persistência do undo.

## Alternativas rejeitadas

- **`parentNode`/subflow nativo do ReactFlow**: posições relativas nativas, mas drag no filho não move o grupo (exigência explícita do produto), muda semântica de coordenadas/z-index e exigiria conversão relativo↔absoluto na persistência. Mais invasivo, menos aderente.
- **`draggable: false` nas aprovações**: drag na aprovação viraria pan do canvas em vez de mover o bloco — contraria a exigência.
- **Persistir offsets relativos no schema**: YAGNI — a rigidez por delta preserva offsets sem migração; criação + auto-layout continuam donos do arranjo.

## Efeitos colaterais aceitos

- Grupo de N membros gera N PATCHes `/cards` por drag (padrão já existente no `onSelectionDragStop`).
- Movimento por setas do teclado move o grupo ao vivo mas não persiste — igual ao comportamento atual de qualquer card (fora de escopo). Consequência: como o caminho do teclado não seta `nodeDragActiveRef` (não há drag real), o próximo poll de 3s reconstrói o join node a partir das posições do SERVIDOR — o join "volta" pro lugar antigo enquanto os cards ficam onde o teclado os moveu, até algo persistir (drag, seleção ou reorganizar).
- Arranjos intra-grupo historicamente "espalhados" (por drags antigos persistidos via seleção) não são normalizados — ficam rígidos como estão; "reorganizar" arruma.

## Testes

- **Unit (vitest, novo em mindtask-app)**: `buildApprovalGroupIndex` e `expandPositionChanges` são funções puras com 16 casos (sequencial, paralelo c/ join, órfã, dedup, flag dragging, zero-delta, change final sem position) incluindo um teste de integração com o `applyNodeChanges` real do ReactFlow simulando frames sucessivos de drag + evento final. Infra: `vitest@^4.1.4` (mesma major do api-server), `vitest.config.ts` standalone (environment node, sem tocar o vite.config do app).
- **Gates**: typecheck FE relativo (baseline ~71 erros pré-existentes — zero erro novo), `vite build`, lockfile `--frozen-lockfile` OK (regen com pnpm 11.4.0, mesma do Dockerfile).
- **Smoke manual (gate humano)**: drag de aprovação, drag do pai, box-select parcial, undo/redo, modo paralelo com join, auto-layout, clique simples sem drag (joins continuam re-derivando no poll).

## Revisão adversarial (Codex, 2026-08-18 — pré-execução)

Rodada 1 sobre spec+plano vs código real (8 achados, REQUEST-CHANGES) — incorporados:

- **[BLOCKER] aceito**: `dragStartSnapshotRef` é setado em qualquer mousedown do wrapper → não serve de predicado de drag; guard do poll usaria e congelaria joins após um clique. Fix: `nodeDragActiveRef` dedicado.
- **[MAJOR] aceito**: persistência lia `nodesRef` (sincronizado por useEffect) no stop → risco de 1 frame stale. Fix: snapshot+delta com a posição autoritativa do callback.
- **[MAJOR] aceito**: auto-layout deixava o join pra trás até o refetch. Fix: `deriveJoinPosition` na mesma transação.
- **[MINOR] aceitos**: teste de integração com `applyNodeChanges` real + caso zero-delta; contrato de ordem do índice documentado.
- **[MAJOR] parcialmente rejeitado** (guard lifecycle por timeout): posições de cards existentes nunca são sobrescritas pelo poll (sync só troca `data`) — o único vetor é o join, coberto; timeout de 5s é o padrão do arquivo (shapes). Registrado como decisão.
- **[MINOR] rejeitados**: "auto-derived" aparece só como âncora literal de Edit (código antigo citado verbatim); check por prefixo `join-` é idioma do codebase com namespace UUID sem colisão (documentado no contrato do módulo).
