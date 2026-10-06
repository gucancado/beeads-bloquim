# Modelos de tarefa (criar/aplicar) e modelos de plano de ação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar modelo de tarefa a partir da tarefa aberta (menu "aplicar modelo"/"criar modelo" no modal) e introduzir modelos de plano de ação (capturar mapa inteiro ou seleção; aplicar numa área livre do mapa, com seleção dos novos nós e enquadramento).

**Architecture:** Backend Express 5 + Drizzle. Modelo de tarefa ganha `POST /api/task-templates/from-task`. Modelo de plano é uma tabela nova `plan_templates` com `payload jsonb` versionado (`v: 1`, posições relativas). A lógica de captura/aplicação é dividida em funções puras (`services/planTemplates/capture.ts`, `apply.ts`, testadas sem banco) e um service com banco (`services/planTemplates/service.ts`; aplicação numa transação com `pg_advisory_xact_lock` por mapa). Frontend: popover artesanal de dois níveis no modal de tarefa, `DropdownMenu` do `@beeads/ui` no canvas, aba nova em `/my-templates`. Rotas novas ficam FORA do OpenAPI (precedente `/api/task-templates`): `customFetch` + React Query.

**Tech Stack:** Node 24, TypeScript 5.9, Express 5, Drizzle ORM (Postgres), Zod v4, Vitest + Supertest (api-server), React 19 + Vite 7 + ReactFlow 11.11.4 + TanStack Query v5 + `@beeads/ui` (Base UI) no `mindtask-app`.

**Spec:** `docs/superpowers/specs/2026-10-05-modelos-de-plano-design.md` (decisões D1–D10 são fixas; leia antes de qualquer task).

## Global Constraints

- Branch: `feat/modelos-de-plano`. Commits só nesta branch. **Nunca** commit/merge/push em `master`. Não fazer push (o dono decide).
- `git add` só dos arquivos da task (a árvore tem arquivos não rastreados alheios: `.superpowers/`, `test-results/`, `docs/specs/prompt-handoff-*`). Nunca `git add -A` / `git add .`.
- Mensagem de commit termina com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Nenhuma dependência nova** em nenhum `package.json` (lockfile tem que bater com pnpm 11.4.0 do Dockerfile; esta feature não precisa de nada novo).
- Zod nos arquivos novos: `import { z } from "zod/v4";`.
- Rotas novas **não** entram no `lib/api-spec/openapi.yaml`; não rodar codegen; não editar `lib/api-client-react/src/generated/` nem `lib/api-zod/src/generated/`.
- Migration: SQL escrito à mão, numerado `lib/db/drizzle/0041_add_plan_templates.sql`, aditivo e idempotente. **Nunca** `drizzle-kit generate`. **Nunca** `drizzle-kit push` (nem `--force`) contra o dev DB: ele dropa as tabelas `strategy_*` de outra branch. Aplicar no dev com `pg` direto (comando na Task 1). Nunca tocar o prod (ref `ljilttjsrceddoydnneu`).
- Textos de UI em português, rótulos em minúsculas. Toasts com o texto exato da spec: "novo modelo de tarefa criado", "novo modelo de plano de ação criado", "modelo de plano de ação aplicado".
- `@beeads/ui` é Base UI: trigger de overlay usa `render={(props) => <button {...props} />}` (nunca `asChild`); `DropdownMenuItem` usa `onClick` (nunca `onSelect`).
- UI autosave: input de texto salva no blur/Enter, sem botão Salvar.
- O popover do `TaskApplyTemplateButton` continua artesanal (portal em `portalContainer`), por causa do Dialog e do iframe `/embed/task` (contrato com o painel). Não trocar por `DropdownMenu`/`Popover` do DS.
- Erro HTTP no front: `customFetch` lança `ApiError` com o corpo em **`.data`** (não `.body`). Ler mensagens com o helper `apiErrorMessage` (Task 6).
- Rodar testes do api-server: a suíte **não lê `.env`**. De dentro de `artifacts/api-server`, com Git Bash:
  `DATABASE_URL='<dev DB>' JWT_SECRET='<jwt>' npx vitest run <padrão>`
  - `<dev DB>`: URL do dev DB (session pooler, porta 5432) na memória `C:\Users\gusta\.claude\projects\c--Users-gusta-Projetos-beeads-bloquim\memory\bloquim_apiserver_test_run.md` (seção "Rodando a suíte") / `bloquim_db_credentials.md`. `<jwt>`: `JWT_SECRET` do SSO no `C:\Users\gusta\.claude\CLAUDE.md`. Não gravar esses valores em arquivo do repo.
  - Se o dev DB estiver pausado/fora: usar o Plano B (Postgres embarcado) da mesma memória; nesse caso o schema é criado por `drizzle-kit push --force` **apenas contra o Postgres local** `127.0.0.1:55432`, como a memória descreve.
  - Teste pesado que falha por timeout: re-rodar antes de suspeitar de regressão.
- Testes puros (sem banco) não podem importar `@workspace/db` em runtime (o módulo lança sem `DATABASE_URL`). `capture.ts`, `apply.ts` e `types.ts` só importam `zod/v4`, `../../lib/collision` e tipos.
- Typecheck é **gate relativo** (baseline vermelho: api ~278 erros, web 71). Zero erro novo. Baselines capturados na Task 1 em `c:/tmp/modelos-de-plano/`.
- Rotação de formas (`map_shapes.rotation`) é tratada em **graus** (o front ainda não renderiza rotação; convenção CSS).

## Review Focus

1. **`templateId`/`:id` que não é UUID** (link velho, digitação) → deve dar 404, não 500 de cast do Postgres. Teste na Task 5 (`apply` com `not-a-uuid`, `PATCH /api/plan-templates/not-a-uuid`).
2. **Dois "aplicar" simultâneos no mesmo mapa** (duplo clique, duas abas) → os dois conjuntos ficam lado a lado sem sobreposição (lock por mapa). Teste na Task 5 (`Promise.all` de dois applies; segundo `bounds.x` ≥ fim do primeiro + 120).
3. **Corpo ausente no `capture`** (cliente/MCP que manda POST sem body; Express 5 deixa `req.body` `undefined`) → tratar como `{}` (mapa inteiro), não 400. Teste na Task 5.
4. **Seleção só com aprovações/imagens** (`cardIds` só de aprovação) → 400 "nada pra salvar no modelo" com mensagem legível no toast, nunca modelo vazio. Teste na Task 3 (puro) e Task 5 (HTTP).
5. **Executor aplicando modelo** → 403 com toast legível ("você não tem permissão pra aplicar modelos neste plano"), não "Forbidden". Teste na Task 5 (403) + mapeamento de status coberto pelo teste puro de `apiErrorMessage` na Task 6.

---

## File Structure

**Backend (`artifacts/api-server/src/`)**
- `services/taskTemplatesService.ts` (modify) — `createTemplateFromTask` + helper de acesso compartilhado com `applyTemplateToTask`.
- `routes/taskTemplates.ts` (modify) — `POST /from-task`.
- `services/planTemplates/types.ts` (create) — Zod do payload v1, tipos de entrada da captura, `payloadCounts`.
- `services/planTemplates/capture.ts` (create) — puras: `hasSelection`, `selectElements`, `remapConnections`, `normalizePositions`, `buildPayload`, `buildCapture`.
- `services/planTemplates/apply.ts` (create) — puras: `shapeAabb`, `existingBoxes`, `computeOrigin`, `computeBounds`, `APPLY_GAP_X`.
- `services/planTemplates/service.ts` (create) — banco: `captureFromMap`, `applyToMap`, `listPlanTemplates`, `renamePlanTemplate`, `deletePlanTemplate`.
- `routes/mapPlanTemplates.ts` (create) — `POST /capture`, `POST /:templateId/apply` (mergeParams).
- `routes/planTemplates.ts` (create) — `GET /`, `PATCH /:id`, `DELETE /:id`.
- `routes/index.ts` (modify) — montagem.
- Testes: `__tests__/taskTemplatesFromTask.smoke.test.ts`, `__tests__/planTemplatesCapture.test.ts`, `__tests__/planTemplatesApply.test.ts`, `__tests__/planTemplates.smoke.test.ts`.

**DB (`lib/db/`)**
- `src/schema/planTemplates.ts` (create), `src/schema/index.ts` (modify), `drizzle/0041_add_plan_templates.sql` (create).

**Frontend (`artifacts/mindtask-app/src/`)**
- `lib/apiErrorMessage.ts` + `lib/apiErrorMessage.test.ts` (create).
- `components/tasks/TaskApplyTemplateButton.tsx` (modify).
- `lib/planTemplates.ts` + `lib/planTemplates.test.ts` (create) — tipos, `selectionFromNodes`, `skippedDescription`, `formatPlanCounts`, query key.
- `components/maps/PlanTemplateMenu.tsx` (create).
- `pages/maps/canvas.tsx` (modify) — botão, seleção pendente no efeito de sync, `fitBounds`.
- `components/templates/PlanTemplatesTab.tsx` (create).
- `pages/templates.tsx` (modify) — abas.
- `components/layout/AppLayout.tsx` (modify) — rótulo "modelos".

---

### Task 1: Tabela `plan_templates` (schema + migration) e baselines de typecheck

**Files:**
- Create: `lib/db/src/schema/planTemplates.ts`
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/drizzle/0041_add_plan_templates.sql`

**Interfaces:**
- Consumes: `users` de `lib/db/src/schema/users.ts`.
- Produces: `planTemplates` (Drizzle table) exportado por `@workspace/db/schema`, colunas `id, userId, name, payload (jsonb, $type<unknown>), createdAt, updatedAt`; tipo `PlanTemplate`.

- [ ] **Step 1: Capturar baselines de typecheck ANTES de qualquer mudança**

Git Bash, da raiz do repo (`C:/Users/gusta/Projetos/beeads-bloquim/repo`):

```bash
mkdir -p /c/tmp/modelos-de-plano
npx tsc -b lib/db
cd artifacts/api-server && NODE_OPTIONS=--max-old-space-size=4096 npx tsc -p tsconfig.json --noEmit > /c/tmp/modelos-de-plano/api-tsc-baseline.txt 2>&1; cd ../..
cd artifacts/mindtask-app && printf '{\n  "extends": "./tsconfig.json",\n  "references": []\n}\n' > tsconfig.gate.json && NODE_OPTIONS=--max-old-space-size=4096 npx tsc -p tsconfig.gate.json --noEmit > /c/tmp/modelos-de-plano/web-tsc-baseline.txt 2>&1; rm -f tsconfig.gate.json; cd ../..
grep -c "error TS" /c/tmp/modelos-de-plano/api-tsc-baseline.txt /c/tmp/modelos-de-plano/web-tsc-baseline.txt
```

Expected: contagens não-zero (api na casa de ~278, web ~71). **Se alguma vier 0, foi OOM** — repetir; não seguir com baseline 0.

- [ ] **Step 2: Criar o schema**

`lib/db/src/schema/planTemplates.ts`:

```ts
import { pgTable, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Modelo de plano de ação (spec 2026-10-05-modelos-de-plano). Privado por
 * usuário, como task_templates. `payload` é um snapshot versionado
 * (`v: 1`) validado com Zod na aplicação — ver
 * artifacts/api-server/src/services/planTemplates/types.ts.
 */
export const planTemplates = pgTable("plan_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  payload: jsonb("payload").$type<unknown>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("idx_plan_templates_user").on(table.userId),
]);

export type PlanTemplate = typeof planTemplates.$inferSelect;
```

Em `lib/db/src/schema/index.ts`, adicionar ao fim:

```ts
export * from "./planTemplates";
```

- [ ] **Step 3: Criar a migration**

`lib/db/drizzle/0041_add_plan_templates.sql`:

```sql
-- Modelos de plano de ação (spec docs/superpowers/specs/2026-10-05-modelos-de-plano-design.md).
-- Snapshot JSON versionado por usuário; posições relativas ao canto superior
-- esquerdo do conjunto capturado.
-- Aditiva e idempotente. Dev: aplicar com pg direto (NÃO drizzle-kit push,
-- que dropa strategy_* de outra branch). Prod: mesmo SQL, antes do deploy do api.
CREATE TABLE IF NOT EXISTS "plan_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plan_templates_user" ON "plan_templates" ("user_id");
```

- [ ] **Step 4: Typecheck do `lib/db` e regenerar os `.d.ts`**

```bash
npx tsc -b lib/db
```

Expected: exit 0, sem saída. (Isto também atualiza `lib/db/dist/*.d.ts`, que o tsc do api-server usa — sem isso o api-server "não enxerga" `planTemplates`.)

- [ ] **Step 5: Aplicar a migration no dev DB (pg direto) e conferir**

De `lib/db` (Git Bash), com a URL do dev DB (ver Global Constraints):

```bash
cd lib/db && DATABASE_URL='<dev DB>' node -e "
const { Client } = require('pg'); const fs = require('fs');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
  const parts = fs.readFileSync('drizzle/0041_add_plan_templates.sql', 'utf8').split('--> statement-breakpoint');
  for (const p of parts) if (p.trim()) await c.query(p);
  const r = await c.query(\"select to_regclass('public.plan_templates') as t, (select count(*) from information_schema.tables where table_schema='public') as n\");
  console.log(r.rows[0]); await c.end();
})().catch(e => { console.error(e); process.exit(1); });
"; cd ../..
```

Expected: `{ t: 'plan_templates', n: '<número > 30>' }`. Se `n` vier muito baixo (0–5), o dev DB está no meio de um restore — **parar** e esperar (memória `bloquim_apiserver_test_run.md`, armadilha 1). Rodar duas vezes deve continuar OK (idempotente).

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/planTemplates.ts lib/db/src/schema/index.ts lib/db/drizzle/0041_add_plan_templates.sql
git commit -m "feat(db): tabela plan_templates (modelos de plano de ação)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `POST /api/task-templates/from-task`

**Files:**
- Modify: `artifacts/api-server/src/services/taskTemplatesService.ts`
- Modify: `artifacts/api-server/src/routes/taskTemplates.ts`
- Test: `artifacts/api-server/src/__tests__/taskTemplatesFromTask.smoke.test.ts`

**Interfaces:**
- Consumes: `tasks`, `subtasks`, `taskTemplates`, `taskTemplateSubtasks`, `workspaceMembers` de `@workspace/db/schema`.
- Produces: `createTemplateFromTask(userId: string, taskId: string): Promise<ServiceResponse>` — 201 `{ ...taskTemplateRow, subtasks: TaskTemplateSubtask[] }`; 404 `{ error: "Task not found" }`; 403 `{ error: "Forbidden" }`; 400 `{ error: "não é possível criar modelo a partir de uma tarefa de aprovação" }`. Rota `POST /api/task-templates/from-task` body `{ taskId: uuid }` (400 `{ error: "Validation error", message }` se inválido).

- [ ] **Step 1: Escrever o teste (falha)**

`artifacts/api-server/src/__tests__/taskTemplatesFromTask.smoke.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

describe("POST /api/task-templates/from-task", () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  afterAll(async () => {
    await deleteWorkspaces(workspaceIds);
    for (const id of userIds) await deleteUser(id);
  });

  it("cria modelo copiando título, descrição, prioridade e checklist; aplica regras de acesso", async () => {
    const { agent, user } = await registerAndLogin("Dono");
    userIds.push(user.id);
    const { agent: outsider, user: outsiderUser } = await registerAndLogin("Fora");
    userIds.push(outsiderUser.id);
    const { user: approver } = await registerAndLogin("Aprovador");
    userIds.push(approver.id);

    const ws = await agent.post("/api/workspaces").send({ name: "FromTask WS", colorIndex: 0 });
    expect(ws.status).toBe(201);
    const workspaceId = ws.body.id as string;
    workspaceIds.push(workspaceId);
    const inv = await agent
      .post(`/api/workspaces/${workspaceId}/members`)
      .send({ email: approver.email, role: "editor" });
    expect(inv.status).toBe(201);

    const map = await agent.post(`/api/workspaces/${workspaceId}/maps`).send({ name: "M" });
    const mapId = map.body.id as string;
    const card = await agent
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/cards`)
      .send({ title: "Publicar post", positionX: 0, positionY: 0 });
    expect(card.status).toBe(201);
    const taskId = card.body.taskId as string;

    const patch = await agent
      .patch(`/api/workspaces/${workspaceId}/tasks/${taskId}`)
      .send({ description: "texto da descrição", priority: "high" });
    expect(patch.status).toBe(200);
    const subs = await agent
      .put(`/api/workspaces/${workspaceId}/tasks/${taskId}/subtasks`)
      .send({
        subtasks: [
          { text: "rascunho", completed: true, order: 0 },
          { text: "revisão", completed: false, order: 1 },
        ],
      });
    expect(subs.status).toBe(200);

    // happy path
    const res = await agent.post("/api/task-templates/from-task").send({ taskId });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Publicar post");
    expect(res.body.title).toBe("Publicar post");
    expect(res.body.description).toBe("texto da descrição");
    expect(res.body.priority).toBe("high");
    expect(res.body.userId).toBe(user.id);
    const tplSubs = res.body.subtasks as Array<{ title: string; order: number }>;
    expect(tplSubs.map((s) => [s.title, s.order])).toEqual([
      ["rascunho", 0],
      ["revisão", 1],
    ]);

    // aparece na lista do usuário
    const list = await agent.get("/api/task-templates");
    expect((list.body as Array<{ id: string }>).some((t) => t.id === res.body.id)).toBe(true);

    // não-membro do workspace → 403
    const forbidden = await outsider.post("/api/task-templates/from-task").send({ taskId });
    expect(forbidden.status).toBe(403);

    // tarefa de aprovação → 400
    const ap = await agent
      .post(`/api/workspaces/${workspaceId}/tasks/${taskId}/approvals`)
      .send({ approverId: approver.id, dueDate: null });
    expect(ap.status).toBe(201);
    const approvalRes = await agent
      .post("/api/task-templates/from-task")
      .send({ taskId: ap.body.id as string });
    expect(approvalRes.status).toBe(400);

    // inexistente → 404; inválido → 400
    const missing = await agent.post("/api/task-templates/from-task").send({ taskId: randomUUID() });
    expect(missing.status).toBe(404);
    const invalid = await agent.post("/api/task-templates/from-task").send({ taskId: "x" });
    expect(invalid.status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd artifacts/api-server && DATABASE_URL='<dev DB>' JWT_SECRET='<jwt>' npx vitest run taskTemplatesFromTask
```

Expected: FAIL — o POST devolve 404 (`/from-task` ainda não existe; cai em nada) e a primeira asserção `expect(res.status).toBe(201)` quebra.

- [ ] **Step 3: Implementar o service**

Em `artifacts/api-server/src/services/taskTemplatesService.ts`:

1. Logo após `getOwnedTemplate`, adicionar o helper de acesso:

```ts
/**
 * Mesma regra do apply: membro do workspace da tarefa, ou responsável numa
 * tarefa standalone.
 */
async function userCanUseTask(
  userId: string,
  task: { workspaceId: string | null; assignedTo: string | null },
): Promise<boolean> {
  if (task.workspaceId) {
    const [m] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, task.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);
    return !!m;
  }
  return task.assignedTo === userId;
}
```

2. Em `applyTemplateToTask`, substituir o bloco de permissão (de `// Permission: user must be a member...` até o fim do `else { ... }`) por:

```ts
  if (!(await userCanUseTask(userId, task))) {
    return { status: 403, body: { error: "Forbidden" } };
  }
```

3. Adicionar ao fim do arquivo:

```ts
/**
 * Cria um modelo a partir de uma tarefa existente (campos persistidos).
 * name = title = título da tarefa; checklist vira subtasks do modelo
 * preservando `order`.
 */
export async function createTemplateFromTask(
  userId: string,
  taskId: string,
): Promise<ServiceResponse> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return { status: 404, body: { error: "Task not found" } };
  if (!(await userCanUseTask(userId, task))) {
    return { status: 403, body: { error: "Forbidden" } };
  }
  if (task.isApprovalTask) {
    return {
      status: 400,
      body: { error: "não é possível criar modelo a partir de uma tarefa de aprovação" },
    };
  }

  const items = await db
    .select({ text: subtasks.text, order: subtasks.order })
    .from(subtasks)
    .where(eq(subtasks.taskId, taskId))
    .orderBy(asc(subtasks.order), asc(subtasks.createdAt));

  const body = await db.transaction(async (tx) => {
    const [tpl] = await tx
      .insert(taskTemplates)
      .values({
        userId,
        name: task.title,
        title: task.title,
        description: task.description,
        priority: task.priority,
      })
      .returning();
    const subs =
      items.length === 0
        ? []
        : await tx
            .insert(taskTemplateSubtasks)
            .values(items.map((i) => ({ templateId: tpl.id, title: i.text, order: i.order })))
            .returning();
    subs.sort((a, b) => a.order - b.order);
    return { ...tpl, subtasks: subs };
  });

  return { status: 201, body };
}
```

Remover do import de `drizzle-orm` os símbolos que ficarem sem uso (`or`, `isNull` já não eram usados — deixar como estavam se o tsc não reclamar; não é escopo).

- [ ] **Step 4: Implementar a rota**

Em `artifacts/api-server/src/routes/taskTemplates.ts`:
- Adicionar `createTemplateFromTask` ao import do service.
- Adicionar o schema `const fromTaskSchema = z.object({ taskId: z.string().uuid() });` junto dos outros.
- Registrar a rota **antes** de `router.get("/:templateId", ...)`:

```ts
router.post("/from-task", requireAuth, async (req: AuthRequest, res) => {
  const parsed = fromTaskSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }
  const r = await createTemplateFromTask(req.user!.userId, parsed.data.taskId);
  res.status(r.status).json(r.body);
});
```

- [ ] **Step 5: Rodar e ver passar**

```bash
cd artifacts/api-server && DATABASE_URL='<dev DB>' JWT_SECRET='<jwt>' npx vitest run taskTemplatesFromTask
```

Expected: PASS (1 teste).

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/services/taskTemplatesService.ts artifacts/api-server/src/routes/taskTemplates.ts artifacts/api-server/src/__tests__/taskTemplatesFromTask.smoke.test.ts
git commit -m "feat(api): POST /api/task-templates/from-task cria modelo a partir da tarefa

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Payload v1 + funções puras de captura

**Files:**
- Create: `artifacts/api-server/src/services/planTemplates/types.ts`
- Create: `artifacts/api-server/src/services/planTemplates/capture.ts`
- Test: `artifacts/api-server/src/__tests__/planTemplatesCapture.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores (puro).
- Produces (usado nas Tasks 4 e 5):
  - `types.ts`: `PRIORITIES`, `type Priority`, `planTemplatePayloadV1Schema`, `type PlanTemplatePayloadV1`, `type PlanCounts = { cards; connections; texts; shapes }`, `payloadCounts(payload: unknown): PlanCounts`, `type CaptureCardRow`, `type CaptureConnectionRow`, `type CaptureTextRow`, `type CaptureShapeRow`, `type MapSnapshot`, `type Selection`, `type Skipped = { approvals: number; images: number }`.
  - `capture.ts`: `hasSelection(sel: Selection): boolean`; `selectElements(snapshot: MapSnapshot, sel: Selection): SelectedElements`; `remapConnections(snapshot: MapSnapshot, includedCardIds: Set<string>): RemappedConnection[]`; `normalizePositions(points: Array<{ positionX: number; positionY: number }>): { minX: number; minY: number }`; `buildPayload(selected: SelectedElements, connections: RemappedConnection[], offset: { minX: number; minY: number }): PlanTemplatePayloadV1`; `buildCapture(snapshot: MapSnapshot, sel: Selection): { payload: PlanTemplatePayloadV1; skipped: Skipped } | null` (null = conjunto vazio).

- [ ] **Step 1: Escrever `types.ts` (só tipos e Zod; sem lógica a testar além de `payloadCounts`)**

`artifacts/api-server/src/services/planTemplates/types.ts`:

```ts
import { z } from "zod/v4";

// ATENÇÃO: este módulo é importado por testes puros — não importar
// @workspace/db aqui (lança sem DATABASE_URL).

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type Priority = (typeof PRIORITIES)[number];

const checklistItemSchema = z.object({ text: z.string(), order: z.number().int() });

export const planTemplatePayloadV1Schema = z.object({
  v: z.literal(1),
  cards: z.array(
    z.object({
      key: z.string().min(1),
      x: z.number(),
      y: z.number(),
      title: z.string(),
      description: z.string().nullable(),
      task: z.object({
        priority: z.enum(PRIORITIES),
        checklist: z.array(checklistItemSchema),
      }),
    }),
  ),
  connections: z.array(
    z.object({
      sourceKey: z.string(),
      targetKey: z.string(),
      sourceHandle: z.string().nullable(),
      targetHandle: z.string().nullable(),
    }),
  ),
  texts: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      fontSize: z.number().int(),
      color: z.string(),
      content: z.string(),
    }),
  ),
  shapes: z.array(
    z.object({
      type: z.enum(["rect", "ellipse", "line"]),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      rotation: z.number(),
      color: z.string(),
      filled: z.boolean(),
      strokeStyle: z.enum(["solid", "dashed"]),
      x1: z.number().nullable(),
      y1: z.number().nullable(),
      x2: z.number().nullable(),
      y2: z.number().nullable(),
    }),
  ),
});

export type PlanTemplatePayloadV1 = z.infer<typeof planTemplatePayloadV1Schema>;

export type PlanCounts = { cards: number; connections: number; texts: number; shapes: number };

/** Contagens tolerantes: payload malformado conta 0, nunca lança. */
export function payloadCounts(payload: unknown): PlanCounts {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return {
    cards: len(p.cards),
    connections: len(p.connections),
    texts: len(p.texts),
    shapes: len(p.shapes),
  };
}

/** Linha de card do mapa com a tarefa (left join) e o checklist já ordenado. */
export type CaptureCardRow = {
  id: string;
  positionX: number;
  positionY: number;
  title: string;
  description: string | null;
  taskId: string | null;
  taskTitle: string | null;
  taskDescription: string | null;
  taskPriority: Priority | null;
  isApprovalTask: boolean;
  parentTaskId: string | null;
  checklist: Array<{ text: string; order: number }>;
};

export type CaptureConnectionRow = {
  sourceCardId: string;
  targetCardId: string;
  sourceHandle: string | null;
  targetHandle: string | null;
};

export type CaptureTextRow = {
  id: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  fontSize: number;
  color: string;
  content: string;
};

export type CaptureShapeRow = {
  id: string;
  type: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
  filled: boolean;
  strokeStyle: string;
  x1: number | null;
  y1: number | null;
  x2: number | null;
  y2: number | null;
};

export type MapSnapshot = {
  cards: CaptureCardRow[];
  connections: CaptureConnectionRow[];
  texts: CaptureTextRow[];
  shapes: CaptureShapeRow[];
};

/** Sem nenhum array = mapa inteiro. Com qualquer array = só os ids listados. */
export type Selection = {
  cardIds?: string[];
  textElementIds?: string[];
  shapeIds?: string[];
};

export type Skipped = { approvals: number; images: number };
```

- [ ] **Step 2: Escrever o teste da captura (falha)**

`artifacts/api-server/src/__tests__/planTemplatesCapture.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildCapture,
  buildPayload,
  normalizePositions,
  remapConnections,
  selectElements,
} from "../services/planTemplates/capture";
import {
  payloadCounts,
  planTemplatePayloadV1Schema,
  type CaptureCardRow,
  type CaptureConnectionRow,
  type CaptureShapeRow,
  type CaptureTextRow,
  type MapSnapshot,
} from "../services/planTemplates/types";

const card = (id: string, over: Partial<CaptureCardRow> = {}): CaptureCardRow => ({
  id,
  positionX: 0,
  positionY: 0,
  title: `card ${id}`,
  description: null,
  taskId: `t-${id}`,
  taskTitle: `task ${id}`,
  taskDescription: null,
  taskPriority: "medium",
  isApprovalTask: false,
  parentTaskId: null,
  checklist: [],
  ...over,
});
const approval = (id: string, parentCardId: string): CaptureCardRow =>
  card(id, { isApprovalTask: true, parentTaskId: `t-${parentCardId}`, taskTitle: "aprovação" });
const conn = (s: string, t: string, sh: string | null = "sh", th: string | null = "th"): CaptureConnectionRow => ({
  sourceCardId: s,
  targetCardId: t,
  sourceHandle: sh,
  targetHandle: th,
});
const text = (id: string, over: Partial<CaptureTextRow> = {}): CaptureTextRow => ({
  id, positionX: 0, positionY: 0, width: 200, height: 80, fontSize: 14, color: "#374151",
  content: '{"type":"doc","content":[{"type":"paragraph"}]}', ...over,
});
const shape = (id: string, over: Partial<CaptureShapeRow> = {}): CaptureShapeRow => ({
  id, type: "rect", positionX: 0, positionY: 0, width: 100, height: 50, rotation: 0, color: "#6366f1",
  filled: false, strokeStyle: "solid", x1: null, y1: null, x2: null, y2: null, ...over,
});
const snap = (over: Partial<MapSnapshot> = {}): MapSnapshot => ({
  cards: [], connections: [], texts: [], shapes: [], ...over,
});

describe("selectElements", () => {
  const s = snap({
    cards: [card("A"), card("B"), approval("AP", "A")],
    texts: [text("T1")],
    shapes: [shape("S1"), shape("IMG", { type: "image" })],
  });

  it("sem seleção pega tudo, exclui aprovações e imagens e conta", () => {
    const r = selectElements(s, {});
    expect(r.cards.map((c) => c.id)).toEqual(["A", "B"]);
    expect(r.texts.map((t) => t.id)).toEqual(["T1"]);
    expect(r.shapes.map((x) => x.id)).toEqual(["S1"]);
    expect(r.skipped).toEqual({ approvals: 1, images: 1 });
  });

  it("com seleção pega só os ids listados e ignora ids desconhecidos", () => {
    const r = selectElements(s, { cardIds: ["B", "AP", "ghost"], shapeIds: ["IMG"] });
    expect(r.cards.map((c) => c.id)).toEqual(["B"]);
    expect(r.texts).toEqual([]);
    expect(r.shapes).toEqual([]);
    expect(r.skipped).toEqual({ approvals: 1, images: 1 });
  });

  it("aprovação fora da seleção não conta", () => {
    const r = selectElements(s, { textElementIds: ["T1"] });
    expect(r.cards).toEqual([]);
    expect(r.texts.map((t) => t.id)).toEqual(["T1"]);
    expect(r.skipped).toEqual({ approvals: 0, images: 0 });
  });
});

describe("remapConnections", () => {
  it("sequencial: conexão que sai do último aprovador vira pai→destino com handles padrão", () => {
    const s = snap({
      cards: [card("A"), approval("AP1", "A"), approval("AP2", "A"), card("B")],
      connections: [conn("AP2", "B", "x", "y")],
    });
    expect(remapConnections(s, new Set(["A", "B"]))).toEqual([
      { sourceCardId: "A", targetCardId: "B", sourceHandle: "source-right", targetHandle: "target-left" },
    ]);
  });

  it("paralelo: conexão que sai do pai é mantida com os handles originais", () => {
    const s = snap({
      cards: [card("A"), approval("AP1", "A"), approval("AP2", "A"), card("B")],
      connections: [conn("A", "B", "source-bottom", "target-top")],
    });
    expect(remapConnections(s, new Set(["A", "B"]))).toEqual([
      { sourceCardId: "A", targetCardId: "B", sourceHandle: "source-bottom", targetHandle: "target-top" },
    ]);
  });

  it("conexão que chega numa aprovação é remapeada pro pai", () => {
    const s = snap({ cards: [card("X"), card("A"), approval("AP", "A")], connections: [conn("X", "AP")] });
    expect(remapConnections(s, new Set(["X", "A"]))).toEqual([
      { sourceCardId: "X", targetCardId: "A", sourceHandle: "source-right", targetHandle: "target-left" },
    ]);
  });

  it("pai fora do conjunto descarta a conexão", () => {
    const s = snap({ cards: [card("A"), approval("AP", "A"), card("B")], connections: [conn("AP", "B")] });
    expect(remapConnections(s, new Set(["B"]))).toEqual([]);
  });

  it("deduplica pares iguais depois do remapeamento (primeira vence)", () => {
    const s = snap({
      cards: [card("A"), approval("AP", "A"), card("B")],
      connections: [conn("A", "B", "orig-s", "orig-t"), conn("AP", "B")],
    });
    expect(remapConnections(s, new Set(["A", "B"]))).toEqual([
      { sourceCardId: "A", targetCardId: "B", sourceHandle: "orig-s", targetHandle: "orig-t" },
    ]);
  });

  it("descarta self-loop gerado pelo remapeamento", () => {
    const s = snap({ cards: [card("A"), approval("AP", "A")], connections: [conn("AP", "A")] });
    expect(remapConnections(s, new Set(["A"]))).toEqual([]);
  });

  it("descarta conexão com ponta fora do mapa", () => {
    const s = snap({ cards: [card("A")], connections: [conn("A", "ghost")] });
    expect(remapConnections(s, new Set(["A"]))).toEqual([]);
  });

  it("descarta aprovação cujo pai não tem card no mapa", () => {
    const s = snap({ cards: [card("B"), approval("AP", "NOPE")], connections: [conn("AP", "B")] });
    expect(remapConnections(s, new Set(["B"]))).toEqual([]);
  });
});

describe("normalizePositions", () => {
  it("mínimo sobre todos os pontos; vazio vira (0,0)", () => {
    expect(normalizePositions([{ positionX: 10, positionY: -5 }, { positionX: -30, positionY: 40 }])).toEqual({
      minX: -30,
      minY: -5,
    });
    expect(normalizePositions([])).toEqual({ minX: 0, minY: 0 });
  });
});

describe("buildPayload / buildCapture", () => {
  it("monta payload v1 válido com posições relativas, chaves e fallbacks", () => {
    const s = snap({
      cards: [
        card("A", {
          positionX: 100, positionY: 200, taskTitle: "Tarefa A", title: "card A",
          description: "desc do card", taskDescription: null, taskPriority: "high",
          checklist: [{ text: "um", order: 0 }, { text: "dois", order: 1 }],
        }),
        card("LEG", {
          positionX: 400, positionY: 260, taskId: null, taskTitle: null, taskPriority: null,
          title: "legado", description: "d",
        }),
      ],
      connections: [conn("A", "LEG")],
      texts: [text("T", { positionX: 50, positionY: 300 })],
      shapes: [shape("L", { type: "line", positionX: 90, positionY: 150, x1: 0, y1: 0, x2: 80, y2: 10 })],
    });
    const r = buildCapture(s, {});
    expect(r).not.toBeNull();
    const p = r!.payload;
    expect(planTemplatePayloadV1Schema.safeParse(p).success).toBe(true);
    expect(p.v).toBe(1);
    // minX = 50 (texto), minY = 150 (linha)
    expect(p.cards[0]).toEqual({
      key: "c1", x: 50, y: 50, title: "Tarefa A", description: "desc do card",
      task: { priority: "high", checklist: [{ text: "um", order: 0 }, { text: "dois", order: 1 }] },
    });
    expect(p.cards[1]).toMatchObject({
      key: "c2", x: 350, y: 110, title: "legado", description: "d",
      task: { priority: "medium", checklist: [] },
    });
    expect(p.connections).toEqual([{ sourceKey: "c1", targetKey: "c2", sourceHandle: "sh", targetHandle: "th" }]);
    expect(p.texts[0]).toMatchObject({ x: 0, y: 150, width: 200, height: 80 });
    expect(p.shapes[0]).toMatchObject({ type: "line", x: 40, y: 0, x1: 0, y1: 0, x2: 80, y2: 10 });
    expect(r!.skipped).toEqual({ approvals: 0, images: 0 });
    expect(payloadCounts(p)).toEqual({ cards: 2, connections: 1, texts: 1, shapes: 1 });
  });

  it("buildPayload usa o offset recebido", () => {
    const sel = selectElements(snap({ cards: [card("A", { positionX: 10, positionY: 20 })] }), {});
    const p = buildPayload(sel, [], { minX: 10, minY: 20 });
    expect(p.cards[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("conjunto vazio (só aprovação/imagem selecionada) devolve null", () => {
    const s = snap({ cards: [card("A"), approval("AP", "A")], shapes: [shape("IMG", { type: "image" })] });
    expect(buildCapture(s, { cardIds: ["AP"], shapeIds: ["IMG"] })).toBeNull();
    expect(buildCapture(snap(), {})).toBeNull();
  });

  it("forma com strokeStyle desconhecido vira solid", () => {
    const r = buildCapture(snap({ shapes: [shape("S", { strokeStyle: "dotted" })] }), {});
    expect(r!.payload.shapes[0].strokeStyle).toBe("solid");
  });
});

describe("payloadCounts", () => {
  it("é tolerante a payload malformado", () => {
    expect(payloadCounts(null)).toEqual({ cards: 0, connections: 0, texts: 0, shapes: 0 });
    expect(payloadCounts({ v: 2, cards: "x" })).toEqual({ cards: 0, connections: 0, texts: 0, shapes: 0 });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

```bash
cd artifacts/api-server && npx vitest run planTemplatesCapture
```

Expected: FAIL com `Failed to resolve import "../services/planTemplates/capture"` (o módulo ainda não existe). Este teste não precisa de `DATABASE_URL`.

- [ ] **Step 4: Implementar `capture.ts`**

`artifacts/api-server/src/services/planTemplates/capture.ts`:

```ts
// Funções puras da captura de modelo de plano (spec B2). Sem banco.
import type {
  CaptureCardRow,
  CaptureShapeRow,
  CaptureTextRow,
  MapSnapshot,
  PlanTemplatePayloadV1,
  Selection,
  Skipped,
} from "./types";

export type SelectedElements = {
  cards: CaptureCardRow[];
  texts: CaptureTextRow[];
  shapes: CaptureShapeRow[];
  skipped: Skipped;
};

export type RemappedConnection = {
  sourceCardId: string;
  targetCardId: string;
  sourceHandle: string | null;
  targetHandle: string | null;
};

const CAPTURABLE_SHAPES = new Set(["rect", "ellipse", "line"]);

export function hasSelection(sel: Selection): boolean {
  return sel.cardIds !== undefined || sel.textElementIds !== undefined || sel.shapeIds !== undefined;
}

export function selectElements(snapshot: MapSnapshot, sel: Selection): SelectedElements {
  const partial = hasSelection(sel);
  const pick = <T extends { id: string }>(rows: T[], ids: string[] | undefined): T[] => {
    if (!partial) return rows;
    if (!ids) return [];
    const wanted = new Set(ids);
    return rows.filter((r) => wanted.has(r.id));
  };

  const consideredCards = pick(snapshot.cards, sel.cardIds);
  const consideredShapes = pick(snapshot.shapes, sel.shapeIds);

  return {
    cards: consideredCards.filter((c) => !c.isApprovalTask),
    texts: pick(snapshot.texts, sel.textElementIds),
    shapes: consideredShapes.filter((s) => CAPTURABLE_SHAPES.has(s.type)),
    skipped: {
      approvals: consideredCards.filter((c) => c.isApprovalTask).length,
      images: consideredShapes.filter((s) => s.type === "image").length,
    },
  };
}

/**
 * D4: toda card_connection que toca um card de aprovação é remapeada pro card
 * pai da cadeia (resolvido com o mapa INTEIRO). Mantém só conexões cujas duas
 * pontas (pós-remapeamento) estão no conjunto, sem self-loop, deduplicadas por
 * par (a primeira ocorrência vence). Remapeada → handles source-right /
 * target-left; senão, os originais.
 */
export function remapConnections(
  snapshot: MapSnapshot,
  includedCardIds: Set<string>,
): RemappedConnection[] {
  const cardById = new Map(snapshot.cards.map((c) => [c.id, c]));
  const cardIdByTaskId = new Map<string, string>();
  for (const c of snapshot.cards) if (c.taskId) cardIdByTaskId.set(c.taskId, c.id);

  const resolve = (cardId: string): { id: string; remapped: boolean } | null => {
    const c = cardById.get(cardId);
    if (!c) return null;
    if (!c.isApprovalTask) return { id: c.id, remapped: false };
    const parentCardId = c.parentTaskId ? cardIdByTaskId.get(c.parentTaskId) : undefined;
    return parentCardId ? { id: parentCardId, remapped: true } : null;
  };

  const seen = new Set<string>();
  const out: RemappedConnection[] = [];
  for (const conn of snapshot.connections) {
    const s = resolve(conn.sourceCardId);
    const t = resolve(conn.targetCardId);
    if (!s || !t) continue;
    if (s.id === t.id) continue;
    if (!includedCardIds.has(s.id) || !includedCardIds.has(t.id)) continue;
    const pair = `${s.id}->${t.id}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const remapped = s.remapped || t.remapped;
    out.push({
      sourceCardId: s.id,
      targetCardId: t.id,
      sourceHandle: remapped ? "source-right" : conn.sourceHandle,
      targetHandle: remapped ? "target-left" : conn.targetHandle,
    });
  }
  return out;
}

export function normalizePositions(
  points: Array<{ positionX: number; positionY: number }>,
): { minX: number; minY: number } {
  if (points.length === 0) return { minX: 0, minY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  for (const p of points) {
    if (p.positionX < minX) minX = p.positionX;
    if (p.positionY < minY) minY = p.positionY;
  }
  return { minX, minY };
}

export function buildPayload(
  selected: SelectedElements,
  connections: RemappedConnection[],
  offset: { minX: number; minY: number },
): PlanTemplatePayloadV1 {
  const keyByCardId = new Map<string, string>();
  const cards = selected.cards.map((c, i) => {
    const key = `c${i + 1}`;
    keyByCardId.set(c.id, key);
    return {
      key,
      x: c.positionX - offset.minX,
      y: c.positionY - offset.minY,
      title: c.taskTitle ?? c.title,
      description: c.taskDescription ?? c.description,
      task: {
        priority: c.taskPriority ?? "medium",
        checklist: c.taskId ? c.checklist.map((i) => ({ text: i.text, order: i.order })) : [],
      },
    };
  });

  return {
    v: 1,
    cards,
    connections: connections.flatMap((cn) => {
      const sourceKey = keyByCardId.get(cn.sourceCardId);
      const targetKey = keyByCardId.get(cn.targetCardId);
      return sourceKey && targetKey
        ? [{ sourceKey, targetKey, sourceHandle: cn.sourceHandle, targetHandle: cn.targetHandle }]
        : [];
    }),
    texts: selected.texts.map((t) => ({
      x: t.positionX - offset.minX,
      y: t.positionY - offset.minY,
      width: t.width,
      height: t.height,
      fontSize: t.fontSize,
      color: t.color,
      content: t.content,
    })),
    shapes: selected.shapes.map((s) => ({
      type: s.type as "rect" | "ellipse" | "line",
      x: s.positionX - offset.minX,
      y: s.positionY - offset.minY,
      width: s.width,
      height: s.height,
      rotation: s.rotation,
      color: s.color,
      filled: s.filled,
      strokeStyle: s.strokeStyle === "dashed" ? ("dashed" as const) : ("solid" as const),
      x1: s.x1,
      y1: s.y1,
      x2: s.x2,
      y2: s.y2,
    })),
  };
}

export function buildCapture(
  snapshot: MapSnapshot,
  sel: Selection,
): { payload: PlanTemplatePayloadV1; skipped: Skipped } | null {
  const selected = selectElements(snapshot, sel);
  if (selected.cards.length + selected.texts.length + selected.shapes.length === 0) return null;
  const connections = remapConnections(snapshot, new Set(selected.cards.map((c) => c.id)));
  const offset = normalizePositions([...selected.cards, ...selected.texts, ...selected.shapes]);
  return { payload: buildPayload(selected, connections, offset), skipped: selected.skipped };
}
```

- [ ] **Step 5: Rodar e ver passar**

```bash
cd artifacts/api-server && npx vitest run planTemplatesCapture
```

Expected: PASS (todos os testes do arquivo).

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/services/planTemplates/types.ts artifacts/api-server/src/services/planTemplates/capture.ts artifacts/api-server/src/__tests__/planTemplatesCapture.test.ts
git commit -m "feat(api): payload v1 e funções puras de captura de modelo de plano

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Funções puras de aplicação (origem livre, AABB, bounds)

**Files:**
- Create: `artifacts/api-server/src/services/planTemplates/apply.ts`
- Test: `artifacts/api-server/src/__tests__/planTemplatesApply.test.ts`

**Interfaces:**
- Consumes: `NODE_WIDTH`, `NODE_HEIGHT`, `type Box` de `artifacts/api-server/src/lib/collision.ts`; `PlanTemplatePayloadV1` (Task 3).
- Produces (Task 5): `APPLY_GAP_X = 120`; `shapeAabb(s: { type: string; x: number; y: number; width: number; height: number; rotation: number }): Box`; `existingBoxes(rows: { cards: Array<{ positionX; positionY }>; texts: Array<{ positionX; positionY; width; height }>; shapes: Array<{ type; positionX; positionY; width; height; rotation }> }): Box[]`; `computeOrigin(boxes: Box[]): { x: number; y: number }`; `computeBounds(payload: PlanTemplatePayloadV1, origin: { x: number; y: number }): Box`.

- [ ] **Step 1: Escrever o teste (falha)**

`artifacts/api-server/src/__tests__/planTemplatesApply.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  APPLY_GAP_X,
  computeBounds,
  computeOrigin,
  existingBoxes,
  shapeAabb,
} from "../services/planTemplates/apply";
import { NODE_HEIGHT, NODE_WIDTH } from "../lib/collision";
import type { PlanTemplatePayloadV1 } from "../services/planTemplates/types";

const close = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
  expect(a.width).toBeCloseTo(b.width, 6);
  expect(a.height).toBeCloseTo(b.height, 6);
};

describe("shapeAabb", () => {
  it("sem rotação devolve a própria caixa", () => {
    expect(shapeAabb({ type: "rect", x: 10, y: 20, width: 200, height: 100, rotation: 0 })).toEqual({
      x: 10, y: 20, width: 200, height: 100,
    });
  });

  it("90° troca largura e altura em torno do centro", () => {
    close(shapeAabb({ type: "rect", x: 0, y: 0, width: 200, height: 100, rotation: 90 }), {
      x: 50, y: -50, width: 100, height: 200,
    });
  });

  it("45° num quadrado aumenta a caixa pra lado·√2", () => {
    const side = 100 * Math.SQRT2;
    close(shapeAabb({ type: "ellipse", x: 0, y: 0, width: 100, height: 100, rotation: 45 }), {
      x: 50 - side / 2, y: 50 - side / 2, width: side, height: side,
    });
  });

  it("linha usa position + width × height mesmo com rotação", () => {
    expect(shapeAabb({ type: "line", x: 5, y: 6, width: 80, height: 10, rotation: 30 })).toEqual({
      x: 5, y: 6, width: 80, height: 10,
    });
  });
});

describe("computeOrigin", () => {
  it("mapa vazio → (0,0)", () => {
    expect(computeOrigin([])).toEqual({ x: 0, y: 0 });
  });

  it("à direita da caixa envolvente, alinhada ao topo", () => {
    const boxes = existingBoxes({
      cards: [{ positionX: 0, positionY: 100 }, { positionX: 500, positionY: 300 }],
      texts: [],
      shapes: [],
    });
    expect(computeOrigin(boxes)).toEqual({ x: 500 + NODE_WIDTH + APPLY_GAP_X, y: 100 });
  });

  it("mistura de tipos: texto mais alto define o topo, forma rotacionada define a direita", () => {
    const boxes = existingBoxes({
      cards: [{ positionX: 0, positionY: 0 }],
      texts: [{ positionX: 100, positionY: -80, width: 200, height: 80 }],
      shapes: [{ type: "rect", positionX: 300, positionY: 0, width: 200, height: 100, rotation: 90 }],
    });
    // forma: centro (400,50), caixa rotacionada 100×200 → x 350..450, topo -50.
    // Texto em -80 é o topo; a forma define a direita (450).
    const o = computeOrigin(boxes);
    expect(o.x).toBeCloseTo(450 + APPLY_GAP_X, 6);
    expect(o.y).toBe(-80);
  });
});

describe("computeBounds", () => {
  it("caixa absoluta dos elementos criados (cards com caixa nominal)", () => {
    const payload: PlanTemplatePayloadV1 = {
      v: 1,
      cards: [
        { key: "c1", x: 0, y: 0, title: "a", description: null, task: { priority: "medium", checklist: [] } },
        { key: "c2", x: 400, y: 50, title: "b", description: null, task: { priority: "medium", checklist: [] } },
      ],
      connections: [],
      texts: [{ x: 100, y: 400, width: 200, height: 80, fontSize: 14, color: "#000", content: "{}" }],
      shapes: [],
    };
    expect(computeBounds(payload, { x: 1000, y: -20 })).toEqual({
      x: 1000,
      y: -20,
      width: 400 + NODE_WIDTH,
      height: Math.max(50 + NODE_HEIGHT, 480),
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd artifacts/api-server && npx vitest run planTemplatesApply
```

Expected: FAIL com `Failed to resolve import "../services/planTemplates/apply"`.

- [ ] **Step 3: Implementar `apply.ts`**

`artifacts/api-server/src/services/planTemplates/apply.ts`:

```ts
// Funções puras da aplicação de modelo de plano (spec B3). Sem banco.
import { NODE_HEIGHT, NODE_WIDTH, type Box } from "../../lib/collision";
import type { PlanTemplatePayloadV1 } from "./types";

/** D7: folga à direita da caixa envolvente do mapa. */
export const APPLY_GAP_X = 120;

/**
 * Caixa alinhada aos eixos de uma forma rotacionada (graus) em torno do
 * centro. Linhas usam position + width × height (x1..y2 são locais ao nó).
 */
export function shapeAabb(s: {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}): Box {
  if (s.type === "line" || !s.rotation) {
    return { x: s.x, y: s.y, width: s.width, height: s.height };
  }
  const theta = (s.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(theta));
  const sin = Math.abs(Math.sin(theta));
  const w = s.width * cos + s.height * sin;
  const h = s.width * sin + s.height * cos;
  const cx = s.x + s.width / 2;
  const cy = s.y + s.height / 2;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

export function existingBoxes(rows: {
  cards: Array<{ positionX: number; positionY: number }>;
  texts: Array<{ positionX: number; positionY: number; width: number; height: number }>;
  shapes: Array<{
    type: string;
    positionX: number;
    positionY: number;
    width: number;
    height: number;
    rotation: number;
  }>;
}): Box[] {
  return [
    ...rows.cards.map((c) => ({ x: c.positionX, y: c.positionY, width: NODE_WIDTH, height: NODE_HEIGHT })),
    ...rows.texts.map((t) => ({ x: t.positionX, y: t.positionY, width: t.width, height: t.height })),
    ...rows.shapes.map((s) =>
      shapeAabb({ type: s.type, x: s.positionX, y: s.positionY, width: s.width, height: s.height, rotation: s.rotation }),
    ),
  ];
}

/** D7: { maxRight + 120, minTop }; mapa sem elementos → (0,0). */
export function computeOrigin(boxes: Box[]): { x: number; y: number } {
  if (boxes.length === 0) return { x: 0, y: 0 };
  let maxRight = -Infinity;
  let minTop = Infinity;
  for (const b of boxes) {
    if (b.x + b.width > maxRight) maxRight = b.x + b.width;
    if (b.y < minTop) minTop = b.y;
  }
  return { x: maxRight + APPLY_GAP_X, y: minTop };
}

/**
 * Caixa absoluta dos elementos criados: começa na origem; largura/altura =
 * max(x_rel + w) / max(y_rel + h) sobre o payload (cards com a caixa nominal,
 * formas com shapeAabb).
 */
export function computeBounds(payload: PlanTemplatePayloadV1, origin: { x: number; y: number }): Box {
  const rel: Box[] = [
    ...payload.cards.map((c) => ({ x: c.x, y: c.y, width: NODE_WIDTH, height: NODE_HEIGHT })),
    ...payload.texts.map((t) => ({ x: t.x, y: t.y, width: t.width, height: t.height })),
    ...payload.shapes.map((s) => shapeAabb(s)),
  ];
  let width = 0;
  let height = 0;
  for (const b of rel) {
    width = Math.max(width, b.x + b.width);
    height = Math.max(height, b.y + b.height);
  }
  return { x: origin.x, y: origin.y, width, height };
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd artifacts/api-server && npx vitest run planTemplatesApply planTemplatesCapture collision
```

Expected: PASS nos três arquivos.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/services/planTemplates/apply.ts artifacts/api-server/src/__tests__/planTemplatesApply.test.ts
git commit -m "feat(api): funções puras de aplicação de modelo de plano (origem livre, AABB, bounds)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Service com banco + rotas de modelos de plano

**Files:**
- Create: `artifacts/api-server/src/services/planTemplates/service.ts`
- Create: `artifacts/api-server/src/routes/mapPlanTemplates.ts`
- Create: `artifacts/api-server/src/routes/planTemplates.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Test: `artifacts/api-server/src/__tests__/planTemplates.smoke.test.ts`

**Interfaces:**
- Consumes: `planTemplates` (Task 1); `buildCapture`, `hasSelection` (Task 3); `planTemplatePayloadV1Schema`, `payloadCounts`, `MapSnapshot`, `Selection` (Task 3); `computeOrigin`, `computeBounds`, `existingBoxes` (Task 4); `requireAuth`, `requireWorkspaceRole`, `requireMapInWorkspace`.
- Produces (contrato HTTP usado pelo front nas Tasks 7–8):
  - `POST /api/workspaces/:workspaceId/maps/:mapId/plan-templates/capture` body `{ cardIds?, textElementIds?, shapeIds? }` (uuid[]) → 201 `{ template: { id, name, counts: { cards, connections, texts, shapes }, createdAt }, skipped: { approvals, images } }`; 400 `{ error: "nada pra salvar no modelo" }`; 400 `{ error: "Validation error", message }`.
  - `POST /api/workspaces/:workspaceId/maps/:mapId/plan-templates/:templateId/apply` → 200 `{ cardIds, connectionIds, textElementIds, shapeIds, bounds: { x, y, width, height } }`; 404 (modelo inexistente, de outro usuário ou id não-UUID); 422 `{ error: "modelo em formato não suportado" }`; 403 executor; 500 com rollback.
  - `GET /api/plan-templates` → `[{ id, name, counts, createdAt, updatedAt }]` (sem `payload`), ordenado por `createdAt` asc.
  - `PATCH /api/plan-templates/:id` body `{ name }` → 200 `{ id, name, counts, createdAt, updatedAt }`; 400 nome vazio; 404.
  - `DELETE /api/plan-templates/:id` → 200 `{ success: true }`; 404.

- [ ] **Step 1: Escrever o smoke test (falha)**

`artifacts/api-server/src/__tests__/planTemplates.smoke.test.ts`:

```ts
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { Agent } from "supertest";
import { db } from "@workspace/db";
import {
  cards,
  cardConnections,
  mapShapes,
  mapTextElements,
  planTemplates,
  subtasks,
  taskActivities,
  tasks,
} from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";
import { NODE_WIDTH } from "../lib/collision";

type ApplyBody = {
  cardIds: string[];
  connectionIds: string[];
  textElementIds: string[];
  shapeIds: string[];
  bounds: { x: number; y: number; width: number; height: number };
};

async function mapCounts(mapId: string) {
  const cardRows = await db.select({ id: cards.id }).from(cards).where(eq(cards.mapId, mapId));
  const taskRows = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.mapId, mapId));
  const acts = taskRows.length
    ? await db.select({ id: taskActivities.id }).from(taskActivities).where(inArray(taskActivities.taskId, taskRows.map((t) => t.id)))
    : [];
  const conns = await db.select({ id: cardConnections.id }).from(cardConnections).where(eq(cardConnections.mapId, mapId));
  return { cards: cardRows.length, tasks: taskRows.length, activities: acts.length, connections: conns.length };
}

describe("modelos de plano de ação", () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  let admin: Agent;
  let adminId: string;
  let executor: Agent;
  let executorId: string;
  let workspaceId: string;
  let mapId: string;
  let mapName: string;
  let emptyMapId: string;
  let otherMapId: string; // mapa de OUTRO workspace
  let alphaCardId: string;
  let approvalCardId: string;
  let fullTemplateId: string;

  beforeAll(async () => {
    const a = await registerAndLogin("Admin");
    admin = a.agent; adminId = a.user.id; userIds.push(adminId);
    const e = await registerAndLogin("Executor");
    executor = e.agent; executorId = e.user.id; userIds.push(executorId);
    const ap = await registerAndLogin("Aprovador");
    userIds.push(ap.user.id);

    const ws = await admin.post("/api/workspaces").send({ name: "Plan Tpl WS", colorIndex: 0 });
    workspaceId = ws.body.id; workspaceIds.push(workspaceId);
    await admin.post(`/api/workspaces/${workspaceId}/members`).send({ email: e.user.email, role: "executor" });
    await admin.post(`/api/workspaces/${workspaceId}/members`).send({ email: ap.user.email, role: "editor" });

    mapName = "Lançamento";
    mapId = (await admin.post(`/api/workspaces/${workspaceId}/maps`).send({ name: mapName })).body.id;
    emptyMapId = (await admin.post(`/api/workspaces/${workspaceId}/maps`).send({ name: "Vazio" })).body.id;

    const ws2 = await ap.agent.post("/api/workspaces").send({ name: "Outro WS", colorIndex: 1 });
    workspaceIds.push(ws2.body.id);
    otherMapId = (await ap.agent.post(`/api/workspaces/${ws2.body.id}/maps`).send({ name: "Outro" })).body.id;

    const base = `/api/workspaces/${workspaceId}/maps/${mapId}`;
    const alpha = await admin.post(`${base}/cards`).send({ title: "alpha", positionX: 0, positionY: 0 });
    const beta = await admin.post(`${base}/cards`).send({ title: "beta", positionX: 600, positionY: 0 });
    alphaCardId = alpha.body.id;
    const alphaTask = alpha.body.taskId as string;
    await admin.patch(`/api/workspaces/${workspaceId}/tasks/${alphaTask}`).send({ description: "desc a", priority: "high" });
    await admin.put(`/api/workspaces/${workspaceId}/tasks/${alphaTask}/subtasks`).send({
      subtasks: [
        { text: "um", completed: true, order: 0 },
        { text: "dois", completed: false, order: 1 },
      ],
    });
    // card legado sem tarefa
    const [legacy] = await db
      .insert(cards)
      .values({ mapId, title: "gamma", positionX: 1200, positionY: 0, statusVisual: "no_task" })
      .returning();
    await admin.post(`${base}/connections`).send({
      sourceCardId: alpha.body.id, targetCardId: beta.body.id, sourceHandle: "source-right", targetHandle: "target-left",
    });
    // aprovação em beta; conexão aprovação → gamma (deve virar beta → gamma)
    const apRes = await admin
      .post(`/api/workspaces/${workspaceId}/tasks/${beta.body.taskId}/approvals`)
      .send({ approverId: ap.user.id, dueDate: null });
    expect(apRes.status).toBe(201);
    const [apCard] = await db.select({ id: cards.id }).from(cards).where(eq(cards.taskId, apRes.body.id));
    approvalCardId = apCard.id;
    await db.insert(cardConnections).values({
      mapId, sourceCardId: approvalCardId, targetCardId: legacy.id, sourceHandle: "source-right", targetHandle: "target-left",
    }).onConflictDoNothing();
    await admin.post(`${base}/text-elements`).send({ positionX: -100, positionY: 500, content: '{"type":"doc","content":[{"type":"paragraph"}]}' });
    await admin.post(`${base}/shapes`).send({ type: "rect", positionX: 300, positionY: 500, width: 100, height: 50 });
    await db.insert(mapShapes).values({ mapId, type: "image", positionX: 0, positionY: 900, width: 100, height: 100 });
  });

  afterAll(async () => {
    await deleteWorkspaces(workspaceIds);
    for (const id of userIds) await deleteUser(id); // plan_templates cai em cascade
  });

  it("captura o mapa inteiro (aprovação remapeada pro pai, imagem fora)", async () => {
    const res = await admin.post(`/api/workspaces/${workspaceId}/maps/${mapId}/plan-templates/capture`).send({});
    expect(res.status).toBe(201);
    expect(res.body.template.name).toBe(mapName);
    expect(res.body.template.counts).toEqual({ cards: 3, connections: 2, texts: 1, shapes: 1 });
    expect(res.body.skipped).toEqual({ approvals: 1, images: 1 });
    fullTemplateId = res.body.template.id;

    const [row] = await db.select().from(planTemplates).where(eq(planTemplates.id, fullTemplateId));
    expect(row.userId).toBe(adminId);
    const p = row.payload as {
      cards: Array<{ key: string; x: number; y: number; title: string; task: { priority: string; checklist: unknown[] } }>;
      connections: Array<{ sourceKey: string; targetKey: string; sourceHandle: string | null }>;
      texts: Array<{ x: number; y: number }>;
      shapes: Array<{ x: number; y: number }>;
    };
    const xs = [...p.cards, ...p.texts, ...p.shapes].map((e) => e.x);
    const ys = [...p.cards, ...p.texts, ...p.shapes].map((e) => e.y);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.min(...ys)).toBe(0);
    const byTitle = new Map(p.cards.map((c) => [c.title, c]));
    expect(byTitle.get("alpha")!.task.priority).toBe("high");
    expect(byTitle.get("alpha")!.task.checklist).toHaveLength(2);
    expect(byTitle.get("gamma")!.task).toEqual({ priority: "medium", checklist: [] });
    const keyOf = (t: string) => byTitle.get(t)!.key;
    const pairs = p.connections.map((c) => `${c.sourceKey}->${c.targetKey}`).sort();
    expect(pairs).toEqual([`${keyOf("alpha")}->${keyOf("beta")}`, `${keyOf("beta")}->${keyOf("gamma")}`].sort());
  });

  it("corpo ausente equivale a {} (mapa inteiro)", async () => {
    const res = await admin.post(`/api/workspaces/${workspaceId}/maps/${mapId}/plan-templates/capture`);
    expect(res.status).toBe(201);
    expect(res.body.template.counts.cards).toBe(3);
  });

  it("captura subconjunto e conta a aprovação selecionada; executor pode capturar", async () => {
    const res = await executor
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/plan-templates/capture`)
      .send({ cardIds: [alphaCardId, approvalCardId], textElementIds: [] });
    expect(res.status).toBe(201);
    expect(res.body.template.name).toBe(`${mapName} (seleção)`);
    expect(res.body.template.counts).toEqual({ cards: 1, connections: 0, texts: 0, shapes: 0 });
    expect(res.body.skipped).toEqual({ approvals: 1, images: 0 });
  });

  it("seleção só com aprovação → 400 com mensagem exibível", async () => {
    const res = await admin
      .post(`/api/workspaces/${workspaceId}/maps/${mapId}/plan-templates/capture`)
      .send({ cardIds: [approvalCardId] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("nada pra salvar no modelo");
  });

  it("aplica em mapa vazio na origem, com tarefas draft do caller, checklist e activities", async () => {
    const res = await admin.post(`/api/workspaces/${workspaceId}/maps/${emptyMapId}/plan-templates/${fullTemplateId}/apply`);
    expect(res.status).toBe(200);
    const body = res.body as ApplyBody;
    expect(body.cardIds).toHaveLength(3);
    expect(body.connectionIds).toHaveLength(2);
    expect(body.textElementIds).toHaveLength(1);
    expect(body.shapeIds).toHaveLength(1);
    expect(body.bounds.x).toBe(0);
    expect(body.bounds.y).toBe(0);

    const newCards = await db.select().from(cards).where(inArray(cards.id, body.cardIds));
    expect(newCards.every((c) => c.mapId === emptyMapId && c.statusVisual === "draft" && !!c.taskId)).toBe(true);
    const newTasks = await db.select().from(tasks).where(inArray(tasks.id, newCards.map((c) => c.taskId!)));
    for (const t of newTasks) {
      expect(t.status).toBe("draft");
      expect(t.scheduleMode).toBe("sem_prazo");
      expect(t.assignedTo).toBe(adminId);
      expect(t.ownerId).toBe(adminId);
      expect(t.createdBy).toBe(adminId);
      expect(t.workspaceId).toBe(workspaceId);
      expect(t.mapId).toBe(emptyMapId);
    }
    const alphaTask = newTasks.find((t) => t.title === "alpha")!;
    expect(alphaTask.priority).toBe("high");
    expect(alphaTask.description).toBe("desc a");
    const items = await db.select().from(subtasks).where(eq(subtasks.taskId, alphaTask.id));
    expect(items.map((i) => [i.text, i.completed, i.order]).sort()).toEqual([["dois", false, 1], ["um", false, 0]]);
    const acts = await db
      .select()
      .from(taskActivities)
      .where(and(inArray(taskActivities.taskId, newTasks.map((t) => t.id)), eq(taskActivities.type, "task_created")));
    expect(acts).toHaveLength(3);
    expect(acts.every((a) => a.actorId === adminId && a.metadata.actorName === "Admin")).toBe(true);

    const conns = await db.select().from(cardConnections).where(inArray(cardConnections.id, body.connectionIds));
    const ids = new Set(body.cardIds);
    expect(conns.every((c) => ids.has(c.sourceCardId) && ids.has(c.targetCardId))).toBe(true);
    expect(Math.min(...newCards.map((c) => c.positionX))).toBeGreaterThanOrEqual(0);
  });

  it("aplica num mapa com elementos à direita de tudo (maxRight + 120)", async () => {
    const before = {
      cards: await db.select().from(cards).where(eq(cards.mapId, mapId)),
      texts: await db.select().from(mapTextElements).where(eq(mapTextElements.mapId, mapId)),
      shapes: await db.select().from(mapShapes).where(eq(mapShapes.mapId, mapId)),
    };
    const maxRight = Math.max(
      ...before.cards.map((c) => c.positionX + NODE_WIDTH),
      ...before.texts.map((t) => t.positionX + t.width),
      ...before.shapes.map((s) => s.positionX + s.width), // rotação 0 em todas
    );
    const res = await admin.post(`/api/workspaces/${workspaceId}/maps/${mapId}/plan-templates/${fullTemplateId}/apply`);
    expect(res.status).toBe(200);
    const body = res.body as ApplyBody;
    expect(body.bounds.x).toBeCloseTo(maxRight + 120, 6);
    const newCards = await db.select().from(cards).where(inArray(cards.id, body.cardIds));
    const newTexts = await db.select().from(mapTextElements).where(inArray(mapTextElements.id, body.textElementIds));
    const newShapes = await db.select().from(mapShapes).where(inArray(mapShapes.id, body.shapeIds));
    for (const x of [...newCards, ...newTexts, ...newShapes].map((e) => e.positionX)) {
      expect(x).toBeGreaterThanOrEqual(maxRight + 120 - 1e-6);
    }
  });

  it("dois applies simultâneos no mesmo mapa não se sobrepõem (lock por mapa)", async () => {
    const lockMapId = (await admin.post(`/api/workspaces/${workspaceId}/maps`).send({ name: "Lock" })).body.id;
    const url = `/api/workspaces/${workspaceId}/maps/${lockMapId}/plan-templates/${fullTemplateId}/apply`;
    const [r1, r2] = await Promise.all([admin.post(url), admin.post(url)]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const [first, second] = [r1.body as ApplyBody, r2.body as ApplyBody].sort((a, b) => a.bounds.x - b.bounds.x);
    expect(second.bounds.x).toBeGreaterThanOrEqual(first.bounds.x + first.bounds.width + 120 - 1e-6);
  });

  it("rollback: payload com conexão duplicada falha e não deixa nada no mapa", async () => {
    const [bad] = await db
      .insert(planTemplates)
      .values({
        userId: adminId,
        name: "ruim",
        payload: {
          v: 1,
          cards: [
            { key: "c1", x: 0, y: 0, title: "x", description: null, task: { priority: "low", checklist: [] } },
            { key: "c2", x: 300, y: 0, title: "y", description: null, task: { priority: "low", checklist: [] } },
          ],
          connections: [
            { sourceKey: "c1", targetKey: "c2", sourceHandle: null, targetHandle: null },
            { sourceKey: "c1", targetKey: "c2", sourceHandle: null, targetHandle: null },
          ],
          texts: [],
          shapes: [],
        },
      })
      .returning();
    const before = await mapCounts(mapId);
    const res = await admin.post(`/api/workspaces/${workspaceId}/maps/${mapId}/plan-templates/${bad.id}/apply`);
    expect(res.status).toBe(500);
    expect(await mapCounts(mapId)).toEqual(before);
  });

  it("payload fora do schema v1 → 422", async () => {
    const [v2] = await db.insert(planTemplates).values({ userId: adminId, name: "v2", payload: { v: 2 } }).returning();
    const res = await admin.post(`/api/workspaces/${workspaceId}/maps/${emptyMapId}/plan-templates/${v2.id}/apply`);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("modelo em formato não suportado");
  });

  it("permissões e ids: executor 403, modelo alheio 404, id não-UUID 404, mapa de outro workspace 404", async () => {
    const execApply = await executor.post(`/api/workspaces/${workspaceId}/maps/${emptyMapId}/plan-templates/${fullTemplateId}/apply`);
    expect(execApply.status).toBe(403);

    const [execTpl] = await db.select({ id: planTemplates.id }).from(planTemplates).where(eq(planTemplates.userId, executorId));
    const foreign = await admin.post(`/api/workspaces/${workspaceId}/maps/${emptyMapId}/plan-templates/${execTpl.id}/apply`);
    expect(foreign.status).toBe(404);

    const notUuid = await admin.post(`/api/workspaces/${workspaceId}/maps/${emptyMapId}/plan-templates/not-a-uuid/apply`);
    expect(notUuid.status).toBe(404);

    const otherMap = await admin.post(`/api/workspaces/${workspaceId}/maps/${otherMapId}/plan-templates/${fullTemplateId}/apply`);
    expect(otherMap.status).toBe(404);
  });

  it("gestão: lista sem payload, renomeia, exclui; escopo do dono", async () => {
    const list = await admin.get("/api/plan-templates");
    expect(list.status).toBe(200);
    const item = (list.body as Array<Record<string, unknown>>).find((t) => t.id === fullTemplateId)!;
    expect(item).toBeDefined();
    expect(item.payload).toBeUndefined();
    expect(item.counts).toEqual({ cards: 3, connections: 2, texts: 1, shapes: 1 });
    expect((await executor.get("/api/plan-templates")).body.some((t: { id: string }) => t.id === fullTemplateId)).toBe(false);

    const renamed = await admin.patch(`/api/plan-templates/${fullTemplateId}`).send({ name: "Lançamento padrão" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Lançamento padrão");
    expect(renamed.body.counts.cards).toBe(3);
    expect((await admin.patch(`/api/plan-templates/${fullTemplateId}`).send({ name: "  " })).status).toBe(400);
    expect((await executor.patch(`/api/plan-templates/${fullTemplateId}`).send({ name: "x" })).status).toBe(404);
    expect((await admin.patch("/api/plan-templates/not-a-uuid").send({ name: "x" })).status).toBe(404);

    expect((await executor.delete(`/api/plan-templates/${fullTemplateId}`)).status).toBe(404);
    expect((await admin.delete(`/api/plan-templates/${fullTemplateId}`)).status).toBe(200);
    expect((await admin.get("/api/plan-templates")).body.some((t: { id: string }) => t.id === fullTemplateId)).toBe(false);
  });
});
```

Nota pro implementador: a ordem dos `it` importa (o último exclui `fullTemplateId`); a suíte roda com `singleFork` e sequencial, então isso é estável.

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd artifacts/api-server && DATABASE_URL='<dev DB>' JWT_SECRET='<jwt>' npx vitest run planTemplates.smoke
```

Expected: FAIL — o primeiro `capture` devolve 404 (rota não montada).

- [ ] **Step 3: Implementar o service**

`artifacts/api-server/src/services/planTemplates/service.ts`:

```ts
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  cards,
  cardConnections,
  mapShapes,
  mapTextElements,
  maps,
  planTemplates,
  subtasks,
  taskActivities,
  tasks,
} from "@workspace/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { buildCapture, hasSelection } from "./capture";
import { computeBounds, computeOrigin, existingBoxes } from "./apply";
import { payloadCounts, planTemplatePayloadV1Schema, type MapSnapshot, type Selection } from "./types";

export interface ServiceResponse<T = unknown> {
  status: number;
  body: T;
}

async function loadSnapshot(mapId: string): Promise<MapSnapshot> {
  const cardRows = await db
    .select({
      id: cards.id,
      positionX: cards.positionX,
      positionY: cards.positionY,
      title: cards.title,
      description: cards.description,
      taskId: cards.taskId,
      taskTitle: tasks.title,
      taskDescription: tasks.description,
      taskPriority: tasks.priority,
      isApprovalTask: tasks.isApprovalTask,
      parentTaskId: tasks.parentTaskId,
    })
    .from(cards)
    .leftJoin(tasks, eq(tasks.id, cards.taskId))
    .where(eq(cards.mapId, mapId));

  const taskIds = cardRows.map((c) => c.taskId).filter((id): id is string => !!id);
  const checklistRows =
    taskIds.length === 0
      ? []
      : await db
          .select({ taskId: subtasks.taskId, text: subtasks.text, order: subtasks.order })
          .from(subtasks)
          .where(inArray(subtasks.taskId, taskIds))
          .orderBy(asc(subtasks.order), asc(subtasks.createdAt));
  const checklistByTask = new Map<string, Array<{ text: string; order: number }>>();
  for (const r of checklistRows) {
    const list = checklistByTask.get(r.taskId) ?? [];
    list.push({ text: r.text, order: r.order });
    checklistByTask.set(r.taskId, list);
  }

  const connections = await db
    .select({
      sourceCardId: cardConnections.sourceCardId,
      targetCardId: cardConnections.targetCardId,
      sourceHandle: cardConnections.sourceHandle,
      targetHandle: cardConnections.targetHandle,
    })
    .from(cardConnections)
    .where(eq(cardConnections.mapId, mapId));

  const texts = await db
    .select({
      id: mapTextElements.id,
      positionX: mapTextElements.positionX,
      positionY: mapTextElements.positionY,
      width: mapTextElements.width,
      height: mapTextElements.height,
      fontSize: mapTextElements.fontSize,
      color: mapTextElements.color,
      content: mapTextElements.content,
    })
    .from(mapTextElements)
    .where(eq(mapTextElements.mapId, mapId));

  const shapes = await db
    .select({
      id: mapShapes.id,
      type: mapShapes.type,
      positionX: mapShapes.positionX,
      positionY: mapShapes.positionY,
      width: mapShapes.width,
      height: mapShapes.height,
      rotation: mapShapes.rotation,
      color: mapShapes.color,
      filled: mapShapes.filled,
      strokeStyle: mapShapes.strokeStyle,
      x1: mapShapes.x1,
      y1: mapShapes.y1,
      x2: mapShapes.x2,
      y2: mapShapes.y2,
    })
    .from(mapShapes)
    .where(eq(mapShapes.mapId, mapId));

  return {
    cards: cardRows.map((c) => ({
      ...c,
      isApprovalTask: c.isApprovalTask ?? false,
      checklist: c.taskId ? checklistByTask.get(c.taskId) ?? [] : [],
    })),
    connections,
    texts,
    shapes,
  };
}

export async function captureFromMap(args: {
  userId: string;
  mapId: string;
  selection: Selection;
}): Promise<ServiceResponse> {
  const [map] = await db.select({ name: maps.name }).from(maps).where(eq(maps.id, args.mapId)).limit(1);
  if (!map) return { status: 404, body: { error: "Not found" } };

  const result = buildCapture(await loadSnapshot(args.mapId), args.selection);
  if (!result) return { status: 400, body: { error: "nada pra salvar no modelo" } };

  const name = hasSelection(args.selection) ? `${map.name} (seleção)` : map.name;
  const [row] = await db
    .insert(planTemplates)
    .values({ userId: args.userId, name, payload: result.payload })
    .returning();
  return {
    status: 201,
    body: {
      template: { id: row.id, name: row.name, counts: payloadCounts(row.payload), createdAt: row.createdAt },
      skipped: result.skipped,
    },
  };
}

export async function applyToMap(args: {
  userId: string;
  actorName: string | null;
  source: string | null;
  templateId: string;
  mapId: string;
  workspaceId: string;
}): Promise<ServiceResponse> {
  const { userId, mapId, workspaceId } = args;
  const [tpl] = await db
    .select()
    .from(planTemplates)
    .where(and(eq(planTemplates.id, args.templateId), eq(planTemplates.userId, userId)))
    .limit(1);
  if (!tpl) return { status: 404, body: { error: "Not found" } };

  const parsed = planTemplatePayloadV1Schema.safeParse(tpl.payload);
  if (!parsed.success) return { status: 422, body: { error: "modelo em formato não suportado" } };
  const payload = parsed.data;

  // Mesmo shape que recordTaskActivity produz (que usa o db global e por isso
  // não serve dentro da transação).
  const metadata: Record<string, string | null> = { actorName: args.actorName };
  if (args.source) metadata.source = args.source;

  const body = await db.transaction(async (tx) => {
    // D6: serializa applies no mesmo mapa antes de ler as caixas.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${mapId}::text))`);

    const cardRows = await tx
      .select({ positionX: cards.positionX, positionY: cards.positionY })
      .from(cards)
      .where(eq(cards.mapId, mapId));
    const textRows = await tx
      .select({
        positionX: mapTextElements.positionX,
        positionY: mapTextElements.positionY,
        width: mapTextElements.width,
        height: mapTextElements.height,
      })
      .from(mapTextElements)
      .where(eq(mapTextElements.mapId, mapId));
    const shapeRows = await tx
      .select({
        type: mapShapes.type,
        positionX: mapShapes.positionX,
        positionY: mapShapes.positionY,
        width: mapShapes.width,
        height: mapShapes.height,
        rotation: mapShapes.rotation,
      })
      .from(mapShapes)
      .where(eq(mapShapes.mapId, mapId));

    const origin = computeOrigin(existingBoxes({ cards: cardRows, texts: textRows, shapes: shapeRows }));

    // Ids gerados aqui pra inserir em lote (poucos round-trips dentro da transação).
    const keyToCardId = new Map<string, string>();
    const taskValues: Array<typeof tasks.$inferInsert> = [];
    const cardValues: Array<typeof cards.$inferInsert & { id: string }> = [];
    const checklistValues: Array<typeof subtasks.$inferInsert> = [];
    const activityValues: Array<typeof taskActivities.$inferInsert> = [];
    for (const c of payload.cards) {
      const taskId = randomUUID();
      const cardId = randomUUID();
      keyToCardId.set(c.key, cardId);
      taskValues.push({
        id: taskId,
        title: c.title,
        description: c.description,
        priority: c.task.priority,
        status: "draft",
        scheduleMode: "sem_prazo",
        mapId,
        workspaceId,
        assignedTo: userId,
        ownerId: userId,
        createdBy: userId,
      });
      cardValues.push({
        id: cardId,
        mapId,
        title: c.title,
        description: c.description,
        positionX: origin.x + c.x,
        positionY: origin.y + c.y,
        statusVisual: "draft",
        taskId,
      });
      for (const item of c.task.checklist) {
        checklistValues.push({ taskId, text: item.text, completed: false, order: item.order });
      }
      activityValues.push({ taskId, actorId: userId, type: "task_created", metadata });
    }
    if (taskValues.length) await tx.insert(tasks).values(taskValues);
    if (cardValues.length) await tx.insert(cards).values(cardValues);
    if (checklistValues.length) await tx.insert(subtasks).values(checklistValues);
    if (activityValues.length) await tx.insert(taskActivities).values(activityValues);

    // Sem dedupe: par duplicado viola a unique e derruba a transação (a captura já deduplica).
    const connectionValues = payload.connections.flatMap((cn) => {
      const sourceCardId = keyToCardId.get(cn.sourceKey);
      const targetCardId = keyToCardId.get(cn.targetKey);
      return sourceCardId && targetCardId
        ? [{ id: randomUUID(), mapId, sourceCardId, targetCardId, sourceHandle: cn.sourceHandle, targetHandle: cn.targetHandle }]
        : [];
    });
    if (connectionValues.length) await tx.insert(cardConnections).values(connectionValues);

    const textValues = payload.texts.map((t) => ({
      id: randomUUID(),
      mapId,
      positionX: origin.x + t.x,
      positionY: origin.y + t.y,
      width: t.width,
      height: t.height,
      fontSize: t.fontSize,
      color: t.color,
      content: t.content,
    }));
    if (textValues.length) await tx.insert(mapTextElements).values(textValues);

    const shapeValues = payload.shapes.map((s) => ({
      id: randomUUID(),
      mapId,
      type: s.type,
      positionX: origin.x + s.x,
      positionY: origin.y + s.y,
      width: s.width,
      height: s.height,
      rotation: s.rotation,
      color: s.color,
      filled: s.filled,
      strokeStyle: s.strokeStyle,
      x1: s.x1,
      y1: s.y1,
      x2: s.x2,
      y2: s.y2,
    }));
    if (shapeValues.length) await tx.insert(mapShapes).values(shapeValues);

    return {
      cardIds: cardValues.map((c) => c.id),
      connectionIds: connectionValues.map((c) => c.id),
      textElementIds: textValues.map((t) => t.id),
      shapeIds: shapeValues.map((s) => s.id),
      bounds: computeBounds(payload, origin),
    };
  });

  return { status: 200, body };
}

function toListItem(r: { id: string; name: string; payload: unknown; createdAt: Date; updatedAt: Date }) {
  return { id: r.id, name: r.name, counts: payloadCounts(r.payload), createdAt: r.createdAt, updatedAt: r.updatedAt };
}

export async function listPlanTemplates(userId: string): Promise<ServiceResponse> {
  const rows = await db
    .select()
    .from(planTemplates)
    .where(eq(planTemplates.userId, userId))
    .orderBy(asc(planTemplates.createdAt));
  return { status: 200, body: rows.map(toListItem) };
}

export async function renamePlanTemplate(userId: string, id: string, name: string): Promise<ServiceResponse> {
  const [row] = await db
    .update(planTemplates)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(planTemplates.id, id), eq(planTemplates.userId, userId)))
    .returning();
  if (!row) return { status: 404, body: { error: "Not found" } };
  return { status: 200, body: toListItem(row) };
}

export async function deletePlanTemplate(userId: string, id: string): Promise<ServiceResponse> {
  const [row] = await db
    .delete(planTemplates)
    .where(and(eq(planTemplates.id, id), eq(planTemplates.userId, userId)))
    .returning({ id: planTemplates.id });
  if (!row) return { status: 404, body: { error: "Not found" } };
  return { status: 200, body: { success: true } };
}
```

- [ ] **Step 4: Implementar as rotas**

`artifacts/api-server/src/routes/mapPlanTemplates.ts`:

```ts
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { requireMapInWorkspace, requireWorkspaceRole } from "../middlewares/permissions";
import { applyToMap, captureFromMap } from "../services/planTemplates/service";

// Montado em /api/workspaces/:workspaceId/maps/:mapId/plan-templates.
const router: IRouter = Router({ mergeParams: true });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const captureSchema = z.object({
  cardIds: z.array(z.string().uuid()).optional(),
  textElementIds: z.array(z.string().uuid()).optional(),
  shapeIds: z.array(z.string().uuid()).optional(),
});

router.post(
  "/capture",
  requireAuth,
  requireWorkspaceRole(["admin", "editor", "executor"]),
  requireMapInWorkspace,
  async (req: AuthRequest, res) => {
    // Express 5 deixa req.body undefined sem corpo: equivale a {} (mapa inteiro).
    const parsed = captureSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", message: parsed.error.message });
      return;
    }
    const r = await captureFromMap({
      userId: req.user!.userId,
      mapId: req.params.mapId as string,
      selection: parsed.data,
    });
    res.status(r.status).json(r.body);
  },
);

router.post(
  "/:templateId/apply",
  requireAuth,
  requireWorkspaceRole(["admin", "editor"]),
  requireMapInWorkspace,
  async (req: AuthRequest, res) => {
    const templateId = req.params.templateId as string;
    if (!UUID_RE.test(templateId)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const userId = req.user!.userId;
    const [actor] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    const r = await applyToMap({
      userId,
      actorName: actor?.name ?? null,
      source: req.user?.source ?? null,
      templateId,
      mapId: req.params.mapId as string,
      workspaceId: req.params.workspaceId as string,
    });
    res.status(r.status).json(r.body);
  },
);

export default router;
```

`artifacts/api-server/src/routes/planTemplates.ts`:

```ts
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import {
  deletePlanTemplate,
  listPlanTemplates,
  renamePlanTemplate,
} from "../services/planTemplates/service";

// Montado em /api/plan-templates. Escopo: modelos do próprio usuário.
const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const renameSchema = z.object({ name: z.string().trim().min(1) });

router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const r = await listPlanTemplates(req.user!.userId);
  res.status(r.status).json(r.body);
});

router.patch("/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = renameSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", message: parsed.error.message });
    return;
  }
  const r = await renamePlanTemplate(req.user!.userId, id, parsed.data.name);
  res.status(r.status).json(r.body);
});

router.delete("/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = req.params.id as string;
  if (!UUID_RE.test(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const r = await deletePlanTemplate(req.user!.userId, id);
  res.status(r.status).json(r.body);
});

export default router;
```

Em `artifacts/api-server/src/routes/index.ts`:
- imports, junto dos demais: `import mapPlanTemplatesRouter from "./mapPlanTemplates";` e `import planTemplatesRouter from "./planTemplates";`
- logo após a linha `router.use("/workspaces/:workspaceId/maps/:mapId/shapes", shapesRouter);`:
  `router.use("/workspaces/:workspaceId/maps/:mapId/plan-templates", mapPlanTemplatesRouter);`
- logo após `router.use("/task-templates", taskTemplatesRouter);`:
  `router.use("/plan-templates", planTemplatesRouter);`

- [ ] **Step 5: Rodar e ver passar**

```bash
cd artifacts/api-server && DATABASE_URL='<dev DB>' JWT_SECRET='<jwt>' npx vitest run planTemplates
```

Expected: PASS em `planTemplates.smoke.test.ts`, `planTemplatesCapture.test.ts`, `planTemplatesApply.test.ts`.

- [ ] **Step 6: Typecheck relativo dos arquivos novos**

```bash
npx tsc -b lib/db
cd artifacts/api-server && NODE_OPTIONS=--max-old-space-size=4096 npx tsc -p tsconfig.json --noEmit > /c/tmp/modelos-de-plano/api-tsc-task5.txt 2>&1; grep -c "error TS" /c/tmp/modelos-de-plano/api-tsc-task5.txt; grep -E "planTemplates|mapPlanTemplates|taskTemplates|routes/index" /c/tmp/modelos-de-plano/api-tsc-task5.txt
```

Expected: contagem total ≠ 0 (senão foi OOM — repetir); o segundo grep não lista nenhum erro em arquivo novo/tocado que não esteja no baseline (`grep -E "<mesmo padrão>" /c/tmp/modelos-de-plano/api-tsc-baseline.txt` para comparar; erros em `__tests__/*` do tipo "Cannot find module 'vitest'" já existem no baseline para todos os testes e são aceitáveis só se o mesmo erro aparece nos testes antigos). Corrigir qualquer erro novo de tipo real antes de commitar.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/services/planTemplates/service.ts artifacts/api-server/src/routes/mapPlanTemplates.ts artifacts/api-server/src/routes/planTemplates.ts artifacts/api-server/src/routes/index.ts artifacts/api-server/src/__tests__/planTemplates.smoke.test.ts
git commit -m "feat(api): capturar e aplicar modelos de plano de ação + gestão

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Menu "aplicar modelo" / "criar modelo" no modal de tarefa

**Files:**
- Create: `artifacts/mindtask-app/src/lib/apiErrorMessage.ts`
- Test: `artifacts/mindtask-app/src/lib/apiErrorMessage.test.ts`
- Modify: `artifacts/mindtask-app/src/components/tasks/TaskApplyTemplateButton.tsx`

**Interfaces:**
- Consumes: `POST /api/task-templates/from-task` (Task 2); `customFetch` (lança `ApiError` com `.status` e `.data`).
- Produces: `apiErrorMessage(e: unknown, fallback: string, byStatus?: Record<number, string>): string` — usado também nas Tasks 7 e 8. Props do `TaskApplyTemplateButton` **inalteradas** (`taskId`, `status`, `onApplied`, `portalContainer`, `skipConfirm`), então `TaskHeaderActions.tsx`/`TaskDetailModal.tsx`/`pages/embed/task.tsx` não mudam.

- [ ] **Step 1: Escrever o teste do helper (falha)**

`artifacts/mindtask-app/src/lib/apiErrorMessage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { apiErrorMessage } from "./apiErrorMessage";

describe("apiErrorMessage", () => {
  it("lê data.error do ApiError do customFetch", () => {
    expect(apiErrorMessage({ status: 400, data: { error: "nada pra salvar no modelo" } }, "falhou")).toBe(
      "nada pra salvar no modelo",
    );
  });

  it("aceita body.error legado", () => {
    expect(apiErrorMessage({ body: { error: "x" } }, "falhou")).toBe("x");
  });

  it("mensagem por status tem prioridade", () => {
    expect(
      apiErrorMessage({ status: 403, data: { error: "Forbidden" } }, "falhou", { 403: "sem permissão" }),
    ).toBe("sem permissão");
  });

  it("cai no fallback sem mensagem utilizável", () => {
    expect(apiErrorMessage(new Error("boom"), "falhou")).toBe("falhou");
    expect(apiErrorMessage({ data: { error: "  " } }, "falhou")).toBe("falhou");
    expect(apiErrorMessage(null, "falhou")).toBe("falhou");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd artifacts/mindtask-app && npx vitest run src/lib/apiErrorMessage.test.ts
```

Expected: FAIL com `Failed to resolve import "./apiErrorMessage"`.

- [ ] **Step 3: Implementar o helper**

`artifacts/mindtask-app/src/lib/apiErrorMessage.ts`:

```ts
/**
 * Mensagem exibível de um erro do customFetch. O ApiError guarda o corpo em
 * `.data` (não `.body`); `.body` é aceito por compatibilidade. `byStatus`
 * substitui mensagens genéricas do servidor (ex.: 403 "Forbidden").
 */
export function apiErrorMessage(
  e: unknown,
  fallback: string,
  byStatus?: Record<number, string>,
): string {
  const err = (e ?? {}) as {
    status?: unknown;
    data?: { error?: unknown } | null;
    body?: { error?: unknown } | null;
  };
  if (typeof err.status === "number" && byStatus?.[err.status]) return byStatus[err.status];
  const v = err.data?.error ?? err.body?.error;
  return typeof v === "string" && v.trim() ? v : fallback;
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd artifacts/mindtask-app && npx vitest run src/lib/apiErrorMessage.test.ts
```

Expected: PASS (4 testes).

- [ ] **Step 5: Reescrever o `TaskApplyTemplateButton`**

Substituir o conteúdo de `artifacts/mindtask-app/src/components/tasks/TaskApplyTemplateButton.tsx` por:

```tsx
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@beeads/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@beeads/ui";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/apiErrorMessage";

interface Template {
  id: string;
  name: string | null;
  title: string | null;
}

const APPLY_DISABLED_HINT = "só é possível aplicar modelo em tarefas em rascunho";

// Popover artesanal (não o Popover do DS) de propósito: ele vive dentro do
// Dialog do TaskDetailModal e do iframe /embed/task (contrato com o painel) e
// precisa do portalContainer.
export function TaskApplyTemplateButton({
  taskId,
  status,
  onApplied,
  portalContainer,
  skipConfirm = false,
}: {
  taskId: string | null;
  status: string;
  onApplied: () => void;
  portalContainer?: HTMLElement | null;
  skipConfirm?: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "list">("menu");
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [confirming, setConfirming] = useState<Template | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const enabled = !!taskId;
  const canApply = status === "draft";

  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ["/api/task-templates"],
    queryFn: () => customFetch("/api/task-templates"),
    enabled: open && view === "list",
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const applyMut = useMutation({
    mutationFn: (templateId: string) =>
      customFetch(`/api/task-templates/${templateId}/apply`, {
        method: "POST",
        body: JSON.stringify({ taskId }),
      }),
    onSuccess: () => {
      toast({ title: "modelo aplicado" });
      setConfirming(null);
      onApplied();
    },
    onError: (e: unknown) => {
      toast({ title: apiErrorMessage(e, "erro ao aplicar modelo"), variant: "destructive" });
    },
  });

  const createMut = useMutation({
    mutationFn: () =>
      customFetch("/api/task-templates/from-task", {
        method: "POST",
        body: JSON.stringify({ taskId }),
      }),
    onSuccess: () => {
      setOpen(false);
      toast({ title: "novo modelo de tarefa criado" });
      queryClient.invalidateQueries({ queryKey: ["/api/task-templates"] });
    },
    onError: (e: unknown) => {
      toast({ title: apiErrorMessage(e, "erro ao criar modelo"), variant: "destructive" });
    },
  });

  const handleClick = () => {
    if (!enabled) return;
    if (buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      if (portalContainer) {
        const c = portalContainer.getBoundingClientRect();
        setPos({
          top: r.bottom - c.top + portalContainer.scrollTop + 4,
          left: Math.max(0, Math.min(r.left - c.left + portalContainer.scrollLeft - 200, portalContainer.clientWidth - 230)),
        });
      } else {
        setPos({
          top: Math.min(r.bottom + 4, window.innerHeight - 250),
          left: Math.max(4, Math.min(r.left - 200, window.innerWidth - 240)),
        });
      }
    }
    setView("menu");
    setOpen((v) => !v);
  };

  const displayName = (t: Template) =>
    (t.name && t.name.trim()) || (t.title && t.title.trim()) || "modelo sem nome";

  const itemClass = "w-full text-left px-3 py-1.5 text-sm lowercase transition-colors";

  return (
    <>
      <Button
        ref={buttonRef}
        variant="ghost"
        size="icon"
        onClick={handleClick}
        disabled={!enabled}
        className={`h-7 w-7 shrink-0 rounded-lg ${enabled ? "text-muted-foreground hover:text-primary hover:bg-primary/10" : "text-muted-foreground/40 cursor-not-allowed hover:bg-transparent"}`}
        title="modelo"
      >
        <FileText className="w-3.5 h-3.5" />
      </Button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: portalContainer ? "absolute" : "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
          className="bg-popover border border-border rounded-xl shadow-lg w-60 max-h-64 overflow-y-auto py-1"
        >
          {view === "menu" ? (
            <>
              <button
                type="button"
                aria-disabled={!canApply}
                title={canApply ? undefined : APPLY_DISABLED_HINT}
                onClick={() => {
                  if (canApply) setView("list");
                }}
                className={`${itemClass} ${canApply ? "hover:bg-muted" : "text-muted-foreground/50 cursor-not-allowed"}`}
              >
                aplicar modelo
              </button>
              <button
                type="button"
                disabled={createMut.isPending}
                onClick={() => createMut.mutate()}
                className={`${itemClass} hover:bg-muted flex items-center justify-between gap-2`}
              >
                criar modelo
                {createMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
              </button>
            </>
          ) : isLoading ? (
            <div className="px-3 py-4 flex items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : !templates || templates.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground text-center lowercase">
              você ainda não tem modelos
            </div>
          ) : (
            templates.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setOpen(false);
                  if (skipConfirm) applyMut.mutate(t.id);
                  else setConfirming(t);
                }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors truncate"
                title={displayName(t)}
              >
                {displayName(t)}
              </button>
            ))
          )}
        </div>,
        portalContainer ?? document.body,
      )}

      <AlertDialog open={!!confirming} onOpenChange={(v) => !v && setConfirming(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="lowercase">Aplicar modelo?</AlertDialogTitle>
            <AlertDialogDescription className="lowercase">
              Os campos preenchidos no modelo substituirão os atuais. A descrição será adicionada
              ao final e as subtarefas do modelo serão acrescentadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl lowercase">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl lowercase"
              onClick={(e) => {
                e.preventDefault();
                if (confirming) applyMut.mutate(confirming.id);
              }}
            >
              {applyMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Aplicar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 6: Typecheck relativo + build**

```bash
cd artifacts/mindtask-app && printf '{\n  "extends": "./tsconfig.json",\n  "references": []\n}\n' > tsconfig.gate.json && NODE_OPTIONS=--max-old-space-size=4096 npx tsc -p tsconfig.gate.json --noEmit > /c/tmp/modelos-de-plano/web-tsc-task6.txt 2>&1; rm -f tsconfig.gate.json
grep -c "error TS" /c/tmp/modelos-de-plano/web-tsc-task6.txt
grep -E "TaskApplyTemplateButton|apiErrorMessage" /c/tmp/modelos-de-plano/web-tsc-task6.txt
```

Expected: total = 71 (o baseline; se 0 → OOM, repetir); o segundo grep não imprime nada.

```bash
cd artifacts/mindtask-app && pnpm run build
```

Expected: build do vite conclui sem erro.

- [ ] **Step 7: Commit**

```bash
git add artifacts/mindtask-app/src/lib/apiErrorMessage.ts artifacts/mindtask-app/src/lib/apiErrorMessage.test.ts artifacts/mindtask-app/src/components/tasks/TaskApplyTemplateButton.tsx
git commit -m "feat(web): menu aplicar/criar modelo no modal de tarefa

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Botão de modelos de plano no canvas

**Files:**
- Create: `artifacts/mindtask-app/src/lib/planTemplates.ts`
- Test: `artifacts/mindtask-app/src/lib/planTemplates.test.ts`
- Create: `artifacts/mindtask-app/src/components/maps/PlanTemplateMenu.tsx`
- Modify: `artifacts/mindtask-app/src/pages/maps/canvas.tsx`

**Interfaces:**
- Consumes: rotas da Task 5 (`/capture`, `/:templateId/apply`, `GET /api/plan-templates`); `apiErrorMessage` (Task 6).
- Produces (Task 8 usa `PLAN_TEMPLATES_QUERY_KEY`, `PlanTemplateListItem`, `formatPlanCounts`):
  - `lib/planTemplates.ts`: `PLAN_TEMPLATES_QUERY_KEY = ["/api/plan-templates"] as const`; tipos `PlanCounts`, `PlanTemplateListItem`, `PlanSelection = { cardIds: string[]; textElementIds: string[]; shapeIds: string[]; usable: boolean }`, `PlanCaptureResult`, `PlanApplyResult`; `selectionFromNodes(nodes: Array<{ id: string; type?: string; selected?: boolean; data?: unknown }>): PlanSelection`; `skippedDescription(s: { approvals: number; images: number }): string | undefined`; `formatPlanCounts(c: PlanCounts): string`.
  - `PlanTemplateMenu` props: `{ workspaceId: string; mapId: string; getSelection: () => PlanSelection; onApplied: (r: PlanApplyResult) => void }`.

- [ ] **Step 1: Escrever o teste dos helpers (falha)**

`artifacts/mindtask-app/src/lib/planTemplates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatPlanCounts, selectionFromNodes, skippedDescription } from "./planTemplates";

describe("selectionFromNodes", () => {
  it("separa por tipo, envia aprovação e imagem, ignora joinnode e não-selecionados", () => {
    const s = selectionFromNodes([
      { id: "c1", type: "mindmap", selected: true },
      { id: "ap", type: "approvalnode", selected: true },
      { id: "join-c1", type: "joinnode", selected: true },
      { id: "t1", type: "textnode", selected: true },
      { id: "img", type: "shapenode", selected: true, data: { type: "image" } },
      { id: "r1", type: "shapenode", selected: false, data: { type: "rect" } },
    ]);
    expect(s).toEqual({ cardIds: ["c1", "ap"], textElementIds: ["t1"], shapeIds: ["img"], usable: true });
  });

  it("só aprovação/imagem selecionada não é aproveitável", () => {
    const s = selectionFromNodes([
      { id: "ap", type: "approvalnode", selected: true },
      { id: "img", type: "shapenode", selected: true, data: { type: "image" } },
    ]);
    expect(s.usable).toBe(false);
  });

  it("forma não-imagem é aproveitável", () => {
    expect(selectionFromNodes([{ id: "r", type: "shapenode", selected: true, data: { type: "rect" } }]).usable).toBe(true);
  });
});

describe("skippedDescription", () => {
  it("sem nada de fora → undefined", () => {
    expect(skippedDescription({ approvals: 0, images: 0 })).toBeUndefined();
  });
  it("singular e plural", () => {
    expect(skippedDescription({ approvals: 1, images: 0 })).toBe("1 aprovação ficou de fora");
    expect(skippedDescription({ approvals: 0, images: 3 })).toBe("3 imagens ficaram de fora");
    expect(skippedDescription({ approvals: 2, images: 1 })).toBe("2 aprovações e 1 imagem ficaram de fora");
  });
});

describe("formatPlanCounts", () => {
  it("lista só o que existe, em minúsculas", () => {
    expect(formatPlanCounts({ cards: 5, connections: 4, texts: 2, shapes: 1 })).toBe("5 tarefas · 2 textos · 1 forma");
    expect(formatPlanCounts({ cards: 1, connections: 0, texts: 0, shapes: 0 })).toBe("1 tarefa");
    expect(formatPlanCounts({ cards: 0, connections: 0, texts: 1, shapes: 2 })).toBe("1 texto · 2 formas");
    expect(formatPlanCounts({ cards: 0, connections: 0, texts: 0, shapes: 0 })).toBe("vazio");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd artifacts/mindtask-app && npx vitest run src/lib/planTemplates.test.ts
```

Expected: FAIL com `Failed to resolve import "./planTemplates"`.

- [ ] **Step 3: Implementar `lib/planTemplates.ts`**

```ts
// Contrato do front com /api/plan-templates e /plan-templates/{capture,apply}
// do mapa (rotas fora do OpenAPI; ver spec 2026-10-05-modelos-de-plano).

export const PLAN_TEMPLATES_QUERY_KEY = ["/api/plan-templates"] as const;

export type PlanCounts = { cards: number; connections: number; texts: number; shapes: number };

export type PlanTemplateListItem = {
  id: string;
  name: string;
  counts: PlanCounts;
  createdAt: string;
  updatedAt: string;
};

export type PlanSelection = {
  cardIds: string[];
  textElementIds: string[];
  shapeIds: string[];
  /** Há ≥1 elemento que o servidor vai de fato guardar (decide o item "a partir da seleção"). */
  usable: boolean;
};

export type PlanCaptureResult = {
  template: { id: string; name: string; counts: PlanCounts; createdAt: string };
  skipped: { approvals: number; images: number };
};

export type PlanApplyResult = {
  cardIds: string[];
  connectionIds: string[];
  textElementIds: string[];
  shapeIds: string[];
  bounds: { x: number; y: number; width: number; height: number };
};

type NodeLike = { id: string; type?: string; selected?: boolean; data?: unknown };

const isImage = (n: NodeLike) => (n.data as { type?: string } | undefined)?.type === "image";

/**
 * Ids dos nós do ReactFlow = UUIDs do banco (sem prefixo) pra mindmap,
 * approvalnode, textnode e shapenode. joinnode é virtual e nunca vai.
 * Aprovações e imagens VÃO no corpo: o servidor exclui e conta em `skipped`.
 */
export function selectionFromNodes(nodes: NodeLike[]): PlanSelection {
  const sel = nodes.filter((n) => n.selected === true);
  return {
    cardIds: sel.filter((n) => n.type === "mindmap" || n.type === "approvalnode").map((n) => n.id),
    textElementIds: sel.filter((n) => n.type === "textnode").map((n) => n.id),
    shapeIds: sel.filter((n) => n.type === "shapenode").map((n) => n.id),
    usable: sel.some(
      (n) => n.type === "mindmap" || n.type === "textnode" || (n.type === "shapenode" && !isImage(n)),
    ),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function skippedDescription(s: { approvals: number; images: number }): string | undefined {
  const parts: string[] = [];
  if (s.approvals > 0) parts.push(plural(s.approvals, "aprovação", "aprovações"));
  if (s.images > 0) parts.push(plural(s.images, "imagem", "imagens"));
  if (parts.length === 0) return undefined;
  const verb = s.approvals + s.images === 1 ? "ficou" : "ficaram";
  return `${parts.join(" e ")} ${verb} de fora`;
}

export function formatPlanCounts(c: PlanCounts): string {
  const parts: string[] = [];
  if (c.cards > 0) parts.push(plural(c.cards, "tarefa", "tarefas"));
  if (c.texts > 0) parts.push(plural(c.texts, "texto", "textos"));
  if (c.shapes > 0) parts.push(plural(c.shapes, "forma", "formas"));
  return parts.length > 0 ? parts.join(" · ") : "vazio";
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd artifacts/mindtask-app && npx vitest run src/lib/planTemplates.test.ts
```

Expected: PASS.

- [ ] **Step 5: Criar `PlanTemplateMenu.tsx`**

`artifacts/mindtask-app/src/components/maps/PlanTemplateMenu.tsx`:

```tsx
import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@beeads/ui";
import { customFetch } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/apiErrorMessage";
import {
  PLAN_TEMPLATES_QUERY_KEY,
  skippedDescription,
  type PlanApplyResult,
  type PlanCaptureResult,
  type PlanSelection,
  type PlanTemplateListItem,
} from "@/lib/planTemplates";

type CaptureBody = { cardIds?: string[]; textElementIds?: string[]; shapeIds?: string[] };

const EMPTY_SELECTION: PlanSelection = { cardIds: [], textElementIds: [], shapeIds: [], usable: false };

export function PlanTemplateMenu({
  workspaceId,
  mapId,
  getSelection,
  onApplied,
}: {
  workspaceId: string;
  mapId: string;
  getSelection: () => PlanSelection;
  onApplied: (r: PlanApplyResult) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "list">("menu");
  const [selection, setSelection] = useState<PlanSelection>(EMPTY_SELECTION);
  const base = `/api/workspaces/${workspaceId}/maps/${mapId}/plan-templates`;

  const { data: templates, isLoading } = useQuery<PlanTemplateListItem[]>({
    queryKey: PLAN_TEMPLATES_QUERY_KEY,
    queryFn: () => customFetch("/api/plan-templates"),
    enabled: open && view === "list",
  });

  const captureMut = useMutation({
    mutationFn: (body: CaptureBody) =>
      customFetch<PlanCaptureResult>(`${base}/capture`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (r) => {
      toast({ title: "novo modelo de plano de ação criado", description: skippedDescription(r.skipped) });
      queryClient.invalidateQueries({ queryKey: PLAN_TEMPLATES_QUERY_KEY });
    },
    onError: (e: unknown) => {
      toast({ title: apiErrorMessage(e, "erro ao criar modelo de plano de ação"), variant: "destructive" });
    },
  });

  const applyMut = useMutation({
    mutationFn: (templateId: string) =>
      customFetch<PlanApplyResult>(`${base}/${templateId}/apply`, { method: "POST" }),
    onSuccess: (r) => {
      onApplied(r);
      toast({ title: "modelo de plano de ação aplicado" });
    },
    onError: (e: unknown) => {
      toast({
        title: apiErrorMessage(e, "erro ao aplicar modelo de plano de ação", {
          403: "você não tem permissão pra aplicar modelos neste plano",
        }),
        variant: "destructive",
      });
    },
  });

  const busy = captureMut.isPending || applyMut.isPending;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (next && busy) return;
        setOpen(next);
        if (next) {
          setView("menu");
          setSelection(getSelection());
        }
      }}
    >
      <DropdownMenuTrigger
        render={(props) => (
          <button
            {...props}
            type="button"
            title="modelos de plano de ação"
            aria-busy={busy}
            className="w-10 h-10 rounded-xl bg-card border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          </button>
        )}
      />
      <DropdownMenuContent sideOffset={6} className="w-64 max-h-72 overflow-y-auto">
        {view === "menu" ? (
          <>
            <DropdownMenuItem closeOnClick={false} className="lowercase cursor-pointer" onClick={() => setView("list")}>
              aplicar modelo de plano de ação
            </DropdownMenuItem>
            <DropdownMenuItem className="lowercase cursor-pointer" onClick={() => captureMut.mutate({})}>
              criar modelo de plano de ação
            </DropdownMenuItem>
            {selection.usable && (
              <DropdownMenuItem
                className="lowercase cursor-pointer"
                onClick={() =>
                  captureMut.mutate({
                    cardIds: selection.cardIds,
                    textElementIds: selection.textElementIds,
                    shapeIds: selection.shapeIds,
                  })
                }
              >
                criar modelo a partir da seleção
              </DropdownMenuItem>
            )}
          </>
        ) : isLoading ? (
          <div className="px-3 py-4 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : !templates || templates.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground text-center lowercase">
            você ainda não tem modelos de plano de ação
          </div>
        ) : (
          templates.map((t) => (
            <DropdownMenuItem
              key={t.id}
              className="cursor-pointer truncate"
              title={t.name}
              onClick={() => applyMut.mutate(t.id)}
            >
              {t.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

(Se o tsc reclamar de `closeOnClick` ou `title` no `DropdownMenuItem`, conferir `node_modules/.pnpm/@base-ui+react@1.5.0*/node_modules/@base-ui/react/menu/item/MenuItem.d.ts` — `closeOnClick` existe na 1.5.0; `title` vem dos atributos de div.)

- [ ] **Step 6: Ligar no `canvas.tsx`**

Em `artifacts/mindtask-app/src/pages/maps/canvas.tsx`:

1. Imports (topo do arquivo, junto dos demais):

```ts
import { PlanTemplateMenu } from "@/components/maps/PlanTemplateMenu";
import { selectionFromNodes, type PlanApplyResult } from "@/lib/planTemplates";
```

2. Na desestruturação do `useReactFlow()` (≈ linha 379), adicionar `fitBounds`:

```ts
const { getViewport, setViewport, screenToFlowPosition, zoomIn, zoomOut, fitView, fitBounds, setCenter } = useReactFlow();
```

3. Junto dos refs (logo depois de `const focusOnLoadAppliedRef = useRef(false);`, ≈ linha 443):

```ts
  // Ids (cards/textos/formas) criados por "aplicar modelo de plano": o efeito
  // de sync os seleciona no MESMO setNodes que os insere (sem corrida com o refetch).
  const pendingSelectIdsRef = useRef<Set<string>>(new Set());
```

4. No efeito de sync (`useEffect(() => { if (!mapData) return; ...`), no ramo `else {` (o que começa com `setNodes(prev => {` depois de `initializedRef.current = true;`), inserir **antes** de `setNodes(prev => {`:

```ts
      // Consome a seleção pendente só quando o payload já traz os elementos
      // aplicados (um poll em voo, anterior ao apply, não pode esvaziar o ref).
      // Decidido FORA do updater: o React pode chamar o updater duas vezes.
      let selectIds: Set<string> | null = null;
      const pendingSel = pendingSelectIdsRef.current;
      if (pendingSel.size > 0) {
        const arrived =
          mapData.cards.some(c => pendingSel.has(c.id)) ||
          (mapDataWithText.textElements ?? []).some(el => pendingSel.has(el.id)) ||
          (mapDataWithText.shapes ?? []).some(sh => pendingSel.has(sh.id));
        if (arrived) {
          selectIds = pendingSel;
          pendingSelectIdsRef.current = new Set();
        }
      }
```

   e, no fim do mesmo updater, trocar o `return [ ...filtered.map(...), ...newShapeNodes, ...newCardNodes, ...newTextNodes, ...freshJoinNodes, ];` por uma variável + passada de seleção:

```ts
        const next: Node[] = [
          ...filtered.map(n => {
            /* corpo existente do map, inalterado */
          }),
          ...newShapeNodes,
          ...newCardNodes,
          ...newTextNodes,
          ...freshJoinNodes,
        ];
        if (!selectIds) return next;
        const toSelect = selectIds;
        // Novos nós do modelo nascem selecionados; o resto é desmarcado (D8).
        return next.map(n => ({ ...n, selected: toSelect.has(n.id) }));
```

   (Mover o corpo do `filtered.map(n => { ... })` exatamente como está — não alterar nada dentro dele.)

5. Depois de `handleAutoLayout` (≈ linha 1158), adicionar:

```ts
  const getPlanSelection = useCallback(() => selectionFromNodes(nodesRef.current), []);

  // Pós-aplicação de modelo de plano: marca a seleção pendente, enquadra a
  // caixa devolvida pelo servidor (não depende dos nós existirem) e refaz o GET.
  const handlePlanTemplateApplied = useCallback((r: PlanApplyResult) => {
    pendingSelectIdsRef.current = new Set([...r.cardIds, ...r.textElementIds, ...r.shapeIds]);
    fitBounds(r.bounds, { duration: 400, padding: 0.2 });
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
  }, [fitBounds, queryClient, workspaceId, mapId]);
```

6. No JSX, logo **depois** do `div` do canto superior esquerdo (`<div className="absolute top-4 left-4 z-10 flex items-center gap-3"> ... </div>`, ≈ linhas 2871–2885), adicionar:

```tsx
        <div className="absolute top-4 right-16 z-20">
          <PlanTemplateMenu
            workspaceId={workspaceId}
            mapId={mapId}
            getSelection={getPlanSelection}
            onApplied={handlePlanTemplateApplied}
          />
        </div>
```

- [ ] **Step 7: Testes, typecheck relativo e build**

```bash
cd artifacts/mindtask-app && npx vitest run
```

Expected: PASS em todos os testes do app (inclui os novos).

```bash
cd artifacts/mindtask-app && printf '{\n  "extends": "./tsconfig.json",\n  "references": []\n}\n' > tsconfig.gate.json && NODE_OPTIONS=--max-old-space-size=4096 npx tsc -p tsconfig.gate.json --noEmit > /c/tmp/modelos-de-plano/web-tsc-task7.txt 2>&1; rm -f tsconfig.gate.json
grep -c "error TS" /c/tmp/modelos-de-plano/web-tsc-task7.txt
grep "pages/maps/canvas.tsx" /c/tmp/modelos-de-plano/web-tsc-task7.txt | sed 's/([0-9]*,[0-9]*)//' | sort > /c/tmp/modelos-de-plano/canvas-after.txt
grep "pages/maps/canvas.tsx" /c/tmp/modelos-de-plano/web-tsc-baseline.txt | sed 's/([0-9]*,[0-9]*)//' | sort > /c/tmp/modelos-de-plano/canvas-before.txt
diff /c/tmp/modelos-de-plano/canvas-before.txt /c/tmp/modelos-de-plano/canvas-after.txt && echo "canvas sem erro novo"
grep -E "PlanTemplateMenu|lib/planTemplates" /c/tmp/modelos-de-plano/web-tsc-task7.txt
```

Expected: total = 71; `canvas sem erro novo` (8 erros pré-existentes, iguais); último grep vazio.

```bash
cd artifacts/mindtask-app && pnpm run build
```

Expected: build OK.

- [ ] **Step 8: Commit**

```bash
git add artifacts/mindtask-app/src/lib/planTemplates.ts artifacts/mindtask-app/src/lib/planTemplates.test.ts artifacts/mindtask-app/src/components/maps/PlanTemplateMenu.tsx artifacts/mindtask-app/src/pages/maps/canvas.tsx
git commit -m "feat(web): botão de modelos de plano de ação no canvas (criar, aplicar, enquadrar, selecionar)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Página `/my-templates` com abas e menu "modelos"

**Files:**
- Create: `artifacts/mindtask-app/src/components/templates/PlanTemplatesTab.tsx`
- Modify: `artifacts/mindtask-app/src/pages/templates.tsx`
- Modify: `artifacts/mindtask-app/src/components/layout/AppLayout.tsx:138`

**Interfaces:**
- Consumes: `GET/PATCH/DELETE /api/plan-templates` (Task 5); `PLAN_TEMPLATES_QUERY_KEY`, `PlanTemplateListItem`, `formatPlanCounts` (Task 7); `apiErrorMessage` (Task 6); `TaskDeleteDialog` (props `open`, `onOpenChange`, `label`, `description`, `confirmLabel`, `loading`, `onConfirm`); `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `Input` do `@beeads/ui`.
- Produces: `PlanTemplatesTab` (sem props).

- [ ] **Step 1: Criar a aba de planos**

`artifacts/mindtask-app/src/components/templates/PlanTemplatesTab.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Input } from "@beeads/ui";
import { customFetch } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TaskDeleteDialog } from "@/components/tasks/TaskDeleteDialog";
import { toast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/apiErrorMessage";
import { formatPlanCounts, PLAN_TEMPLATES_QUERY_KEY, type PlanTemplateListItem } from "@/lib/planTemplates";

function PlanTemplateRow({
  template,
  onRename,
  onDelete,
}: {
  template: PlanTemplateListItem;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(template.name);
  useEffect(() => setName(template.name), [template.name]);

  // Autosave no blur (convenção do app); nome vazio volta ao anterior.
  const commit = () => {
    const v = name.trim();
    if (!v) {
      setName(template.name);
      return;
    }
    if (v !== template.name) onRename(template.id, v);
  };

  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setName(template.name);
              e.currentTarget.blur();
            }
          }}
          aria-label="nome do modelo de plano"
          className="h-8 border-transparent bg-transparent px-1 text-base font-semibold shadow-none hover:border-border focus:border-border"
        />
        <p className="px-1 text-xs text-muted-foreground lowercase">{formatPlanCounts(template.counts)}</p>
      </div>
      <button
        type="button"
        onClick={() => onDelete(template.id)}
        className="text-muted-foreground hover:text-destructive transition-colors p-1.5 rounded-lg hover:bg-destructive/10"
        title="excluir modelo"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

export function PlanTemplatesTab() {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery<PlanTemplateListItem[]>({
    queryKey: PLAN_TEMPLATES_QUERY_KEY,
    queryFn: () => customFetch("/api/plan-templates"),
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      customFetch(`/api/plan-templates/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: PLAN_TEMPLATES_QUERY_KEY }),
    onError: (e: unknown) => toast({ title: apiErrorMessage(e, "erro ao renomear modelo"), variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => customFetch(`/api/plan-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PLAN_TEMPLATES_QUERY_KEY });
      setDeletingId(null);
    },
    onError: (e: unknown) => toast({ title: apiErrorMessage(e, "erro ao excluir modelo"), variant: "destructive" }),
  });

  return (
    <>
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      ) : !templates || templates.length === 0 ? (
        <div className="text-center py-24">
          <p className="text-muted-foreground lowercase">
            você ainda não tem modelos de plano de ação. crie um a partir de um plano no mapa.
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-3xl border border-border/60 shadow-sm overflow-hidden">
          <div className="divide-y divide-border/50">
            {templates.map((t) => (
              <PlanTemplateRow
                key={t.id}
                template={t}
                onRename={(id, name) => renameMut.mutate({ id, name })}
                onDelete={setDeletingId}
              />
            ))}
          </div>
        </div>
      )}

      <TaskDeleteDialog
        open={!!deletingId}
        onOpenChange={(v) => {
          if (!v) setDeletingId(null);
        }}
        label="Excluir modelo de plano?"
        description="O modelo será removido permanentemente. Planos já criados a partir dele não serão afetados."
        confirmLabel="Excluir"
        loading={deleteMut.isPending}
        onConfirm={() => {
          if (deletingId) deleteMut.mutate(deletingId);
        }}
      />
    </>
  );
}
```

- [ ] **Step 2: Abas em `pages/templates.tsx`**

Em `artifacts/mindtask-app/src/pages/templates.tsx`:

1. Imports adicionais:

```ts
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@beeads/ui";
import { PlanTemplatesTab } from "@/components/templates/PlanTemplatesTab";
```

2. No componente, adicionar `const [tab, setTab] = useState("tarefas");` e a constante de classe (mesma de `workspaces/detail.tsx`):

```ts
  const tabTriggerClass = "data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground data-[state=active]:font-normal rounded-none px-0 py-0 h-auto text-base font-light text-muted-foreground/80 hover:text-foreground lowercase transition-colors";
```

3. Trocar o miolo de `<div className="max-w-6xl mx-auto p-8 lg:p-12"> ... </div>` por (breadcrumb "modelos"; o bloco do botão "novo modelo" e a lista atual de tarefas vão, **sem alteração**, pra dentro de `TabsContent value="tarefas"`):

```tsx
        <div className="max-w-6xl mx-auto p-8 lg:p-12">
          <PageBreadcrumb items={[{ label: "modelos" }]} className="mb-4" />
          <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="w-full">
            <TabsList className="bg-transparent border-b-0 h-auto p-0 flex gap-5 mb-6">
              <TabsTrigger value="tarefas" className={tabTriggerClass}>tarefas</TabsTrigger>
              <TabsTrigger value="planos" className={tabTriggerClass}>planos de ação</TabsTrigger>
            </TabsList>
            <TabsContent value="tarefas">
              {/* bloco existente: <div className="flex flex-col gap-6 mb-8"> com o botão "novo modelo" */}
              {/* bloco existente: isLoading ? ... : lista de modelos de tarefa */}
            </TabsContent>
            <TabsContent value="planos">
              <PlanTemplatesTab />
            </TabsContent>
          </Tabs>
        </div>
```

(Os comentários acima marcam onde colar os dois blocos JSX que hoje vêm logo após o `PageBreadcrumb`; colar o código real, idêntico ao atual.) `TemplateDetailModal` e o `TaskDeleteDialog` de modelos de tarefa continuam onde estão, fora das abas.

- [ ] **Step 3: Rótulo do menu lateral**

Em `artifacts/mindtask-app/src/components/layout/AppLayout.tsx`, no item de `settingsItems` com `onSelect: () => setLocation("/my-templates")`, trocar `label: "modelos de tarefas",` por `label: "modelos",`.

- [ ] **Step 4: Typecheck relativo, testes e build**

```bash
cd artifacts/mindtask-app && printf '{\n  "extends": "./tsconfig.json",\n  "references": []\n}\n' > tsconfig.gate.json && NODE_OPTIONS=--max-old-space-size=4096 npx tsc -p tsconfig.gate.json --noEmit > /c/tmp/modelos-de-plano/web-tsc-task8.txt 2>&1; rm -f tsconfig.gate.json
grep -c "error TS" /c/tmp/modelos-de-plano/web-tsc-task8.txt
grep -E "pages/templates.tsx|PlanTemplatesTab|AppLayout" /c/tmp/modelos-de-plano/web-tsc-task8.txt | sed 's/([0-9]*,[0-9]*)//' | sort > /c/tmp/modelos-de-plano/t8-after.txt
grep -E "pages/templates.tsx|PlanTemplatesTab|AppLayout" /c/tmp/modelos-de-plano/web-tsc-baseline.txt | sed 's/([0-9]*,[0-9]*)//' | sort > /c/tmp/modelos-de-plano/t8-before.txt
diff /c/tmp/modelos-de-plano/t8-before.txt /c/tmp/modelos-de-plano/t8-after.txt && echo "sem erro novo"
npx vitest run && pnpm run build
```

Expected: total = 71; `sem erro novo`; vitest PASS; build OK.

- [ ] **Step 5: Commit**

```bash
git add artifacts/mindtask-app/src/components/templates/PlanTemplatesTab.tsx artifacts/mindtask-app/src/pages/templates.tsx artifacts/mindtask-app/src/components/layout/AppLayout.tsx
git commit -m "feat(web): aba planos de ação em /my-templates e menu modelos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Gates finais e smoke no browser

**Files:** nenhum arquivo novo (só correções se algum gate falhar; cada correção vira commit próprio).

**Interfaces:**
- Consumes: tudo das Tasks 1–8.
- Produces: evidência de verde (saídas dos comandos) pro relatório final.

- [ ] **Step 1: Suíte completa do api-server**

```bash
cd artifacts/api-server && DATABASE_URL='<dev DB>' JWT_SECRET='<jwt>' npx vitest run
```

Expected: 100% PASS. Falha só por timeout em `approvalFlow`/`approvalRejectAndDelete`/`taskStatus`/`duplicateTask` → re-rodar esses arquivos antes de investigar (flakiness conhecida). Em Postgres embarcado, `workspaceStats.smoke` "window.completed conta DISTINCT tasks" falha por fuso — conhecido, não é regressão.

- [ ] **Step 2: Typecheck api — sem erro novo**

```bash
npx tsc -b lib/db
cd artifacts/api-server && NODE_OPTIONS=--max-old-space-size=4096 npx tsc -p tsconfig.json --noEmit > /c/tmp/modelos-de-plano/api-tsc-final.txt 2>&1; cd ../..
grep -c "error TS" /c/tmp/modelos-de-plano/api-tsc-baseline.txt /c/tmp/modelos-de-plano/api-tsc-final.txt
sed 's/([0-9]*,[0-9]*)//' /c/tmp/modelos-de-plano/api-tsc-baseline.txt | grep "error TS" | sort > /c/tmp/modelos-de-plano/api-before.txt
sed 's/([0-9]*,[0-9]*)//' /c/tmp/modelos-de-plano/api-tsc-final.txt | grep "error TS" | sort > /c/tmp/modelos-de-plano/api-after.txt
comm -13 /c/tmp/modelos-de-plano/api-before.txt /c/tmp/modelos-de-plano/api-after.txt
```

Expected: contagens não-zero; o `comm -13` (linhas só no "depois") lista apenas erros dos arquivos de teste novos que repetem um padrão já presente em testes antigos (ex.: tipos do `vitest` não resolvidos) — **nenhum** erro em `services/planTemplates/*`, `routes/mapPlanTemplates.ts`, `routes/planTemplates.ts`, `routes/index.ts`, `services/taskTemplatesService.ts`, `routes/taskTemplates.ts`. Qualquer outro → corrigir.

- [ ] **Step 3: Typecheck web — sem erro novo**

```bash
cd artifacts/mindtask-app && printf '{\n  "extends": "./tsconfig.json",\n  "references": []\n}\n' > tsconfig.gate.json && NODE_OPTIONS=--max-old-space-size=4096 npx tsc -p tsconfig.gate.json --noEmit > /c/tmp/modelos-de-plano/web-tsc-final.txt 2>&1; rm -f tsconfig.gate.json; cd ../..
grep -c "error TS" /c/tmp/modelos-de-plano/web-tsc-final.txt
sed 's/([0-9]*,[0-9]*)//' /c/tmp/modelos-de-plano/web-tsc-baseline.txt | grep "error TS" | sort > /c/tmp/modelos-de-plano/web-before.txt
sed 's/([0-9]*,[0-9]*)//' /c/tmp/modelos-de-plano/web-tsc-final.txt | grep "error TS" | sort > /c/tmp/modelos-de-plano/web-after.txt
comm -13 /c/tmp/modelos-de-plano/web-before.txt /c/tmp/modelos-de-plano/web-after.txt
```

Expected: total 71 (≠ 0); `comm -13` vazio.

- [ ] **Step 4: Lockfile e builds**

```bash
git diff master --stat -- pnpm-lock.yaml '**/package.json'
CI=1 pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/mindtask-app run build
```

Expected: o `git diff` não lista nada (nenhuma dependência mudou); `Lockfile is up to date` (ou "Already up to date") sem `ERR_PNPM_*`; os dois builds terminam sem erro.

- [ ] **Step 5: Smoke manual no browser**

Subir api + web contra o dev DB (`pnpm --filter @workspace/api-server run dev` e `pnpm --filter @workspace/mindtask-app run dev`, ambos leem o `.env` da raiz) ou usar o Playwright como na memória `bloquim_e2e_playwright_setup.md`. Conferir, com um usuário admin de um workspace de teste:

1. Modal de tarefa (tarefa em rascunho): botão `FileText` (title "modelo") abre menu com "aplicar modelo" e "criar modelo".
2. "criar modelo" → toast "novo modelo de tarefa criado"; o modelo aparece em `/my-templates` aba "tarefas" com título, descrição, prioridade e checklist da tarefa.
3. Tarefa **não** rascunho: botão habilitado; "aplicar modelo" acinzentado com dica "só é possível aplicar modelo em tarefas em rascunho"; "criar modelo" funciona.
4. "aplicar modelo" → lista; escolher → diálogo de confirmação → toast "modelo aplicado" (fluxo antigo intacto).
5. `/embed/task?theme=light` (iframe do painel, ou abrir direto): o menu do modelo abre posicionado dentro do modal e funciona.
6. Canvas: botão `FileText` (title "modelos de plano de ação") à esquerda da lupa, mesmo estilo. Sem seleção → 2 itens; com um card selecionado → 3 itens; só uma aprovação selecionada → 2 itens.
7. "criar modelo de plano de ação" num mapa com aprovação e imagem → toast "novo modelo de plano de ação criado" com descrição "1 aprovação e 1 imagem ficaram de fora".
8. "criar modelo a partir da seleção" → nome "<plano> (seleção)" na aba "planos de ação".
9. "aplicar modelo de plano de ação" → lista → clique: viewport anima até o conjunto novo, à direita de tudo, todos os novos nós **selecionados** e os antigos desmarcados; toast "modelo de plano de ação aplicado"; nada antigo se moveu; tecla Delete abre o diálogo de exclusão dos novos.
10. Executor no canvas: aplicar → toast "você não tem permissão pra aplicar modelos neste plano".
11. `/my-templates`: menu lateral diz "modelos", breadcrumb "modelos", abas "tarefas"/"planos de ação"; renomear no input salva no blur e no Enter (recarregar confirma); nome vazio volta ao anterior; excluir pede confirmação "Excluir modelo de plano?" e some da lista; estado vazio mostra "você ainda não tem modelos de plano de ação. crie um a partir de um plano no mapa."

Expected: todos os 11 itens OK. Qualquer falha → corrigir na task correspondente (commit `fix(...)`), re-rodar os gates 1–4.

- [ ] **Step 6: Relatório**

Não fazer push nem PR (decisão do dono). Reportar: SHAs dos commits, saídas resumidas dos Steps 1–4, resultado do checklist do Step 5, e o lembrete de rollout: aplicar `lib/db/drizzle/0041_add_plan_templates.sql` no prod **antes** do deploy do api (spec, seção Rollout).
