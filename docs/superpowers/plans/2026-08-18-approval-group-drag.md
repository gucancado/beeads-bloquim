# Grupo rígido tarefa+aprovações no canvas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No mapa de planos, cards de tarefa de aprovação passam a ter posicionamento fixo em relação à tarefa principal: arrastar qualquer membro (pai, aprovação ou join node) move o grupo inteiro como bloco rígido, preservando offsets, com persistência coerente.

**Architecture:** Propagação de delta via interceptor de `onNodesChange` do ReactFlow v11 — um módulo puro (`approvalGroups.ts`) constrói o índice de grupos e expande `NodeChange`s de posição pros demais membros; o canvas persiste as posições finais de todos os cards do grupo nos drag-stops. Zero mudança de backend/schema.

**Tech Stack:** React 19 + ReactFlow 11 (`reactflow`), TypeScript 5.9, vitest 4 (novo em mindtask-app), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-18-approval-group-drag-design.md`

## Global Constraints

- Branch de trabalho: `feature/approval-group-drag` a partir de `master`. **Nunca** commitar/mergear em `master` (regra do repo).
- Frontend only: nenhum arquivo fora de `artifacts/mindtask-app/` e `docs/` pode ser modificado (exceto `pnpm-lock.yaml` na raiz, pelo install do vitest).
- Lockfile: regenerar **com pnpm 11.4.0** (mesma versão do `deploy/mindtask-app/Dockerfile`). Validar com `pnpm install --frozen-lockfile` antes do commit que toca o lockfile.
- Typecheck do mindtask-app é **vermelho no baseline** (~71 erros pré-existentes). Gate é RELATIVO: zero erro NOVO. Medir antes/depois com o mesmo comando.
- vitest fixado em `^4.1.4` (mesma major/minor do api-server) — resolve do lockfile existente, sem pacote novo <24h (gate supply-chain do pnpm 11).
- Não editar arquivos gerados (`lib/api-client-react/src/generated/`, `lib/api-zod/src/generated/`).
- Todos os comandos rodam da raiz do repo (`repo/`), PowerShell: encadear com `;`, não `&&`.

---

### Task 1: Branch + infra vitest no mindtask-app + `buildApprovalGroupIndex`

**Files:**
- Create: `artifacts/mindtask-app/vitest.config.ts`
- Create: `artifacts/mindtask-app/src/lib/approvalGroups.ts`
- Test: `artifacts/mindtask-app/src/lib/approvalGroups.test.ts`
- Modify: `artifacts/mindtask-app/package.json` (script `test` + devDep `vitest`)
- Modify: `pnpm-lock.yaml` (raiz, via `pnpm install`)

**Interfaces:**
- Consumes: nada (módulo puro novo).
- Produces (Task 2 e 3 dependem):
  - `export interface ApprovalGroupCardInput { id: string; taskId?: string | null; taskIsApprovalTask?: boolean; taskParentTaskId?: string | null; taskApprovalMode?: string | null }`
  - `export type ApprovalGroupIndex = Map<string, string[]>`
  - `export function buildApprovalGroupIndex(cards: ApprovalGroupCardInput[]): ApprovalGroupIndex`

- [ ] **Step 1: Entrar na branch e medir baseline de typecheck**

A branch `feature/approval-group-drag` JÁ EXISTE (criada com spec + plano commitados; é master + docs). Entrar nela e, ANTES de qualquer mudança de código, medir e ANOTAR o baseline de erros TS (o gate das tasks seguintes é relativo a este número):

```powershell
git checkout feature/approval-group-drag
pnpm --filter @workspace/mindtask-app run typecheck 2>&1 | Select-String -Pattern 'error TS' | Measure-Object -Line
```

Pré-condição: `git status` limpo de mudanças staged (untracked pré-existentes como `e2e/` podem ficar — não tocar neles).

- [ ] **Step 2: Adicionar vitest ao mindtask-app**

Em `artifacts/mindtask-app/package.json`, adicionar na seção `scripts`:

```json
"test": "vitest run"
```

e em `devDependencies` (ordem alfabética, junto dos outros):

```json
"vitest": "^4.1.4"
```

Criar `artifacts/mindtask-app/vitest.config.ts` (standalone de propósito — NÃO reusar o `vite.config.ts` do app, que carrega plugins React desnecessários pra funções puras):

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 3: Instalar e validar lockfile**

```powershell
pnpm -v   # DEVE ser 11.4.0 (mesma do Dockerfile). Se não for: corepack prepare pnpm@11.4.0 --activate
pnpm install
pnpm install --frozen-lockfile   # deve passar: "Lockfile passes supply-chain policies" / sem erro
```

- [ ] **Step 4: Escrever os testes que falham (buildApprovalGroupIndex)**

Criar `artifacts/mindtask-app/src/lib/approvalGroups.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildApprovalGroupIndex } from './approvalGroups';

const parent = (id: string, taskId: string, mode?: string) => ({
  id, taskId, taskIsApprovalTask: false, taskParentTaskId: null, taskApprovalMode: mode ?? null,
});
const approval = (id: string, parentTaskId: string) => ({
  id, taskId: `task-${id}`, taskIsApprovalTask: true, taskParentTaskId: parentTaskId, taskApprovalMode: null,
});

describe('buildApprovalGroupIndex', () => {
  it('agrupa pai + aprovações sequenciais, sem join node', () => {
    const idx = buildApprovalGroupIndex([
      parent('p1', 't1', 'sequential'), approval('a1', 't1'), approval('a2', 't1'),
    ]);
    const members = ['p1', 'a1', 'a2'];
    expect(idx.get('p1')).toEqual(members);
    expect(idx.get('a1')).toEqual(members);
    expect(idx.get('a2')).toEqual(members);
    expect(idx.has('join-p1')).toBe(false);
  });

  it('modo paralelo com 2+ aprovações inclui o join node como membro E como chave', () => {
    const idx = buildApprovalGroupIndex([
      parent('p1', 't1', 'parallel'), approval('a1', 't1'), approval('a2', 't1'),
    ]);
    const members = ['p1', 'a1', 'a2', 'join-p1'];
    expect(idx.get('p1')).toEqual(members);
    expect(idx.get('join-p1')).toEqual(members);
  });

  it('modo paralelo com 1 aprovação NÃO cria join (espelha buildJoinNodes: children >= 2)', () => {
    const idx = buildApprovalGroupIndex([parent('p1', 't1', 'parallel'), approval('a1', 't1')]);
    expect(idx.get('p1')).toEqual(['p1', 'a1']);
    expect(idx.has('join-p1')).toBe(false);
  });

  it('approvalMode ausente default sequential (sem join)', () => {
    const idx = buildApprovalGroupIndex([
      parent('p1', 't1'), approval('a1', 't1'), approval('a2', 't1'),
    ]);
    expect(idx.has('join-p1')).toBe(false);
  });

  it('card sem aprovações fica fora do índice', () => {
    const idx = buildApprovalGroupIndex([parent('p1', 't1'), parent('p2', 't2')]);
    expect(idx.size).toBe(0);
  });

  it('aprovação órfã (sem card-pai no mapa) fica fora do índice', () => {
    const idx = buildApprovalGroupIndex([approval('a1', 't-fantasma')]);
    expect(idx.size).toBe(0);
  });

  it('dois grupos independentes não se misturam', () => {
    const idx = buildApprovalGroupIndex([
      parent('p1', 't1'), approval('a1', 't1'),
      parent('p2', 't2'), approval('b1', 't2'),
    ]);
    expect(idx.get('a1')).toEqual(['p1', 'a1']);
    expect(idx.get('b1')).toEqual(['p2', 'b1']);
  });
});
```

- [ ] **Step 5: Rodar e confirmar que falham**

```powershell
pnpm --filter @workspace/mindtask-app test
```

Esperado: FAIL — `Cannot find module './approvalGroups'` (ou equivalente).

- [ ] **Step 6: Implementar `buildApprovalGroupIndex`**

Criar `artifacts/mindtask-app/src/lib/approvalGroups.ts` (o import de tipos do `reactflow` entra só na Task 2, quando é usado):

```ts
export interface ApprovalGroupCardInput {
  id: string;
  taskId?: string | null;
  taskIsApprovalTask?: boolean;
  taskParentTaskId?: string | null;
  taskApprovalMode?: string | null;
}

/**
 * nodeId → ids de TODOS os membros do grupo rígido (incluindo o próprio id).
 * Grupo = card da tarefa-pai + cards de aprovação + join node virtual
 * (`join-<parentCardId>`, só em modo parallel com 2+ aprovações — espelha
 * buildJoinNodes do canvas). Cards sem aprovações e aprovações órfãs ficam
 * fora do índice (movem livres).
 */
export type ApprovalGroupIndex = Map<string, string[]>;

export function buildApprovalGroupIndex(cards: ApprovalGroupCardInput[]): ApprovalGroupIndex {
  const approvalsByParentTask = new Map<string, ApprovalGroupCardInput[]>();
  for (const c of cards) {
    if (c.taskIsApprovalTask && c.taskParentTaskId) {
      const list = approvalsByParentTask.get(c.taskParentTaskId) ?? [];
      list.push(c);
      approvalsByParentTask.set(c.taskParentTaskId, list);
    }
  }

  const index: ApprovalGroupIndex = new Map();
  for (const parentCard of cards) {
    if (parentCard.taskIsApprovalTask || !parentCard.taskId) continue;
    const children = approvalsByParentTask.get(parentCard.taskId);
    if (!children || children.length === 0) continue;
    const memberIds = [parentCard.id, ...children.map(c => c.id)];
    const isParallel = (parentCard.taskApprovalMode ?? 'sequential') === 'parallel';
    if (isParallel && children.length >= 2) memberIds.push(`join-${parentCard.id}`);
    for (const id of memberIds) index.set(id, memberIds);
  }
  return index;
}
```


- [ ] **Step 7: Rodar e confirmar verde**

```powershell
pnpm --filter @workspace/mindtask-app test
```

Esperado: 7 testes PASS.

- [ ] **Step 8: Commit**

```powershell
git add artifacts/mindtask-app/vitest.config.ts artifacts/mindtask-app/package.json artifacts/mindtask-app/src/lib/approvalGroups.ts artifacts/mindtask-app/src/lib/approvalGroups.test.ts pnpm-lock.yaml
git commit -m "feat(canvas): infra vitest no mindtask-app + indice de grupos de aprovacao"
```

---

### Task 2: `expandPositionChanges` (propagação de delta)

**Files:**
- Modify: `artifacts/mindtask-app/src/lib/approvalGroups.ts`
- Test: `artifacts/mindtask-app/src/lib/approvalGroups.test.ts` (append)

**Interfaces:**
- Consumes: `ApprovalGroupIndex` da Task 1.
- Produces (Task 3 depende):
  - `export function expandPositionChanges(changes: NodeChange[], getPosition: (id: string) => XYPosition | undefined, groupIndex: ApprovalGroupIndex): NodeChange[]`
  - Contrato: retorna o MESMO array (identidade) quando não há nada a propagar; senão `[...changes, ...propagadas]`. Changes propagadas têm `type: 'position'`, `position` E `positionAbsolute` iguais (nodes são todos top-level), e `dragging` copiado da change de origem.

- [ ] **Step 1: Escrever os testes que falham**

Em `artifacts/mindtask-app/src/lib/approvalGroups.test.ts`: adicionar os dois imports no TOPO do arquivo (junto dos existentes) e o bloco `describe` no fim.

```ts
// topo do arquivo:
import { expandPositionChanges } from './approvalGroups';
import type { NodeChange, XYPosition } from 'reactflow';

// fim do arquivo (reusa os helpers parent()/approval() já definidos no topo):
describe('expandPositionChanges', () => {
  const groupIndex = buildApprovalGroupIndex([
    parent('p1', 't1', 'parallel'), approval('a1', 't1'), approval('a2', 't1'),
    parent('solo', 't9'),
  ]);
  // membros do grupo: p1, a1, a2, join-p1

  const positions: Record<string, XYPosition> = {
    p1: { x: 100, y: 100 },
    a1: { x: 450, y: 250 },
    a2: { x: 500, y: 370 },
    'join-p1': { x: 760, y: 300 },
    livre: { x: 0, y: 0 },
  };
  const getPos = (id: string) => positions[id];

  it('drag do pai propaga o mesmo delta pros demais membros (incl. join), com flag dragging', () => {
    const changes: NodeChange[] = [
      { id: 'p1', type: 'position', position: { x: 110, y: 95 }, dragging: true },
    ];
    const out = expandPositionChanges(changes, getPos, groupIndex);
    expect(out).toHaveLength(4);
    expect(out[1]).toEqual({ id: 'a1', type: 'position', position: { x: 460, y: 245 }, positionAbsolute: { x: 460, y: 245 }, dragging: true });
    expect(out[2]).toEqual({ id: 'a2', type: 'position', position: { x: 510, y: 365 }, positionAbsolute: { x: 510, y: 365 }, dragging: true });
    expect(out[3]).toEqual({ id: 'join-p1', type: 'position', position: { x: 770, y: 295 }, positionAbsolute: { x: 770, y: 295 }, dragging: true });
  });

  it('drag de uma aprovação move pai e irmãos', () => {
    const changes: NodeChange[] = [
      { id: 'a1', type: 'position', position: { x: 470, y: 250 }, dragging: true },
    ];
    const out = expandPositionChanges(changes, getPos, groupIndex);
    const ids = out.map(c => c.id).sort();
    expect(ids).toEqual(['a1', 'a2', 'join-p1', 'p1']);
    const p1Change = out.find(c => c.id === 'p1');
    expect(p1Change).toMatchObject({ position: { x: 120, y: 100 } });
  });

  it('membros com change explícita não recebem propagação duplicada (seleção com pai+filho)', () => {
    const changes: NodeChange[] = [
      { id: 'p1', type: 'position', position: { x: 110, y: 110 }, dragging: true },
      { id: 'a1', type: 'position', position: { x: 460, y: 260 }, dragging: true },
    ];
    const out = expandPositionChanges(changes, getPos, groupIndex);
    expect(out.filter(c => c.id === 'a1')).toHaveLength(1);
    expect(out.filter(c => c.id === 'a2')).toHaveLength(1);
    expect(out.filter(c => c.id === 'join-p1')).toHaveLength(1);
    expect(out).toHaveLength(4);
  });

  it('node fora de grupo não gera propagação e retorna o array original (identidade)', () => {
    const changes: NodeChange[] = [
      { id: 'livre', type: 'position', position: { x: 5, y: 5 }, dragging: true },
    ];
    const out = expandPositionChanges(changes, getPos, groupIndex);
    expect(out).toBe(changes);
  });

  it('changes não-position passam intactas e não propagam', () => {
    const changes: NodeChange[] = [{ id: 'p1', type: 'select', selected: true }];
    const out = expandPositionChanges(changes, getPos, groupIndex);
    expect(out).toBe(changes);
  });

  it('change de posição sem position mas com dragging propaga só a flag (fim de drag do RF)', () => {
    const changes: NodeChange[] = [
      { id: 'p1', type: 'position', dragging: false },
    ];
    const out = expandPositionChanges(changes, getPos, groupIndex);
    expect(out).toHaveLength(4);
    expect(out[1]).toEqual({ id: 'a1', type: 'position', dragging: false });
  });

  it('origem sem posição conhecida (getPosition undefined) não propaga', () => {
    const changes: NodeChange[] = [
      { id: 'p1', type: 'position', position: { x: 110, y: 95 }, dragging: true },
    ];
    const out = expandPositionChanges(changes, () => undefined, groupIndex);
    expect(out).toBe(changes);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

```powershell
pnpm --filter @workspace/mindtask-app test
```

Esperado: FAIL — `expandPositionChanges is not a function` (ou export ausente).

- [ ] **Step 3: Implementar**

Adicionar no TOPO de `artifacts/mindtask-app/src/lib/approvalGroups.ts`:

```ts
import type { NodeChange, XYPosition } from 'reactflow';
```

e fazer append no fim do arquivo:

```ts
type PositionChange = Extract<NodeChange, { type: 'position' }>;

/**
 * Expande NodeChanges de posição: quando um membro de grupo rígido se move,
 * gera changes com o MESMO delta pros demais membros. Ids já presentes nas
 * changes originais (seleção contendo vários membros) não recebem propagação.
 * Change de posição sem `position` (evento de fim de drag do ReactFlow) só
 * replica a flag `dragging`, pra nenhum membro ficar preso em dragging=true.
 */
export function expandPositionChanges(
  changes: NodeChange[],
  getPosition: (id: string) => XYPosition | undefined,
  groupIndex: ApprovalGroupIndex,
): NodeChange[] {
  const explicitIds = new Set<string>();
  for (const ch of changes) {
    if (ch.type === 'position') explicitIds.add(ch.id);
  }

  const propagated: PositionChange[] = [];
  const propagatedIds = new Set<string>();

  for (const ch of changes) {
    if (ch.type !== 'position') continue;
    const memberIds = groupIndex.get(ch.id);
    if (!memberIds) continue;

    if (!ch.position) {
      if (ch.dragging === undefined) continue;
      for (const memberId of memberIds) {
        if (memberId === ch.id || explicitIds.has(memberId) || propagatedIds.has(memberId)) continue;
        propagatedIds.add(memberId);
        propagated.push({ id: memberId, type: 'position', dragging: ch.dragging });
      }
      continue;
    }

    const origin = getPosition(ch.id);
    if (!origin) continue;
    const dx = ch.position.x - origin.x;
    const dy = ch.position.y - origin.y;

    for (const memberId of memberIds) {
      if (memberId === ch.id || explicitIds.has(memberId) || propagatedIds.has(memberId)) continue;
      const memberPos = getPosition(memberId);
      if (!memberPos) continue;
      const next = { x: memberPos.x + dx, y: memberPos.y + dy };
      propagatedIds.add(memberId);
      propagated.push({
        id: memberId,
        type: 'position',
        position: next,
        positionAbsolute: next,
        dragging: ch.dragging,
      });
    }
  }

  return propagated.length ? [...changes, ...propagated] : changes;
}
```

- [ ] **Step 4: Rodar e confirmar verde**

```powershell
pnpm --filter @workspace/mindtask-app test
```

Esperado: 14 testes PASS.

- [ ] **Step 5: Commit**

```powershell
git add artifacts/mindtask-app/src/lib/approvalGroups.ts artifacts/mindtask-app/src/lib/approvalGroups.test.ts
git commit -m "feat(canvas): expandPositionChanges - propagacao de delta pro grupo de aprovacao"
```

---

### Task 3: Wiring no canvas — grupo se move junto ao vivo

**Files:**
- Modify: `artifacts/mindtask-app/src/pages/maps/canvas.tsx`

**Interfaces:**
- Consumes: `buildApprovalGroupIndex`, `expandPositionChanges`, `ApprovalGroupIndex` de `@/lib/approvalGroups`.
- Produces (Task 4 depende): `groupIndexRef: React.MutableRefObject<ApprovalGroupIndex>` disponível no componente `CanvasInner`.

Referências de âncora (linhas do master atual — confirmar com grep antes de editar; o arquivo tem ~3000 linhas):
- Imports do reactflow no topo do arquivo (adicionar `type NodeChange` se ausente).
- Declarações de refs: `nodesRef` em ~linha 419.
- Efeito de `mapData`: começa em ~linha 714 (`useEffect(() => { if (!mapData) return;`), com `buildTerminalNodeMap` chamado em ~732.
- `<ReactFlow ... onNodesChange={onNodesChange}` em ~linha 2927.

- [ ] **Step 1: Adicionar imports e ref**

No topo de `canvas.tsx`, junto dos imports locais:

```ts
import { buildApprovalGroupIndex, expandPositionChanges, type ApprovalGroupIndex } from '@/lib/approvalGroups';
```

No import de `reactflow`, garantir que `NodeChange` está entre os tipos importados (ex.: `import ReactFlow, { ..., type NodeChange } from 'reactflow';` — seguir o estilo de import de tipos já usado no arquivo).

Junto das declarações de refs (perto de `const nodesRef = useRef<Node[]>([]);`, ~linha 419):

```ts
const groupIndexRef = useRef<ApprovalGroupIndex>(new Map());
```

- [ ] **Step 2: Atualizar o índice no efeito de mapData**

Dentro do `useEffect` de `mapData`, logo após a linha `const terminalNodeMap = buildTerminalNodeMap(mapData.cards as ApprovalCardMeta[]);` (~linha 732), adicionar:

```ts
    groupIndexRef.current = buildApprovalGroupIndex(mapData.cards as ApprovalCardMeta[]);
```

(`ApprovalCardMeta` satisfaz `ApprovalGroupCardInput` estruturalmente — mesmos nomes de campos.)

- [ ] **Step 3: Interceptor de onNodesChange**

Declarar o wrapper junto dos outros `useCallback` de drag (~linha 1356, imediatamente antes de `onNodeDragStart` — ponto em que `nodesRef` e `groupIndexRef` já existem):

```ts
  // Qualquer mudança de posição num membro de grupo tarefa+aprovações é
  // expandida pros demais membros ANTES de aplicar — o grupo é um bloco
  // rígido em todos os caminhos de movimento (drag, seleção, teclado).
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(
        expandPositionChanges(
          changes,
          (id) => nodesRef.current.find(n => n.id === id)?.position,
          groupIndexRef.current,
        ),
      );
    },
    [onNodesChange],
  );
```

- [ ] **Step 4: Trocar o prop do ReactFlow**

Em ~linha 2927, trocar:

```tsx
            onNodesChange={onNodesChange}
```

por:

```tsx
            onNodesChange={handleNodesChange}
```

- [ ] **Step 5: Gates de compilação**

```powershell
pnpm --filter @workspace/mindtask-app run typecheck 2>&1 | Select-String -Pattern 'error TS' | Measure-Object -Line
```

Comparar com o baseline medido em `master` (rodar o mesmo comando lá antes, ou aceitar o valor de referência ~71): **zero erro novo**.

```powershell
pnpm --filter @workspace/mindtask-app build
pnpm --filter @workspace/mindtask-app test
```

Esperado: build OK, 14 testes PASS.

- [ ] **Step 6: Commit**

```powershell
git add artifacts/mindtask-app/src/pages/maps/canvas.tsx
git commit -m "feat(canvas): grupo tarefa+aprovacoes se move como bloco rigido (interceptor onNodesChange)"
```

---

### Task 4: Persistência de grupo nos drag-stops + guards do join node

**Files:**
- Modify: `artifacts/mindtask-app/src/pages/maps/canvas.tsx`

**Interfaces:**
- Consumes: `groupIndexRef` (Task 3), `updateCardMut` (~linha 1004), `pendingUpdatesRef` (~linha 399), `nodesRef`, `dragStartSnapshotRef`.
- Produces: `persistGroupPositions(originId: string, exclude?: Set<string>): void` (interno ao componente).

Âncoras no master atual:
- `onNodeDragStop` ~linha 1443; early-return de approvalnode ~1474-1475; branch joinnode ~1480-1490; persist do card ~1492-1496.
- `onSelectionDragStop` ~linha 1609.
- Loop de persistência do undo/redo ~linhas 1701-1723.
- Rebuild de join nodes no poll: `const freshJoinNodes = buildJoinNodes(...)` ~linha 911, dentro do `setNodes(prev => ...)` do else-branch do efeito de mapData.

- [ ] **Step 1: Helper `persistGroupPositions`**

Declarar após as mutations (depois de `const updateCardMut = useUpdateCard();` ~linha 1004) e antes de `onNodeDragStart` (~linha 1358):

```ts
  // Persiste a posição final de todos os cards de um grupo tarefa+aprovações.
  // O join node é derivado (nunca persiste) — só ganha guard no
  // pendingUpdatesRef pro rebuild do poll não regredir a posição local
  // enquanto os PATCHes dos cards ainda não refletiram no payload.
  const persistGroupPositions = useCallback(
    (originId: string, exclude?: Set<string>) => {
      const memberIds = groupIndexRef.current.get(originId);
      if (!memberIds) return;
      for (const id of memberIds) {
        if (id.startsWith('join-')) {
          pendingUpdatesRef.current.set(id, Date.now());
          continue;
        }
        if (exclude?.has(id)) continue;
        const member = nodesRef.current.find(n => n.id === id);
        if (!member) continue;
        updateCardMut.mutate({
          workspaceId, mapId, cardId: id,
          data: { positionX: member.position.x, positionY: member.position.y },
        });
      }
    },
    [workspaceId, mapId, updateCardMut],
  );
```

- [ ] **Step 2: onNodeDragStop — approvalnode e joinnode persistem o grupo**

Trocar (~linhas 1474-1475):

```ts
      // Approval nodes use auto-derived positions and are not user-movable.
      if (node.type === 'approvalnode') return;
```

por:

```ts
      // Approval nodes movem o grupo inteiro (bloco rígido via
      // expandPositionChanges); persiste a posição final de todos os cards.
      if (node.type === 'approvalnode') {
        persistGroupPositions(node.id);
        return;
      }
```

No branch do joinnode logo abaixo (~1480-1490), adicionar a persistência do grupo antes da limpeza de highlight, trocando:

```ts
      // Join nodes are user-draggable (individually and in group selections),
      // but their position is derived from approval children and is not
      // persisted. The drag lifecycle (snapshot/undo) above still applies.
      if (node.type === 'joinnode') {
```

por:

```ts
      // Join nodes arrastam o grupo inteiro; a posição do próprio join é
      // derivada e não persiste, mas os cards do grupo persistem.
      if (node.type === 'joinnode') {
        persistGroupPositions(node.id);
```

(o corpo existente do branch — limpeza de highlight e `return` — permanece).

- [ ] **Step 3: onNodeDragStop — mindmap persiste os membros do grupo**

Logo após o persist do próprio card (~1492-1496):

```ts
      // Always save position
      updateCardMut.mutate({
        workspaceId, mapId, cardId: node.id,
        data: { positionX: node.position.x, positionY: node.position.y },
      });
```

adicionar:

```ts
      // Se o card tem aprovações, o grupo se moveu junto — persiste os demais.
      persistGroupPositions(node.id, new Set([node.id]));
```

Atualizar o array de deps do `onNodeDragStop` para incluir `persistGroupPositions`.

- [ ] **Step 4: onSelectionDragStop — expandir persistência pros membros não-selecionados**

Após o `selectedNodes.forEach(...)` existente (~1622-1642), adicionar:

```ts
      // Membros de grupo que não estavam na seleção também se moveram
      // (expandPositionChanges) — persiste cada um exatamente uma vez.
      const persistedIds = new Set(selectedNodes.map(n => n.id));
      for (const node of selectedNodes) {
        const memberIds = groupIndexRef.current.get(node.id);
        if (!memberIds) continue;
        persistGroupPositions(node.id, persistedIds);
        for (const id of memberIds) persistedIds.add(id);
      }
```

Atualizar o array de deps do `onSelectionDragStop` para incluir `persistGroupPositions`.

- [ ] **Step 5: Guard do join no rebuild do poll**

No else-branch do efeito de mapData, trocar (~linha 911):

```ts
        const freshJoinNodes = buildJoinNodes(mapData.cards as ApprovalCardMeta[], handleAddChildCard);
```

por:

```ts
        const rebuiltJoinNodes = buildJoinNodes(mapData.cards as ApprovalCardMeta[], handleAddChildCard);
        // Durante drag ativo ou na janela pós-persistência do grupo, o payload
        // do poll ainda pode ser anterior aos PATCHes — preserva a posição
        // local do join pra ele não "pular" e reconvergir sozinho depois.
        const freshJoinNodes = rebuiltJoinNodes.map(jn => {
          const existing = prev.find(n => n.id === jn.id);
          if (!existing) return jn;
          if (dragStartSnapshotRef.current || pendingUpdatesRef.current.has(jn.id)) {
            return { ...jn, position: existing.position };
          }
          return jn;
        });
```

(O sweep de expiração do `pendingUpdatesRef` — `PENDING_GUARD_MS = 5000` — já roda nesse mesmo efeito antes deste ponto, ~linhas 906-910, então o guard expira sozinho.)

- [ ] **Step 6: Undo/redo — marcar guard do join**

No loop de persistência do undo/redo (~linhas 1701-1723), adicionar um branch pro joinnode antes do branch `mindmap || approvalnode`:

```ts
        } else if (n.type === 'joinnode') {
          // Posição derivada — não persiste; guard evita pulo no poll.
          pendingUpdatesRef.current.set(n.id, Date.now());
        } else if (n.type === 'mindmap' || n.type === 'approvalnode') {
```

- [ ] **Step 7: Gates de compilação e testes**

```powershell
pnpm --filter @workspace/mindtask-app run typecheck 2>&1 | Select-String -Pattern 'error TS' | Measure-Object -Line
pnpm --filter @workspace/mindtask-app build
pnpm --filter @workspace/mindtask-app test
```

Esperado: zero erro TS novo vs baseline, build OK, 14 testes PASS.

- [ ] **Step 8: Commit**

```powershell
git add artifacts/mindtask-app/src/pages/maps/canvas.tsx
git commit -m "feat(canvas): persistencia de grupo nos drag-stops + guards do join node"
```

---

### Task 5: Gates finais + smoke manual (gate humano)

**Files:**
- Nenhum novo (verificação).

**Interfaces:**
- Consumes: tudo das tasks 1-4.
- Produces: branch pronta pra PR.

- [ ] **Step 1: Gates completos da branch**

```powershell
pnpm install --frozen-lockfile
pnpm --filter @workspace/mindtask-app test
pnpm --filter @workspace/mindtask-app run typecheck 2>&1 | Select-String -Pattern 'error TS' | Measure-Object -Line
pnpm --filter @workspace/mindtask-app build
```

Esperado: frozen-lockfile OK; 14 testes PASS; contagem de erros TS igual ao baseline de master; build OK. Nenhum arquivo de backend alterado (`git diff master --stat` só deve listar `artifacts/mindtask-app/`, `docs/` e `pnpm-lock.yaml`).

- [ ] **Step 2: Subir dev servers pro smoke**

```powershell
pnpm --filter @workspace/api-server run dev    # :5000, terminal 1
pnpm --filter @workspace/mindtask-app run dev  # :3000, terminal 2
```

(Cada um em terminal separado — NÃO encadear com `&`, o vite roda pnpm install no CWD errado. Login: conta dev própria ou `e2e_canvas_gate@test.local` / `E2ePass12345!`.)

- [ ] **Step 3: Smoke manual — checklist (gate humano: Gustavo)**

Num mapa com uma tarefa com 2 aprovações **sequenciais** e outra com 2 aprovações **paralelas** (join node presente):

1. Arrastar um card de aprovação → pai + irmãos + join movem juntos, offsets intactos; soltar; recarregar a página → posições persistiram em grupo.
2. Arrastar a tarefa-pai → aprovações + join seguem; reload persiste.
3. Arrastar o join node → grupo segue; reload persiste (join re-derivado no lugar certo).
4. Box-select parcial (só uma aprovação + um card de fora do grupo) e arrastar → o grupo inteiro da aprovação acompanha; o card de fora move normal; reload persiste.
5. Ctrl+Z depois de um drag de grupo → grupo volta junto; Ctrl+Y refaz.
6. Inserção em aresta: arrastar a tarefa-pai (com aprovações) sobre uma aresta entre dois outros cards → inserção continua funcionando e o grupo acompanha o pai.
7. Botão "reorganizar" (auto-layout) → mapa reorganiza normalmente, join nodes acompanham sem pulos.
8. Criar uma aprovação nova numa tarefa (painel da tarefa) com o canvas aberto → o card novo aparece e o grupo passa a incluí-lo nos drags.
9. Esperar ~10s (3 polls) depois de um drag de grupo → nada "pula" de volta.

- [ ] **Step 4: Push da branch (sem merge)**

```powershell
git push -u origin feature/approval-group-drag
```

PR pra master **só com pedido explícito do Gustavo** (regra do repo: deploy/merge é decisão dele).
