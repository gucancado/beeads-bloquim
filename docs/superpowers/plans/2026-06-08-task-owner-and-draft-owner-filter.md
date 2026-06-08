# Dono da tarefa + filtro de rascunho por dono — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um "dono" (owner) mutável às tarefas — exibido no cabeçalho do modal com troca registrada no histórico — e fazer o filtro de status "rascunho" filtrar por dono em vez de responsável.

**Architecture:** Nova coluna `tasks.owner_id` (mutável, default = criador no INSERT), separada de `created_by` (imutável, delete-auth) e `assigned_to` (responsável). Troca de dono via PATCH existentes, emitindo activity `owner_changed`. O filtro de lista passa a usar um predicado por-status: `(status≠draft AND assigned_to ∈ pills) OR (status=draft AND owner_id ∈ pills)`.

**Tech Stack:** PostgreSQL + Drizzle ORM, Express 5, Zod v4, React 19 + Vite, Orval (OpenAPI codegen), vitest.

**Spec:** [docs/superpowers/specs/2026-06-08-task-owner-and-draft-owner-filter-design.md](../specs/2026-06-08-task-owner-and-draft-owner-filter-design.md)

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `lib/db/src/schema/tasks.ts` | Coluna `owner_id`, valor de enum `owner_changed`, índice `idx_tasks_owner_id` |
| `lib/db/drizzle/<gerado>` | Migration: add column + enum value + backfill + index |
| `artifacts/api-server/src/routes/workspaceTasks.ts` | INSERT owner (POST), troca owner + activity (PATCH), hidratação owner (GET detail), filtro por-status (list + counts) |
| `artifacts/api-server/src/routes/cards.ts` | INSERT owner (POST card-com-task + POST :cardId/task), troca owner + activity (PATCH details) |
| `artifacts/api-server/src/routes/myTasks.ts` | INSERT owner (POST standalone), filtro por-status (list + counts) |
| `lib/api-spec/openapi.yaml` | Campos `ownerId`/`ownerName`/`ownerAvatarUrl` nas respostas, `ownerId` nos updates → codegen |
| `artifacts/mindtask-app/src/components/tasks/OwnerAvatarPicker.tsx` | **Novo** — avatar + tooltip + popover de troca de dono |
| `artifacts/mindtask-app/src/components/tasks/useTaskDetailForm.ts` | Estado `ownerId`/`setOwnerId` |
| `artifacts/mindtask-app/src/components/tasks/TaskHeaderActions.tsx` | Render do owner picker antes do "aplicar modelo" |
| `artifacts/mindtask-app/src/components/tasks/TaskDetailModal.tsx` | Wiring do dono (estado → header → save) |
| `artifacts/mindtask-app/src/hooks/useComments.ts` | Tipo `owner_changed` no union |
| `artifacts/mindtask-app/src/components/maps/CommentsSection.tsx` | Render do label `owner_changed` |

---

## Convenções de teste (ler antes)

- Suíte do api-server **não lê `.env`** — rodar com env inline:
  ```bash
  DATABASE_URL='<dev url>' JWT_SECRET='<qualquer>' pnpm --filter @workspace/api-server run test
  ```
- Testes de approval são flaky por timeout no DB remoto — re-rodar antes de suspeitar de regressão.
- Typecheck do FE tem ~71 erros pré-existentes; usar gate **relativo** (sem erro novo), não "verde".
- Após editar `openapi.yaml`: `pnpm --filter @workspace/api-spec run codegen`. Nunca editar arquivos em `generated/`.
- Após editar schema: `pnpm --filter @workspace/db run push` (dev).
- Git workflow: trabalhar em **feature branch**. Nunca commit em master sem pedido explícito.

---

## Task 0: Branch de trabalho

- [ ] **Step 1: Criar branch**

```bash
cd /c/Users/gusta/Projetos/beeads-bloquim/repo
git checkout -b feature/task-owner
```

---

## Task 1: Coluna `owner_id` + enum `owner_changed` no schema

**Files:**
- Modify: `lib/db/src/schema/tasks.ts:117-119` (junto de `createdBy`)
- Modify: `lib/db/src/schema/tasks.ts:122-140` (índices)
- Modify: `lib/db/src/schema/tasks.ts:182-212` (enum de activity)

- [ ] **Step 1: Adicionar coluna `owner_id`**

Em `tasks.ts`, logo após o bloco `createdBy` (linha ~117-119), adicionar:

```ts
  /**
   * Dono da tarefa. Mutável (transferível). Default no INSERT = criador.
   * Diferente de `created_by` (imutável, delete-auth) e `assigned_to`
   * (responsável pela execução). Nullable: linhas pré-migration e dono
   * deletado (FK `set null`).
   */
  ownerId: uuid("owner_id").references(() => users.id, {
    onDelete: "set null",
  }),
```

- [ ] **Step 2: Adicionar índice**

No array de índices (após `idx_tasks_assigned_to`, linha ~128):

```ts
  index("idx_tasks_owner_id").on(table.ownerId),
```

- [ ] **Step 3: Adicionar valor ao enum de activity**

Em `taskActivityTypeEnum` (linha ~182), adicionar `"owner_changed"` ao array, após `"assignee_changed"`:

```ts
  "task_created",
  "assignee_changed",
  "owner_changed",
  "status_changed",
```

- [ ] **Step 4: Aplicar ao banco dev**

Run:
```bash
pnpm --filter @workspace/db run push
```
Expected: push aplica `ALTER TABLE ... ADD COLUMN owner_id`, novo valor de enum e índice sem erro.

- [ ] **Step 5: Backfill do dono = criador**

Conectar no DB dev (psql/script) e rodar:
```sql
UPDATE tasks SET owner_id = COALESCE(created_by, assigned_to) WHERE owner_id IS NULL;
```
Expected: linhas atualizadas; `SELECT count(*) FROM tasks WHERE owner_id IS NULL;` retorna 0 (salvo tarefas sem criador nem responsável).

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/tasks.ts
git commit -m "feat(db): coluna tasks.owner_id + enum owner_changed + índice"
```

> **Nota PROD:** a coluna + enum + backfill devem virar migration versionada antes do deploy (regra do projeto: migrations via session pooler 5432). Anotar no PR.

---

## Task 2: Gravar `owner_id = criador` em todos os INSERTs de tarefa

São **quatro** sites de criação. Em todos, `owner_id` = mesmo actor de `createdBy`/`assignedTo` default.

**Files:**
- Modify: `artifacts/api-server/src/routes/workspaceTasks.ts:242-259`
- Modify: `artifacts/api-server/src/routes/myTasks.ts:316-331`
- Modify: `artifacts/api-server/src/routes/cards.ts:89-90`
- Modify: `artifacts/api-server/src/routes/cards.ts:220-233`

- [ ] **Step 1: workspaceTasks POST** — em `.values({...})` (linha ~244-258), adicionar após `createdBy: actorId,`:

```ts
      createdBy: actorId,
      ownerId: actorId,
```

- [ ] **Step 2: myTasks POST** — em `.values({...})` (linha ~316-331), adicionar após `createdBy: userId,`:

```ts
      createdBy: userId,
      ownerId: userId,
```

- [ ] **Step 3: cards POST `/` (criar card com task)** — linha 90, no `.values({ ... assignedTo: userId, ... })`, adicionar `ownerId: userId`:

```ts
    .values({ title: parsed.data.title, mapId, workspaceId, priority: "medium", status: "draft", assignedTo: userId, ownerId: userId, scheduleMode: "sem_prazo" })
```

- [ ] **Step 4: cards POST `/:cardId/task`** — no `.values({...})` (linha ~222-232), adicionar `ownerId: userId` (logo após `assignedTo,`):

```ts
      ...rest,
      assignedTo,
      ownerId: userId,
      mapId,
```

- [ ] **Step 5: Verificar typecheck do api-server**

Run:
```bash
pnpm --filter @workspace/api-server exec tsc --noEmit
```
Expected: sem erros novos (campo `ownerId` existe no tipo de insert via schema).

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/workspaceTasks.ts artifacts/api-server/src/routes/myTasks.ts artifacts/api-server/src/routes/cards.ts
git commit -m "feat(api): grava owner_id = criador em todos os INSERTs de tarefa"
```

---

## Task 3: Aceitar `ownerId` + emitir `owner_changed` no PATCH de workspace

**Files:**
- Modify: `artifacts/api-server/src/routes/workspaceTasks.ts:208-220` (schema)
- Modify: `artifacts/api-server/src/routes/workspaceTasks.ts:416-425` (detecção de mudança)
- Modify: `artifacts/api-server/src/routes/workspaceTasks.ts:471-494` (activity)
- Test: `artifacts/api-server/src/routes/__tests__/workspaceTasks.owner.test.ts` (novo, se existir convenção de testes de rota)

- [ ] **Step 1: Escrever teste de troca de dono (TDD)**

Verificar primeiro o diretório de testes existente:
```bash
ls artifacts/api-server/src/**/__tests__ 2>/dev/null; ls artifacts/api-server/src/**/*.test.ts 2>/dev/null
```
Seguir o padrão de setup já usado (helper de criação de workspace/user/task). Criar teste que:

```ts
// PATCH /api/workspaces/:wId/tasks/:tId com { ownerId: outroMembro }
// → 200, tarefa.ownerId == outroMembro
// → existe 1 activity type "owner_changed" com metadata.newOwnerId == outroMembro
//   e metadata.oldOwnerName == nome do criador
// PATCH com ownerId == dono atual → NENHUMA activity owner_changed nova
```

Se não houver harness de testes de rota neste pacote, **pular o teste automatizado** e marcar verificação manual via curl no Step 6 (não inventar harness).

- [ ] **Step 2: Adicionar `ownerId` ao schema de update**

Em `createTaskSchema` (linha ~208-218), adicionar campo:

```ts
  assignedTo: z.string().uuid().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
```
(`updateTaskSchema = createTaskSchema.partial()` herda automaticamente.)

- [ ] **Step 3: Detectar mudança de dono**

Após o bloco `assigneeChanging`/`newAssigneeId` (linha ~416-417), adicionar:

```ts
  const ownerChanging = "ownerId" in parsed.data && (parsed.data.ownerId ?? null) !== existing.ownerId;
  const newOwnerId = ownerChanging ? (parsed.data.ownerId ?? null) : null;
```

- [ ] **Step 4: Persistir `owner_id`**

Após a linha `if ("assignedTo" in parsed.data) updateData.assignedTo = ...` (linha ~425), adicionar:

```ts
  if ("ownerId" in parsed.data) updateData.ownerId = parsed.data.ownerId ?? null;
```

- [ ] **Step 5: Emitir activity `owner_changed`**

Logo após o bloco `if (assigneeChanging) { ... }` (linha ~471-494), adicionar:

```ts
  if (ownerChanging) {
    const [oldOwner, newOwner] = await Promise.all([
      existing.ownerId
        ? db.select({ name: users.name }).from(users).where(eq(users.id, existing.ownerId)).limit(1)
        : Promise.resolve([]),
      newOwnerId
        ? db.select({ name: users.name }).from(users).where(eq(users.id, newOwnerId)).limit(1)
        : Promise.resolve([]),
    ]);

    await recordTaskActivity({
      taskId,
      actorId,
      type: "owner_changed",
      metadata: {
        actorName: actorUser[0]?.name ?? null,
        actorId,
        oldOwnerId: existing.ownerId ?? null,
        newOwnerId,
        oldOwnerName: (oldOwner as { name: string }[])[0]?.name ?? null,
        newOwnerName: (newOwner as { name: string }[])[0]?.name ?? null,
      },
      source: req.user?.source ?? null,
    });
  }
```

- [ ] **Step 6: Rodar teste / verificação**

Se criou teste no Step 1:
```bash
DATABASE_URL='<dev>' JWT_SECRET='x' pnpm --filter @workspace/api-server run test -- workspaceTasks.owner
```
Expected: PASS.

Senão, verificação manual (com cookie válido):
```bash
curl -X PATCH "$API/api/workspaces/$WS/tasks/$T" -H 'Content-Type: application/json' --cookie "token=$JWT" -d '{"ownerId":"<membro>"}'
# checar GET .../activities → entrada owner_changed
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/workspaceTasks.ts artifacts/api-server/src/routes/__tests__/ 2>/dev/null
git commit -m "feat(api): PATCH workspace task aceita ownerId + activity owner_changed"
```

---

## Task 4: Aceitar `ownerId` + emitir `owner_changed` no PATCH de card details

**Files:**
- Modify: `artifacts/api-server/src/routes/cards.ts:46-54` (schema)
- Modify: `artifacts/api-server/src/routes/cards.ts:571-596` (após bloco assignee_changed)

- [ ] **Step 1: Adicionar `ownerId` ao schema**

Em `updateTaskDetailsSchema` (linha ~46-54), adicionar:

```ts
  assignedTo: z.string().uuid().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
```

> O `updateData` em cards.ts é montado por spread de `rest` (linha 526-527: `const { dueDate, startAt, scheduleMode, ...rest } = parsed.data`). Como `ownerId` não é desestruturado, ele já entra em `rest` → é persistido automaticamente. **Não** precisa linha extra de persistência. (Confirmar: `ownerId` cai em `rest` e vira `updateData.ownerId`.)

- [ ] **Step 2: Emitir activity `owner_changed`**

Logo após o bloco `if (parsed.data.assignedTo !== undefined && ...) { ... }` (linha ~571-596), adicionar:

```ts
  if (parsed.data.ownerId !== undefined && currentTask && currentTask.ownerId !== parsed.data.ownerId) {
    const newOwnerId = parsed.data.ownerId ?? null;
    let newOwnerName: string | null = null;
    if (newOwnerId) {
      const [newUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, newOwnerId)).limit(1);
      newOwnerName = newUser?.name ?? null;
    }
    let oldOwnerName: string | null = null;
    if (currentTask.ownerId) {
      const [oldUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, currentTask.ownerId)).limit(1);
      oldOwnerName = oldUser?.name ?? null;
    }
    await recordTaskActivity({
      taskId: card.taskId,
      actorId: userId,
      type: "owner_changed",
      metadata: {
        actorName: actorUser?.name ?? null,
        actorId: userId,
        oldOwnerId: currentTask.ownerId ?? null,
        newOwnerId,
        oldOwnerName,
        newOwnerName,
      },
      source: req.user?.source ?? null,
    });
  }
```

- [ ] **Step 3: Typecheck**

Run:
```bash
pnpm --filter @workspace/api-server exec tsc --noEmit
```
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/cards.ts
git commit -m "feat(api): PATCH card details aceita ownerId + activity owner_changed"
```

---

## Task 5: Hidratar dono (nome + avatar) no GET de detalhe do workspace task

O modal lê o dono via `GET /api/workspaces/:wId/tasks/:tId`. `ownerId` já vem em `...task`; falta `ownerName`/`ownerAvatarUrl`.

**Files:**
- Modify: `artifacts/api-server/src/routes/workspaceTasks.ts:295-305` (busca paralela)
- Modify: `artifacts/api-server/src/routes/workspaceTasks.ts:386-393` (response)

- [ ] **Step 1: Buscar dados do dono**

No `Promise.all` (linha ~295-305), adicionar um item para o dono. Substituir o array `[assignee, members, taskSubtasks]` por `[assignee, owner, members, taskSubtasks]` e incluir:

```ts
  const [assignee, owner, members, taskSubtasks] = await Promise.all([
    task.assignedTo
      ? db.select({ name: users.name, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, task.assignedTo)).limit(1)
      : Promise.resolve([]),
    task.ownerId
      ? db.select({ name: users.name, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, task.ownerId)).limit(1)
      : Promise.resolve([]),
    db
      .select({ userId: workspaceMembers.userId, name: users.name, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, workspaceId)),
    db.select().from(subtasks).where(eq(subtasks.taskId, taskId)).orderBy(asc(subtasks.order), asc(subtasks.createdAt)),
  ]);
```

- [ ] **Step 2: Incluir no response**

No `res.json({...})` (linha ~386-393), adicionar:

```ts
  res.json({
    ...task,
    assigneeName: assignee[0]?.name ?? null,
    assigneeAvatarUrl: assignee[0]?.avatarUrl ?? null,
    ownerName: (owner as { name: string; avatarUrl: string | null }[])[0]?.name ?? null,
    ownerAvatarUrl: (owner as { name: string; avatarUrl: string | null }[])[0]?.avatarUrl ?? null,
    members,
    subtasks: taskSubtasks,
    parentTask,
  });
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm --filter @workspace/api-server exec tsc --noEmit
git add artifacts/api-server/src/routes/workspaceTasks.ts
git commit -m "feat(api): GET workspace task detail hidrata ownerName/ownerAvatarUrl"
```

> **Card mode:** o modal em card mode lê o dono dos dados do card já carregados no mapa. `ownerId` virá em `...task` no GET do mapa (coluna nova selecionada via `select()`). Nome/avatar do dono no card mode são resolvidos client-side via lista de `members` (Task 8) — não precisa join extra no GET do mapa.

---

## Task 6: Filtro por-status (rascunho → dono) nos 4 handlers de lista/counts

Trocar cada `buildAssigneeFilter` (que casa só `tasks.assignedTo`) por um predicado por-status. O filtro de status (`inArray`) permanece ANDado por fora — o predicado decide o campo por linha.

**Files:**
- Modify: `artifacts/api-server/src/routes/workspaceTasks.ts:70-78` (counts)
- Modify: `artifacts/api-server/src/routes/workspaceTasks.ts:119-127` (list)
- Modify: `artifacts/api-server/src/routes/myTasks.ts:88-99` (counts)
- Modify: `artifacts/api-server/src/routes/myTasks.ts:182-193` (list)
- Test: teste de filtro (se houver harness)

- [ ] **Step 1: Escrever teste do filtro (TDD, se houver harness)**

```ts
// Setup: workspace W, membros A,B.
// taskDraft: status=draft, owner=A, assigned=B
// taskPending: status=pending, owner=B, assigned=A
// GET /tasks?status=draft&assignedTo=A  → retorna taskDraft (dono A), NÃO taskPending
// GET /tasks?status=pending&assignedTo=A → retorna taskPending (assignee A), NÃO taskDraft
// GET /tasks?status=draft,pending&assignedTo=A → retorna AMBAS (draft por dono, pending por assignee)
// GET /tasks/counts?assignedTo=A → draft conta por dono, pending por assignee
```
Se não houver harness de rota, pular automatizado e usar verificação manual no Step 7.

- [ ] **Step 2: workspaceTasks counts (linha 70-78)** — substituir `buildAssigneeFilter` por:

```ts
  const buildAssigneeFilter = () => {
    if (assignees.length === 0) return undefined;
    const hasUnassigned = assignees.includes("unassigned");
    const uuids = assignees.filter(a => a !== "unassigned");
    const scope = (field: typeof tasks.assignedTo) => {
      const parts = [];
      if (hasUnassigned) parts.push(isNull(field));
      if (uuids.length > 0) parts.push(inArray(field, uuids));
      return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : or(...parts);
    };
    const assigneeBranch = and(ne(tasks.status, "draft"), scope(tasks.assignedTo));
    const ownerBranch = and(eq(tasks.status, "draft"), scope(tasks.ownerId));
    return or(assigneeBranch, ownerBranch);
  };
```

- [ ] **Step 3: workspaceTasks list (linha 119-127)** — substituir `buildAssigneeFilter` pelo **mesmo** corpo do Step 2.

- [ ] **Step 4: myTasks counts (linha 88-99)** — substituir `buildAssigneeFilter` por (note o `hasMe` extra do my-tasks):

```ts
  const buildAssigneeFilter = () => {
    if (assignees.length === 0) return undefined;
    const hasMe = assignees.includes("me");
    const hasUnassigned = assignees.includes("unassigned");
    const uuids = assignees.filter(a => a !== "me" && a !== "unassigned");
    const scope = (field: typeof tasks.assignedTo) => {
      const parts = [];
      if (hasMe) parts.push(eq(field, userId));
      if (hasUnassigned) parts.push(isNull(field));
      if (uuids.length > 0) parts.push(inArray(field, uuids));
      return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : or(...parts);
    };
    const assigneeBranch = and(ne(tasks.status, "draft"), scope(tasks.assignedTo));
    const ownerBranch = and(eq(tasks.status, "draft"), scope(tasks.ownerId));
    return or(assigneeBranch, ownerBranch);
  };
```

- [ ] **Step 5: myTasks list (linha 182-193)** — substituir `buildAssigneeFilter` pelo **mesmo** corpo do Step 4.

- [ ] **Step 6: Garantir import de `ne`**

Em ambos os arquivos, conferir que `ne` está no import do `drizzle-orm`. Run:
```bash
grep -n "from \"drizzle-orm\"" artifacts/api-server/src/routes/workspaceTasks.ts artifacts/api-server/src/routes/myTasks.ts
```
Se `ne` não estiver na lista, adicioná-lo ao import (junto de `eq, and, or, isNull, inArray, not`).

- [ ] **Step 7: Rodar testes / verificação manual**

```bash
pnpm --filter @workspace/api-server exec tsc --noEmit
# se houver harness:
DATABASE_URL='<dev>' JWT_SECRET='x' pnpm --filter @workspace/api-server run test -- tasks
```
Expected: typecheck limpo (sem erro novo); testes de filtro PASS.

Verificação manual:
```bash
curl --cookie "token=$JWT" "$API/api/workspaces/$WS/tasks?status=draft&assignedTo=$A"   # rascunhos cujo dono é A
curl --cookie "token=$JWT" "$API/api/workspaces/$WS/tasks?status=pending&assignedTo=$A" # pendentes cujo responsável é A
```

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/routes/workspaceTasks.ts artifacts/api-server/src/routes/myTasks.ts
git commit -m "feat(api): filtro de rascunho passa a filtrar por dono (predicado por-status)"
```

---

## Task 7: OpenAPI — campos de dono + codegen

Adicionar `ownerId`/`ownerName`/`ownerAvatarUrl` às respostas de tarefa e `ownerId` aos updates. Garante tipos para os hooks gerados consumidos no FE.

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (junto de cada `assignedTo`/`assigneeName`)

- [ ] **Step 1: Localizar os schemas de tarefa**

```bash
grep -n "assignedTo:\|assigneeName:\|assigneeAvatarUrl:" lib/api-spec/openapi.yaml
```

- [ ] **Step 2: Em cada schema de RESPOSTA de tarefa** (os que têm `assigneeName`), adicionar logo após `assigneeAvatarUrl`:

```yaml
        ownerId:
          type: string
          format: uuid
          nullable: true
        ownerName:
          type: string
          nullable: true
        ownerAvatarUrl:
          type: string
          nullable: true
```

- [ ] **Step 3: Em cada schema de REQUEST de update de tarefa** (os que têm `assignedTo` como propriedade de body de PATCH), adicionar após `assignedTo`:

```yaml
        ownerId:
          type: string
          format: uuid
          nullable: true
```

- [ ] **Step 4: Rodar codegen**

Run:
```bash
pnpm --filter @workspace/api-spec run codegen
```
Expected: regenera hooks + zod schemas sem erro. Verificar `git status` mostra mudanças só em `generated/`.

- [ ] **Step 5: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "feat(api-spec): campos owner nas respostas/updates de tarefa + codegen"
```

---

## Task 8: Componente `OwnerAvatarPicker`

Espelha `AssigneeAvatarPicker`, sem opção "sem dono".

**Files:**
- Create: `artifacts/mindtask-app/src/components/tasks/OwnerAvatarPicker.tsx`

- [ ] **Step 1: Criar o componente**

```tsx
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@beeads/ui";
import { Avatar, AvatarFallback, AvatarImage } from "@beeads/ui";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@beeads/ui";
import { Crown } from "lucide-react";
import type { WorkspaceMemberResponse } from "@workspace/api-client-react";
import { MemberSelectList, type MemberItem } from "@/components/tasks/MemberSelectList";

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join("");
}

interface OwnerAvatarPickerProps {
  ownerId: string | null;
  members: WorkspaceMemberResponse[] | undefined;
  onSelect: (value: string) => void;
}

export function OwnerAvatarPicker({ ownerId, members, onSelect }: OwnerAvatarPickerProps) {
  const [open, setOpen] = useState(false);
  const selectedMember = members?.find(m => m.userId === ownerId) ?? null;
  const ownerName = selectedMember?.user.name ?? null;
  const ownerAvatarUrl = selectedMember?.user.avatarUrl ?? null;

  const memberItems: MemberItem[] = (members ?? []).map(m => ({
    userId: m.userId,
    name: m.user.name,
    avatarUrl: m.user.avatarUrl ?? null,
  }));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger render={(tooltipProps) => (
            <PopoverTrigger
              {...tooltipProps}
              render={(popoverProps) => (
                <button
                  {...popoverProps}
                  type="button"
                  className="flex items-center justify-center h-7 w-7 rounded-lg hover:bg-muted/60 transition-colors focus:outline-none cursor-pointer shrink-0"
                >
                  {ownerName ? (
                    <Avatar key={`${ownerId}|${ownerAvatarUrl ?? ""}`} className="w-6 h-6 shrink-0">
                      {ownerAvatarUrl ? (
                        <AvatarImage src={ownerAvatarUrl} alt={ownerName} className="object-cover" />
                      ) : null}
                      <AvatarFallback className="text-[10px] font-semibold bg-primary/10 text-primary">
                        {getInitials(ownerName)}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <Crown className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                </button>
              )}
            />
          )} />
          <TooltipContent>
            {ownerName ? `Dono: ${ownerName}` : "Sem dono"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        align="end"
        className="w-auto p-1 rounded-xl min-w-[180px]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <MemberSelectList
          members={memberItems}
          selectedId={ownerId}
          onSelect={(id) => {
            if (id) onSelect(id);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
```

> Avatar 6×6 (botão 7×7) para casar com os botões de ícone do cabeçalho (h-7 w-7), menores que o picker de responsável do corpo. Confirmar que `MemberSelectList` aceita `selectedId: string | null` sem `unassignedLabel` (omitir a opção "sem"). Se `MemberSelectList` exigir `unassignedLabel` para esconder a opção, verificar a assinatura em `MemberSelectList.tsx` e ajustar.

- [ ] **Step 2: Verificar assinatura do MemberSelectList**

```bash
sed -n '1,60p' artifacts/mindtask-app/src/components/tasks/MemberSelectList.tsx
```
Confirmar props `members`, `selectedId`, `onSelect` e que omitir `unassignedLabel` não renderiza a opção "sem". Ajustar o componente acima se necessário.

- [ ] **Step 3: Commit**

```bash
git add artifacts/mindtask-app/src/components/tasks/OwnerAvatarPicker.tsx
git commit -m "feat(ui): OwnerAvatarPicker (avatar + tooltip + troca de dono)"
```

---

## Task 9: Estado `ownerId` no form hook

**Files:**
- Modify: `artifacts/mindtask-app/src/components/tasks/useTaskDetailForm.ts`

- [ ] **Step 1: Ler o hook para entender o padrão de estado**

```bash
cat artifacts/mindtask-app/src/components/tasks/useTaskDetailForm.ts
```
Identificar como `assignedTo`/`setAssignedTo` é declarado e inicializado a partir de `card`/`task`.

- [ ] **Step 2: Adicionar `ownerId` espelhando `assignedTo`**

Adicionar `const [ownerId, setOwnerId] = useState<string | null>(null);` e, no mesmo `useEffect`/init que seta `assignedTo` a partir de `task`/`card`, setar:

```ts
setOwnerId((task as { ownerId?: string | null })?.ownerId ?? (card as { ownerId?: string | null })?.ownerId ?? null);
```

Incluir `ownerId, setOwnerId` no objeto retornado pelo hook.

- [ ] **Step 3: Typecheck (gate relativo)**

```bash
pnpm --filter @workspace/mindtask-app exec tsc --noEmit 2>&1 | tail -5
```
Expected: contagem de erros não aumenta vs baseline (~71).

- [ ] **Step 4: Commit**

```bash
git add artifacts/mindtask-app/src/components/tasks/useTaskDetailForm.ts
git commit -m "feat(ui): estado ownerId no useTaskDetailForm"
```

---

## Task 10: Render do owner picker no cabeçalho

**Files:**
- Modify: `artifacts/mindtask-app/src/components/tasks/TaskHeaderActions.tsx:6-36` (props)
- Modify: `artifacts/mindtask-app/src/components/tasks/TaskHeaderActions.tsx:71-80` (render)
- Modify: `artifacts/mindtask-app/src/components/tasks/TaskDetailModal.tsx:762-804` (wiring)

- [ ] **Step 1: Adicionar props ao TaskHeaderActions**

No tipo de props (linha ~21-36), adicionar:

```ts
  ownerSlot?: ReactNode;
```
E na lista de parâmetros desestruturados (linha ~6-21), adicionar `ownerSlot,`.

- [ ] **Step 2: Renderizar o owner slot antes do "aplicar modelo"**

No grupo direito (linha ~71-72), inserir `{ownerSlot}` **antes** do `<TaskApplyTemplateButton>`:

```tsx
        <div className="flex items-center gap-1.5 shrink-0">
        {ownerSlot}
        {isEditing && taskStatus !== undefined && (
          <TaskApplyTemplateButton
```

- [ ] **Step 3: Wiring no TaskDetailModal**

No `<TaskHeaderActions ...>` (linha ~762), adicionar a prop `ownerSlot`:

```tsx
                  ownerSlot={
                    isEditing && !isStandalone ? (
                      <OwnerAvatarPicker
                        ownerId={ownerId}
                        members={members}
                        onSelect={v => {
                          setOwnerId(v);
                          markDirty();
                          if (isCardMode) saveCardTaskDetails({ ownerId: v });
                          else if (resolvedTaskId) saveMutation.mutate({ body: { ownerId: v }, taskId: resolvedTaskId, standalone: isStandalone, wsId: effectiveWorkspaceId });
                        }}
                      />
                    ) : null
                  }
```

- [ ] **Step 4: Import + destructure de `ownerId`/`setOwnerId`**

No topo do TaskDetailModal, adicionar import:
```ts
import { OwnerAvatarPicker } from "@/components/tasks/OwnerAvatarPicker";
```
E incluir `ownerId, setOwnerId,` na desestruturação de `useTaskDetailForm(...)` (linha ~298-311).

- [ ] **Step 5: Suportar `ownerId` em `saveCardTaskDetails`**

Conferir a assinatura de `saveCardTaskDetails` (linha ~414): o objeto `overrides` precisa aceitar `ownerId?: string`. Ampliar o tipo e incluir `ownerId` no payload enviado ao `PATCH .../task/details`:

```ts
  const saveCardTaskDetails = (overrides: { priority?: string; assignedTo?: string; ownerId?: string; dueDate?: string; startAt?: string; scheduleMode?: ScheduleModeValue } = {}) => {
    // ... montar payload incluindo:
    //   if (overrides.ownerId !== undefined) payload.ownerId = overrides.ownerId;
```
Ler o corpo da função (linha ~414-440) e adicionar `ownerId` ao payload no mesmo padrão de `assignedTo`.

- [ ] **Step 6: Confirmar que `saveMutation` aceita `ownerId` no body**

`saveMutation` (linha ~471) usa customFetch — o body é repassado direto. Conferir que o tipo do `body` não bloqueia `ownerId` (se for tipado por orval, o codegen da Task 7 já incluiu `ownerId`). Ajustar tipo local se necessário.

- [ ] **Step 7: Typecheck (gate relativo) + verificação manual**

```bash
pnpm --filter @workspace/mindtask-app exec tsc --noEmit 2>&1 | tail -5
```
Expected: sem erros novos.

Subir dev e abrir modal de uma tarefa de workspace:
```bash
pnpm --filter @workspace/api-server run dev &
pnpm --filter @workspace/mindtask-app run dev
```
Verificar: avatar do dono aparece à esquerda do botão "aplicar modelo"; hover mostra nome; clicar abre lista; trocar dono persiste e reflete no avatar. Em tarefa standalone (Minhas Tarefas sem workspace) o avatar **não** aparece.

- [ ] **Step 8: Commit**

```bash
git add artifacts/mindtask-app/src/components/tasks/TaskHeaderActions.tsx artifacts/mindtask-app/src/components/tasks/TaskDetailModal.tsx
git commit -m "feat(ui): avatar do dono no cabeçalho do modal com troca inline"
```

---

## Task 11: Label `owner_changed` no histórico

**Files:**
- Modify: `artifacts/mindtask-app/src/hooks/useComments.ts:22` (union de tipos)
- Modify: `artifacts/mindtask-app/src/components/maps/CommentsSection.tsx:257-267` (render)

- [ ] **Step 1: Estender o union de tipos**

Na linha 22 de `useComments.ts`, adicionar `"owner_changed"` após `"assignee_changed"`:

```ts
  type: "task_created" | "assignee_changed" | "owner_changed" | "status_changed" | "priority_changed" | "due_date_changed" | "approval_comment" | "task_approved" | "task_rejected" | "task_duplicated";
```

- [ ] **Step 2: Adicionar case de render**

Em `CommentsSection.tsx`, logo após o bloco `case "assignee_changed": { ... }` (linha ~267), adicionar:

```ts
    case "owner_changed": {
      const actor = m.actorName ?? activity.actorName ?? "Alguém";
      const newName = m.newOwnerName;
      const oldName = m.oldOwnerName;
      if (m.actorId && m.newOwnerId && m.actorId === m.newOwnerId) {
        return `${dateStr}: ${actor} tornou-se dono da tarefa.`;
      }
      if (!newName) {
        return `${dateStr}: ${actor} removeu o dono da tarefa.`;
      }
      if (oldName) {
        return `${dateStr}: ${actor} alterou o dono de ${oldName} para ${newName}.`;
      }
      return `${dateStr}: ${actor} definiu ${newName} como dono da tarefa.`;
    }
```

- [ ] **Step 3: Typecheck (gate relativo) + verificação manual**

```bash
pnpm --filter @workspace/mindtask-app exec tsc --noEmit 2>&1 | tail -5
```
Trocar o dono de uma tarefa e abrir o histórico/atividades → confirmar a frase "alterou o dono de X para Y".

- [ ] **Step 4: Commit**

```bash
git add artifacts/mindtask-app/src/hooks/useComments.ts artifacts/mindtask-app/src/components/maps/CommentsSection.tsx
git commit -m "feat(ui): histórico renderiza owner_changed"
```

---

## Task 12: Verificação end-to-end + suíte

- [ ] **Step 1: Rodar suíte do api-server**

```bash
DATABASE_URL='<dev>' JWT_SECRET='x' pnpm --filter @workspace/api-server run test 2>&1 | tail -30
```
Expected: sem regressões (lembrar: testes de approval podem ser flaky — re-rodar os que falharem isoladamente).

- [ ] **Step 2: Typecheck dos dois pacotes**

```bash
pnpm --filter @workspace/api-server exec tsc --noEmit
pnpm --filter @workspace/mindtask-app exec tsc --noEmit 2>&1 | tail -5
```
Expected: api-server verde; mindtask-app sem erro novo vs baseline.

- [ ] **Step 3: Checklist funcional manual**

- [ ] Avatar do dono aparece à esquerda do "aplicar modelo" em tarefa de workspace; ausente em standalone.
- [ ] Hover mostra nome do dono; clique troca; persiste após reload.
- [ ] Histórico mostra `owner_changed`.
- [ ] Filtro status=rascunho + pill de usuário X → mostra rascunhos cujo **dono** é X.
- [ ] Filtro status=pendente + pill X → mostra pendentes cujo **responsável** é X.
- [ ] Filtro status=rascunho,pendente + pill X → mistura correta.
- [ ] Counts do badge de rascunho refletem dono; demais status refletem responsável.
- [ ] Tarefa nova nasce com dono = criador.

- [ ] **Step 4: Build do api-server (sanidade de bundle)**

```bash
pnpm --filter @workspace/api-server run build
```
Expected: build OK.

---

## Self-Review (preenchido)

**Cobertura da spec:**
- Avatar do dono no cabeçalho à esquerda do "aplicar modelo" → Task 10.
- Foto só + nome no hover → Task 8 (Tooltip).
- Clique troca dono → Task 8/10.
- Dono inicial = criador → Task 2 (INSERT) + Task 1 (backfill).
- Troca registrada no histórico → Task 3/4 (activity) + Task 11 (render).
- Filtro rascunho por dono, demais por responsável, predicado por-status → Task 6.
- Só workspace → Task 10 (`isEditing && !isStandalone`).
- Qualquer membro troca → sem checagem extra de autorização (Task 3/4 herdam `requireWorkspaceRole`).
- Storage = nova coluna `owner_id` → Task 1.

**Placeholders:** nenhum — todos os steps têm código/comando reais. Pontos com "confirmar assinatura" (MemberSelectList, saveCardTaskDetails, useTaskDetailForm) são leituras de verificação, não TODOs de implementação.

**Consistência de tipos:** `ownerId` (camelCase FE/insert), `owner_id` (coluna SQL), metadata `newOwnerId`/`oldOwnerId`/`newOwnerName`/`oldOwnerName` consistentes entre Task 3, 4 e 11. Activity type `owner_changed` consistente entre schema (Task 1), emit (3/4) e render (11).

**Fora de escopo (não implementar):** bulk transfer, mudar regra de delete, picker em standalone, notificação ao novo dono, coluna dono na visão de lista, relabel das pills (opcional na spec).
