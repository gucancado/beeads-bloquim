# Dono da tarefa + filtro de rascunho por dono — Design

**Data:** 2026-06-08
**Status:** Proposto (aguardando revisão)

## Resumo

Duas mudanças relacionadas em torno de um novo conceito — o **dono** (owner) de uma tarefa:

1. **Modal de edição de tarefa:** mostrar o avatar do dono no cabeçalho, à esquerda do botão "aplicar modelo". Foto apenas, nome no hover. Clicar abre seletor de membro para trocar o dono. Dono inicial = criador da tarefa. Toda troca de dono é registrada no histórico da tarefa.

2. **Lista de tarefas:** o filtro de status **"rascunho" passa a filtrar por dono**, não por responsável. Todos os outros filtros de status continuam filtrando por responsável (`assigned_to`). Quando rascunho é selecionado junto com outros status, cada status casa o campo correto via predicado por-status.

## Conceitos: criador × dono × responsável

Hoje a tarefa tem dois vínculos de usuário:

- **`created_by`** — criador, **imutável**. Usado para autorizar exclusão ("só o criador deleta"). **Não muda neste design.**
- **`assigned_to`** — responsável (assignee). Quem executa. Mutável via picker no corpo do modal.

Este design adiciona um terceiro:

- **`owner_id`** (novo) — **dono**, mutável. Default no INSERT = criador. Quem "possui" / é dono da tarefa, independente de quem executa. Troca registrada no histórico.

Manter os três separados evita acoplar a regra de delete (`created_by`) à transferência de posse, e mantém responsável (`assigned_to`) com sua semântica de execução.

## Decisões (confirmadas com o usuário)

| # | Decisão | Escolha |
|---|---------|---------|
| 1 | Storage do dono | **Nova coluna `tasks.owner_id`** (mutável, default = criador). `created_by` segue imutável. |
| 2 | Escopo do picker de dono | **Só tarefas de workspace.** Standalone (my-tasks) não mostra picker (dono = criador, único usuário possível). |
| 3 | Quem troca o dono | **Qualquer membro do workspace** (consistente com responsável). |
| 4 | Filtro misto (rascunho + outros status) | **Predicado por-status:** `(status ∈ {outros} AND assigned_to ∈ pills) OR (status = draft AND owner_id ∈ pills)`. |

## Arquitetura

### 1. Banco (`lib/db/src/schema/tasks.ts`)

Nova coluna em `tasks`:

```ts
owner_id: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
```

- Posicionada junto de `created_by`. `onDelete: set null` (igual `assigned_to`/`created_by`): apagar usuário não derruba a tarefa.
- **Nullable** — para linhas pré-migration e para o caso de dono deletado.

Novo valor no `taskActivityTypeEnum`: **`owner_changed`**.

**Migration (`drizzle`):**
- `ALTER TABLE tasks ADD COLUMN owner_id uuid REFERENCES users(id) ON DELETE SET NULL;`
- `ALTER TYPE task_activity_type ADD VALUE 'owner_changed';`
- **Backfill:** `UPDATE tasks SET owner_id = COALESCE(created_by, assigned_to);` — dono inicial = criador, com fallback no responsável para linhas antigas sem `created_by`.
- Índice: `CREATE INDEX idx_tasks_owner_id ON tasks(owner_id);` (espelha `idx_tasks_assigned_to`, usado pelo filtro de rascunho por dono).

Aplicar via `pnpm --filter @workspace/db run push` em dev; PROD via migration versionada (regra de deploy do projeto).

### 2. INSERTs — gravar `owner_id` na criação

Onde a tarefa nasce, gravar `owner_id = caller` (mesmo actor de `created_by`):

- `POST /api/workspaces/:wId/tasks` ([workspaceTasks.ts](../../../artifacts/api-server/src/routes/workspaceTasks.ts), ~linha 240)
- `POST /api/.../cards/:cId/task` ([cards.ts](../../../artifacts/api-server/src/routes/cards.ts)) — criação de tarefa via card
- `POST /api/my-tasks` ([myTasks.ts](../../../artifacts/api-server/src/routes/myTasks.ts), ~linha 321) — standalone; `owner_id = userId` (inofensivo, mantém invariante dono≠null)

### 3. Troca de dono + histórico

O picker do cabeçalho salva no mesmo endpoint que já salva o responsável no modal:

- **Workspace:** `PATCH /api/workspaces/:wId/tasks/:tId` ([workspaceTasks.ts:471-494](../../../artifacts/api-server/src/routes/workspaceTasks.ts#L471-L494) — espelhar bloco `assignee_changed`)
- **Card mode:** `PATCH /api/.../cards/:cId/task/details` ([cards.ts:586](../../../artifacts/api-server/src/routes/cards.ts#L586) — mesmo padrão)

Ambos passam a aceitar `ownerId` no body. Quando `ownerId` muda em relação ao existente, emitir activity:

```ts
await recordTaskActivity({
  taskId, actorId,
  type: "owner_changed",
  metadata: {
    actorName, actorId,
    oldOwnerId, oldOwnerName,
    newOwnerId, newOwnerName,
  },
  source: req.user?.source ?? null,
});
```

Sem rota nova — só estende as PATCH existentes. Standalone (`PATCH /api/my-tasks/:tId`) **não** aceita `ownerId` (escopo só-workspace).

### 4. Filtro de rascunho por dono (predicado por-status)

Afeta **quatro** handlers, todos hoje com a forma `status filter (inArray)` + `buildAssigneeFilter()` ANDados separadamente:

- `GET /api/workspaces/:wId/tasks` ([workspaceTasks.ts:172-179](../../../artifacts/api-server/src/routes/workspaceTasks.ts#L172-L179))
- `GET /api/workspaces/:wId/tasks/counts` ([workspaceTasks.ts:65-90](../../../artifacts/api-server/src/routes/workspaceTasks.ts#L65-L90))
- `GET /api/my-tasks` ([myTasks.ts:183-191](../../../artifacts/api-server/src/routes/myTasks.ts#L183-L191))
- `GET /api/my-tasks/counts` ([myTasks.ts:89-97](../../../artifacts/api-server/src/routes/myTasks.ts#L89-L97))

**Mudança:** o `buildAssigneeFilter()` deixa de casar sempre `tasks.assignedTo`. Passa a ser **status-aware**, casando `assigned_to` para não-rascunho e `owner_id` para rascunho:

```ts
// scope(field) = OR sobre as pills selecionadas, aplicado num campo
function scope(field: AnyPgColumn) {
  const parts = [];
  if (hasMe) parts.push(eq(field, userId));            // só my-tasks tem "me"
  if (hasUnassigned) parts.push(isNull(field));
  if (uuids.length) parts.push(inArray(field, uuids));
  return parts.length ? or(...parts) : undefined;
}

function buildScopedFilter() {
  if (assignees.length === 0) return undefined;        // sem pills → sem filtro (inalterado)
  const assigneeBranch = and(ne(tasks.status, "draft"), scope(tasks.assignedTo));
  const ownerBranch    = and(eq(tasks.status, "draft"), scope(tasks.ownerId));
  return or(assigneeBranch, ownerBranch);
}
```

- Continua ANDado com o filtro de status (`inArray(tasks.status, statuses)`), então combina corretamente em **todos** os casos:
  - **só pendente:** branch de assignee casa, branch de owner é vazio (status≠draft) → filtra por responsável.
  - **só rascunho:** branch de owner casa → filtra por dono.
  - **pendente + rascunho:** OR resolve cada linha pelo seu status → cada uma casa o campo certo.
  - **sem filtro de status:** rascunhos casam por dono, demais por responsável (semântica "pertence a" coerente).
- Nas counts, como o predicado decide por-linha, o bucket `draft` conta por dono e os demais por responsável — sem query extra.
- Pill **"sem responsável"** (`unassigned`) no branch de rascunho vira `isNull(owner_id)` (raro; só dono deletado).

### 5. API spec (`lib/api-spec/openapi.yaml`) + codegen

- Schemas de resposta de tarefa (lista workspace, detalhe, my-tasks) ganham: `ownerId`, `ownerName`, `ownerAvatarUrl`.
  - Nos SELECTs de lista/detalhe, adicionar `leftJoin` em `users` por `owner_id` (alias) para hidratar nome/avatar — ou subselect, seguindo o padrão de `assigneeName/assigneeAvatarUrl`.
- Schemas de update (workspace task PATCH, card task details PATCH) aceitam `ownerId: uuid nullable optional`.
- Rodar `pnpm --filter @workspace/api-spec run codegen` após editar o yaml. **Não** editar arquivos gerados.

### 6. Frontend

**Componente novo `OwnerAvatarPicker.tsx`** (espelha [AssigneeAvatarPicker.tsx](../../../artifacts/mindtask-app/src/components/tasks/AssigneeAvatarPicker.tsx)):
- Avatar 9×9 com `Tooltip` (nome do dono no hover) + `Popover` com `MemberSelectList` (mesma lista de membros já carregada para o responsável).
- Sem opção "sem dono" na lista — dono sempre tem valor (default criador). (Fallback visual de ícone só se `owner_id` vier null por dono deletado.)

**`TaskHeaderActions.tsx`** — novas props `ownerId`, `members`, `onOwnerChange`, `showOwner`. Renderizar o `OwnerAvatarPicker` **dentro do grupo direito, imediatamente antes** do `TaskApplyTemplateButton` ([TaskHeaderActions.tsx:71-80](../../../artifacts/mindtask-app/src/components/tasks/TaskHeaderActions.tsx#L71-L80)). Mostrar só quando `showOwner` (= `isEditing && !isStandalone`).

**`TaskDetailModal.tsx`** — estado `ownerId`; passar para `TaskHeaderActions`. `onOwnerChange(v)`:
- card mode → `saveCardTaskDetails({ ownerId: v })`
- workspace edit → `saveMutation.mutate({ body: { ownerId: v }, ... })`
- Reaproveitar `members` já buscado para o picker de responsável.

**Histórico (`CommentsSection.tsx` / `useComments.ts`)** — adicionar `owner_changed` ao union de tipos e ao render: texto tipo *"alterou o dono de {oldOwnerName} para {newOwnerName}"*, no mesmo padrão de `assignee_changed`.

**Filtro (lista):** comportamento é server-side — o FE segue mandando o mesmo param `assignedTo` com as pills. O servidor reinterpreta para dono quando o status é rascunho. **Sem mudança obrigatória de FE no filtro.**
- *Opcional (nice-to-have):* quando o filtro de status ativo for **apenas** rascunho, trocar o tooltip da pill "Sem responsável" → "Sem dono" em [AssigneeFilterPills.tsx](../../../artifacts/mindtask-app/src/components/tasks/AssigneeFilterPills.tsx). Fora do escopo mínimo.

## Fluxo de dados

```
Criar tarefa (workspace/card)
  → INSERT tasks { created_by: caller, owner_id: caller, assigned_to: ... }

Trocar dono no modal
  → PATCH .../tasks/:id { ownerId }  ou  .../cards/:c/task/details { ownerId }
  → UPDATE tasks.owner_id
  → recordTaskActivity(owner_changed)
  → invalidate query → header reflete novo avatar; histórico mostra entrada

Filtrar lista por status=rascunho + pills [userX]
  → GET .../tasks?status=draft&assignedTo=userX
  → WHERE status IN (draft) AND ((status≠draft AND assigned_to=userX) OR (status=draft AND owner_id=userX))
  → retorna rascunhos cujo DONO é userX
```

## Tratamento de erros / edge cases

- **Dono deletado** (`owner_id` set null): header cai no fallback de ícone; pill "sem responsável" no branch rascunho casa essas linhas. Sem crash.
- **Linhas pré-migration:** backfill garante `owner_id = COALESCE(created_by, assigned_to)`; nenhum rascunho fica órfão do filtro.
- **`ownerId` inválido (não-membro do workspace):** validar que o `ownerId` é membro do workspace antes do UPDATE (espelhar validação que já exista para assignee; se não houver, aceitar qualquer uuid de user como hoje o assignee aceita — manter consistência com o comportamento atual do responsável).
- **Standalone recebe `ownerId`:** ignorar/rejeitar no `PATCH /my-tasks` (campo fora do schema). Picker nem aparece.
- **`assigned_to` vs `owner_id` divergentes:** esperado e suportado — são conceitos distintos.

## Testes

Backend (vitest, `artifacts/api-server`):
- INSERT grava `owner_id = caller` (workspace, card, standalone).
- `PATCH` muda `owner_id` e emite `owner_changed` com metadata correta; não emite quando `ownerId` inalterado.
- Filtro: `status=draft` + pills filtra por `owner_id`; `status=pending` filtra por `assigned_to`; misto resolve por-status; counts refletem o mesmo.
- Backfill: tarefa antiga sem `created_by` recebe `owner_id = assigned_to`.

Frontend:
- `OwnerAvatarPicker` mostra avatar/tooltip/lista; troca dispara `onOwnerChange`.
- `owner_changed` renderiza no histórico.

> Nota baseline: suíte do api-server não lê `.env` (passar `DATABASE_URL`+`JWT_SECRET` inline); typecheck do FE tem débito pré-existente — usar gate relativo (sem erro novo).

## Fora de escopo (YAGNI)

- Transferência de posse em massa / bulk.
- Mudar a regra de delete para seguir o dono (segue em `created_by`).
- Picker de dono em tarefas standalone.
- Notificação ao novo dono.
- Coluna "dono" na visão de lista (só no modal + filtro).

## Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `lib/db/src/schema/tasks.ts` | coluna `owner_id`, enum `owner_changed`, índice |
| `lib/db/drizzle/*` | migration (add column + enum value + backfill + index) |
| `artifacts/api-server/src/routes/workspaceTasks.ts` | INSERT owner, PATCH owner+activity, filtro por-status (list+counts) |
| `artifacts/api-server/src/routes/cards.ts` | INSERT owner, PATCH details owner+activity |
| `artifacts/api-server/src/routes/myTasks.ts` | INSERT owner, filtro por-status (list+counts) |
| `lib/api-spec/openapi.yaml` | owner fields nas respostas, `ownerId` nos updates → codegen |
| `artifacts/mindtask-app/src/components/tasks/OwnerAvatarPicker.tsx` | **novo** |
| `artifacts/mindtask-app/src/components/tasks/TaskHeaderActions.tsx` | render do owner picker antes do "aplicar modelo" |
| `artifacts/mindtask-app/src/components/tasks/TaskDetailModal.tsx` | estado + wiring do dono |
| `artifacts/mindtask-app/src/hooks/useComments.ts` + `components/maps/CommentsSection.tsx` | label `owner_changed` |
| `artifacts/mindtask-app/src/components/tasks/AssigneeFilterPills.tsx` | *(opcional)* relabel tooltip em modo rascunho |
