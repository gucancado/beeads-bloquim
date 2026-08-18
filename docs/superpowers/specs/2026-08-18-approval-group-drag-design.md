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
   - `expandPositionChanges(changes, getPosition, groupIndex)` → pra cada `NodeChange` de posição num membro de grupo, gera changes adicionais com o **mesmo delta** pros demais membros (dedup de ids já explícitos/já propagados; propaga a flag `dragging`; change de posição sem `position` mas com `dragging` definido propaga só a flag).
2. **Wiring em canvas.tsx**:
   - `groupIndexRef` atualizado no efeito de `mapData` (que já agrupa aprovações).
   - Wrapper `handleNodesChange` aplica `expandPositionChanges` antes do `onNodesChange` do `useNodesState` → **qualquer** movimento (drag individual, drag de seleção, setas do teclado) move o bloco ao vivo, porque todos passam por `onNodesChange`.
   - `onNodeDragStop`: remove o early-return de `approvalnode`; qualquer membro arrastado persiste a posição final de **todos os cards do grupo** (`persistGroupPositions`); join node não persiste (derivado) mas ganha guard em `pendingUpdatesRef`. A lógica de inserção-em-aresta continua exclusiva do card-pai (`mindmap`).
   - `onSelectionDragStop`: expande a persistência pros membros de grupo não-selecionados (dedup, 1 PATCH por card).
   - Rebuild de join nodes no poll: preserva a posição local quando há drag ativo (`dragStartSnapshotRef`) ou guard pendente (`pendingUpdatesRef`), evitando "pulo" com payload stale do poll de 3s.
   - Undo/redo: snapshots já são completos (grupo restaura rígido e persiste); acrescenta só a marcação de `pendingUpdatesRef` pro join no loop de persistência do undo.

## Alternativas rejeitadas

- **`parentNode`/subflow nativo do ReactFlow**: posições relativas nativas, mas drag no filho não move o grupo (exigência explícita do produto), muda semântica de coordenadas/z-index e exigiria conversão relativo↔absoluto na persistência. Mais invasivo, menos aderente.
- **`draggable: false` nas aprovações**: drag na aprovação viraria pan do canvas em vez de mover o bloco — contraria a exigência.
- **Persistir offsets relativos no schema**: YAGNI — a rigidez por delta preserva offsets sem migração; criação + auto-layout continuam donos do arranjo.

## Efeitos colaterais aceitos

- Grupo de N membros gera N PATCHes `/cards` por drag (padrão já existente no `onSelectionDragStop`).
- Movimento por setas do teclado move o grupo ao vivo mas não persiste — igual ao comportamento atual de qualquer card (fora de escopo).
- Arranjos intra-grupo historicamente "espalhados" (por drags antigos persistidos via seleção) não são normalizados — ficam rígidos como estão; "reorganizar" arruma.

## Testes

- **Unit (vitest, novo em mindtask-app)**: `buildApprovalGroupIndex` e `expandPositionChanges` são funções puras com cobertura de casos (sequencial, paralelo c/ join, órfã, dedup, flag dragging, zero-delta). Infra: `vitest@^4.1.4` (mesma major do api-server), `vitest.config.ts` standalone (environment node, sem tocar o vite.config do app).
- **Gates**: typecheck FE relativo (baseline ~71 erros pré-existentes — zero erro novo), `vite build`, lockfile `--frozen-lockfile` OK (regen com pnpm 11.4.0, mesma do Dockerfile).
- **Smoke manual (gate humano)**: drag de aprovação, drag do pai, box-select parcial, undo/redo, modo paralelo com join, auto-layout.
