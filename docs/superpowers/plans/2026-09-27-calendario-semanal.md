# Modo calendário semanal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar às listas de tarefas (`/my-tasks` e aba de tarefas do workspace) um modo "calendário": kanban segunda→domingo com tarefas, aprovações, reuniões e eventos do Google Calendar, drag and drop que grava data de execução pretendida e ordem de prioridade.

**Architecture:** Duas colunas novas em `tasks` (`planned_date`, `planned_order`) e uma em `meetings` (`planned_order`). Um router novo `/api/calendar` (leitura de tarefas da semana + reorder) e extensões de leitura por intervalo em reuniões e Google Calendar. No front, a ancoragem e o DnD são funções puras testadas (`lib/calendar/*`), e o card do canvas é extraído em corpos apresentacionais reutilizados pelo canvas e pelo calendário.

**Tech Stack:** Express 5 + Drizzle (Postgres) + Zod v4, Vitest + Supertest; React 19 + Vite + TanStack Query v5 + `@dnd-kit/core`/`@dnd-kit/sortable` (já instalados) + `@beeads/ui`; Playwright (runner fora do repo).

**Spec:** `docs/superpowers/specs/2026-09-27-calendario-semanal-design.md`

## Global Constraints

- Branch de trabalho: `feat/calendario-semanal`. Nunca commitar/mergear em `master`.
- Zero dependência nova (sem mexer em `package.json`/`pnpm-lock.yaml`).
- Migration **só aditiva**, aplicada por SQL direto no dev (`pg`). **Nunca** `drizzle-kit push` no dev (dropa `strategy_*` de outra branch). **Nunca** tocar prod nesta feature.
- Testes da API **nunca** com `DATABASE_URL` de prod (`ljilttjsrceddoydnneu`); o `helpers.ts` recusa.
- `planned_date` é `date` (string `YYYY-MM-DD`); datas de tarefa existentes seguem a convenção `YYYY-MM-DDT12:00:00.000Z`.
- Status "cancelada" = `blocked`. "todos" = `draft,pending,in_progress,completed`.
- Ativos = `draft`, `pending`, `in_progress`. Terminais = `completed`, `blocked`.
- Ordem padrão numa coluna sem ordem manual: aprovação → reunião → tarefa.
- Sem activity log para `planned_date`/`planned_order`.
- Zod: `import { z } from "zod/v4";` em arquivos novos.
- UI: componentes de `@beeads/ui`; cores por tokens/classes Tailwind existentes; triggers de overlay com `render={...}` (não `asChild`).
- Idioma de UI: português, minúsculas no estilo do app ("hoje", "sem data", "calendário").
- Gates de typecheck são **relativos** (baseline vermelho): zero erro novo nos arquivos tocados.
  - API: `cd artifacts/api-server && npx tsc -p tsconfig.json --noEmit > $SCRATCH/api-tsc.txt 2>&1` (rodar `npx tsc -b lib/db` na raiz antes).
  - FE: `cd artifacts/mindtask-app && printf '{\n  "extends": "./tsconfig.json",\n  "references": []\n}\n' > tsconfig.gate.json && NODE_OPTIONS=--max-old-space-size=4096 npx tsc -p tsconfig.gate.json --noEmit > $SCRATCH/fe-tsc.txt 2>&1; rm -f tsconfig.gate.json`. Total de `error TS` no baseline = 71; se vier 0 foi OOM, não sucesso.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Ambiente

- `$DEV_DATABASE_URL`: dev do Supabase. Pooler: `DATABASE_URL` do `.env` da raiz. Se o pooler der `ENOTFOUND tenant/user`, usar o host direto `postgresql://postgres:<senha>@db.dzhdnaemauvtdchbkppp.supabase.co:5432/postgres` (mesma senha). O controlador passa a URL no prompt de cada task.
- `$JWT_SECRET`: o do `.env`.
- `$SCRATCH`: scratchpad da sessão.
- Suíte API: de `artifacts/api-server`, `DATABASE_URL=$DEV_DATABASE_URL JWT_SECRET=$JWT_SECRET npx vitest run <padrão>`. Falha por **timeout** em testes pesados de aprovação é ambiental: re-rodar antes de suspeitar.
- Suíte FE: de `artifacts/mindtask-app`, `npx vitest run <padrão>`.

## Review Focus

1. **Card mudando de coluna no meio da edição de prazo** (urgente → "fazer até" ainda sem data): o card não pode desmontar até o usuário terminar; atualiza ao fechar. Coberto na Task 12 (represa via `onScheduleEditingChange`) e verificado no e2e da Task 14.
2. **Semana com domingo como "hoje"**: domingo aparece mesmo vazio e é a coluna destacada; `startOfWeekMonday` de um domingo volta 6 dias. Teste na Task 6.
3. **Evento de dia inteiro com `end` exclusivo** e evento que cruza meia-noite: aparece em cada dia coberto, nunca no dia seguinte ao fim. Teste na Task 6.
4. **Soltar sobre um card de outra coluna** (não sobre o container): o item entra antes do card alvo, na coluna do alvo; soltar sobre coluna passada é rejeitado. Teste na Task 6.
5. **Reorder tentando mover tarefa de workspace alheio ou tarefa concluída**: 403/400 sem gravar nada, nem nos outros itens. Teste na Task 3.

---

## Task 1: Schema e migration

**Files:**
- Create: `lib/db/drizzle/0040_add_calendar_planning.sql`
- Modify: `lib/db/src/schema/tasks.ts` (imports; colunas após `recurrenceConfig`; índice no array final)
- Modify: `lib/db/src/schema/meetings.ts` (coluna após `attributionMethod`)

**Interfaces:**
- Produces: `tasks.plannedDate: string | null` (`date`, mode string), `tasks.plannedOrder: number | null`, `meetings.plannedOrder: number | null`. `$inferSelect` de ambas as tabelas passa a expor esses campos.

- [ ] **Step 1: Medir o baseline de typecheck da API (antes de qualquer edit)**

```bash
cd <repo> && npx tsc -b lib/db
cd artifacts/api-server && npx tsc -p tsconfig.json --noEmit > $SCRATCH/api-tsc-baseline.txt 2>&1; grep -c "error TS" $SCRATCH/api-tsc-baseline.txt
```
Anotar o número (≈278–287). Também medir o FE (comando em Global Constraints) em `$SCRATCH/fe-tsc-baseline.txt` e confirmar 71.

- [ ] **Step 2: Escrever a migration**

`lib/db/drizzle/0040_add_calendar_planning.sql`:
```sql
-- Modo calendário (kanban semanal) das listas de tarefas.
-- planned_date: data de execução pretendida (só o calendário lê/escreve).
-- planned_order: ordem de prioridade dentro da coluna do dia; NULL = nunca
-- ordenada manualmente (cai na ordem padrão aprovação → reunião → tarefa).
-- Aditiva e idempotente. Dev: aplicar com pg direto (NÃO drizzle-kit push,
-- que dropa strategy_* de outra branch). Prod: mesmo SQL, no deploy.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS planned_date date;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS planned_order integer;
--> statement-breakpoint
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS planned_order integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_planned ON tasks (assigned_to, planned_date) WHERE planned_date IS NOT NULL;
```

- [ ] **Step 3: Atualizar o schema Drizzle**

`lib/db/src/schema/tasks.ts` — adicionar `date` ao import de `drizzle-orm/pg-core`:
```ts
import {
  pgTable,
  text,
  timestamp,
  date,
  uuid,
  pgEnum,
  boolean,
  integer,
  jsonb,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
```
Logo após `recurrenceConfig: jsonb(...)`:
```ts
  /** Data de execução pretendida. Só o modo calendário lê/escreve. */
  plannedDate: date("planned_date", { mode: "string" }),
  /** Ordem de prioridade dentro da coluna do dia no calendário. NULL = não ordenada. */
  plannedOrder: integer("planned_order"),
```
No array de índices, após `idx_tasks_workspace_created`:
```ts
  index("idx_tasks_assigned_planned")
    .on(table.assignedTo, table.plannedDate)
    .where(sql`${table.plannedDate} IS NOT NULL`),
```

`lib/db/src/schema/meetings.ts` — após `attributionMethod: text("attribution_method"),`:
```ts
  /** Ordem de prioridade na coluna do dia do calendário. NULL = não ordenada. */
  plannedOrder: integer("planned_order"),
```

- [ ] **Step 4: Aplicar no dev e verificar**

Script `$SCRATCH/apply-0040.cjs`:
```js
const { createRequire } = require("module");
const req = createRequire(process.argv[2] + "/lib/db/package.json");
const pg = req("pg");
const fs = require("fs");
const url = process.env.DATABASE_URL;
if (!url || url.includes("ljilttjsrceddoydnneu")) throw new Error("dev only");
(async () => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const sql = fs.readFileSync(process.argv[2] + "/lib/db/drizzle/0040_add_calendar_planning.sql", "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const s = stmt.split("\n").filter(l => !l.trim().startsWith("--")).join("\n").trim();
    if (s) await c.query(s);
  }
  const { rows } = await c.query(`select table_name, column_name, data_type from information_schema.columns
    where (table_name='tasks' and column_name in ('planned_date','planned_order'))
       or (table_name='meetings' and column_name='planned_order') order by 1,2`);
  console.log(rows);
  await c.end();
})();
```
Run: `DATABASE_URL=$DEV_DATABASE_URL node $SCRATCH/apply-0040.cjs <repo>`
Expected: 3 linhas (`meetings.planned_order integer`, `tasks.planned_date date`, `tasks.planned_order integer`).

- [ ] **Step 5: Regenerar `.d.ts` e checar typecheck**

Run: `npx tsc -b lib/db` (raiz), depois o typecheck da API em `$SCRATCH/api-tsc.txt`.
Expected: contagem de `error TS` igual ao baseline.

- [ ] **Step 6: Commit**

```bash
git add lib/db/drizzle/0040_add_calendar_planning.sql lib/db/src/schema/tasks.ts lib/db/src/schema/meetings.ts
git commit -m "feat(db): colunas planned_date/planned_order para o modo calendário"
```

---

## Task 2: `GET /api/calendar/tasks`

**Files:**
- Create: `artifacts/api-server/src/services/calendarTasksQuery.ts`
- Create: `artifacts/api-server/src/routes/calendar.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (import + `router.use("/calendar", calendarRouter)` antes de `router.use("/my-tasks", ...)`)
- Test: `artifacts/api-server/src/__tests__/calendarTasks.smoke.test.ts`

**Interfaces:**
- Consumes: colunas da Task 1.
- Produces:
  - `GET /api/calendar/tasks?from=<ISO>&to=<ISO>&status=<csv>&assignedTo=<csv>&workspaceId=<uuid?>` → `CalendarTaskRow[]` (campos listados no select abaixo).
  - `export const ACTIVE_STATUSES`, `export const CALENDAR_STATUSES`, `export type CalendarStatus`, `export const TODOS_STATUSES`, `export async function listCalendarTasks(p: CalendarTasksParams)` em `calendarTasksQuery.ts`.
  - `routes/calendar.ts` exporta `default router` (a Task 3 adiciona o PUT no mesmo arquivo).

- [ ] **Step 1: Escrever o teste que falha**

`artifacts/api-server/src/__tests__/calendarTasks.smoke.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Agent } from "supertest";
import { db } from "@workspace/db";
import { tasks } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { registerAndLogin, deleteUser, deleteWorkspaces, type TestUser } from "./helpers";

const DAY = 86_400_000;
const noon = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * DAY);
  return d.toISOString().slice(0, 10) + "T12:00:00.000Z";
};

describe("GET /api/calendar/tasks", () => {
  let agent: Agent;
  let user: TestUser;
  let outsider: { agent: Agent; user: TestUser };
  let wsId: string;
  let alienWsId: string;
  const ids: Record<string, string> = {};

  const create = async (title: string, body: Record<string, unknown> = {}) => {
    const r = await agent.post(`/api/workspaces/${wsId}/tasks`).send({ title, ...body });
    expect(r.status).toBe(201);
    ids[title] = r.body.id;
    return r.body.id as string;
  };
  const setStatus = async (id: string, status: string) => {
    const r = await agent.patch(`/api/workspaces/${wsId}/tasks/${id}/status`).send({ status });
    expect(r.status).toBe(200);
  };

  beforeAll(async () => {
    ({ agent, user } = await registerAndLogin("Calendar Owner"));
    outsider = await registerAndLogin("Calendar Outsider");
    wsId = (await agent.post("/api/workspaces").send({ name: "WS Calendar" })).body.id;
    alienWsId = (await outsider.agent.post("/api/workspaces").send({ name: "WS Alheio" })).body.id;

    const future = await create("ativa-futura", { scheduleMode: "ate", dueDate: noon(10) });
    await setStatus(future, "pending");
    const done = await create("concluida-agora");
    await setStatus(done, "pending");
    await setStatus(done, "completed");
    const oldDone = await create("concluida-antiga");
    await setStatus(oldDone, "pending");
    await setStatus(oldDone, "completed");
    await db.update(tasks).set({ completedAt: new Date(Date.now() - 30 * DAY) }).where(eq(tasks.id, oldDone));
    const cancelled = await create("cancelada-agora");
    await setStatus(cancelled, "pending");
    await setStatus(cancelled, "blocked");
    await create("rascunho-urgente", { scheduleMode: "urgente" });
    const standalone = await agent.post("/api/my-tasks").send({ title: "avulsa" });
    ids["avulsa"] = standalone.body.id;
  });

  afterAll(async () => {
    await db.delete(tasks).where(eq(tasks.id, ids["avulsa"]));
    await deleteWorkspaces([wsId, alienWsId]);
    await deleteUser(user.id);
    await deleteUser(outsider.user.id);
  });

  const range = () => {
    const from = new Date(Date.now() - 3 * DAY).toISOString();
    const to = new Date(Date.now() + 3 * DAY).toISOString();
    return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  };
  const titles = (body: Array<{ title: string }>) => body.map(t => t.title).sort();

  it("default (todos): ativas + concluídas na janela; sem canceladas nem concluídas fora da janela", async () => {
    const r = await agent.get(`/api/calendar/tasks?${range()}&workspaceId=${wsId}`);
    expect(r.status).toBe(200);
    expect(titles(r.body)).toEqual(["ativa-futura", "concluida-agora", "rascunho-urgente"]);
    const row = r.body.find((t: any) => t.title === "ativa-futura");
    expect(row).toHaveProperty("plannedDate", null);
    expect(row).toHaveProperty("plannedOrder", null);
    expect(row).toHaveProperty("description");
    expect(row).toHaveProperty("approvalStatus");
    expect(row).toHaveProperty("updatedAt");
  });

  it("status=blocked traz a cancelada da janela", async () => {
    const r = await agent.get(`/api/calendar/tasks?${range()}&workspaceId=${wsId}&status=blocked`);
    expect(r.status).toBe(200);
    expect(titles(r.body)).toEqual(["cancelada-agora"]);
  });

  it("assignedTo=unassigned exclui as minhas", async () => {
    const r = await agent.get(`/api/calendar/tasks?${range()}&workspaceId=${wsId}&assignedTo=unassigned`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it("sem workspaceId: escopo cross-workspace inclui avulsa", async () => {
    const r = await agent.get(`/api/calendar/tasks?${range()}`);
    expect(r.status).toBe(200);
    expect(titles(r.body)).toContain("avulsa");
    expect(titles(r.body)).toContain("ativa-futura");
  });

  it("403 em workspace alheio; 400 em datas inválidas, intervalo > 31 dias e status inválido", async () => {
    expect((await agent.get(`/api/calendar/tasks?${range()}&workspaceId=${alienWsId}`)).status).toBe(403);
    expect((await agent.get(`/api/calendar/tasks?from=xx&to=yy`)).status).toBe(400);
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 40 * DAY).toISOString();
    expect((await agent.get(`/api/calendar/tasks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).status).toBe(400);
    expect((await agent.get(`/api/calendar/tasks?${range()}&status=overdue`)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL=$DEV_DATABASE_URL JWT_SECRET=$JWT_SECRET npx vitest run calendarTasks`
Expected: FAIL (404 na rota).

- [ ] **Step 3: Implementar o serviço**

`artifacts/api-server/src/services/calendarTasksQuery.ts`:
```ts
import { db } from "@workspace/db";
import { tasks, cards, maps, workspaces, workspaceMembers, users } from "@workspace/db/schema";
import { and, eq, gte, inArray, isNull, lt, ne, not, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export const ACTIVE_STATUSES = ["draft", "pending", "in_progress"] as const;
export const CALENDAR_STATUSES = ["draft", "pending", "in_progress", "completed", "blocked"] as const;
export type CalendarStatus = (typeof CALENDAR_STATUSES)[number];
/** Filtro "todos" = tudo menos cancelada. */
export const TODOS_STATUSES: CalendarStatus[] = ["draft", "pending", "in_progress", "completed"];

export interface CalendarTasksParams {
  userId: string;
  /** null = escopo "minhas tarefas" (workspaces visíveis + standalone do usuário). */
  workspaceId: string | null;
  statuses: CalendarStatus[];
  /** "me" | "unassigned" | uuid. Vazio = sem filtro de pessoas. */
  assignees: string[];
  from: Date;
  to: Date;
}

const blockedSinceExpr = sql<string | null>`(SELECT MAX(a.created_at) FROM task_activities a WHERE a.task_id = ${tasks.id} AND a.type = 'status_changed' AND a.metadata->>'newStatus' = 'blocked')`;

function assigneeFilter(userId: string, assignees: string[]): SQL | undefined {
  if (assignees.length === 0) return undefined;
  const hasMe = assignees.includes("me");
  const hasUnassigned = assignees.includes("unassigned");
  const uuids = assignees.filter(a => a !== "me" && a !== "unassigned");
  const scope = (field: typeof tasks.assignedTo | typeof tasks.ownerId) => {
    const parts: SQL[] = [];
    if (hasMe) parts.push(eq(field, userId));
    if (hasUnassigned) parts.push(isNull(field));
    if (uuids.length > 0) parts.push(inArray(field, uuids));
    return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : or(...parts);
  };
  // Rascunho filtra pelo dono, como as listas (workspaceTasks.ts / myTasks.ts).
  return or(
    and(ne(tasks.status, "draft"), scope(tasks.assignedTo)),
    and(eq(tasks.status, "draft"), scope(tasks.ownerId)),
  );
}

async function scopeFilter(userId: string, workspaceId: string | null): Promise<SQL | undefined> {
  if (workspaceId) return eq(tasks.workspaceId, workspaceId);
  const memberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.hidden, false)));
  const ids = memberships.map(m => m.workspaceId);
  const standalone = and(isNull(tasks.workspaceId), eq(tasks.assignedTo, userId));
  return ids.length > 0 ? or(inArray(tasks.workspaceId, ids), standalone) : standalone;
}

function statusWindowFilter(statuses: CalendarStatus[], from: Date, to: Date): SQL | undefined {
  const active = statuses.filter(s => (ACTIVE_STATUSES as readonly string[]).includes(s));
  const parts: SQL[] = [];
  if (active.length > 0) parts.push(inArray(tasks.status, active));
  if (statuses.includes("completed")) {
    parts.push(and(eq(tasks.status, "completed"), gte(tasks.completedAt, from), lt(tasks.completedAt, to))!);
  }
  if (statuses.includes("blocked")) {
    // timestamp SEM tz: serializar com toISOString antes de interpolar (ver myTasks.ts, cursor).
    const cancelledExpr = sql`COALESCE(${tasks.cancelledAt}, ${blockedSinceExpr})`;
    parts.push(and(
      eq(tasks.status, "blocked"),
      sql`${cancelledExpr} >= ${from.toISOString()}::timestamp`,
      sql`${cancelledExpr} < ${to.toISOString()}::timestamp`,
    )!);
  }
  if (parts.length === 0) return sql`false`;
  return parts.length === 1 ? parts[0] : or(...parts);
}

export async function listCalendarTasks(p: CalendarTasksParams) {
  const parentTasks = alias(tasks, "parent_tasks");
  return db
    .select({
      id: tasks.id,
      mapId: tasks.mapId,
      workspaceId: tasks.workspaceId,
      title: tasks.title,
      description: tasks.description,
      assignedTo: tasks.assignedTo,
      dueDate: tasks.dueDate,
      startAt: tasks.startAt,
      scheduleMode: tasks.scheduleMode,
      priority: tasks.priority,
      status: tasks.status,
      overdue: tasks.overdue,
      completedAt: tasks.completedAt,
      cancelledAt: tasks.cancelledAt,
      blockedSince: blockedSinceExpr,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      plannedDate: tasks.plannedDate,
      plannedOrder: tasks.plannedOrder,
      isApprovalTask: tasks.isApprovalTask,
      approvalStatus: tasks.approvalStatus,
      parentApprovalStatus: tasks.parentApprovalStatus,
      isRecurring: tasks.isRecurring,
      recurrenceConfig: tasks.recurrenceConfig,
      parentTaskId: tasks.parentTaskId,
      parentTaskTitle: parentTasks.title,
      cardId: cards.id,
      cardTitle: cards.title,
      mapName: maps.name,
      workspaceName: workspaces.name,
      workspaceColorIndex: workspaces.colorIndex,
      assigneeName: users.name,
      assigneeAvatarUrl: users.avatarUrl,
      attachmentCount: sql<number>`(SELECT COUNT(*) FROM task_attachments ta JOIN attachments a ON a.id = ta.attachment_id WHERE ta.task_id = ${tasks.id} AND a.deleted_at IS NULL)`,
      subtaskCount: sql<number>`(SELECT COUNT(*) FROM subtasks WHERE task_id = ${tasks.id})`,
      subtaskCompletedCount: sql<number>`(SELECT COUNT(*) FROM subtasks WHERE task_id = ${tasks.id} AND completed = true)`,
      commentCount: sql<number>`((SELECT COUNT(*) FROM task_comments WHERE task_id = ${tasks.id}) + (SELECT COUNT(*) FROM task_comments tc JOIN tasks ct ON ct.id = tc.task_id WHERE ct.parent_task_id = ${tasks.id} AND ct.is_approval_task = true))`,
    })
    .from(tasks)
    .leftJoin(cards, eq(cards.taskId, tasks.id))
    .leftJoin(maps, eq(maps.id, tasks.mapId))
    .leftJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .leftJoin(users, eq(users.id, tasks.assignedTo))
    .leftJoin(parentTasks, eq(parentTasks.id, tasks.parentTaskId))
    .where(and(
      await scopeFilter(p.userId, p.workspaceId),
      assigneeFilter(p.userId, p.assignees),
      not(and(eq(tasks.isApprovalTask, true), eq(tasks.status, "draft"))!),
      statusWindowFilter(p.statuses, p.from, p.to),
    ))
    .limit(1000);
}
```

- [ ] **Step 4: Implementar a rota e montar**

`artifacts/api-server/src/routes/calendar.ts`:
```ts
import { Router, IRouter } from "express";
import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { workspaceMembers } from "@workspace/db/schema";
import { requireAuth, AuthRequest } from "../middlewares/auth";
import {
  CALENDAR_STATUSES, TODOS_STATUSES, listCalendarTasks, type CalendarStatus,
} from "../services/calendarTasksQuery";

const router: IRouter = Router();
const MAX_RANGE_MS = 31 * 86_400_000;

const tasksQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  status: z.string().optional(),
  assignedTo: z.string().optional(),
  workspaceId: z.string().uuid().optional(),
});

export function parseRange(fromRaw: string, toRaw: string): { from: Date; to: Date } | null {
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (to.getTime() <= from.getTime() || to.getTime() - from.getTime() > MAX_RANGE_MS) return null;
  return { from, to };
}

// GET /api/calendar/tasks — tarefas da semana do modo calendário.
router.get("/tasks", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const parsed = tasksQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", message: parsed.error.message });
  const range = parseRange(parsed.data.from, parsed.data.to);
  if (!range) return res.status(400).json({ error: "Validation error", message: "from/to inválidos (ISO, to > from, máx 31 dias)" });

  const rawStatuses = parsed.data.status ? parsed.data.status.split(",").filter(Boolean) : [];
  if (rawStatuses.some(s => !(CALENDAR_STATUSES as readonly string[]).includes(s))) {
    return res.status(400).json({ error: "Validation error", message: `status aceita: ${CALENDAR_STATUSES.join(", ")}` });
  }
  const statuses = rawStatuses.length > 0 ? (rawStatuses as CalendarStatus[]) : TODOS_STATUSES;
  const assignees = parsed.data.assignedTo !== undefined ? parsed.data.assignedTo.split(",").filter(Boolean) : ["me"];

  const workspaceId = parsed.data.workspaceId ?? null;
  if (workspaceId) {
    const [m] = await db.select({ id: workspaceMembers.id }).from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))).limit(1);
    if (!m) return res.status(403).json({ message: "Sem permissão" });
  }

  const rows = await listCalendarTasks({ userId, workspaceId, statuses, assignees, from: range.from, to: range.to });
  return res.json(rows);
});

export default router;
```
Se `workspaceMembers` não tiver coluna `id`, selecionar `{ userId: workspaceMembers.userId }`.

`artifacts/api-server/src/routes/index.ts`: importar `import calendarRouter from "./calendar";` junto dos outros imports de rotas e adicionar `router.use("/calendar", calendarRouter);` na linha **antes** de `router.use("/my-tasks", myTasksRouter);`.

- [ ] **Step 5: Rodar e ver passar**

Run: `DATABASE_URL=$DEV_DATABASE_URL JWT_SECRET=$JWT_SECRET npx vitest run calendarTasks`
Expected: 5 passed.

- [ ] **Step 6: Typecheck relativo da API**

Rodar o comando de Global Constraints; `grep -E "calendar(Tasks|\.ts)" $SCRATCH/api-tsc.txt` deve vir vazio e o total igual ao baseline.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/services/calendarTasksQuery.ts artifacts/api-server/src/routes/calendar.ts artifacts/api-server/src/routes/index.ts artifacts/api-server/src/__tests__/calendarTasks.smoke.test.ts
git commit -m "feat(api): GET /api/calendar/tasks com ativas + terminais da janela"
```

---

## Task 3: `PUT /api/calendar/reorder`

**Files:**
- Create: `artifacts/api-server/src/services/calendarReorderService.ts`
- Modify: `artifacts/api-server/src/routes/calendar.ts` (rota PUT)
- Test: `artifacts/api-server/src/__tests__/calendarReorder.smoke.test.ts`

**Interfaces:**
- Consumes: `canActOnMeeting(userId, row)` exportado de `routes/meetings.ts`; `ACTIVE_STATUSES` da Task 2.
- Produces: `PUT /api/calendar/reorder` body `ReorderBody` → `{ ok: true }` | 400 | 403 | 404.
  ```ts
  type ReorderBody = {
    date: string; // YYYY-MM-DD
    items: { kind: "task" | "meeting"; id: string }[];
    moved?: { kind: "task" | "meeting"; id: string; target: "day" | "pool" };
  };
  ```

- [ ] **Step 1: Escrever o teste que falha**

`artifacts/api-server/src/__tests__/calendarReorder.smoke.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Agent } from "supertest";
import { db } from "@workspace/db";
import { tasks, meetings } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { registerAndLogin, deleteUser, deleteWorkspaces, type TestUser } from "./helpers";

describe("PUT /api/calendar/reorder", () => {
  let agent: Agent;
  let user: TestUser;
  let outsider: { agent: Agent; user: TestUser };
  let wsId: string;
  let alienWsId: string;
  let a: string, b: string, c: string, done: string, alienTask: string, meetingId: string;

  const mk = async (ag: Agent, ws: string, title: string) => {
    const r = await ag.post(`/api/workspaces/${ws}/tasks`).send({ title });
    await ag.patch(`/api/workspaces/${ws}/tasks/${r.body.id}/status`).send({ status: "pending" });
    return r.body.id as string;
  };
  const row = async (id: string) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0];

  beforeAll(async () => {
    ({ agent, user } = await registerAndLogin("Reorder Owner"));
    outsider = await registerAndLogin("Reorder Outsider");
    wsId = (await agent.post("/api/workspaces").send({ name: "WS Reorder" })).body.id;
    alienWsId = (await outsider.agent.post("/api/workspaces").send({ name: "WS Reorder Alheio" })).body.id;
    a = await mk(agent, wsId, "A");
    b = await mk(agent, wsId, "B");
    c = await mk(agent, wsId, "C");
    done = await mk(agent, wsId, "D");
    await agent.patch(`/api/workspaces/${wsId}/tasks/${done}/status`).send({ status: "completed" });
    alienTask = await mk(outsider.agent, alienWsId, "X");
    const [m] = await db.insert(meetings).values({
      workspaceId: wsId, meetCode: "cal-reorder-m", status: "scheduled",
      occurredAt: new Date(), scheduledStartAt: new Date(), scheduledEndAt: new Date(Date.now() + 3_600_000),
    }).returning();
    meetingId = m.id;
  });

  afterAll(async () => {
    await db.delete(meetings).where(eq(meetings.id, meetingId));
    await deleteWorkspaces([wsId, alienWsId]);
    await deleteUser(user.id);
    await deleteUser(outsider.user.id);
  });

  it("grava ordem densa na coluna e data pretendida só no movido", async () => {
    const r = await agent.put("/api/calendar/reorder").send({
      date: "2030-01-07",
      items: [{ kind: "task", id: c }, { kind: "meeting", id: meetingId }, { kind: "task", id: a }],
      moved: { kind: "task", id: c, target: "day" },
    });
    expect(r.status).toBe(200);
    expect((await row(c)).plannedDate).toBe("2030-01-07");
    expect((await row(c)).plannedOrder).toBe(0);
    expect((await row(a)).plannedDate).toBeNull();
    expect((await row(a)).plannedOrder).toBe(2);
    const [m] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
    expect(m.plannedOrder).toBe(1);
  });

  it("soltar no pool limpa data e ordem", async () => {
    const r = await agent.put("/api/calendar/reorder").send({
      date: "2030-01-07", items: [], moved: { kind: "task", id: c, target: "pool" },
    });
    expect(r.status).toBe(200);
    expect((await row(c)).plannedDate).toBeNull();
    expect((await row(c)).plannedOrder).toBeNull();
  });

  it("403 com tarefa de workspace alheio e nada é gravado", async () => {
    await db.update(tasks).set({ plannedOrder: null }).where(inArray(tasks.id, [a, b]));
    const r = await agent.put("/api/calendar/reorder").send({
      date: "2030-01-08",
      items: [{ kind: "task", id: a }, { kind: "task", id: alienTask }],
    });
    expect(r.status).toBe(403);
    expect((await row(a)).plannedOrder).toBeNull();
  });

  it("400: reunião movida, terminal movida, ids duplicados, pool com itens, movido fora dos itens", async () => {
    const put = (body: unknown) => agent.put("/api/calendar/reorder").send(body);
    expect((await put({ date: "2030-01-08", items: [{ kind: "meeting", id: meetingId }], moved: { kind: "meeting", id: meetingId, target: "day" } })).status).toBe(400);
    expect((await put({ date: "2030-01-08", items: [{ kind: "task", id: done }], moved: { kind: "task", id: done, target: "day" } })).status).toBe(400);
    expect((await put({ date: "2030-01-08", items: [{ kind: "task", id: a }, { kind: "task", id: a }] })).status).toBe(400);
    expect((await put({ date: "2030-01-08", items: [{ kind: "task", id: a }], moved: { kind: "task", id: a, target: "pool" } })).status).toBe(400);
    expect((await put({ date: "2030-01-08", items: [{ kind: "task", id: a }], moved: { kind: "task", id: b, target: "day" } })).status).toBe(400);
    expect((await put({ date: "08/01/2030", items: [] })).status).toBe(400);
  });

  it("404 com id inexistente", async () => {
    const r = await agent.put("/api/calendar/reorder").send({
      date: "2030-01-08", items: [{ kind: "task", id: "00000000-0000-4000-8000-000000000000" }],
    });
    expect(r.status).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `... npx vitest run calendarReorder` → FAIL (404 na rota).

- [ ] **Step 3: Implementar o serviço**

`artifacts/api-server/src/services/calendarReorderService.ts`:
```ts
import { z } from "zod/v4";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { tasks, meetings, workspaceMembers } from "@workspace/db/schema";
import { canActOnMeeting } from "../routes/meetings";
import { ACTIVE_STATUSES } from "./calendarTasksQuery";

export const reorderSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(z.object({ kind: z.enum(["task", "meeting"]), id: z.string().uuid() })).max(500),
  moved: z.object({
    kind: z.enum(["task", "meeting"]),
    id: z.string().uuid(),
    target: z.enum(["day", "pool"]),
  }).optional(),
});
export type ReorderInput = z.infer<typeof reorderSchema>;

type Result = { status: number; body: unknown };
const bad = (message: string): Result => ({ status: 400, body: { error: "Validation error", message } });

export async function applyCalendarReorder(userId: string, input: ReorderInput): Promise<Result> {
  const keys = input.items.map(i => `${i.kind}:${i.id}`);
  if (new Set(keys).size !== keys.length) return bad("itens duplicados");
  const { moved } = input;
  if (moved) {
    if (moved.kind === "meeting") return bad("reunião não muda de dia pelo calendário");
    if (moved.target === "pool" && input.items.length > 0) return bad("soltar no pool não leva itens");
    if (moved.target === "day" && !keys.includes(`task:${moved.id}`)) return bad("item movido precisa estar na coluna");
  }

  const taskIds = Array.from(new Set([
    ...input.items.filter(i => i.kind === "task").map(i => i.id),
    ...(moved ? [moved.id] : []),
  ]));
  const meetingIds = input.items.filter(i => i.kind === "meeting").map(i => i.id);

  const taskRows = taskIds.length
    ? await db.select({ id: tasks.id, workspaceId: tasks.workspaceId, assignedTo: tasks.assignedTo, status: tasks.status })
        .from(tasks).where(inArray(tasks.id, taskIds))
    : [];
  if (taskRows.length !== taskIds.length) return { status: 404, body: { message: "Tarefa não encontrada" } };

  const wsIds = Array.from(new Set(taskRows.map(t => t.workspaceId).filter((w): w is string => !!w)));
  const memberOf = new Set(
    wsIds.length
      ? (await db.select({ workspaceId: workspaceMembers.workspaceId }).from(workspaceMembers)
          .where(and(eq(workspaceMembers.userId, userId), inArray(workspaceMembers.workspaceId, wsIds))))
          .map(m => m.workspaceId)
      : [],
  );
  for (const t of taskRows) {
    const allowed = t.workspaceId ? memberOf.has(t.workspaceId) : t.assignedTo === userId;
    if (!allowed) return { status: 403, body: { message: "Sem permissão" } };
  }
  if (moved) {
    const m = taskRows.find(t => t.id === moved.id)!;
    if (!(ACTIVE_STATUSES as readonly string[]).includes(m.status)) return bad("tarefa concluída/cancelada não muda de dia");
  }

  const meetingRows = meetingIds.length ? await db.select().from(meetings).where(inArray(meetings.id, meetingIds)) : [];
  if (meetingRows.length !== meetingIds.length) return { status: 404, body: { message: "Reunião não encontrada" } };
  for (const m of meetingRows) {
    if (!(await canActOnMeeting(userId, m))) return { status: 403, body: { message: "Sem permissão" } };
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i];
      if (item.kind === "meeting") {
        await tx.update(meetings).set({ plannedOrder: i }).where(eq(meetings.id, item.id));
      } else if (moved?.target === "day" && moved.id === item.id) {
        await tx.update(tasks).set({ plannedOrder: i, plannedDate: input.date }).where(eq(tasks.id, item.id));
      } else {
        await tx.update(tasks).set({ plannedOrder: i }).where(eq(tasks.id, item.id));
      }
    }
    if (moved?.target === "pool") {
      await tx.update(tasks).set({ plannedDate: null, plannedOrder: null }).where(eq(tasks.id, moved.id));
    }
  });
  return { status: 200, body: { ok: true } };
}
```

- [ ] **Step 4: Adicionar a rota**

Em `routes/calendar.ts`, importar `import { reorderSchema, applyCalendarReorder } from "../services/calendarReorderService";` e, antes do `export default`:
```ts
// PUT /api/calendar/reorder — grava a ordem final de uma coluna (e a data
// pretendida do item movido, ou limpa quando solto no pool).
router.put("/reorder", requireAuth, async (req: AuthRequest, res) => {
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Validation error", message: parsed.error.message });
  const result = await applyCalendarReorder(req.user!.userId, parsed.data);
  return res.status(result.status).json(result.body);
});
```

- [ ] **Step 5: Rodar e ver passar**

Run: `... npx vitest run calendarReorder calendarTasks` → todos passam.

- [ ] **Step 6: Typecheck relativo da API** (como na Task 2, grep `calendarReorder`).

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/services/calendarReorderService.ts artifacts/api-server/src/routes/calendar.ts artifacts/api-server/src/__tests__/calendarReorder.smoke.test.ts
git commit -m "feat(api): PUT /api/calendar/reorder com ordem densa e autorização por item"
```

---

## Task 4: Regra de ordem na reatribuição e no urgente

**Files:**
- Create: `artifacts/api-server/src/services/calendarOrderService.ts`
- Modify: `artifacts/api-server/src/routes/workspaceTasks.ts` (POST `/` e PATCH `/:taskId`)
- Modify: `artifacts/api-server/src/routes/myTasks.ts` (POST `/`, PATCH `/:taskId`, PATCH `/:taskId/association`)
- Modify: `artifacts/api-server/src/routes/cards.ts` (POST `/:cardId/task`, PATCH `/:cardId/task/details`)
- Modify: `artifacts/api-server/src/services/taskMoveService.ts` (após a transação)
- Test: `artifacts/api-server/src/__tests__/calendarOrder.smoke.test.ts`

**Interfaces:**
- Produces:
  - `export function todayYmdSP(): string` (hoje em `America/Sao_Paulo`, `YYYY-MM-DD`).
  - `export async function applyOrderRules(taskId: string, todayOverride?: string): Promise<void>`
  - `export async function safeApplyOrderRules(taskId: string): Promise<void>` — mesmo, mas captura e loga erro (uso nas rotas).

- [ ] **Step 1: Escrever o teste que falha**

`artifacts/api-server/src/__tests__/calendarOrder.smoke.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Agent } from "supertest";
import { db } from "@workspace/db";
import { tasks, workspaceMembers } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { registerAndLogin, deleteUser, deleteWorkspaces, type TestUser } from "./helpers";
import { applyOrderRules, todayYmdSP } from "../services/calendarOrderService";

const addDays = (ymd: string, n: number) => {
  const d = new Date(ymd + "T12:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe("calendarOrderService.applyOrderRules", () => {
  let agent: Agent;
  let owner: TestUser;
  let mate: TestUser;
  let wsId: string;
  const today = todayYmdSP();
  const future = addDays(today, 10);

  const insert = async (v: Partial<typeof tasks.$inferInsert> & { title: string }) => {
    const [t] = await db.insert(tasks).values({
      workspaceId: wsId, status: "pending", createdBy: owner.id, ownerId: owner.id, ...v,
    }).returning();
    return t.id;
  };
  const order = async (id: string) => (await db.select().from(tasks).where(eq(tasks.id, id)))[0].plannedOrder;

  beforeAll(async () => {
    ({ agent, user: owner } = await registerAndLogin("Order Owner"));
    const m = await registerAndLogin("Order Mate");
    mate = m.user;
    wsId = (await agent.post("/api/workspaces").send({ name: "WS Order" })).body.id;
    await db.insert(workspaceMembers).values({ workspaceId: wsId, userId: mate.id, role: "editor" });
  });

  afterAll(async () => {
    await deleteWorkspaces([wsId]);
    await deleteUser(owner.id);
    await deleteUser(mate.id);
  });

  it("reatribuir via PATCH vai para o fim do dia do novo responsável", async () => {
    await insert({ title: "m0", assignedTo: mate.id, plannedDate: future, plannedOrder: 0 });
    await insert({ title: "m1", assignedTo: mate.id, dueDate: new Date(future + "T12:00:00.000Z"), scheduleMode: "ate", plannedOrder: 1 });
    const moving = await insert({ title: "mv", assignedTo: owner.id, plannedDate: future, plannedOrder: 0 });
    const r = await agent.patch(`/api/workspaces/${wsId}/tasks/${moving}`).send({ assignedTo: mate.id });
    expect(r.status).toBe(200);
    expect(await order(moving)).toBe(2);
  });

  it("urgente vai para o topo (min - 1) na coluna de hoje", async () => {
    await insert({ title: "h0", assignedTo: owner.id, plannedDate: today, plannedOrder: 0 });
    await insert({ title: "h-late", assignedTo: owner.id, dueDate: new Date(addDays(today, -3) + "T12:00:00.000Z"), scheduleMode: "ate", plannedOrder: 1 });
    const urg = await insert({ title: "urg", assignedTo: owner.id, scheduleMode: "urgente" });
    await applyOrderRules(urg, today);
    expect(await order(urg)).toBe(-1);
  });

  it("coluna sem ordem manual → null; terminal → no-op; atrasada ancora em hoje", async () => {
    const lonely = await insert({ title: "lonely", assignedTo: mate.id, plannedDate: addDays(today, 20), plannedOrder: 5 });
    await applyOrderRules(lonely, today);
    expect(await order(lonely)).toBeNull();

    const done = await insert({ title: "done", assignedTo: mate.id, status: "completed", plannedOrder: 7 });
    await applyOrderRules(done, today);
    expect(await order(done)).toBe(7);

    const late = await insert({ title: "late", assignedTo: owner.id, dueDate: new Date(addDays(today, -1) + "T12:00:00.000Z"), scheduleMode: "ate" });
    await applyOrderRules(late, today);
    // irmãs em hoje: h0 (0), h-late (1), urg (-1) → max + 1 = 2
    expect(await order(late)).toBe(2);
  });

  it("PATCH scheduleMode=urgente aplica o topo", async () => {
    const t = await insert({ title: "vira-urgente", assignedTo: owner.id, plannedDate: today });
    const r = await agent.patch(`/api/workspaces/${wsId}/tasks/${t}`).send({ scheduleMode: "urgente" });
    expect(r.status).toBe(200);
    // irmãs em hoje do owner: h0 (0), h-late (1), urg (-1), late (2) → min - 1 = -2
    expect(await order(t)).toBe(-2);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `... npx vitest run calendarOrder` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar o serviço**

`artifacts/api-server/src/services/calendarOrderService.ts`:
```ts
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { tasks } from "@workspace/db/schema";
import { getTodayLocal } from "../lib/overdue";
import { logger } from "../lib/logger";
import { ACTIVE_STATUSES } from "./calendarTasksQuery";

const log = logger.child({ module: "calendarOrder" });

/** Hoje em America/Sao_Paulo (mesma referência do overdue), YYYY-MM-DD. */
export function todayYmdSP(): string {
  return getTodayLocal().toISOString().slice(0, 10);
}

/**
 * Regra do calendário ao trocar responsável ou virar urgente: a tarefa vai para
 * o fim da coluna do dia do responsável (max + 1), ou para o topo se urgente
 * (min - 1). Coluna sem ordem manual → null (vale a ordem padrão).
 * Âncora = planned_date ?? due_date; sem data e urgente = hoje; passada = hoje.
 */
export async function applyOrderRules(taskId: string, todayOverride?: string): Promise<void> {
  const [t] = await db
    .select({
      id: tasks.id, status: tasks.status, assignedTo: tasks.assignedTo,
      plannedDate: tasks.plannedDate, dueDate: tasks.dueDate, scheduleMode: tasks.scheduleMode,
    })
    .from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!t || !(ACTIVE_STATUSES as readonly string[]).includes(t.status)) return;

  const today = todayOverride ?? todayYmdSP();
  const urgente = t.scheduleMode === "urgente";
  let d = t.plannedDate ?? (t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null);
  if (!d) {
    if (!urgente) {
      await db.update(tasks).set({ plannedOrder: null }).where(eq(tasks.id, taskId));
      return;
    }
    d = today;
  }
  if (d < today) d = today;

  const anchor = sql`COALESCE(${tasks.plannedDate}, (${tasks.dueDate})::date)`;
  const anchorCond = d === today
    ? or(sql`${anchor} <= ${today}::date`, and(eq(tasks.scheduleMode, "urgente"), sql`${anchor} IS NULL`))
    : sql`${anchor} = ${d}::date`;

  const [agg] = await db
    .select({
      min: sql<number | null>`MIN(${tasks.plannedOrder})`,
      max: sql<number | null>`MAX(${tasks.plannedOrder})`,
    })
    .from(tasks)
    .where(and(
      t.assignedTo ? eq(tasks.assignedTo, t.assignedTo) : isNull(tasks.assignedTo),
      ne(tasks.id, taskId),
      inArray(tasks.status, [...ACTIVE_STATUSES]),
      anchorCond,
    ));
  const min = agg?.min == null ? null : Number(agg.min);
  const max = agg?.max == null ? null : Number(agg.max);
  const next = urgente ? (min == null ? 0 : min - 1) : (max == null ? null : max + 1);
  await db.update(tasks).set({ plannedOrder: next }).where(eq(tasks.id, taskId));
}

/** Versão best-effort para as rotas: a mutação principal já foi gravada. */
export async function safeApplyOrderRules(taskId: string): Promise<void> {
  try {
    await applyOrderRules(taskId);
  } catch (err) {
    log.error({ taskId, err: err instanceof Error ? { message: err.message, cause: err.cause } : String(err) },
      "applyOrderRules failed (best-effort, swallowed)");
  }
}
```

- [ ] **Step 4: Ligar nas rotas**

Em cada arquivo, importar `import { safeApplyOrderRules } from "../services/calendarOrderService";` (em `taskMoveService.ts`: `from "./calendarOrderService"`).

`workspaceTasks.ts`, POST `/` — imediatamente antes do `res.status(201).json({...})`:
```ts
  if (task.scheduleMode === "urgente") await safeApplyOrderRules(task.id);
```
`workspaceTasks.ts`, PATCH `/:taskId` — logo após o bloco `if (touchesSchedule) { await tryActivateTask(taskId); }`:
```ts
  const becameUrgent = updated.scheduleMode === "urgente" && existing.scheduleMode !== "urgente";
  if (assigneeChanging || becameUrgent) await safeApplyOrderRules(taskId);
```
`myTasks.ts`, POST `/` — antes de `return res.status(201).json(newTask);`:
```ts
  if (newTask.scheduleMode === "urgente") await safeApplyOrderRules(newTask.id);
```
`myTasks.ts`, PATCH `/:taskId` — após `if (touchesSchedule) { await tryActivateTask(taskId); }`:
```ts
  if (updated.scheduleMode === "urgente" && existing.scheduleMode !== "urgente") await safeApplyOrderRules(taskId);
```
`myTasks.ts`, PATCH `/:taskId/association` — antes de `return res.json(updated);`:
```ts
  if (updateData.assignedTo !== undefined && updateData.assignedTo !== existing.assignedTo) {
    await safeApplyOrderRules(taskId);
  }
```
`cards.ts`, POST `/:cardId/task` — antes de `res.status(201).json(task);`:
```ts
  if (task.scheduleMode === "urgente") await safeApplyOrderRules(task.id);
```
`cards.ts`, PATCH `/:cardId/task/details` — após o bloco `if (touchesSchedule) { await tryActivateTask(card.taskId!); }`:
```ts
  const assigneeChanged = parsed.data.assignedTo !== undefined && !!currentTask && currentTask.assignedTo !== parsed.data.assignedTo;
  const becameUrgent = updatedTask.scheduleMode === "urgente" && currentTask?.scheduleMode !== "urgente";
  if (assigneeChanged || becameUrgent) await safeApplyOrderRules(card.taskId!);
```
`taskMoveService.ts` — logo após o `await db.transaction(...)` do move (antes do `recordTaskActivity`):
```ts
  if (nextAssignee !== task.assignedTo) await safeApplyOrderRules(taskId);
```

- [ ] **Step 5: Rodar e ver passar + regressão das suítes tocadas**

Run: `... npx vitest run calendarOrder taskOwner cardTaskOwner myTasksWorkspaceHandoff scheduleActivityResilience`
Expected: tudo verde (re-rodar uma vez se algo cair por timeout).

- [ ] **Step 6: Typecheck relativo da API** (grep dos 5 arquivos tocados: nenhuma linha nova em relação ao baseline, comparar por mensagem).

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/services/calendarOrderService.ts artifacts/api-server/src/routes/workspaceTasks.ts artifacts/api-server/src/routes/myTasks.ts artifacts/api-server/src/routes/cards.ts artifacts/api-server/src/services/taskMoveService.ts artifacts/api-server/src/__tests__/calendarOrder.smoke.test.ts
git commit -m "feat(api): ordem do calendário ao reatribuir (fim do dia) e ao virar urgente (topo)"
```

---

## Task 5: Reuniões por intervalo e eventos do Google por intervalo

**Files:**
- Modify: `artifacts/api-server/src/routes/meetings.ts` (GET `/`)
- Modify: `artifacts/api-server/src/routes/integrations/google-calendar.ts` (extrair coleta; nova rota `/events`)
- Test: `artifacts/api-server/src/__tests__/meetingsRange.smoke.test.ts`
- Test: `artifacts/api-server/src/__tests__/googleCalendarEvents.smoke.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/meetings?workspaceId=&from=<ISO>&to=<ISO>` → `Meeting[]` (agora com `plannedOrder`), só não-canceladas cujo `COALESCE(scheduled_start_at, occurred_at) ∈ [from,to)`, ordem crescente. Sem `from/to`: inalterado. Só um dos dois → 400.
  - `GET /api/integrations/google-calendar/events?from=<ISO>&to=<ISO>&tz=<IANA>` → `{ events: TodayEvent[]; cached: boolean; noCalendarsSelected: boolean }`; 400 intervalo inválido/>31 dias; 404 sem conta; 401 reauth; 503 flag.

- [ ] **Step 1: Escrever os testes que falham**

`meetingsRange.smoke.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { db } from "@workspace/db";
import { meetings, workspaces, workspaceMembers } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { registerAndLogin, deleteUser, deleteWorkspaces } from "./helpers";

describe("GET /api/meetings com from/to", () => {
  const ENV_KEYS = ["MEETINGS_ENABLED", "WORKER_URL", "WORKER_PANEL_TOKEN"] as const;
  const saved: Record<string, string | undefined> = {};
  const cleanup: { users: string[]; ws: string[]; meetings: string[] } = { users: [], ws: [], meetings: [] };

  afterAll(async () => {
    for (const id of cleanup.meetings) await db.delete(meetings).where(eq(meetings.id, id));
    await deleteWorkspaces(cleanup.ws);
    for (const id of cleanup.users) await deleteUser(id);
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  it("filtra por início na janela, exclui canceladas, ordena crescente; 400 com só um limite", async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.MEETINGS_ENABLED = "true";
    process.env.WORKER_URL = "http://worker.invalid";
    process.env.WORKER_PANEL_TOKEN = "t";

    const { agent, user } = await registerAndLogin();
    cleanup.users.push(user.id);
    const [ws] = await db.insert(workspaces).values({ name: "WS Range", createdBy: user.id }).returning();
    cleanup.ws.push(ws.id);
    await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: user.id, role: "admin" });

    const h = 3_600_000;
    const base = Date.now();
    const at = (hrs: number) => new Date(base + hrs * h);
    const rows = await db.insert(meetings).values([
      { workspaceId: ws.id, meetCode: "rng-late", status: "scheduled", occurredAt: at(30), scheduledStartAt: at(30), scheduledEndAt: at(31) },
      { workspaceId: ws.id, meetCode: "rng-early", status: "scheduled", occurredAt: at(2), scheduledStartAt: at(2), scheduledEndAt: at(3) },
      { workspaceId: ws.id, meetCode: "rng-canceled", status: "canceled", occurredAt: at(5), scheduledStartAt: at(5), scheduledEndAt: at(6) },
      { workspaceId: ws.id, meetCode: "rng-out", status: "scheduled", occurredAt: at(24 * 20), scheduledStartAt: at(24 * 20), scheduledEndAt: at(24 * 20 + 1) },
      { workspaceId: ws.id, meetCode: "rng-transcribed", status: "transcribed", occurredAt: at(-2) },
    ]).returning();
    cleanup.meetings.push(...rows.map(r => r.id));

    const from = encodeURIComponent(at(-24).toISOString());
    const to = encodeURIComponent(at(24 * 7).toISOString());
    const r = await agent.get(`/api/meetings?workspaceId=${ws.id}&from=${from}&to=${to}`);
    expect(r.status).toBe(200);
    expect(r.body.map((m: any) => m.meetCode)).toEqual(["rng-transcribed", "rng-early", "rng-late"]);
    expect(r.body[0]).toHaveProperty("plannedOrder");

    const cross = await agent.get(`/api/meetings?from=${from}&to=${to}`);
    expect(cross.status).toBe(200);
    expect(cross.body.map((m: any) => m.meetCode)).toEqual(["rng-transcribed", "rng-early", "rng-late"]);

    expect((await agent.get(`/api/meetings?from=${from}`)).status).toBe(400);
    expect((await agent.get(`/api/meetings?from=xx&to=yy`)).status).toBe(400);
    const legacy = await agent.get(`/api/meetings?workspaceId=${ws.id}`);
    expect(legacy.body.length).toBe(5);
  });
});
```

`googleCalendarEvents.smoke.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { registerAndLogin, deleteUser } from "./helpers";

describe("GET /api/integrations/google-calendar/events", () => {
  const KEYS = ["GOOGLE_CALENDAR_ENABLED", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI"] as const;
  const saved: Record<string, string | undefined> = {};
  let userId = "";

  afterAll(async () => {
    await deleteUser(userId);
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  it("400 em intervalo inválido ou > 31 dias; 404 sem conta conectada", async () => {
    for (const k of KEYS) saved[k] = process.env[k];
    process.env.GOOGLE_CALENDAR_ENABLED = "true";
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost/cb";
    const { agent, user } = await registerAndLogin();
    userId = user.id;
    const now = Date.now();
    const q = (a: number, b: number) =>
      `from=${encodeURIComponent(new Date(now + a).toISOString())}&to=${encodeURIComponent(new Date(now + b).toISOString())}&tz=America%2FSao_Paulo`;
    const base = "/api/integrations/google-calendar/events";
    expect((await agent.get(`${base}?from=xx&to=yy`)).status).toBe(400);
    expect((await agent.get(`${base}?${q(0, 40 * 86_400_000)}`)).status).toBe(400);
    expect((await agent.get(`${base}?${q(0, -1000)}`)).status).toBe(400);
    expect((await agent.get(`${base}?${q(0, 7 * 86_400_000)}`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `... npx vitest run meetingsRange googleCalendarEvents` → FAIL.

- [ ] **Step 3: Implementar o intervalo em reuniões**

Em `routes/meetings.ts`, adicionar `ne, sql` ao import de `drizzle-orm`. Substituir o handler `GET "/"` por:
```ts
// GET /api/meetings?workspaceId=&from=&to=
// from/to (ISO, to exclusivo) alimentam o calendário semanal: só não-canceladas
// cujo início (scheduled_start_at ?? occurred_at) cai na janela, em ordem crescente.
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  const fromRaw = typeof req.query.from === "string" ? req.query.from : undefined;
  const toRaw = typeof req.query.to === "string" ? req.query.to : undefined;
  if (!!fromRaw !== !!toRaw) return res.status(400).json({ message: "from e to vão juntos" });
  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    return res.status(400).json({ message: "from/to inválidos" });
  }
  const startExpr = sql`COALESCE(${meetings.scheduledStartAt}, ${meetings.occurredAt})`;
  const rangeCond = from && to
    ? and(
        sql`${startExpr} >= ${from.toISOString()}::timestamp`,
        sql`${startExpr} < ${to.toISOString()}::timestamp`,
        ne(meetings.status, "canceled"),
      )
    : undefined;
  const orderBy = from && to ? asc(startExpr) : desc(meetings.createdAt);

  if (workspaceId) {
    if (!(await assertMembership(userId, workspaceId))) return res.status(403).json({ message: "Sem permissão" });
    const rows = await db.select().from(meetings)
      .where(and(eq(meetings.workspaceId, workspaceId), rangeCond))
      .orderBy(orderBy);
    return res.json(rows);
  }
  // sem workspace: tudo que o usuário legitimamente vê — standalone criadas por
  // ele + reuniões dos workspaces onde é membro. A agenda (my-tasks) é uma visão
  // cross-workspace e chama sem parâmetro; filtrar só standalone aqui esconderia
  // da UI toda reunião com workspace (e travaria o poll-through do syncMeetingFromWorker).
  const myWorkspaces = db.select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers).where(eq(workspaceMembers.userId, userId));
  const rows = await db.select().from(meetings)
    .where(and(
      or(
        and(eq(meetings.createdBy, userId), isNull(meetings.workspaceId)),
        inArray(meetings.workspaceId, myWorkspaces),
      ),
      rangeCond,
    ))
    .orderBy(orderBy);
  return res.json(rows);
});
```

- [ ] **Step 4: Implementar `/events` no Google Calendar**

Em `routes/integrations/google-calendar.ts`:

1. Extrair o miolo do `today-events` numa função no mesmo arquivo:
```ts
class NotConnectedError extends Error {}

async function collectEvents(
  userId: string, startISO: string, endISO: string, tz: string,
): Promise<{ events: TodayEvent[]; noCalendarsSelected: boolean }> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) throw new NotConnectedError();
  const enabledPrefs = await db
    .select()
    .from(userCalendarPreferences)
    .where(and(eq(userCalendarPreferences.userId, userId), eq(userCalendarPreferences.enabled, true)));
  if (enabledPrefs.length === 0) return { events: [], noCalendarsSelected: true };
  const allEvents: TodayEvent[] = [];
  for (const pref of enabledPrefs) {
    try {
      const events = await listEvents(accessToken, pref.googleCalendarId, startISO, endISO, tz);
      for (const ev of events) allEvents.push(toTodayEvent(ev, pref));
    } catch (innerErr) {
      if (innerErr instanceof GoogleAuthError) throw innerErr;
      log.warn({ err: innerErr, calendarId: pref.googleCalendarId }, "skipping calendar due to error");
    }
  }
  allEvents.sort(compareEvents);
  return { events: allEvents, noCalendarsSelected: false };
}
```
2. Reescrever o corpo do `try` do `today-events` para usar a função (mesmo comportamento):
```ts
  try {
    const { startISO, endISO } = computeDayWindow(tz);
    const { events, noCalendarsSelected } = await collectEvents(userId, startISO, endISO, tz);
    if (!noCalendarsSelected) eventsCache.set(cacheKey, { events, expiresAt: Date.now() + EVENTS_CACHE_TTL_MS });
    res.json({ events, cached: false, noCalendarsSelected });
  } catch (err) {
    if (err instanceof NotConnectedError) {
      return res.status(404).json({ error: "Not connected", message: "Conecte sua conta Google primeiro." });
    }
    if (err instanceof GoogleAuthError) {
      return res.status(401).json({ error: "Reauth required", message: "Sessão do Google expirou. Reconecte sua conta." });
    }
    log.error({ err }, "today-events failed");
    res.status(500).json({ error: "Internal", message: "Erro ao buscar eventos." });
  }
```
3. Nova rota logo após `today-events`:
```ts
const rangeQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  tz: z.string().min(1).max(64).optional(),
});
const MAX_EVENTS_RANGE_MS = 31 * 86_400_000;

// GET /events?from&to&tz — eventos de um intervalo (calendário semanal).
router.get("/events", requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId;
  const parsed = rangeQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Validation", message: "parâmetros inválidos" });
  const from = new Date(parsed.data.from);
  const to = new Date(parsed.data.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > MAX_EVENTS_RANGE_MS) {
    return res.status(400).json({ error: "Validation", message: "from/to inválidos (to > from, máx 31 dias)" });
  }
  const tz = parsed.data.tz || "UTC";
  const cacheKey = `${userId}::range::${from.toISOString()}::${to.toISOString()}::${tz}`;
  const cached = eventsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({ events: cached.events, cached: true, noCalendarsSelected: false });
  }
  try {
    const { events, noCalendarsSelected } = await collectEvents(userId, from.toISOString(), to.toISOString(), tz);
    if (!noCalendarsSelected) eventsCache.set(cacheKey, { events, expiresAt: Date.now() + EVENTS_CACHE_TTL_MS });
    res.json({ events, cached: false, noCalendarsSelected });
  } catch (err) {
    if (err instanceof NotConnectedError) {
      return res.status(404).json({ error: "Not connected", message: "Conecte sua conta Google primeiro." });
    }
    if (err instanceof GoogleAuthError) {
      return res.status(401).json({ error: "Reauth required", message: "Sessão do Google expirou. Reconecte sua conta." });
    }
    log.error({ err }, "events failed");
    res.status(500).json({ error: "Internal", message: "Erro ao buscar eventos." });
  }
});
```
A chave começa com `${userId}::`, então `invalidateEventsCache` já a limpa.

- [ ] **Step 5: Rodar e ver passar + regressão**

Run: `... npx vitest run meetingsRange googleCalendarEvents meetings googleCalendarEventMapping`
Expected: verde.

- [ ] **Step 6: Typecheck relativo da API** (grep `meetings.ts`, `google-calendar.ts`).

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/meetings.ts artifacts/api-server/src/routes/integrations/google-calendar.ts artifacts/api-server/src/__tests__/meetingsRange.smoke.test.ts artifacts/api-server/src/__tests__/googleCalendarEvents.smoke.test.ts
git commit -m "feat(api): leitura de reuniões e eventos do Google por intervalo"
```

---

## Task 6: Módulos puros do calendário (semana, ancoragem, drop)

**Files:**
- Create: `artifacts/mindtask-app/src/lib/calendar/week.ts`
- Create: `artifacts/mindtask-app/src/lib/calendar/placement.ts`
- Create: `artifacts/mindtask-app/src/lib/calendar/dnd.ts`
- Test: `artifacts/mindtask-app/src/lib/calendar/week.test.ts`, `placement.test.ts`, `dnd.test.ts`

**Interfaces:**
- Consumes: tipos `TaskListItemData` (`@/components/tasks/TaskListItem`), `Meeting` (`@/components/meetings/useMeetings`), `TodayEvent` (`@/hooks/useGoogleCalendar`) — só `import type`.
- Produces (usados pelas Tasks 11–13):
  - `week.ts`: `ymdLocal(d: Date): string`, `parseYmd(ymd): Date`, `addDaysYmd(ymd, n): string`, `startOfWeekMonday(ymd): string`, `weekDays(weekStart): string[]`, `weekBoundsISO(weekStart): { from: string; to: string }`, `WEEKDAY_SHORT: string[]`.
  - `placement.ts`: `CalendarTask`, `CalendarMeeting`, `CalendarEvent`, `ColumnItem`, `DayColumnModel`, `WeekModel`, `itemKey(kind, id)`, `isActiveStatus(s)`, `anchorOfTask(t, today)`, `eventDays(e)`, `compareColumnItems(a, b)`, `placeWeek(input)`.
  - `dnd.ts`: `POOL_ID`, `dayContainerId(date)`, `ReorderBody`, `OptimisticPatch`, `DropResult`, `computeDrop(input)`.

- [ ] **Step 1: Escrever os testes que falham**

`week.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { addDaysYmd, startOfWeekMonday, weekDays, weekBoundsISO, ymdLocal } from "./week";

describe("week", () => {
  it("segunda é o início; domingo volta 6 dias", () => {
    expect(startOfWeekMonday("2026-09-28")).toBe("2026-09-28"); // segunda
    expect(startOfWeekMonday("2026-10-01")).toBe("2026-09-28"); // quinta
    expect(startOfWeekMonday("2026-10-04")).toBe("2026-09-28"); // domingo
  });
  it("addDaysYmd cruza mês e ano", () => {
    expect(addDaysYmd("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDaysYmd("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("weekDays tem 7 dias seg→dom", () => {
    expect(weekDays("2026-09-28")).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
    ]);
  });
  it("weekBoundsISO cobre 7 dias locais", () => {
    const { from, to } = weekBoundsISO("2026-09-28");
    expect(ymdLocal(new Date(from))).toBe("2026-09-28");
    expect(ymdLocal(new Date(to))).toBe("2026-10-05");
  });
});
```

`placement.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { anchorOfTask, eventDays, placeWeek, type CalendarTask, type CalendarMeeting, type CalendarEvent } from "./placement";

const WEEK = "2026-09-28"; // seg
const TODAY = "2026-09-30"; // qua

let seq = 0;
function task(p: Partial<CalendarTask>): CalendarTask {
  seq += 1;
  return {
    id: p.id ?? `t${seq}`, workspaceId: "w", title: p.title ?? `t${seq}`, status: "pending", priority: "medium",
    dueDate: null, startAt: null, scheduleMode: "sem_prazo", plannedDate: null, plannedOrder: null,
    completedAt: null, cancelledAt: null, blockedSince: null, isApprovalTask: false,
    createdAt: `2026-09-01T10:00:${String(seq).padStart(2, "0")}.000Z`, updatedAt: "2026-09-01T10:00:00.000Z",
    ...p,
  } as CalendarTask;
}
function meeting(p: Partial<CalendarMeeting>): CalendarMeeting {
  return {
    id: p.id ?? "m1", workspaceId: "w", mapId: null, title: "reunião", meetCode: "abc", status: "scheduled",
    failureReason: null, episodeId: null, participants: null, occurredAt: "2026-09-30T13:00:00.000Z", durationSeconds: null,
    scheduledStartAt: "2026-09-30T13:00:00.000Z", scheduledEndAt: "2026-09-30T14:00:00.000Z", attendees: null,
    collectEnabled: true, attributionMethod: null, gcalEventId: null, gcalRecurringEventId: null, plannedOrder: null,
    ...p,
  } as CalendarMeeting;
}
const localIso = (ymd: string, h = 12) => new Date(`${ymd}T${String(h).padStart(2, "0")}:00:00`).toISOString();

describe("anchorOfTask", () => {
  it("concluída ancora no dia (local) da conclusão; cancelada no cancelamento", () => {
    expect(anchorOfTask(task({ status: "completed", completedAt: localIso("2026-09-29") }), TODAY)).toEqual({ kind: "day", date: "2026-09-29" });
    expect(anchorOfTask(task({ status: "blocked", cancelledAt: null, blockedSince: localIso("2026-09-28") }), TODAY)).toEqual({ kind: "day", date: "2026-09-28" });
    expect(anchorOfTask(task({ status: "completed", completedAt: null, updatedAt: localIso("2026-09-29") }), TODAY)).toEqual({ kind: "day", date: "2026-09-29" });
  });
  it("data pretendida vence o prazo; prazo sem pretendida; entre usa o prazo máximo", () => {
    expect(anchorOfTask(task({ plannedDate: "2026-10-02", dueDate: "2026-10-01T12:00:00.000Z" }), TODAY)).toEqual({ kind: "day", date: "2026-10-02" });
    expect(anchorOfTask(task({ dueDate: "2026-10-01T12:00:00.000Z", scheduleMode: "ate" }), TODAY)).toEqual({ kind: "day", date: "2026-10-01" });
    expect(anchorOfTask(task({ scheduleMode: "entre", startAt: "2026-09-29T12:00:00.000Z", dueDate: "2026-10-02T12:00:00.000Z" }), TODAY)).toEqual({ kind: "day", date: "2026-10-02" });
  });
  it("atrasada e urgente sem data vão para hoje; sem nada vai para o pool", () => {
    expect(anchorOfTask(task({ dueDate: "2026-09-20T12:00:00.000Z" }), TODAY)).toEqual({ kind: "day", date: TODAY });
    expect(anchorOfTask(task({ plannedDate: "2026-09-29" }), TODAY)).toEqual({ kind: "day", date: TODAY });
    expect(anchorOfTask(task({ scheduleMode: "urgente" }), TODAY)).toEqual({ kind: "day", date: TODAY });
    expect(anchorOfTask(task({}), TODAY)).toEqual({ kind: "pool" });
  });
  it("prazo em semana futura ancora lá", () => {
    expect(anchorOfTask(task({ dueDate: "2026-10-14T12:00:00.000Z" }), TODAY)).toEqual({ kind: "day", date: "2026-10-14" });
  });
});

describe("eventDays", () => {
  it("dia inteiro usa end exclusivo", () => {
    const e = { allDay: true, start: "2026-09-29", end: "2026-10-01" } as CalendarEvent;
    expect(eventDays(e)).toEqual(["2026-09-29", "2026-09-30"]);
  });
  it("evento que cruza meia-noite aparece nos dois dias; terminar à meia-noite não conta o dia seguinte", () => {
    const cross = { allDay: false, start: localIso("2026-09-29", 22), end: localIso("2026-09-30", 1) } as CalendarEvent;
    expect(eventDays(cross)).toEqual(["2026-09-29", "2026-09-30"]);
    const midnight = { allDay: false, start: localIso("2026-09-29", 23), end: new Date("2026-09-30T00:00:00").toISOString() } as CalendarEvent;
    expect(eventDays(midnight)).toEqual(["2026-09-29"]);
  });
});

describe("placeWeek", () => {
  it("ordem padrão: aprovação → reunião → tarefa; ordenados primeiro; terminais à parte", () => {
    const approval = task({ id: "ap", isApprovalTask: true, plannedDate: TODAY });
    const plain = task({ id: "pl", plannedDate: TODAY });
    const pinned = task({ id: "pin", plannedDate: TODAY, plannedOrder: 0 });
    const done = task({ id: "dn", status: "completed", completedAt: localIso(TODAY) });
    const m = meeting({ id: "mt" });
    const w = placeWeek({ tasks: [plain, approval, done, pinned], meetings: [m], events: [], weekStart: WEEK, today: TODAY });
    const wed = w.days.find(d => d.date === TODAY)!;
    expect(wed.items.map(i => i.key)).toEqual(["task:pin", "task:ap", "meeting:mt", "task:pl"]);
    expect(wed.terminal.map(t => t.id)).toEqual(["dn"]);
    expect(wed.isToday).toBe(true);
  });
  it("fim de semana só com conteúdo ou se hoje cair nele", () => {
    const w1 = placeWeek({ tasks: [], meetings: [], events: [], weekStart: WEEK, today: TODAY });
    expect(w1.visibleDays.map(d => d.date)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    const w2 = placeWeek({ tasks: [task({ plannedDate: "2026-10-04" })], meetings: [], events: [], weekStart: WEEK, today: TODAY });
    expect(w2.visibleDays.map(d => d.date)).toContain("2026-10-04");
    expect(w2.visibleDays.map(d => d.date)).not.toContain("2026-10-03");
    const w3 = placeWeek({ tasks: [], meetings: [], events: [], weekStart: WEEK, today: "2026-10-03" });
    expect(w3.visibleDays.map(d => d.date)).toContain("2026-10-03");
  });
  it("semana passada não recebe ativas; pool independe da semana; reunião cancelada some; evento de reunião é deduplicado", () => {
    const late = task({ id: "late", dueDate: "2026-09-22T12:00:00.000Z" });
    const loose = task({ id: "loose" });
    const past = placeWeek({ tasks: [late, loose], meetings: [], events: [], weekStart: "2026-09-21", today: TODAY });
    expect(past.days.flatMap(d => d.items)).toEqual([]);
    expect(past.pool.map(t => t.id)).toEqual(["loose"]);
    expect(past.days.every(d => d.isPast)).toBe(true);

    const ev = { id: "g1", allDay: false, start: localIso(TODAY, 9), end: localIso(TODAY, 10), title: "x" } as CalendarEvent;
    const synced = meeting({ id: "m2", gcalEventId: "g1" });
    const cancelled = meeting({ id: "m3", status: "canceled" });
    const cur = placeWeek({ tasks: [], meetings: [synced, cancelled], events: [ev], weekStart: WEEK, today: TODAY });
    const wed = cur.days.find(d => d.date === TODAY)!;
    expect(wed.events).toEqual([]);
    expect(wed.items.map(i => i.key)).toEqual(["meeting:m2"]);
  });
});
```

`dnd.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeDrop, dayContainerId, POOL_ID } from "./dnd";
import { placeWeek, type CalendarTask, type CalendarMeeting } from "./placement";

const WEEK = "2026-09-28";
const TODAY = "2026-09-30";
let n = 0;
const task = (p: Partial<CalendarTask>): CalendarTask => ({
  id: `t${++n}`, workspaceId: "w", title: "t", status: "pending", priority: "medium", dueDate: null, startAt: null,
  scheduleMode: "sem_prazo", plannedDate: null, plannedOrder: null, completedAt: null, cancelledAt: null,
  blockedSince: null, isApprovalTask: false, createdAt: `2026-09-01T00:00:${String(n).padStart(2, "0")}.000Z`,
  updatedAt: "2026-09-01T00:00:00.000Z", ...p,
} as CalendarTask);
const meeting = (id: string): CalendarMeeting => ({
  id, workspaceId: "w", mapId: null, title: "m", meetCode: "c", status: "scheduled", failureReason: null, episodeId: null,
  participants: null, occurredAt: "2026-09-30T13:00:00.000Z", durationSeconds: null,
  scheduledStartAt: "2026-09-30T13:00:00.000Z", scheduledEndAt: "2026-09-30T14:00:00.000Z", attendees: null,
  collectEnabled: true, attributionMethod: null, gcalEventId: null, gcalRecurringEventId: null, plannedOrder: null,
} as CalendarMeeting);

function fixture() {
  const a = task({ id: "a", plannedDate: "2026-10-01", plannedOrder: 0 });
  const b = task({ id: "b", plannedDate: "2026-10-01", plannedOrder: 1 });
  const c = task({ id: "c", plannedDate: "2026-10-01", plannedOrder: 2 });
  const d = task({ id: "d", plannedDate: "2026-10-02" });
  const p = task({ id: "p" });
  const week = placeWeek({ tasks: [a, b, c, d, p], meetings: [meeting("m")], events: [], weekStart: WEEK, today: TODAY });
  return week;
}

describe("computeDrop", () => {
  it("reordena dentro da coluna (arrayMove)", () => {
    const r = computeDrop({ week: fixture(), activeKey: "task:a", overId: "task:c", today: TODAY });
    expect(r.ok && r.body).toEqual({ date: "2026-10-01", items: [{ kind: "task", id: "b" }, { kind: "task", id: "c" }, { kind: "task", id: "a" }] });
    expect(r.ok && r.optimistic.tasks).toEqual({ b: { plannedOrder: 0 }, c: { plannedOrder: 1 }, a: { plannedOrder: 2 } });
  });
  it("move para outra coluna antes do card alvo e marca moved", () => {
    const r = computeDrop({ week: fixture(), activeKey: "task:d", overId: "task:b", today: TODAY });
    expect(r.ok && r.body).toEqual({
      date: "2026-10-01",
      items: [{ kind: "task", id: "a" }, { kind: "task", id: "d" }, { kind: "task", id: "b" }, { kind: "task", id: "c" }],
      moved: { kind: "task", id: "d", target: "day" },
    });
    expect(r.ok && r.optimistic.tasks.d).toEqual({ plannedOrder: 1, plannedDate: "2026-10-01" });
  });
  it("soltar no container anexa ao fim; pool → dia funciona", () => {
    const r = computeDrop({ week: fixture(), activeKey: "task:p", overId: dayContainerId("2026-10-02"), today: TODAY });
    expect(r.ok && r.body).toEqual({
      date: "2026-10-02", items: [{ kind: "task", id: "d" }, { kind: "task", id: "p" }], moved: { kind: "task", id: "p", target: "day" },
    });
  });
  it("dia → pool limpa", () => {
    const r = computeDrop({ week: fixture(), activeKey: "task:a", overId: POOL_ID, today: TODAY });
    expect(r.ok && r.body).toEqual({ date: "2026-10-01", items: [], moved: { kind: "task", id: "a", target: "pool" } });
    expect(r.ok && r.optimistic.tasks.a).toEqual({ plannedOrder: null, plannedDate: null });
  });
  it("rejeita coluna passada, reunião mudando de dia e no-op", () => {
    expect(computeDrop({ week: fixture(), activeKey: "task:a", overId: dayContainerId("2026-09-29"), today: TODAY })).toEqual({ ok: false, reason: "past" });
    expect(computeDrop({ week: fixture(), activeKey: "meeting:m", overId: dayContainerId("2026-10-01"), today: TODAY })).toEqual({ ok: false, reason: "meeting-cross-day" });
    expect(computeDrop({ week: fixture(), activeKey: "task:a", overId: "task:a", today: TODAY })).toEqual({ ok: false, reason: "noop" });
    expect(computeDrop({ week: fixture(), activeKey: "task:p", overId: POOL_ID, today: TODAY })).toEqual({ ok: false, reason: "noop" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd artifacts/mindtask-app && npx vitest run src/lib/calendar` → FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar `week.ts`**

```ts
/** Datas do calendário: sempre YYYY-MM-DD no fuso local do navegador. */
export function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDaysYmd(ymd: string, n: number): string {
  const d = parseYmd(ymd);
  d.setDate(d.getDate() + n);
  return ymdLocal(d);
}

export function startOfWeekMonday(ymd: string): string {
  const d = parseYmd(ymd);
  const dow = (d.getDay() + 6) % 7; // seg=0 … dom=6
  d.setDate(d.getDate() - dow);
  return ymdLocal(d);
}

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i));
}

/** [from, to) da semana em instantes ISO (meia-noite local). */
export function weekBoundsISO(weekStart: string): { from: string; to: string } {
  return { from: parseYmd(weekStart).toISOString(), to: parseYmd(addDaysYmd(weekStart, 7)).toISOString() };
}

export const WEEKDAY_SHORT = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
```

- [ ] **Step 4: Implementar `placement.ts`**

```ts
import type { TaskListItemData } from "@/components/tasks/TaskListItem";
import type { Meeting } from "@/components/meetings/useMeetings";
import type { TodayEvent } from "@/hooks/useGoogleCalendar";
import { addDaysYmd, weekDays, ymdLocal } from "./week";

export interface CalendarTask extends TaskListItemData {
  description?: string | null;
  plannedDate: string | null;
  plannedOrder: number | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  approvalStatus?: string | null;
  parentApprovalStatus?: string | null;
}
export type CalendarMeeting = Meeting & { plannedOrder: number | null };
export type CalendarEvent = TodayEvent;

export type ColumnItem =
  | { key: string; kind: "task" | "approval"; id: string; plannedOrder: number | null; task: CalendarTask }
  | { key: string; kind: "meeting"; id: string; plannedOrder: number | null; meeting: CalendarMeeting };

export interface DayColumnModel {
  date: string;
  isToday: boolean;
  isPast: boolean;
  isWeekend: boolean;
  events: CalendarEvent[];
  items: ColumnItem[];
  terminal: CalendarTask[];
}
export interface WeekModel {
  days: DayColumnModel[];
  visibleDays: DayColumnModel[];
  pool: CalendarTask[];
}
export type Anchor = { kind: "day"; date: string } | { kind: "pool" };

const ACTIVE = new Set(["draft", "pending", "in_progress"]);
const TYPE_RANK: Record<ColumnItem["kind"], number> = { approval: 0, meeting: 1, task: 2 };
const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** A API usa kind "task" também para aprovação: a chave de DnD segue a API. */
export function itemKey(kind: "task" | "meeting", id: string): string {
  return `${kind}:${id}`;
}

export function isActiveStatus(status: string): boolean {
  return ACTIVE.has(status);
}

function localDayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : ymdLocal(d);
}

/** null = não aparece no calendário (terminal sem nenhuma data). */
export function anchorOfTask(t: CalendarTask, today: string): Anchor | null {
  if (t.status === "completed") {
    const d = localDayOf(t.completedAt) ?? localDayOf(t.updatedAt);
    return d ? { kind: "day", date: d } : null;
  }
  if (t.status === "blocked") {
    const d = localDayOf(t.cancelledAt) ?? localDayOf(t.blockedSince) ?? localDayOf(t.updatedAt);
    return d ? { kind: "day", date: d } : null;
  }
  const base = t.plannedDate ?? (t.dueDate ? t.dueDate.slice(0, 10) : null);
  if (!base) return t.scheduleMode === "urgente" ? { kind: "day", date: today } : { kind: "pool" };
  if (base < today) return { kind: "day", date: today };
  return { kind: "day", date: base };
}

export function meetingStart(m: CalendarMeeting): string {
  return m.scheduledStartAt ?? m.occurredAt;
}

/** Dias (YYYY-MM-DD local) cobertos por um evento. `end` é exclusivo. */
export function eventDays(e: CalendarEvent): string[] {
  const days: string[] = [];
  if (e.allDay) {
    const start = e.start.slice(0, 10);
    const endEx = e.end ? e.end.slice(0, 10) : addDaysYmd(start, 1);
    for (let d = start; d < endEx && days.length < 62; d = addDaysYmd(d, 1)) days.push(d);
    return days.length ? days : [start];
  }
  const s = new Date(e.start);
  const en = new Date(e.end || e.start);
  if (Number.isNaN(s.getTime())) return days;
  const first = ymdLocal(s);
  const last = ymdLocal(new Date(Math.max(s.getTime(), en.getTime() - 1)));
  for (let d = first; d <= last && days.length < 62; d = addDaysYmd(d, 1)) days.push(d);
  return days;
}

function taskDue(t: CalendarTask): string | null {
  return t.dueDate ? t.dueDate.slice(0, 10) : null;
}

export function compareColumnItems(a: ColumnItem, b: ColumnItem): number {
  const ao = a.plannedOrder;
  const bo = b.plannedOrder;
  if (ao != null && bo != null && ao !== bo) return ao - bo;
  if (ao != null && bo == null) return -1;
  if (ao == null && bo != null) return 1;
  const tr = TYPE_RANK[a.kind] - TYPE_RANK[b.kind];
  if (tr !== 0) return tr;
  if (a.kind === "meeting" && b.kind === "meeting") {
    const c = meetingStart(a.meeting).localeCompare(meetingStart(b.meeting));
    if (c !== 0) return c;
  } else if (a.kind !== "meeting" && b.kind !== "meeting") {
    const ad = taskDue(a.task);
    const bd = taskDue(b.task);
    if (ad !== bd) {
      if (ad == null) return 1;
      if (bd == null) return -1;
      return ad < bd ? -1 : 1;
    }
    const pr = (PRIORITY_RANK[a.task.priority] ?? 9) - (PRIORITY_RANK[b.task.priority] ?? 9);
    if (pr !== 0) return pr;
    const cr = a.task.createdAt.localeCompare(b.task.createdAt);
    if (cr !== 0) return cr;
  }
  return a.id.localeCompare(b.id);
}

function terminalInstant(t: CalendarTask): string {
  return (t.status === "completed" ? t.completedAt : t.cancelledAt ?? t.blockedSince) ?? t.updatedAt;
}

function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return a.start.localeCompare(b.start);
}

export function placeWeek(input: {
  tasks: CalendarTask[];
  meetings: CalendarMeeting[];
  events: CalendarEvent[];
  weekStart: string;
  today: string;
}): WeekModel {
  const dates = weekDays(input.weekStart);
  const byDate = new Map<string, DayColumnModel>(
    dates.map((date, i) => [date, {
      date, isToday: date === input.today, isPast: date < input.today, isWeekend: i >= 5,
      events: [], items: [], terminal: [],
    }]),
  );
  const pool: CalendarTask[] = [];

  for (const t of input.tasks) {
    const anchor = anchorOfTask(t, input.today);
    if (!anchor) continue;
    if (anchor.kind === "pool") { pool.push(t); continue; }
    const col = byDate.get(anchor.date);
    if (!col) continue;
    if (!isActiveStatus(t.status)) { col.terminal.push(t); continue; }
    col.items.push({
      key: itemKey("task", t.id), kind: t.isApprovalTask ? "approval" : "task",
      id: t.id, plannedOrder: t.plannedOrder, task: t,
    });
  }

  const syncedEventIds = new Set<string>();
  for (const m of input.meetings) {
    if (m.gcalEventId) syncedEventIds.add(m.gcalEventId);
    if (m.status === "canceled") continue;
    const col = byDate.get(ymdLocal(new Date(meetingStart(m))));
    if (!col) continue;
    col.items.push({ key: itemKey("meeting", m.id), kind: "meeting", id: m.id, plannedOrder: m.plannedOrder, meeting: m });
  }

  for (const e of input.events) {
    if (syncedEventIds.has(e.id)) continue;
    for (const d of eventDays(e)) byDate.get(d)?.events.push(e);
  }

  const days = dates.map(d => byDate.get(d)!);
  for (const col of days) {
    col.items.sort(compareColumnItems);
    col.terminal.sort((a, b) => terminalInstant(a).localeCompare(terminalInstant(b)));
    col.events.sort(compareEvents);
  }
  pool.sort((a, b) =>
    ((PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)) || a.createdAt.localeCompare(b.createdAt));

  const hasContent = (c: DayColumnModel) => c.events.length + c.items.length + c.terminal.length > 0;
  const visibleDays = days.filter(c => !c.isWeekend || c.isToday || hasContent(c));
  return { days, visibleDays, pool };
}
```

- [ ] **Step 5: Implementar `dnd.ts`**

```ts
import type { ColumnItem, WeekModel } from "./placement";

export const POOL_ID = "pool";
export const dayContainerId = (date: string) => `day:${date}`;

export interface ReorderBody {
  date: string;
  items: { kind: "task" | "meeting"; id: string }[];
  moved?: { kind: "task"; id: string; target: "day" | "pool" };
}
export interface OptimisticPatch {
  tasks: Record<string, { plannedOrder: number | null; plannedDate?: string | null }>;
  meetings: Record<string, { plannedOrder: number | null }>;
}
export type DropResult =
  | { ok: false; reason: "noop" | "past" | "meeting-cross-day" | "invalid" }
  | { ok: true; body: ReorderBody; optimistic: OptimisticPatch };

type Loc = { container: "pool" } | { container: "day"; date: string; index: number };

function locate(week: WeekModel, key: string): Loc | null {
  for (const d of week.days) {
    const index = d.items.findIndex(i => i.key === key);
    if (index >= 0) return { container: "day", date: d.date, index };
  }
  if (week.pool.some(t => `task:${t.id}` === key)) return { container: "pool" };
  return null;
}

const apiKind = (i: ColumnItem): "task" | "meeting" => (i.kind === "meeting" ? "meeting" : "task");

/** Traduz um drop do dnd-kit na chamada de reorder + patch otimista. Puro. */
export function computeDrop(input: { week: WeekModel; activeKey: string; overId: string; today: string }): DropResult {
  const { week, activeKey, overId, today } = input;
  const source = locate(week, activeKey);
  if (!source) return { ok: false, reason: "invalid" };
  const [kind, id] = activeKey.split(":") as ["task" | "meeting", string];

  let target: Loc | null;
  if (overId === POOL_ID) target = { container: "pool" };
  else if (overId.startsWith("day:")) {
    const date = overId.slice(4);
    const col = week.days.find(d => d.date === date);
    target = col ? { container: "day", date, index: col.items.length } : null;
  } else target = locate(week, overId);
  if (!target) return { ok: false, reason: "invalid" };

  if (kind === "meeting") {
    if (target.container === "pool" || source.container === "pool" || target.date !== source.date) {
      return { ok: false, reason: "meeting-cross-day" };
    }
  }

  if (target.container === "pool") {
    if (source.container === "pool") return { ok: false, reason: "noop" };
    return {
      ok: true,
      body: { date: source.date, items: [], moved: { kind: "task", id, target: "pool" } },
      optimistic: { tasks: { [id]: { plannedOrder: null, plannedDate: null } }, meetings: {} },
    };
  }

  if (target.date < today) return { ok: false, reason: "past" };
  const col = week.days.find(d => d.date === target.date)!;
  const sameColumn = source.container === "day" && source.date === target.date;
  let ordered: ColumnItem[];
  if (sameColumn) {
    if (source.index === target.index || (overId.startsWith("day:") && source.index === col.items.length - 1)) {
      return { ok: false, reason: "noop" };
    }
    ordered = col.items.slice();
    const [moving] = ordered.splice(source.index, 1);
    const to = overId.startsWith("day:") ? ordered.length : target.index;
    ordered.splice(to, 0, moving);
  } else {
    const moving: ColumnItem = source.container === "pool"
      ? { key: activeKey, kind: "task", id, plannedOrder: null, task: week.pool.find(t => t.id === id)! }
      : week.days.find(d => d.date === source.date)!.items[source.index];
    ordered = col.items.slice();
    ordered.splice(target.index, 0, moving);
  }

  const optimistic: OptimisticPatch = { tasks: {}, meetings: {} };
  ordered.forEach((item, i) => {
    if (item.kind === "meeting") optimistic.meetings[item.id] = { plannedOrder: i };
    else optimistic.tasks[item.id] = { plannedOrder: i };
  });
  const body: ReorderBody = { date: target.date, items: ordered.map(i => ({ kind: apiKind(i), id: i.id })) };
  if (!sameColumn) {
    body.moved = { kind: "task", id, target: "day" };
    optimistic.tasks[id] = { plannedOrder: optimistic.tasks[id].plannedOrder, plannedDate: target.date };
  }
  return { ok: true, body, optimistic };
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run src/lib/calendar` → todos passam. Rodar também `npx vitest run` inteiro (approvalGroups/embedBridge continuam verdes).

- [ ] **Step 7: Commit**

```bash
git add artifacts/mindtask-app/src/lib/calendar
git commit -m "feat(calendario): semana, ancoragem e cálculo de drop como funções puras"
```

---

## Task 7: Extrair `TaskCardBody` do `MindMapNode`

**Files:**
- Create: `artifacts/mindtask-app/src/components/maps/TaskCardBody.tsx`
- Modify: `artifacts/mindtask-app/src/components/maps/MindMapNode.tsx` (vira wrapper)
- Modify: `artifacts/mindtask-app/src/components/tasks/AssigneeAvatarPicker.tsx` (tipo de `members` estrutural)
- Create: `e2e/canvas-card-inline.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ScheduleModeValue = "ate" | "entre" | "em" | "sem_prazo" | "urgente";
  export type SchedulePatch = { scheduleMode?: ScheduleModeValue; startAt?: string | null; dueDate?: string | null };
  export interface TaskCardData {
    title: string; statusVisual: string; taskId?: string | null;
    taskDueDate?: string | null; taskStartAt?: string | null; taskScheduleMode?: ScheduleModeValue | null;
    taskAssigneeName?: string | null; taskAssigneeId?: string | null; taskAssigneeAvatarUrl?: string | null;
    taskDescription?: string | null; taskCompletedAt?: string | null; taskParentApprovalStatus?: string | null;
    taskAttachmentCount?: number | null; taskSubtaskCount?: number | null;
    taskSubtaskCompletedCount?: number | null; taskCommentCount?: number | null;
  }
  export interface TaskCardBodyProps {
    data: TaskCardData;
    selected?: boolean;
    /** "canvas" = largura do node (220–280px); "fill" = ocupa a coluna. */
    width?: "canvas" | "fill";
    members?: AvatarPickerMember[];
    autoFocusTitle?: boolean;
    onAutoFocusConsumed?: () => void;
    onTitleSave: (next: string) => void;
    onEditingChange?: (editing: boolean) => void;
    onStatusChange: (status: "pending" | "in_progress" | "completed" | "blocked" | "draft") => void;
    onAssigneeChange: (userId: string) => void; // "unassigned" = sem responsável
    onSchedulePatch: (patch: SchedulePatch) => void;
    /** true enquanto a edição de prazo está em curso (sem-prazo aberto ou modalidade pendente). */
    onScheduleEditingChange?: (editing: boolean) => void;
    onOpen: () => void;
    /** Renderizado primeiro dentro do elemento raiz (Handles e botão "+" no canvas). */
    children?: React.ReactNode;
  }
  export default function TaskCardBody(props: TaskCardBodyProps): JSX.Element;
  export function getNodeColors(status: string): NodeColors;
  ```
  - `AssigneeAvatarPicker.tsx` exporta `export type AvatarPickerMember = { userId: string; user: { name: string; avatarUrl?: string | null } };` e aceita `members: AvatarPickerMember[] | undefined`.

- [ ] **Step 1: Escrever o e2e de caracterização do canvas (antes de mexer)**

`e2e/canvas-card-inline.spec.ts`:
```ts
import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";

/**
 * Caracterização do card de tarefa do canvas (MindMapNode) antes/depois da
 * extração do TaskCardBody: título, status e prazo editados inline persistem.
 */
const API = process.env.API_BASE_URL ?? "http://localhost:5000";
const PASSWORD = "E2ePass12345!";

async function api(): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: API });
  const r = await ctx.post("/api/auth/login", { data: { email: "e2e_tasks_owner@test.local", password: PASSWORD } });
  expect(r.ok()).toBeTruthy();
  return ctx;
}

test("card do canvas: título, status e prazo inline persistem", async ({ page, context }) => {
  const ctx = await api();
  const stamp = Date.now();
  const ws = await (await ctx.post("/api/workspaces", { data: { name: `E2E Canvas ${stamp}`, colorIndex: 0 } })).json();
  try {
    const map = await (await ctx.post(`/api/workspaces/${ws.id}/maps`, { data: { name: "plano" } })).json();
    const card = await (await ctx.post(`/api/workspaces/${ws.id}/maps/${map.id}/cards`, {
      data: { title: `card ${stamp}`, positionX: 100, positionY: 100 },
    })).json();
    const taskRes = await ctx.post(`/api/workspaces/${ws.id}/maps/${map.id}/cards/${card.id}/task`, { data: {} });
    expect(taskRes.ok(), await taskRes.text()).toBeTruthy();

    await context.addCookies((await ctx.storageState()).cookies.map(c => ({ ...c, domain: "localhost" })));
    await page.goto(`/workspaces/${ws.id}/maps/${map.id}`);
    const node = page.locator(".react-flow__node-mindmap").first();
    await expect(node).toContainText(`card ${stamp}`);

    await node.getByText(`card ${stamp}`).click();
    const input = node.locator("input").first();
    await input.fill(`renomeado ${stamp}`);
    await input.press("Enter");

    await node.getByLabel(/status|rascunho|pronta/i).first().click();
    await page.getByRole("button", { name: /pronta para fazer/ }).click();

    await node.getByTitle("Clique para definir prazo").click();
    await expect(node.getByTitle("Modalidade do fazer")).toBeVisible();

    await page.waitForTimeout(800);
    await page.reload();
    const again = page.locator(".react-flow__node-mindmap").first();
    await expect(again).toContainText(`renomeado ${stamp}`);
    await expect(again.getByLabel("pronta para fazer")).toBeVisible();
  } finally {
    await ctx.delete(`/api/workspaces/${ws.id}`);
  }
});
```
Rodar contra o **código atual** (antes do refactor) seguindo `e2e/README.md` (API dev na :5000, build servido na :3100, runner fora do repo com `NODE_PATH`). Ajustar seletores até ficar **verde** no código atual (o spec precisa descrever o comportamento de hoje). Se o payload de criação do card ou do plano divergir, ler `routes/cards.ts:77` / `routes/maps.ts` e corrigir o spec — nunca o app.

- [ ] **Step 2: Tipo estrutural no `AssigneeAvatarPicker`**

Em `AssigneeAvatarPicker.tsx`, trocar o import de `WorkspaceMemberResponse` e a prop:
```ts
export type AvatarPickerMember = { userId: string; user: { name: string; avatarUrl?: string | null } };

interface AssigneeAvatarPickerProps {
  assignedTo: string;
  members: AvatarPickerMember[] | undefined;
  onSelect: (value: string) => void;
}
```
(`WorkspaceMemberResponse` é estruturalmente compatível; remover o import se ficar sem uso.)

- [ ] **Step 3: Criar `TaskCardBody.tsx` movendo o código do `MindMapNode`**

Movimento mecânico, sem mudar markup nem classes:

1. Copiar para `TaskCardBody.tsx` os imports de `MindMapNode.tsx` **menos** `Handle, Position` (reactflow), `useUpdateCard, useUpdateTaskStatus, useUpdateTaskDetails, useListWorkspaceMembers` e `useQueryClient`. Importar `type AvatarPickerMember` do picker.
2. Mover `stripHtml`, `NodeColors`, `getNodeColors` (agora `export function getNodeColors`), `STATUS_OPTIONS`, `statusLabel`.
3. Função `export default function TaskCardBody({ data, selected = false, width = "canvas", members, autoFocusTitle, onAutoFocusConsumed, onTitleSave, onEditingChange, onStatusChange, onAssigneeChange, onSchedulePatch, onScheduleEditingChange, onOpen, children }: TaskCardBodyProps)` com o corpo de `MindMapNode` (linhas 149–1105 do arquivo atual) aplicando:

   | No `MindMapNode` | No `TaskCardBody` |
   |---|---|
   | `workspaceId`, `mapId`, `isTerminalNode`, `queryClient`, `mapQueryKey`, `invalidateAll`, `updateCardMut`, `updateTaskStatusMut`, `updateTaskDetailsMut`, `useListWorkspaceMembers` | removidos (ficam no wrapper) |
   | `dueDateValue`/`startAtValue`/`editingDueDate`/`editingStartAt` + seus `useEffect` + `handleDueDateBlur` + `handleStartAtBlur` | removidos (código morto: só os blur legados liam esses estados). Nos pontos do JSX e do `handleScheduleWrapperBlur` que chamam `setEditingDueDate(...)`/`setEditingStartAt(...)`, apagar a chamada |
   | `useEffect` de `data.autoFocusTitle` | `useEffect(() => { if (autoFocusTitle) setAutoFocusTitleTrigger(true); }, [autoFocusTitle]);` |
   | `handleTitleSave` | `const handleTitleSave = (next: string) => onTitleSave(next);` |
   | `handleTitleEditingChange` | `const handleTitleEditingChange = (editing: boolean) => onEditingChange?.(editing);` |
   | `handleAutoFocusConsumed` | `setAutoFocusTitleTrigger(false); onAutoFocusConsumed?.();` |
   | `handleStatusChange` | `setEditingStatus(false); if (newStatus === data.statusVisual) return; onStatusChange(newStatus as ...);` |
   | `handleAssigneeChange` | `const handleAssigneeChange = (userId: string) => onAssigneeChange(userId);` |
   | cada par `data.onInlineUpdate?.(id, patch)` + `updateTaskDetailsMut.mutate({ ..., data: apiData }, ...)` nos handlers de prazo | um único `onSchedulePatch(apiData)` com o **mesmo** `apiData` (o objeto que ia no `data:` da mutation). Ex.: `handleScheduleModeChange("urgente")` → `onSchedulePatch({ scheduleMode: next, startAt: null, dueDate: null })`. Remover os `if (data.taskId)` em volta: o host decide |
   | `data.onOpen?.(id)` | `onOpen()` |
   | bloco "Add child button" + os dois `<Handle>` invisíveis (nas duas variantes) | `{children}` no mesmo lugar (primeiro filho do elemento raiz) |
   | `className` raiz da variante ativa `min-w-[220px] max-w-[280px]` | `${width === "fill" ? "w-full" : "min-w-[220px] max-w-[280px]"}` |
   | `className` raiz da variante muted `min-w-[180px] max-w-[240px]` | `${width === "fill" ? "w-full" : "min-w-[180px] max-w-[240px]"}` |
   | `members={members}` no `AssigneeAvatarPicker` | igual, vindo da prop |

4. Sinal de edição de prazo, logo após `currentScheduleMode`:
```ts
  const scheduleEditing = editingNoPrazo || pendingMode !== null;
  useEffect(() => {
    onScheduleEditingChange?.(scheduleEditing);
  }, [scheduleEditing, onScheduleEditingChange]);
```
5. Marcar interativos para o DnD do calendário: acrescentar a classe `nodrag` (já usada pelo reactflow) ao wrapper do `AssigneeAvatarPicker`, aos botões "sem prazo"/"urgente", ao wrapper `scheduleWrapperRef`, ao badge de status, aos botões "ver mais/ver menos" e ao botão "Expandir card". O `EditableTitle` já recebe `nodragForReactFlow`.

- [ ] **Step 4: Reescrever `MindMapNode.tsx` como wrapper**

```tsx
import { memo, useCallback } from 'react';
import { Handle, Position } from 'reactflow';
import { Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useUpdateCard, useUpdateTaskStatus, useUpdateTaskDetails, useListWorkspaceMembers } from '@workspace/api-client-react';
import TaskCardBody, { getNodeColors, type SchedulePatch, type ScheduleModeValue, type TaskCardData } from './TaskCardBody';

interface MindMapNodeProps {
  id: string;
  data: TaskCardData & {
    workspaceId?: string;
    mapId?: string;
    onOpen?: (id: string) => void;
    onAddChild?: (id: string) => void;
    onInlineUpdate?: (cardId: string, patch: Partial<{
      title: string;
      statusVisual: string;
      taskAssigneeName: string | null;
      taskAssigneeId: string | null;
      taskAssigneeAvatarUrl: string | null;
      taskDueDate: string | null;
      taskStartAt: string | null;
      taskScheduleMode: ScheduleModeValue | null;
    }>) => void;
    onEditingChange?: (cardId: string, isEditing: boolean) => void;
    onAutoFocusDone?: (cardId: string) => void;
    isTerminalNode?: boolean;
    autoFocusTitle?: boolean;
  };
  selected: boolean;
}

function toNodePatch(p: SchedulePatch) {
  const out: { taskDueDate?: string | null; taskStartAt?: string | null; taskScheduleMode?: ScheduleModeValue } = {};
  if ('dueDate' in p) out.taskDueDate = p.dueDate ?? null;
  if ('startAt' in p) out.taskStartAt = p.startAt ?? null;
  if (p.scheduleMode !== undefined) out.taskScheduleMode = p.scheduleMode;
  return out;
}

function MindMapNode({ id, data, selected }: MindMapNodeProps) {
  const workspaceId = data.workspaceId ?? '';
  const mapId = data.mapId ?? '';
  const hasTask = !!data.taskId;
  const isTerminalNode = data.isTerminalNode !== false;
  const nodeColors = getNodeColors(data.statusVisual);

  const queryClient = useQueryClient();
  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/maps/${mapId}/cards/${id}`] });
    if (data.taskId) {
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks/${data.taskId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks`] });
      queryClient.invalidateQueries({ queryKey: [`task-activities`, workspaceId, data.taskId] });
    }
  }, [queryClient, workspaceId, mapId, id, data.taskId]);

  const updateCardMut = useUpdateCard();
  const updateTaskStatusMut = useUpdateTaskStatus();
  const updateTaskDetailsMut = useUpdateTaskDetails();
  const { data: members } = useListWorkspaceMembers(workspaceId, { query: { enabled: !!workspaceId && hasTask } });

  const handleTitleSave = (next: string) => {
    data.onInlineUpdate?.(id, { title: next });
    updateCardMut.mutate({ workspaceId, mapId, cardId: id, data: { title: next } }, { onSuccess: invalidateAll });
  };
  const handleStatusChange = (status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'draft') => {
    data.onInlineUpdate?.(id, { statusVisual: status });
    if (data.taskId) {
      updateTaskStatusMut.mutate({ workspaceId, mapId, cardId: id, data: { status } }, { onSuccess: invalidateAll });
    }
  };
  const handleAssigneeChange = (userId: string) => {
    if (userId === 'unassigned') {
      data.onInlineUpdate?.(id, { taskAssigneeName: null, taskAssigneeId: null, taskAssigneeAvatarUrl: null });
      if (data.taskId) {
        updateTaskDetailsMut.mutate({ workspaceId, mapId, cardId: id, data: { assignedTo: null } }, { onSuccess: invalidateAll });
      }
      return;
    }
    const member = members?.find(m => m.userId === userId);
    if (!member) return;
    data.onInlineUpdate?.(id, {
      taskAssigneeName: member.user.name,
      taskAssigneeId: userId,
      taskAssigneeAvatarUrl: member.user.avatarUrl ?? null,
    });
    if (data.taskId) {
      updateTaskDetailsMut.mutate({ workspaceId, mapId, cardId: id, data: { assignedTo: userId } }, { onSuccess: invalidateAll });
    }
  };
  const handleSchedulePatch = (p: SchedulePatch) => {
    data.onInlineUpdate?.(id, toNodePatch(p));
    if (data.taskId) {
      updateTaskDetailsMut.mutate({ workspaceId, mapId, cardId: id, data: p }, { onSuccess: invalidateAll });
    }
  };

  return (
    <TaskCardBody
      data={data}
      selected={selected}
      members={members}
      autoFocusTitle={data.autoFocusTitle}
      onAutoFocusConsumed={() => data.onAutoFocusDone?.(id)}
      onTitleSave={handleTitleSave}
      onEditingChange={(editing) => data.onEditingChange?.(id, editing)}
      onStatusChange={handleStatusChange}
      onAssigneeChange={handleAssigneeChange}
      onSchedulePatch={handleSchedulePatch}
      onOpen={() => data.onOpen?.(id)}
    >
      {isTerminalNode && (
        <div
          className="nodrag nopan absolute hover:scale-110 transition-transform duration-150"
          style={{ right: '-4rem', top: 'calc(50% - 24px)' }}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center opacity-0 group-hover/node:opacity-100 transition-opacity duration-150 shadow-lg pointer-events-none"
            style={{ backgroundColor: nodeColors.hex, color: '#fff' }}
          >
            <Plus className="w-6 h-6" />
          </div>
          <Handle
            type="source"
            position={Position.Right}
            id="plus-right"
            className="!absolute !inset-0 !w-full !h-full !rounded-full !border-none !bg-transparent !transform-none !opacity-0 !cursor-pointer"
            isConnectable
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); data.onAddChild?.(id); }}
          />
        </div>
      )}
      <Handle type="target" position={Position.Left} id="target-left" className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-1 !h-1" />
      <Handle type="source" position={Position.Right} id="source-right" className="!opacity-0 !pointer-events-none !border-none !bg-transparent !w-1 !h-1" />
    </TaskCardBody>
  );
}

export default memo(MindMapNode);
```
Se o tipo de `data` do `updateTaskDetailsMut` (Orval) não aceitar `SchedulePatch` direto por causa de `scheduleMode` opcional, fazer spread explícito: `data: { ...p }`.

- [ ] **Step 5: Gates**

- FE typecheck relativo: nenhum erro novo em `MindMapNode.tsx`, `TaskCardBody.tsx`, `AssigneeAvatarPicker.tsx`, `canvas.tsx` (comparar por mensagem contra `$SCRATCH/fe-tsc-baseline.txt`).
- `pnpm --filter @workspace/mindtask-app run build` → sucesso.
- Re-rodar `e2e/canvas-card-inline.spec.ts` (rebuild antes) → verde.

- [ ] **Step 6: Commit**

```bash
git add artifacts/mindtask-app/src/components/maps/TaskCardBody.tsx artifacts/mindtask-app/src/components/maps/MindMapNode.tsx artifacts/mindtask-app/src/components/tasks/AssigneeAvatarPicker.tsx e2e/canvas-card-inline.spec.ts
git commit -m "refactor(canvas): extrai TaskCardBody do MindMapNode para reuso no calendário"
```

---

## Task 8: Extrair `ApprovalCardBody` e `EventRow`

**Files:**
- Create: `artifacts/mindtask-app/src/components/maps/ApprovalCardBody.tsx`
- Modify: `artifacts/mindtask-app/src/components/maps/ApprovalNode.tsx` (wrapper)
- Create: `artifacts/mindtask-app/src/components/meetings/EventRow.tsx`
- Modify: `artifacts/mindtask-app/src/components/tasks/AgendaPanel.tsx` (importa `EventRow`)

**Interfaces:**
- Produces:
  ```ts
  export interface ApprovalCardData {
    approverName: string | null; approverAvatarUrl: string | null;
    approvalStatus: string | null; approvalDecision: string | null;
    dueDate: string | null; taskTitle: string; allSiblingsApproved?: boolean;
  }
  export interface ApprovalCardBodyProps {
    data: ApprovalCardData; selected?: boolean; width?: "canvas" | "fill";
    onOpen?: () => void; children?: React.ReactNode;
  }
  export default function ApprovalCardBody(props: ApprovalCardBodyProps): JSX.Element;
  export function getApprovalStatusColors(status: string | null): ApprovalColors;
  // EventRow.tsx
  export function EventRow({ event }: { event: TodayEvent }): JSX.Element;
  export function formatTimeRange(startISO: string, endISO: string): string;
  ```

- [ ] **Step 1: Criar `ApprovalCardBody.tsx`**

Mover de `ApprovalNode.tsx` (sem mudar markup/classes): `decisionLabel`, `ApprovalColors`, `getApprovalStatusColors` (exportado) e a função de render, com:
- props `ApprovalCardBodyProps`; `handleDoubleClick = (e) => { e.stopPropagation(); onOpen?.(); }`;
- nas duas variantes (avatar 48px e card), os blocos "Add child button" e os dois `<Handle>` viram `{children}` no mesmo lugar;
- `isTerminal`, `cardId`, `onAddChild`, `terminalParentCardId` saem (ficam no wrapper);
- raiz da variante card: `${width === "fill" ? "w-full" : "min-w-[160px] max-w-[200px]"}`.

- [ ] **Step 2: `ApprovalNode.tsx` vira wrapper**

```tsx
import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Plus } from 'lucide-react';
import ApprovalCardBody, { getApprovalStatusColors, type ApprovalCardData } from './ApprovalCardBody';

interface ApprovalNodeProps {
  id: string;
  data: ApprovalCardData & {
    cardId?: string;
    onOpen?: (cardId: string) => void;
    onAddChild?: (cardId: string) => void;
    terminalParentCardId?: string;
  };
  selected: boolean;
}

const ANCHOR_HANDLE_CLS = '!opacity-0 !pointer-events-none !border-none !bg-transparent !w-1 !h-1';
const PLUS_HANDLE_CLS = '!absolute !inset-0 !w-full !h-full !rounded-full !border-none !bg-transparent !transform-none !opacity-0 !cursor-pointer';

function ApprovalNode({ data, selected }: ApprovalNodeProps) {
  const isTerminal = !!(data.onAddChild && data.terminalParentCardId);
  const plusColor = data.allSiblingsApproved ? '#10b981' : getApprovalStatusColors(data.approvalStatus).hex;
  const plusPos = { right: '-2.75rem', top: 'calc(50% - 1rem)', width: '2rem', height: '2rem' };
  return (
    <ApprovalCardBody
      data={data}
      selected={selected}
      onOpen={data.onOpen && data.cardId ? () => data.onOpen!(data.cardId!) : undefined}
    >
      {isTerminal && (
        <div
          className={`nodrag nopan absolute opacity-0 group-hover/node:opacity-100 transition-all duration-150 hover:scale-110${data.allSiblingsApproved ? ' z-10' : ''}`}
          style={plusPos}
        >
          <button
            className="w-full h-full rounded-full flex items-center justify-center shadow-lg pointer-events-none"
            style={{ backgroundColor: plusColor, color: '#fff' }}
            title="Adicionar card filho"
          >
            <Plus className="w-4 h-4" />
          </button>
          <Handle
            type="source"
            position={Position.Right}
            id="plus-right"
            className={PLUS_HANDLE_CLS}
            isConnectable
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); data.onAddChild!(data.cardId!); }}
          />
        </div>
      )}
      <Handle type="target" position={Position.Left} id="target-left" className={ANCHOR_HANDLE_CLS} isConnectable={false} />
      <Handle type="source" position={Position.Right} id="source-right" className={ANCHOR_HANDLE_CLS} isConnectable={false} />
    </ApprovalCardBody>
  );
}

export default memo(ApprovalNode);
```

- [ ] **Step 3: Extrair `EventRow`**

Mover `EventRow` e `formatTimeRange` de `AgendaPanel.tsx` para `components/meetings/EventRow.tsx` (exportados, código idêntico, com `import type { TodayEvent } from "@/hooks/useGoogleCalendar";`). No `AgendaPanel.tsx`, apagar as duas funções e importar `import { EventRow } from "@/components/meetings/EventRow";`.

- [ ] **Step 4: Gates**

FE typecheck relativo (arquivos tocados sem erro novo), `vite build` ok, `e2e/canvas-card-inline.spec.ts` verde. Checagem visual rápida: abrir um plano com aprovações (modo sequencial e paralelo) no build servido e confirmar que cards de aprovação, o "+" terminal e o avatar de "todos aprovaram" aparecem como antes.

- [ ] **Step 5: Commit**

```bash
git add artifacts/mindtask-app/src/components/maps/ApprovalCardBody.tsx artifacts/mindtask-app/src/components/maps/ApprovalNode.tsx artifacts/mindtask-app/src/components/meetings/EventRow.tsx artifacts/mindtask-app/src/components/tasks/AgendaPanel.tsx
git commit -m "refactor(canvas): extrai ApprovalCardBody e EventRow para reuso no calendário"
```

---

## Task 9: Hook `useInlineTaskEditor` extraído do `TaskListItem`

**Files:**
- Create: `artifacts/mindtask-app/src/hooks/useInlineTaskEditor.ts`
- Modify: `artifacts/mindtask-app/src/components/tasks/TaskListItem.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function useInlineTaskEditor<T extends TaskListItemData>(opts: {
    task: T;
    invalidateQueryKeys: readonly (readonly unknown[])[];
    countsQueryKeys?: readonly (readonly unknown[])[];
  }): {
    localTask: T;
    setLocalTask: React.Dispatch<React.SetStateAction<T>>;
    isStandaloneTask: boolean;
    isLinkedToCard: boolean;
    invalidate: () => void;
    handleScheduleOpenChange: (open: boolean) => void;
    patchTask: (body: Record<string, unknown>) => Promise<void>;
    patchStatus: (newStatus: string) => Promise<void>;
    updateCardTitle: (newTitle: string) => Promise<void>;
    saveTitle: (next: string) => Promise<void>;
  };
  ```

- [ ] **Step 1: Criar o hook movendo o código**

`hooks/useInlineTaskEditor.ts` recebe, **sem alteração de comportamento**, os trechos de `TaskListItem.tsx` hoje nas linhas ~126–260: `localTask` + `useEffect(() => setLocalTask(task), [task])`, `isLinkedToCard`, `isStandaloneTask`, `scheduleOpenRef`, `pendingInvalidateRef`, `invalidate`, `handleScheduleOpenChange`, o `useEffect` de unmount que libera a invalidação represada, `patchTask`, `invalidateCounts`, `patchStatus`, `updateCardTitle` (com seus comentários). Acrescentar:
```ts
  const saveTitle = useCallback(async (next: string) => {
    if (isLinkedToCard) await updateCardTitle(next);
    else await patchTask({ title: next });
  }, [isLinkedToCard, updateCardTitle, patchTask]);
```
Imports: `useState, useEffect, useRef, useCallback` de react; `useQueryClient`; `customFetch` de `@workspace/api-client-react`; `useToast`; `type TaskListItemData`. As chaves são `readonly unknown[]`, passadas a `invalidateQueries({ queryKey: k })` como hoje.

- [ ] **Step 2: `TaskListItem` consome o hook**

Substituir o bloco movido por:
```ts
  const {
    localTask, setLocalTask, isLinkedToCard, isStandaloneTask,
    handleScheduleOpenChange, patchTask, patchStatus, saveTitle,
  } = useInlineTaskEditor({ task, invalidateQueryKeys, countsQueryKeys });
```
e `handleTitleSave` passa a:
```ts
  const handleTitleSave = (next: string) => {
    setSavingField("title");
    saveTitle(next).finally(() => setSavingField(null));
  };
```
Nada mais muda no arquivo. Remover imports que ficarem sem uso.

- [ ] **Step 3: Gates**

- FE typecheck relativo: `TaskListItem.tsx` com o mesmo conjunto de erros do baseline (comparar por mensagem), `useInlineTaskEditor.ts` sem erro.
- `vite build` ok.
- Rodar `e2e/inline-due-date.spec.ts` e `e2e/my-tasks-create.spec.ts` → verdes (cobrem a represa e a edição inline da lista).

- [ ] **Step 4: Commit**

```bash
git add artifacts/mindtask-app/src/hooks/useInlineTaskEditor.ts artifacts/mindtask-app/src/components/tasks/TaskListItem.tsx
git commit -m "refactor(tarefas): extrai useInlineTaskEditor do TaskListItem"
```

---

## Task 10: Filtro de status "todos" na lista

**Files:**
- Modify: `artifacts/mindtask-app/src/lib/taskStatusConstants.ts`
- Modify: `artifacts/mindtask-app/src/pages/my-tasks.tsx`
- Modify: `artifacts/mindtask-app/src/pages/workspaces/detail.tsx`
- Test: `artifacts/mindtask-app/src/lib/taskStatusConstants.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const TODOS_STATUS = "todos";
  export const TODOS_STATUS_VALUES: readonly ["draft", "pending", "in_progress", "completed"];
  export function statusFilterToApi(selected: string): string;
  export const TODOS_FILTER_OPTION: { value: "todos"; label: string; icon: LucideIcon; activeClass: string };
  ```

- [ ] **Step 1: Teste que falha**

`src/lib/taskStatusConstants.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { statusFilterToApi, TODOS_STATUS } from "./taskStatusConstants";

describe("statusFilterToApi", () => {
  it("todos vira tudo menos cancelada", () => {
    expect(statusFilterToApi(TODOS_STATUS)).toBe("draft,pending,in_progress,completed");
  });
  it("status único passa direto", () => {
    expect(statusFilterToApi("blocked")).toBe("blocked");
  });
});
```
Run: `npx vitest run taskStatusConstants` → FAIL.

- [ ] **Step 2: Implementar nas constantes**

Em `taskStatusConstants.ts`, adicionar `Layers` ao import de `lucide-react` e, após `TASK_STATUS_ORDER`:
```ts
/** Filtro "todos": todos os status menos cancelada (blocked). */
export const TODOS_STATUS = "todos";
export const TODOS_STATUS_VALUES = ["draft", "pending", "in_progress", "completed"] as const;

export function statusFilterToApi(selected: string): string {
  return selected === TODOS_STATUS ? TODOS_STATUS_VALUES.join(",") : selected;
}

export const TODOS_FILTER_OPTION = {
  value: TODOS_STATUS,
  label: "todos (menos canceladas)",
  icon: Layers,
  activeClass: "bg-foreground/5 text-foreground border-foreground/40 hover:bg-foreground/10",
} as const;
```
Run: `npx vitest run taskStatusConstants` → PASS.

- [ ] **Step 3: Pill "todos" e query nas duas páginas**

Em cada página, antes do `{STATUS_OPTIONS.map(...)}` dentro do mesmo `div` das pills:
```tsx
<button
  onClick={() => selectStatus(TODOS_STATUS)}
  title={TODOS_FILTER_OPTION.label}
  aria-label={TODOS_FILTER_OPTION.label}
  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold border transition-all duration-150 cursor-pointer ${
    selectedStatus === TODOS_STATUS
      ? TODOS_FILTER_OPTION.activeClass
      : "bg-card text-muted-foreground border-border hover:border-slate-400 dark:hover:border-slate-600"
  }`}
>
  <TODOS_FILTER_OPTION.icon className="w-3.5 h-3.5" />
  <span>todos</span>
</button>
```
- `my-tasks.tsx`: `const VALID_STATUSES = new Set<string>([...STATUS_OPTIONS.map(o => o.value), TODOS_STATUS]);` e no `queryFn` da lista `p.set("status", statusFilterToApi(selectedStatus));`.
- `detail.tsx`: no `queryFn` da lista `p.set("status", statusFilterToApi(selectedStatus));`.
- Importar `TODOS_STATUS, TODOS_FILTER_OPTION, statusFilterToApi` nas duas.
- Não mexer em `dateColumnMode` (fica `default` para "todos") nem nas pills de janela (continuam visíveis).

- [ ] **Step 4: Gates**

FE typecheck relativo nos 3 arquivos; `vite build` ok. Conferir no build servido: clicar "todos" em `/my-tasks` lista concluídas e ativas, sem canceladas; URL fica `?status=todos` e recarregar mantém.

- [ ] **Step 5: Commit**

```bash
git add artifacts/mindtask-app/src/lib/taskStatusConstants.ts artifacts/mindtask-app/src/lib/taskStatusConstants.test.ts artifacts/mindtask-app/src/pages/my-tasks.tsx artifacts/mindtask-app/src/pages/workspaces/detail.tsx
git commit -m "feat(tarefas): filtro de status \"todos\" (tudo menos cancelada)"
```

---

## Task 11: Hooks de dados do calendário

**Files:**
- Create: `artifacts/mindtask-app/src/hooks/useCalendarData.ts`
- Modify: `artifacts/mindtask-app/src/hooks/useGoogleCalendar.ts` (`useRangeEvents` + invalidação no disconnect/toggle)
- Test: `artifacts/mindtask-app/src/hooks/calendarOptimistic.test.ts`

**Interfaces:**
- Consumes: `weekBoundsISO` (Task 6), `ReorderBody`, `OptimisticPatch` (Task 6), `statusFilterToApi` (Task 10), `CalendarTask`, `CalendarMeeting` (Task 6).
- Produces:
  ```ts
  export type CalendarScope = { kind: "my" } | { kind: "workspace"; workspaceId: string };
  export function calendarTasksKey(scope: CalendarScope, weekStart: string, status: string, assignees: string[]): unknown[];
  export function calendarMeetingsKey(scope: CalendarScope, weekStart: string): unknown[];
  export function useCalendarTasks(scope, weekStart, status, assignees): UseQueryResult<CalendarTask[]>;
  export function useCalendarMeetings(scope, weekStart): UseQueryResult<CalendarMeeting[]>;
  export function applyOptimistic<T extends { id: string }>(rows: T[] | undefined, patch: Record<string, object>): T[] | undefined;
  export function useReorderCalendar(tasksKey: unknown[], meetingsKey: unknown[], extraInvalidate: unknown[][]): UseMutationResult<unknown, Error, { body: ReorderBody; optimistic: OptimisticPatch }>;
  // useGoogleCalendar.ts
  export function useRangeEvents(from: string, to: string, enabled: boolean): UseQueryResult<{ events: TodayEvent[]; noCalendarsSelected?: boolean }>;
  ```

- [ ] **Step 1: Teste que falha para o patch otimista**

`src/hooks/calendarOptimistic.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { applyOptimistic } from "./useCalendarData";

describe("applyOptimistic", () => {
  it("mescla só as linhas do patch", () => {
    const rows = [{ id: "a", plannedOrder: null, plannedDate: null }, { id: "b", plannedOrder: 3, plannedDate: "2026-10-01" }];
    expect(applyOptimistic(rows, { a: { plannedOrder: 0, plannedDate: "2026-10-02" } })).toEqual([
      { id: "a", plannedOrder: 0, plannedDate: "2026-10-02" },
      { id: "b", plannedOrder: 3, plannedDate: "2026-10-01" },
    ]);
  });
  it("undefined continua undefined", () => {
    expect(applyOptimistic(undefined, {})).toBeUndefined();
  });
});
```
Run: `npx vitest run calendarOptimistic` → FAIL.

- [ ] **Step 2: Implementar `useCalendarData.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { statusFilterToApi } from "@/lib/taskStatusConstants";
import { weekBoundsISO } from "@/lib/calendar/week";
import type { CalendarMeeting, CalendarTask } from "@/lib/calendar/placement";
import type { OptimisticPatch, ReorderBody } from "@/lib/calendar/dnd";

export type CalendarScope = { kind: "my" } | { kind: "workspace"; workspaceId: string };

/** Prefixo igual ao da lista: toda invalidação existente por prefixo atualiza o calendário. */
function tasksBaseKey(scope: CalendarScope): string {
  return scope.kind === "my" ? "/api/my-tasks" : `/api/workspaces/${scope.workspaceId}/tasks`;
}

export function calendarTasksKey(scope: CalendarScope, weekStart: string, status: string, assignees: string[]): unknown[] {
  return [tasksBaseKey(scope), "calendar", weekStart, status, assignees];
}

export function calendarMeetingsKey(scope: CalendarScope, weekStart: string): unknown[] {
  return ["/api/meetings", "calendar", scope.kind === "my" ? "my" : scope.workspaceId, weekStart];
}

export function useCalendarTasks(scope: CalendarScope, weekStart: string, status: string, assignees: string[]) {
  return useQuery<CalendarTask[]>({
    queryKey: calendarTasksKey(scope, weekStart, status, assignees),
    queryFn: () => {
      const { from, to } = weekBoundsISO(weekStart);
      const p = new URLSearchParams({ from, to, status: statusFilterToApi(status), assignedTo: assignees.join(",") });
      if (scope.kind === "workspace") p.set("workspaceId", scope.workspaceId);
      return customFetch<CalendarTask[]>(`/api/calendar/tasks?${p.toString()}`);
    },
  });
}

export function useCalendarMeetings(scope: CalendarScope, weekStart: string) {
  return useQuery<CalendarMeeting[]>({
    queryKey: calendarMeetingsKey(scope, weekStart),
    queryFn: async () => {
      const { from, to } = weekBoundsISO(weekStart);
      const p = new URLSearchParams({ from, to });
      if (scope.kind === "workspace") p.set("workspaceId", scope.workspaceId);
      try {
        return await customFetch<CalendarMeeting[]>(`/api/meetings?${p.toString()}`);
      } catch (err) {
        // 503 = integração de reuniões desligada no ambiente: calendário sem reuniões.
        if ((err as { status?: number }).status === 503) return [];
        throw err;
      }
    },
    retry: false,
  });
}

export function applyOptimistic<T extends { id: string }>(rows: T[] | undefined, patch: Record<string, object>): T[] | undefined {
  if (!rows) return rows;
  return rows.map(r => (patch[r.id] ? { ...r, ...patch[r.id] } : r));
}

export function useReorderCalendar(tasksKey: unknown[], meetingsKey: unknown[], extraInvalidate: unknown[][]) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: ({ body }: { body: ReorderBody; optimistic: OptimisticPatch }) =>
      customFetch("/api/calendar/reorder", { method: "PUT", body: JSON.stringify(body) }),
    onMutate: async ({ optimistic }) => {
      await qc.cancelQueries({ queryKey: tasksKey });
      await qc.cancelQueries({ queryKey: meetingsKey });
      const prevTasks = qc.getQueryData<CalendarTask[]>(tasksKey);
      const prevMeetings = qc.getQueryData<CalendarMeeting[]>(meetingsKey);
      qc.setQueryData<CalendarTask[]>(tasksKey, rows => applyOptimistic(rows, optimistic.tasks));
      qc.setQueryData<CalendarMeeting[]>(meetingsKey, rows => applyOptimistic(rows, optimistic.meetings));
      return { prevTasks, prevMeetings };
    },
    onError: (err, _vars, ctx) => {
      qc.setQueryData(tasksKey, ctx?.prevTasks);
      qc.setQueryData(meetingsKey, ctx?.prevMeetings);
      toast({
        title: "Não foi possível reorganizar.",
        description: err instanceof Error ? err.message : "Tente novamente.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [tasksKey[0]] });
      qc.invalidateQueries({ queryKey: meetingsKey });
      extraInvalidate.forEach(k => qc.invalidateQueries({ queryKey: k }));
    },
  });
}
```

- [ ] **Step 3: `useRangeEvents` no `useGoogleCalendar.ts`**

Após `useTodayEvents`:
```ts
const RANGE_EVENTS_KEY = "/api/integrations/google-calendar/events";

/** Eventos de um intervalo (calendário semanal). Sem conta/flag/reauth → lista vazia. */
export function useRangeEvents(from: string, to: string, enabled: boolean) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return useQuery<{ events: TodayEvent[]; noCalendarsSelected?: boolean }>({
    queryKey: [RANGE_EVENTS_KEY, from, to, tz],
    queryFn: async () => {
      const p = new URLSearchParams({ from, to, tz });
      try {
        return await cf(`${RANGE_EVENTS_KEY}?${p.toString()}`).then(jsonOrThrow);
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 404 || status === 503) return { events: [] };
        throw err;
      }
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
```
Em `useGoogleCalendarDisconnect` e `useToggleCalendar`, no `onSuccess`, acrescentar `qc.invalidateQueries({ queryKey: [RANGE_EVENTS_KEY] });` (declarar `RANGE_EVENTS_KEY` antes dessas funções, no topo do arquivo).

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run calendarOptimistic` → PASS. FE typecheck relativo nos dois arquivos.

- [ ] **Step 5: Commit**

```bash
git add artifacts/mindtask-app/src/hooks/useCalendarData.ts artifacts/mindtask-app/src/hooks/useGoogleCalendar.ts artifacts/mindtask-app/src/hooks/calendarOptimistic.test.ts
git commit -m "feat(calendario): hooks de dados e reorder otimista"
```

---

## Task 12: Componentes do calendário

**Files:**
- Create: `artifacts/mindtask-app/src/lib/calendar/sensor.ts`
- Create: `artifacts/mindtask-app/src/components/calendar/SortableItem.tsx`
- Create: `artifacts/mindtask-app/src/components/calendar/CalendarTaskCard.tsx`
- Create: `artifacts/mindtask-app/src/components/calendar/CalendarApprovalCard.tsx`
- Create: `artifacts/mindtask-app/src/components/calendar/MeetingCard.tsx`
- Create: `artifacts/mindtask-app/src/components/calendar/DayColumn.tsx`
- Create: `artifacts/mindtask-app/src/components/calendar/PoolSection.tsx`
- Create: `artifacts/mindtask-app/src/components/calendar/WeekCalendar.tsx`

**Interfaces:**
- Consumes: Tasks 6, 7, 8, 9, 11.
- Produces:
  ```ts
  export interface WeekCalendarProps {
    scope: CalendarScope;
    status: string;               // valor do filtro (inclui "todos")
    assignees: string[];          // valores do filtro ("me", "unassigned", uuids)
    membersFor: (workspaceId: string | null) => AvatarPickerMember[];
    extraInvalidateKeys: unknown[][]; // ex.: counts da página
    onOpenTask: (task: CalendarTask) => void;
  }
  export function WeekCalendar(props: WeekCalendarProps): JSX.Element;
  ```

- [ ] **Step 1: Sensor que ignora interativos e portais**

`lib/calendar/sensor.ts`:
```ts
import { PointerSensor } from "@dnd-kit/core";
import type { PointerEvent as ReactPointerEvent } from "react";

const INTERACTIVE = ".nodrag, [data-no-dnd], input, textarea, select, button, a, [contenteditable='true'], [role='menu'], [role='dialog']";

/**
 * O card do calendário é o mesmo do canvas, cheio de controles inline.
 * Drag só começa em área "neutra" do card: ignora controles e eventos que
 * borbulham de popovers em portal (o React propaga eventos de portal para o
 * ancestral do componente, mas o alvo DOM não está dentro do card).
 */
export class CalendarPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent, currentTarget }: ReactPointerEvent) => {
        if (!nativeEvent.isPrimary || nativeEvent.button !== 0) return false;
        const target = nativeEvent.target as Element | null;
        if (!target || !(currentTarget as Element).contains(target)) return false;
        return !target.closest(INTERACTIVE);
      },
    },
  ];
}
```

- [ ] **Step 2: `SortableItem` genérico**

```tsx
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

export function SortableItem({ id, disabled, children }: { id: string; disabled?: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
      data-calendar-item={id}
      className={disabled ? "" : "cursor-grab active:cursor-grabbing"}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Cards**

`CalendarTaskCard.tsx`:
```tsx
import TaskCardBody, { type TaskCardData } from "@/components/maps/TaskCardBody";
import type { AvatarPickerMember } from "@/components/tasks/AssigneeAvatarPicker";
import { useInlineTaskEditor } from "@/hooks/useInlineTaskEditor";
import { getApprovalDisplayTitle } from "@/lib/approvalTaskTitle";
import type { CalendarTask } from "@/lib/calendar/placement";

export function toTaskCardData(t: CalendarTask): TaskCardData {
  const overdueVisual = !!t.overdue && (t.status === "pending" || t.status === "in_progress");
  return {
    title: getApprovalDisplayTitle(t),
    statusVisual: overdueVisual ? "overdue" : t.status,
    taskId: t.id,
    taskDueDate: t.dueDate ?? null,
    taskStartAt: t.startAt ?? null,
    taskScheduleMode: t.scheduleMode ?? "sem_prazo",
    taskAssigneeName: t.assigneeName ?? null,
    taskAssigneeId: t.assignedTo ?? null,
    taskAssigneeAvatarUrl: t.assigneeAvatarUrl ?? null,
    taskDescription: t.description ?? null,
    taskCompletedAt: t.completedAt ?? null,
    taskParentApprovalStatus: t.parentApprovalStatus ?? null,
    taskAttachmentCount: t.attachmentCount ?? null,
    taskSubtaskCount: t.subtaskCount ?? null,
    taskSubtaskCompletedCount: t.subtaskCompletedCount ?? null,
    taskCommentCount: t.commentCount ?? null,
  };
}

export function CalendarTaskCard({ task, members, invalidateKeys, onOpen }: {
  task: CalendarTask;
  members: AvatarPickerMember[];
  invalidateKeys: unknown[][];
  onOpen: (task: CalendarTask) => void;
}) {
  const editor = useInlineTaskEditor({ task, invalidateQueryKeys: invalidateKeys });
  const t = editor.localTask;
  return (
    <TaskCardBody
      data={toTaskCardData(t)}
      width="fill"
      members={members}
      onTitleSave={(next) => {
        editor.setLocalTask(p => ({ ...p, title: next, cardTitle: p.cardTitle ? next : p.cardTitle }));
        void editor.saveTitle(next);
      }}
      onStatusChange={(status) => {
        editor.setLocalTask(p => ({ ...p, status }));
        void editor.patchStatus(status);
      }}
      onAssigneeChange={(userId) => {
        const assignedTo = userId === "unassigned" ? null : userId;
        const m = members.find(x => x.userId === userId);
        editor.setLocalTask(p => ({
          ...p, assignedTo, assigneeName: m?.user.name ?? null, assigneeAvatarUrl: m?.user.avatarUrl ?? null,
        }));
        void editor.patchTask({ assignedTo });
      }}
      onSchedulePatch={(patch) => {
        editor.setLocalTask(p => ({ ...p, ...patch }));
        void editor.patchTask(patch);
      }}
      onScheduleEditingChange={editor.handleScheduleOpenChange}
      onOpen={() => onOpen(task)}
    />
  );
}

```
Em card terminal (concluída/cancelada) o `TaskCardBody` renderiza a variante muted automaticamente pelo `statusVisual`.

`CalendarApprovalCard.tsx`:
```tsx
import ApprovalCardBody from "@/components/maps/ApprovalCardBody";
import { getApprovalDisplayTitle } from "@/lib/approvalTaskTitle";
import type { CalendarTask } from "@/lib/calendar/placement";

export function CalendarApprovalCard({ task, onOpen }: { task: CalendarTask; onOpen: (task: CalendarTask) => void }) {
  const overdueVisual = !!task.overdue && (task.status === "pending" || task.status === "in_progress");
  return (
    <ApprovalCardBody
      width="fill"
      data={{
        approverName: task.assigneeName ?? null,
        approverAvatarUrl: task.assigneeAvatarUrl ?? null,
        approvalStatus: overdueVisual ? "overdue" : task.status,
        approvalDecision: task.approvalStatus ?? null,
        dueDate: task.dueDate ?? null,
        taskTitle: getApprovalDisplayTitle(task),
      }}
      onOpen={() => onOpen(task)}
    />
  );
}
```

`MeetingCard.tsx`:
```tsx
import { MeetingItem } from "@/components/meetings/MeetingItem";
import type { Meeting } from "@/components/meetings/useMeetings";
import type { CalendarMeeting } from "@/lib/calendar/placement";

export function MeetingCard({ meeting, onTriage }: { meeting: CalendarMeeting; onTriage: (m: Meeting) => void }) {
  return (
    <div className="rounded-2xl border-2 border-border bg-card shadow-sm">
      <MeetingItem meeting={meeting} onTriage={onTriage} />
    </div>
  );
}
```

- [ ] **Step 4: Coluna e pool**

`DayColumn.tsx`:
```tsx
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { EventRow } from "@/components/meetings/EventRow";
import type { Meeting } from "@/components/meetings/useMeetings";
import type { AvatarPickerMember } from "@/components/tasks/AssigneeAvatarPicker";
import { dayContainerId } from "@/lib/calendar/dnd";
import type { CalendarTask, DayColumnModel } from "@/lib/calendar/placement";
import { parseYmd, WEEKDAY_SHORT } from "@/lib/calendar/week";
import { CalendarApprovalCard } from "./CalendarApprovalCard";
import { CalendarTaskCard } from "./CalendarTaskCard";
import { MeetingCard } from "./MeetingCard";
import { SortableItem } from "./SortableItem";

export interface ColumnCallbacks {
  membersFor: (workspaceId: string | null) => AvatarPickerMember[];
  invalidateKeys: unknown[][];
  onOpenTask: (task: CalendarTask) => void;
  onTriage: (m: Meeting) => void;
}

export function DayColumn({ day, cb }: { day: DayColumnModel; cb: ColumnCallbacks }) {
  const { setNodeRef, isOver } = useDroppable({ id: dayContainerId(day.date), disabled: day.isPast });
  const d = parseYmd(day.date);
  const weekday = WEEKDAY_SHORT[(d.getDay() + 6) % 7];
  return (
    <section
      aria-label={`${weekday} ${d.getDate()}`}
      data-calendar-day={day.date}
      className={`flex min-w-[260px] flex-1 flex-col rounded-2xl border p-2 transition-colors ${
        day.isToday ? "border-primary/50 bg-primary/5" : "border-border bg-card/40"
      } ${isOver && !day.isPast ? "ring-2 ring-primary/40" : ""} ${day.isPast ? "opacity-80" : ""}`}
    >
      <header className="mb-2 flex items-baseline justify-between px-1">
        <span className={`text-xs lowercase ${day.isToday ? "font-semibold text-primary" : "text-muted-foreground"}`}>
          {weekday}{day.isToday ? " · hoje" : ""}
        </span>
        <span className={`text-lg font-light tabular-nums ${day.isToday ? "text-primary" : "text-foreground/80"}`}>{d.getDate()}</span>
      </header>

      {day.events.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {day.events.map(e => <EventRow key={`${e.calendarId}:${e.id}`} event={e} />)}
        </div>
      )}

      <div ref={setNodeRef} className="flex min-h-[80px] flex-1 flex-col gap-3">
        <SortableContext items={day.items.map(i => i.key)} strategy={verticalListSortingStrategy}>
          {day.items.map(item => (
            <SortableItem key={item.key} id={item.key} disabled={day.isPast}>
              {item.kind === "meeting" ? (
                <MeetingCard meeting={item.meeting} onTriage={cb.onTriage} />
              ) : item.kind === "approval" ? (
                <CalendarApprovalCard task={item.task} onOpen={cb.onOpenTask} />
              ) : (
                <CalendarTaskCard
                  task={item.task}
                  members={cb.membersFor(item.task.workspaceId)}
                  invalidateKeys={cb.invalidateKeys}
                  onOpen={cb.onOpenTask}
                />
              )}
            </SortableItem>
          ))}
        </SortableContext>
        {day.terminal.map(t => (
          <CalendarTaskCard
            key={t.id}
            task={t}
            members={cb.membersFor(t.workspaceId)}
            invalidateKeys={cb.invalidateKeys}
            onOpen={cb.onOpenTask}
          />
        ))}
      </div>
    </section>
  );
}
```

`PoolSection.tsx`:
```tsx
import { useDroppable } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import { POOL_ID } from "@/lib/calendar/dnd";
import type { CalendarTask } from "@/lib/calendar/placement";
import { CalendarApprovalCard } from "./CalendarApprovalCard";
import { CalendarTaskCard } from "./CalendarTaskCard";
import type { ColumnCallbacks } from "./DayColumn";
import { SortableItem } from "./SortableItem";

export function PoolSection({ tasks, cb }: { tasks: CalendarTask[]; cb: ColumnCallbacks }) {
  const { setNodeRef, isOver } = useDroppable({ id: POOL_ID });
  return (
    <section aria-label="sem data" data-calendar-pool className="mt-8">
      <h3 className="mb-3 px-1 text-xs font-light lowercase text-muted-foreground">sem data · {tasks.length}</h3>
      <div
        ref={setNodeRef}
        className={`grid min-h-[96px] grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3 rounded-2xl border border-dashed p-3 ${
          isOver ? "border-primary/60 bg-primary/5" : "border-border/60"
        }`}
      >
        <SortableContext items={tasks.map(t => `task:${t.id}`)} strategy={rectSortingStrategy}>
          {tasks.map(t => (
            <SortableItem key={t.id} id={`task:${t.id}`}>
              {t.isApprovalTask ? (
                <CalendarApprovalCard task={t} onOpen={cb.onOpenTask} />
              ) : (
                <CalendarTaskCard task={t} members={cb.membersFor(t.workspaceId)} invalidateKeys={cb.invalidateKeys} onOpen={cb.onOpenTask} />
              )}
            </SortableItem>
          ))}
        </SortableContext>
        {tasks.length === 0 && <p className="col-span-full self-center text-center text-xs text-muted-foreground">arraste um card para cá para tirar a data</p>}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: `WeekCalendar`**

```tsx
import { useMemo, useState } from "react";
import { DndContext, DragOverlay, closestCorners, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@beeads/ui";
import { TriageDialog } from "@/components/meetings/TriageDialog";
import type { Meeting } from "@/components/meetings/useMeetings";
import type { AvatarPickerMember } from "@/components/tasks/AssigneeAvatarPicker";
import { useToast } from "@/hooks/use-toast";
import { useGoogleCalendarStatus, useRangeEvents } from "@/hooks/useGoogleCalendar";
import {
  calendarMeetingsKey, calendarTasksKey, useCalendarMeetings, useCalendarTasks, useReorderCalendar, type CalendarScope,
} from "@/hooks/useCalendarData";
import { computeDrop } from "@/lib/calendar/dnd";
import { placeWeek, type CalendarTask } from "@/lib/calendar/placement";
import { CalendarPointerSensor } from "@/lib/calendar/sensor";
import { addDaysYmd, parseYmd, startOfWeekMonday, weekBoundsISO, ymdLocal } from "@/lib/calendar/week";
import { DayColumn, type ColumnCallbacks } from "./DayColumn";
import { PoolSection } from "./PoolSection";

export interface WeekCalendarProps {
  scope: CalendarScope;
  status: string;
  assignees: string[];
  membersFor: (workspaceId: string | null) => AvatarPickerMember[];
  extraInvalidateKeys: unknown[][];
  onOpenTask: (task: CalendarTask) => void;
}

function weekLabel(weekStart: string): string {
  const s = parseYmd(weekStart);
  const e = parseYmd(addDaysYmd(weekStart, 6));
  const fmt = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
  return `${fmt(s)} – ${fmt(e)}`;
}

export function WeekCalendar({ scope, status, assignees, membersFor, extraInvalidateKeys, onOpenTask }: WeekCalendarProps) {
  const today = ymdLocal(new Date());
  const currentWeek = startOfWeekMonday(today);
  const [weekStart, setWeekStart] = useState(currentWeek);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [triageTarget, setTriageTarget] = useState<Meeting | null>(null);
  const { toast } = useToast();

  const tasksQ = useCalendarTasks(scope, weekStart, status, assignees);
  const meetingsQ = useCalendarMeetings(scope, weekStart);
  const { data: gcal } = useGoogleCalendarStatus();
  const { from, to } = weekBoundsISO(weekStart);
  const eventsQ = useRangeEvents(from, to, !!gcal?.connected && assignees.includes("me"));

  const week = useMemo(() => placeWeek({
    tasks: tasksQ.data ?? [],
    meetings: meetingsQ.data ?? [],
    events: eventsQ.data?.events ?? [],
    weekStart,
    today,
  }), [tasksQ.data, meetingsQ.data, eventsQ.data, weekStart, today]);

  const tasksKey = calendarTasksKey(scope, weekStart, status, assignees);
  const meetingsKey = calendarMeetingsKey(scope, weekStart);
  const reorder = useReorderCalendar(tasksKey, meetingsKey, extraInvalidateKeys);
  const sensors = useSensors(useSensor(CalendarPointerSensor, { activationConstraint: { distance: 4 } }));

  // Chaves ESTÁVEIS: o useInlineTaskEditor libera a invalidação represada no
  // cleanup do efeito que depende delas; identidade nova a cada render soltaria
  // a represa no meio da edição de prazo.
  const extraKeySig = JSON.stringify(extraInvalidateKeys);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const invalidateKeys = useMemo(() => [[tasksKey[0]], ...extraInvalidateKeys], [tasksKey[0], extraKeySig]);
  const cb: ColumnCallbacks = { membersFor, invalidateKeys, onOpenTask, onTriage: setTriageTarget };

  const onDragStart = (e: DragStartEvent) => setActiveKey(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveKey(null);
    if (!e.over) return;
    const result = computeDrop({ week, activeKey: String(e.active.id), overId: String(e.over.id), today });
    if (result.ok) {
      reorder.mutate({ body: result.body, optimistic: result.optimistic });
    } else if (result.reason === "past") {
      toast({ title: "dias passados não recebem tarefas" });
    } else if (result.reason === "meeting-cross-day") {
      toast({ title: "reunião só muda de posição dentro do dia" });
    }
  };

  const activeTitle = useMemo(() => {
    if (!activeKey) return null;
    for (const d of week.days) {
      const it = d.items.find(i => i.key === activeKey);
      if (it) return it.kind === "meeting" ? (it.meeting.title ?? "reunião") : it.task.title;
    }
    return week.pool.find(t => `task:${t.id}` === activeKey)?.title ?? null;
  }, [activeKey, week]);

  const loading = tasksQ.isLoading;

  return (
    <div data-testid="week-calendar">
      <div className="mb-4 flex items-center justify-center gap-3">
        <span className="text-sm font-light lowercase text-foreground/80">{weekLabel(weekStart)}</span>
        {weekStart !== currentWeek && (
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(currentWeek)}>hoje</Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveKey(null)}>
          {/* Setas nas laterais do calendário (pedido do produto). Ficam fora da
              área com scroll horizontal, então nunca cobrem cards. */}
          <div className="flex items-stretch gap-2">
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 self-center"
              onClick={() => setWeekStart(w => addDaysYmd(w, -7))}
              aria-label="semana anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex min-w-0 flex-1 gap-3 overflow-x-auto pb-2">
              {week.visibleDays.map(day => <DayColumn key={day.date} day={day} cb={cb} />)}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 self-center"
              onClick={() => setWeekStart(w => addDaysYmd(w, 7))}
              aria-label="próxima semana"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <PoolSection tasks={week.pool} cb={cb} />
          <DragOverlay>
            {activeTitle ? (
              <div className="max-w-[260px] rounded-xl border bg-card px-3 py-2 text-sm font-semibold shadow-lg">{activeTitle}</div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <TriageDialog meeting={triageTarget} open={triageTarget !== null} onOpenChange={(o) => { if (!o) setTriageTarget(null); }} />
    </div>
  );
}
```
As setas ficam nas laterais do kanban, fora do container com scroll horizontal. O cabeçalho mostra o intervalo da semana e o botão "hoje" quando a semana exibida não é a atual.

- [ ] **Step 6: Gates**

FE typecheck relativo: zero erro nos arquivos novos. `vite build` ok. `npx vitest run` inteiro verde.

- [ ] **Step 7: Commit**

```bash
git add artifacts/mindtask-app/src/lib/calendar/sensor.ts artifacts/mindtask-app/src/components/calendar
git commit -m "feat(calendario): kanban semanal com DnD, pool, reuniões e eventos"
```

---

## Task 13: Toggle lista | calendário nas páginas

**Files:**
- Create: `artifacts/mindtask-app/src/components/tasks/ViewModeToggle.tsx`
- Modify: `artifacts/mindtask-app/src/pages/my-tasks.tsx`
- Modify: `artifacts/mindtask-app/src/pages/workspaces/detail.tsx`

**Interfaces:**
- Consumes: `WeekCalendar` (Task 12), `TODOS_STATUS` (Task 10), `AvatarPickerMember` (Task 7).
- Produces: `export type ViewMode = "lista" | "calendario"`; `export function ViewModeToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void })`.

- [ ] **Step 1: `ViewModeToggle`**

```tsx
import { CalendarDays, List } from "lucide-react";

export type ViewMode = "lista" | "calendario";

const OPTIONS: { value: ViewMode; label: string; Icon: typeof List }[] = [
  { value: "lista", label: "lista", Icon: List },
  { value: "calendario", label: "calendário", Icon: CalendarDays },
];

export function ViewModeToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div role="radiogroup" aria-label="modo de visualização" className="inline-flex rounded-full border border-border bg-card p-0.5">
      {OPTIONS.map(({ value: v, label, Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm lowercase transition-colors ${
            value === v ? "bg-foreground/10 font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `/my-tasks`**

- `readInitialFilters` passa a ler `view`: `view: p.get("view") === "calendario" ? "calendario" : "lista"` (e o fallback SSR `"lista"`).
- Estado: `const [viewMode, setViewMode] = useState<ViewMode>(initial.view);`
- Sync de URL: no `useEffect` existente, `if (viewMode === "lista") p.delete("view"); else p.set("view", viewMode);` e incluir `viewMode` nas deps.
- Troca de modo:
```ts
  const changeView = (v: ViewMode) => {
    setViewMode(v);
    if (v === "calendario") setSelectedStatus(TODOS_STATUS);
  };
```
- Membros com avatar para o card:
```ts
  const pickerMembersByWorkspace = useMemo(() => {
    const acc: Record<string, AvatarPickerMember[]> = {};
    for (const m of members ?? []) {
      (acc[m.workspaceId] ??= []);
      if (!acc[m.workspaceId].some(x => x.userId === m.userId)) {
        acc[m.workspaceId].push({ userId: m.userId, user: { name: m.name, avatarUrl: m.avatarUrl ?? null } });
      }
    }
    return acc;
  }, [members]);
```
- No bloco de filtros: `ViewModeToggle` à esquerda do `AssigneeFilterPills` (mesmo `div` à direita). `TimeWindowFilterPills` só quando `viewMode === "lista"` (além da condição atual). `<AgendaPanel />` só quando `viewMode === "lista"`.
- Chaves extras estáveis: `const calendarExtraKeys = useMemo(() => [countsQueryKey], [JSON.stringify(countsQueryKey)]);` (importar `useMemo` se faltar).
- No conteúdo: se `viewMode === "calendario"`, renderizar no lugar do skeleton/tabela:
```tsx
<WeekCalendar
  scope={{ kind: "my" }}
  status={selectedStatus}
  assignees={selectedAssignees}
  membersFor={(ws) => (ws ? pickerMembersByWorkspace[ws] ?? [] : [])}
  extraInvalidateKeys={calendarExtraKeys}
  onOpenTask={openTaskItem}
/>
```
Os handlers de fechar modal já invalidam `["/api/my-tasks"]`, que é prefixo da chave do calendário.

- [ ] **Step 3: Aba de tarefas do workspace (`detail.tsx`)**

- `const [viewMode, setViewMode] = useState<ViewMode>("lista");` e `changeView` idêntico ao do `/my-tasks`.
- `ViewModeToggle` no mesmo lugar relativo (lado direito da linha de filtros, antes do `AssigneeFilterPills`; renderizar mesmo quando não há membros).
- `TimeWindowFilterPills` só em `lista`.
- Chaves extras estáveis: `const calendarExtraKeys = useMemo(() => [countsQueryKey, ["/api/my-tasks"]], [JSON.stringify(countsQueryKey)]);`
- Conteúdo em `calendario`:
```tsx
<WeekCalendar
  scope={{ kind: "workspace", workspaceId }}
  status={selectedStatus}
  assignees={selectedAssignees}
  membersFor={() => (workspaceMembers ?? []).map(m => ({ userId: m.userId, user: { name: m.user.name, avatarUrl: m.user.avatarUrl ?? null } }))}
  extraInvalidateKeys={calendarExtraKeys}
  onOpenTask={openTaskItem}
/>
```
- Em `handleClosePanel` e `handleCloseTaskSheet`, acrescentar `queryClient.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/tasks`] });` (prefixo; cobre o calendário).

- [ ] **Step 4: Gates**

FE typecheck relativo nos 3 arquivos; `vite build` ok; `npx vitest run` verde; e2e `inline-due-date` e `my-tasks-create` verdes (o modo lista não mudou).

- [ ] **Step 5: Commit**

```bash
git add artifacts/mindtask-app/src/components/tasks/ViewModeToggle.tsx artifacts/mindtask-app/src/pages/my-tasks.tsx artifacts/mindtask-app/src/pages/workspaces/detail.tsx
git commit -m "feat(tarefas): toggle lista | calendário em minhas tarefas e no workspace"
```

---

## Task 14: E2E do calendário e validação no dev

**Files:**
- Create: `e2e/calendar-week.spec.ts`

**Interfaces:**
- Consumes: tudo acima; seletores `data-testid="week-calendar"`, `[data-calendar-day="YYYY-MM-DD"]`, `[data-calendar-item="task:<id>"]`, `[data-calendar-pool]`, `role=radio name=calendário`.

- [ ] **Step 1: Escrever o e2e**

```ts
import { test, expect, request as pwRequest, type APIRequestContext, type Page, type Locator } from "@playwright/test";

const API = process.env.API_BASE_URL ?? "http://localhost:5000";
const PASSWORD = "E2ePass12345!";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Hoje e um dia futuro na MESMA semana (seg–dom), ou o 1º dia da semana seguinte se hoje for domingo. */
function days() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const dow = (t.getDay() + 6) % 7;
  return { today: ymd(t), target: ymd(addDays(t, 1)), crossesWeek: dow === 6 };
}

async function api(): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: API });
  const r = await ctx.post("/api/auth/login", { data: { email: "e2e_tasks_owner@test.local", password: PASSWORD } });
  expect(r.ok()).toBeTruthy();
  return ctx;
}

async function dragTo(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("sem bounding box");
  // Área neutra do card: faixa superior esquerda (acima do título).
  await page.mouse.move(a.x + 8, a.y + 6);
  await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y + 20, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height - 12, { steps: 15 });
  await page.mouse.up();
}

test("calendário: toggle, ancoragem pelo prazo, arrastar para outro dia e reordenar persistem", async ({ page, context }) => {
  const ctx = await api();
  const stamp = Date.now();
  const { today, target, crossesWeek } = days();
  const ws = await (await ctx.post("/api/workspaces", { data: { name: `E2E Calendário ${stamp}`, colorIndex: 0 } })).json();
  try {
    const mk = async (title: string, body: Record<string, unknown>) => {
      const t = await (await ctx.post(`/api/workspaces/${ws.id}/tasks`, { data: { title, ...body } })).json();
      await ctx.patch(`/api/workspaces/${ws.id}/tasks/${t.id}/status`, { data: { status: "pending" } });
      return t.id as string;
    };
    const a = await mk(`A ${stamp}`, { scheduleMode: "ate", dueDate: `${today}T12:00:00.000Z` });
    const b = await mk(`B ${stamp}`, { scheduleMode: "ate", dueDate: `${today}T12:00:00.000Z` });
    const loose = await mk(`solta ${stamp}`, {});

    await context.addCookies((await ctx.storageState()).cookies.map(c => ({ ...c, domain: "localhost" })));
    await page.goto(`/workspaces/${ws.id}?tab=tasks`);
    await page.getByRole("radio", { name: "calendário" }).click();
    const cal = page.getByTestId("week-calendar");
    await expect(cal).toBeVisible();

    const todayCol = cal.locator(`[data-calendar-day="${today}"]`);
    await expect(todayCol.locator(`[data-calendar-item="task:${a}"]`)).toBeVisible();
    await expect(todayCol.locator(`[data-calendar-item="task:${b}"]`)).toBeVisible();
    await expect(cal.locator("[data-calendar-pool]").locator(`[data-calendar-item="task:${loose}"]`)).toBeVisible();

    // reordenar: B acima de A
    await dragTo(page, todayCol.locator(`[data-calendar-item="task:${b}"]`), todayCol.locator(`[data-calendar-item="task:${a}"]`));
    await expect.poll(async () => {
      const rows = await (await ctx.get(`/api/calendar/tasks?from=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}&workspaceId=${ws.id}`)).json();
      const ra = rows.find((r: any) => r.id === a);
      const rb = rows.find((r: any) => r.id === b);
      return rb?.plannedOrder != null && ra?.plannedOrder != null && rb.plannedOrder < ra.plannedOrder;
    }).toBe(true);

    // arrastar a solta para o dia alvo
    if (crossesWeek) await cal.getByRole("button", { name: "próxima semana" }).click();
    const targetCol = cal.locator(`[data-calendar-day="${target}"]`);
    await dragTo(page, cal.locator(`[data-calendar-item="task:${loose}"]`), targetCol);
    await expect(targetCol.locator(`[data-calendar-item="task:${loose}"]`)).toBeVisible();

    await page.reload();
    await page.getByRole("radio", { name: "calendário" }).click();
    if (crossesWeek) await page.getByRole("button", { name: "próxima semana" }).click();
    await expect(page.locator(`[data-calendar-day="${target}"] [data-calendar-item="task:${loose}"]`)).toBeVisible();
    const order = await page.locator(`[data-calendar-day="${today}"] [data-calendar-item]`).evaluateAll(els => els.map(e => e.getAttribute("data-calendar-item")));
    expect(order.indexOf(`task:${b}`)).toBeLessThan(order.indexOf(`task:${a}`));
  } finally {
    await ctx.delete(`/api/workspaces/${ws.id}`);
  }
});

test("calendário: urgente → 'fazer até' sem data não desmonta o card no meio da edição", async ({ page, context }) => {
  const ctx = await api();
  const stamp = Date.now();
  const { today } = days();
  const ws = await (await ctx.post("/api/workspaces", { data: { name: `E2E Calendário U ${stamp}`, colorIndex: 0 } })).json();
  try {
    const t = await (await ctx.post(`/api/workspaces/${ws.id}/tasks`, { data: { title: `U ${stamp}`, scheduleMode: "urgente" } })).json();
    await ctx.patch(`/api/workspaces/${ws.id}/tasks/${t.id}/status`, { data: { status: "pending" } });
    await context.addCookies((await ctx.storageState()).cookies.map(c => ({ ...c, domain: "localhost" })));
    await page.goto(`/workspaces/${ws.id}?tab=tasks`);
    await page.getByRole("radio", { name: "calendário" }).click();
    const card = page.locator(`[data-calendar-day="${today}"] [data-calendar-item="task:${t.id}"]`);
    await expect(card).toBeVisible();
    await card.getByTitle("Clique para alterar modalidade de prazo").click();
    await card.getByTitle("Modalidade do fazer").selectOption("ate");
    await page.waitForTimeout(2500); // janela em que o refetch arrancaria o card
    await expect(card.getByTitle("Modalidade do fazer")).toBeVisible();
  } finally {
    await ctx.delete(`/api/workspaces/${ws.id}`);
  }
});
```
Se o seletor do dia da semana-alvo não bater (ex.: domingo), ajustar só o spec.

- [ ] **Step 2: Rodar o e2e**

Seguir `e2e/README.md`: seed de usuários, API dev na :5000, `pnpm --filter @workspace/mindtask-app run build`, `node e2e/serve.mjs artifacts/mindtask-app/dist/public 3100 http://localhost:5000`, runner fora do repo com `NODE_PATH`:
```bash
NODE_PATH=<runner>/node_modules WEB_BASE_URL=http://localhost:3100 API_BASE_URL=http://localhost:5000 \
  npx playwright test --config <repo>/e2e/playwright.config.ts <repo>/e2e/calendar-week.spec.ts <repo>/e2e/canvas-card-inline.spec.ts <repo>/e2e/inline-due-date.spec.ts <repo>/e2e/my-tasks-create.spec.ts
```
Expected: todos verdes. Falha de app → corrigir o app (com teste) e re-rodar; falha de seletor → corrigir o spec.

- [ ] **Step 3: Suítes completas**

- API: `DATABASE_URL=$DEV_DATABASE_URL JWT_SECRET=$JWT_SECRET npx vitest run` (re-rodar uma vez se cair por timeout).
- FE: `npx vitest run`.
- Typecheck relativo API e FE contra os baselines da Task 1.
- `pnpm install --frozen-lockfile` na raiz → "Lockfile passes" (nada mudou em dependências).

- [ ] **Step 4: Validação visual no dev**

Com API + build servidos, capturar via Playwright screenshots de: `/my-tasks?view=calendario` (semana atual), semana seguinte, semana anterior, aba do workspace em calendário, e o canvas de um plano com aprovações. Salvar em `$SCRATCH/` para o relatório final.

- [ ] **Step 5: Commit**

```bash
git add e2e/calendar-week.spec.ts
git commit -m "test(e2e): calendário semanal — ancoragem, drag entre dias, reorder e edição de prazo"
```
