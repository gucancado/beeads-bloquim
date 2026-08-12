# Seam de extração do CanvasBase

> **Task 0.3 do plano do Mapa Estratégico.** Mapeia o monolito
> `artifacts/mindtask-app/src/pages/maps/canvas.tsx` (3007 linhas) para a
> extração de um `CanvasBase` compartilhado (`mode: 'action' | 'strategy'`),
> **preservando comportamento**. Nenhum código ainda — só o contrato.
>
> Inventário linha-a-linha produzido por codex (read-only) e revisado por
> Claude. Categorias: **GENERIC** (vai pro CanvasBase, vale pros dois modos),
> **ACTION** (fica atrás de `mode='action'`), **MIXED** (interleavado — ponto
> de extração arriscado, exige split cirúrgico numa fatia).

## 1. Conclusões dos gap-checks

### 1.1 Undo/redo (§7.7 da spec) — EXISTE, **só de posição**
- Implementado em `canvas.tsx:1608-1682` via hook `usePositionHistory`
  (`hooks/usePositionHistory.ts`), tipo `NodePositionSnapshot`.
- Atalhos: `Ctrl+Z` (undo), `Ctrl+Y` / `Ctrl+Shift+Z` (redo). Ignora quando o
  foco está em INPUT/TEXTAREA/SELECT/contentEditable.
- **Escopo:** salva/restaura **apenas posições de nó** (snapshot `{id: {x,y}}`).
  **NÃO** desfaz criação, deleção nem edição de conteúdo.
- **Decisão:** o `CanvasBase` **preserva** o undo/redo de posição para `action`.
  `strategy` **herda de graça** — é genérico de posição, agnóstico ao tipo de
  nó. Entra como capability GENERIC do base. Undo/redo "completo" (criação/
  deleção/edição) permanece **fora do v1** (não existe hoje; spec §7.7 permite).

### 1.2 RTL / vitest no `mindtask-app` (gap-to-verify) — **NÃO configurado**
- `package.json` do `mindtask-app`: **sem** `@testing-library/react`, **sem**
  `vitest`, **sem** `jsdom`/`happy-dom`; **sem** script `test`; só `vite.config.ts`.
- **Decisão (segue o plano, ramo NÃO):**
  - Fase 4 (componentes dos nós) usa **smoke manual** (checklist 0.2 estendido)
    + **flag de débito de teste** registrada por componente. Não bloquear nelas.
  - Para Fase 1 Task 1.0 (caracterização de **funções puras**), vamos adicionar
    um **vitest mínimo** (runner + env node) ao `mindtask-app` como infra
    habilitadora — cobre só helpers puros extraíveis (ex.: geometria, builders
    sem React). RTL/jsdom completo fica como débito explícito, adotável quando a
    Fase 4 quiser testes de componente de verdade.

## 2. Contrato do seam — `CanvasBaseProps` (só o tipo, sem implementação)

O `CanvasBase` detém TODA a camada GENERIC (viewport, seleção, formas, texto,
imagem, presença, toolbar shell, undo/redo de posição, paste/drag-drop de
imagem). O `mode` injeta apenas o que é específico de nó/aresta:

```ts
type CanvasMode = 'action' | 'strategy';

interface CanvasBaseProps {
  mode: CanvasMode;
  mapId: string;
  workspaceId: string;

  // Renderers específicos do modo (registrados no ReactFlow)
  nodeTypes: NodeTypes;   // action: mindmap/approvalnode/joinnode · strategy: 6 kinds
  edgeTypes: EdgeTypes;   // action: DeletableEdge/ApprovalEdge (handles fixos) · strategy: FloatingEdge

  // Botões que o modo adiciona à toolbar shell (o shell + botões genéricos
  // de texto/imagem/forma já vivem no base)
  toolbarItems: ToolbarItem[];

  // Criação de nó disparada pelo base (botão/duplo-clique) — o modo decide
  // o que criar e como persistir (action: card+task · strategy: node+satélite)
  onCreateNode: (kind: string, pos: { x: number; y: number }) => void;

  // Comportamento de aresta específico do modo
  edgeBehavior: {
    // action: connect com handles fixos esq/dir + semântica L→R + cascade
    // strategy: connect livre de qualquer borda + floating + pré-preench. tipo
    onConnect: OnConnect;
    onConnectStart?: OnConnectStart;
    onConnectEnd?: OnConnectEnd;
    onEdgesChange: OnEdgesChange;
  };

  // Hidratação dos nós/arestas do modo a partir do payload de dados
  // (action: cards/connections/approvals do useGetMap · strategy: grafo)
  buildNodes: (data: unknown) => Node[];
  buildEdges: (data: unknown) => Edge[];

  // Deleção específica do modo (o base intercepta onNodesDelete e roteia
  // text/shape genéricos pra si; nós do modo chamam isto)
  onDeleteNode: (node: Node) => void;
}
```

**Slots que o `mode` injeta** (resumo): `nodeTypes`, `edgeTypes`,
`toolbarItems`, `onCreateNode`, `edgeBehavior`, `buildNodes`/`buildEdges`,
`onDeleteNode`. **Tudo o resto é do base.**

## 3. Pontos de extração arriscados (blocos MIXED) — split por fatia

Estes blocos interleavam GENERIC + ACTION; cada um precisa ser **cortado** na
fatia certa da Fase 1, com gate (typecheck + `canvasDataLayer` + checklist 0.2)
após cada fatia. Em ordem de risco:

| Bloco (linhas) | O que separar |
|---|---|
| **Efeito principal de hidratação/reconciliação (714-1002)** | GENERIC: `mapDataWithText`, textElements, shapes, `buildTextNode/buildShapeNode`, reconciliação de texto/forma → base. ACTION: terminal maps de aprovação, mindmap/approval/join, autofocus/status de card, arestas de conexão/aprovação → `buildNodes/buildEdges` do modo. **Maior bloco; fatiar com cuidado.** |
| **`onNodeDragStop` (1397-1561)** e **`onSelectionDragStop` (1563-1599)** | GENERIC: position history + persistência de posição de texto/forma. ACTION: persistência de card, regras approval/join, inserção em aresta destacada, create/delete de conexão. |
| **Efeito de undo/redo (1608-1682)** | GENERIC: snapshot de posição + persistência texto/forma. ACTION: persistência de posição de card/approval. (A *mecânica* de history é GENERIC; só a persistência por-tipo difere.) |
| **`duplicateNodeAtDrop` (1142-1310)** + **alt-drag (2042-2159, ghost 2724-2778)** | GENERIC: gesto copy-drag, ghosts, duplicação de texto/forma. ACTION: pula approval/join, duplica card/task via endpoint. |
| **Props do `<ReactFlow>` (2878-2920)** + **`onNodesDelete` inline (2905-2917)** | GENERIC: estado nodes/edges, seleção, pan/zoom, fitView. ACTION: connect handlers, edge delete, inserção em drag, deleção de card, `nodeTypes/edgeTypes` de action. |
| **Toolbar shell (2780-2858)** | GENERIC: container/posição + botões texto/imagem/forma → base com slot `toolbarItems`. ACTION: botão "tarefa" (2781-2790) + botão "reunião" desabilitado (2801-2809) → injetados pelo modo. |
| **`nodeTypes` (35) / `edgeTypes` (36)** | GENERIC reaproveitável: `textnode`, `shapenode`, `DeletableEdge`. ACTION: `mindmap`, `approvalnode`, `joinnode`, `ApprovalEdge`. Vira prop por modo. |
| **`onPaneClick` (2375-2378)** | GENERIC: fecha menu de forma. ACTION: limpa painel de card selecionado. |
| Refs/estado compartilhado: `nodes`/`edges`/`nodesRef`/`edgesRef`/`mapDataRef`/`initializedRef`/`pendingUpdatesRef`/`altDrag` | Containers GENERIC de ReactFlow; o conteúdo é misto. Ficam no base; o modo popula via `buildNodes/buildEdges`. |

## 4. Blocos puramente GENERIC (movem direto pro base, baixo risco)

Texto: `buildTextNode` (626-650), `createTextAt` (2223-2261),
`handleTextButtonMouseDown` (2263-2302), `handleDeleteTextNode` (691-693).
Forma: `buildShapeNode` (652-689), draw handlers (2304-2373), escape effect
(701-712), `handleDeleteShapeNode` (695-697). Imagem: `insertImageFromFile`
(2380-2461), `insertImagesFromFiles` (2467-2511), drag/drop (2516-2555),
paste/copy effects (2558-2628), botão imagem (2810-2828). Viewport/pan:
wheel (1995-2007), right-button pan (2166-2221), mousedown snapshot (2009-2021).
Presença: mousemove (1984-1993), overlay de cursores (2933). Undo/redo
*mecânica*: `usePositionHistory` (403). Controls/zoom (2922-2932), Background
(2921), page shell/breadcrumb (2667-2684), `ReactFlowProvider` wrapper
(2997-3007).

## 5. Blocos puramente ACTION (ficam atrás de `mode='action'`)

Card↔task: `createCardAt`/`handleAddCard` (1903-1927), `handleCardButtonMouseDown`
(1929-1964), Ctrl+N (1966-1978), `handleInlineUpdate` (590-615), `handleDeleteCard`
(2630-2655), painel/URL de card (406-408, 577-588), `TaskDetailModal` (2946-2965),
AlertDialog de deleção (2967-2992), WASD nav (467-566). Conexões fixas + fluxo:
`onConnect`/`onConnectStart`/`onConnectEnd` (1684-1887), `onEdgesChangeWithDelete`
(1889-1901), `buildEdgeFromConn` (288-304), estilos de edge (38-66). Aprovação:
todos os builders `buildTerminalNodeMap`/`buildApprovalEdges`/`buildJoinNodes`
(93-286), `ApprovalCardMeta` (68-91), `mapApprovalCardToNodeData`.

## 6. Estratégia de fatiamento (alimenta Fase 1, Task 1.1)

Ordem que minimiza risco (cada fatia: typecheck + `canvasDataLayer` + checklist
0.2 afetado + commit):
- **Fatia A** — utils/constantes puras GENERIC (seção 4, helpers sem React).
- **Fatia B** — toolbar shell + `toolbarItems` (separar botões action).
- **Fatia C** — camadas formas/texto/imagem (GENERIC puro da seção 4).
- **Fatia D** — viewport/pan/seleção + presença (cursores).
- **Fatia E** — montar `CanvasBase` + wrapper `mode='action'`, injetando os
  `nodeTypes/edgeTypes/toolbarItems/edgeBehavior/buildNodes/buildEdges` atuais.
  Aqui caem os blocos MIXED da seção 3 (hidratação, dragStop, undo/redo,
  ReactFlow props, onNodesDelete) — gate completo.
