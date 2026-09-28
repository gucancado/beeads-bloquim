# Modo calendário (kanban semanal) na lista de tarefas — Design

**Data:** 2026-09-27
**Branch:** `feat/calendario-semanal`
**Escopo:** backend (`lib/db`, `artifacts/api-server`) + frontend (`artifacts/mindtask-app`). Migration aditiva.

## Objetivo

Visualizar e planejar a semana atual e as seguintes, e rever as anteriores, num kanban por dia da semana. As duas listas de tarefas (`/my-tasks` e aba de tarefas do workspace) ganham um toggle **lista | calendário**. O modo padrão continua sendo lista.

## Comportamento

### Layout

- Uma coluna por dia, segunda a domingo. Sábado e domingo só aparecem quando há algum item ancorado neles ou quando hoje cai num deles.
- Setas ← → nas laterais navegam entre semanas. Botão "hoje" volta pra semana atual. A coluna de hoje é destacada.
- Abaixo do kanban, a seção **"sem data"**: tarefas ativas sem prazo e sem data de execução pretendida, em cards.
- Filtros de pessoas e status continuam acima, com o mesmo comportamento da lista. As pills de janela (hoje / até sexta / próxima semana / todas) e o `AgendaPanel` ficam ocultos no modo calendário. A navegação de semana substitui a janela, e o calendário já mostra reuniões e eventos.
- Colunas com largura mínima 240px, scroll horizontal no mobile.

### Itens

| Item | Origem | Card |
|---|---|---|
| Tarefa comum | `tasks` (`is_approval_task=false`) | `TaskCardBody`, o mesmo corpo do `MindMapNode` do canvas |
| Tarefa de aprovação | `tasks` (`is_approval_task=true`) | `ApprovalCardBody`, o mesmo corpo do `ApprovalNode` |
| Reunião | `meetings` (status ≠ `canceled`) | `MeetingCard` embrulhando o `MeetingItem` existente |
| Evento do Google Calendar | `GET /api/integrations/google-calendar/events` | `EventCard` (o `EventRow` do `AgendaPanel`, extraído) |

Eventos do Google que já viraram reunião sincronizada são deduplicados por `gcalEventId`, igual ao `AgendaPanel`. Eventos aparecem só se o usuário tem Google conectado **e** o filtro de pessoas inclui "eu": a integração é por usuário. Reuniões não têm responsável: aparecem independentemente dos filtros de pessoas e status (escopo = workspace da aba, ou todos os workspaces do usuário em `/my-tasks`).

### Campos novos

- `tasks.planned_date date null` — **data de execução pretendida**. Não aparece na lista, no modal nem no card. Só o calendário lê e escreve.
- `tasks.planned_order integer null` — **ordem de prioridade** dentro da coluna. `null` = nunca ordenada manualmente.
- `meetings.planned_order integer null` — idem para reunião.
- Índice parcial `idx_tasks_assigned_planned (assigned_to, planned_date) WHERE planned_date IS NOT NULL`.

### Regras de posicionamento (ancoragem)

Definidas em `lib/calendar/placement.ts` (puro, testado). `hoje` = data local do navegador. Datas de tarefa são `YYYY-MM-DD` via `slice(0,10)` (armazenadas ao meio-dia UTC, convenção do app).

**Tarefa** (`anchorOfTask(task, hoje)`):

1. `completed` → dia de `completedAt`, fallback `updatedAt`.
2. `blocked` (cancelada) → dia de `cancelledAt`, fallback `blockedSince`, fallback `updatedAt`.
3. Ativa (`draft`, `pending`, `in_progress`):
   - `base = plannedDate ?? dueDate`. Em `entre`, `dueDate` é o prazo máximo. Em `em`, `startAt === dueDate`.
   - `base == null` e `scheduleMode === 'urgente'` → **hoje**.
   - `base == null` → **pool "sem data"**.
   - `base < hoje` → **hoje** (atrasada: prazo ou data pretendida já passaram).
   - senão → `base`.

Uma tarefa aparece na semana exibida se a âncora cair em [segunda, domingo]. Consequências:

- Semana passada mostra só concluídas/canceladas (âncora terminal), reuniões e eventos. Atrasadas e urgentes só existem na coluna de hoje, portanto só na semana atual.
- Semana futura mostra tarefas com data pretendida ou prazo naquela semana. Prazo em qualquer semana exibida conta, não só na semana atual.
- O pool "sem data" não depende da semana.

**Reunião:** dia de `scheduledStartAt ?? occurredAt`, na tz do navegador. Não é carregada pra hoje.

**Evento:** cada dia coberto por `[start, end)` dentro da semana. Dia inteiro usa a data literal.

### Ordem dentro da coluna

1. Bloco fixo de eventos do Google no topo: dia inteiro primeiro, depois cronológico. Não arrastável.
2. Itens ordenáveis: `plannedOrder ASC NULLS LAST` → tipo (aprovação 0, reunião 1, tarefa 2) → `dueDate ASC NULLS LAST` → prioridade (`critical`…`low`) → `createdAt ASC`.
3. Tarefas terminais (concluída/cancelada) por último, em ordem cronológica do timestamp terminal, no visual "muted" compacto do canvas. Não arrastáveis.

Coluna que ninguém ordenou tem todos `plannedOrder = null` e cai na ordem padrão do spec: aprovações, reuniões, tarefas.

### Drag and drop

- **Arrastáveis:** tarefas e aprovações ativas (entre colunas e dentro da coluna), reuniões (só dentro da coluna, a data vem da agenda), cards do pool (pra dentro de uma coluna).
- **Alvos:** colunas com data ≥ hoje na semana atual, qualquer coluna em semana futura, e a zona do pool. Semana passada é somente leitura. Soltar em coluna passada é rejeitado no cliente; cairia em hoje pela regra de ancoragem no mesmo instante.
- **Soltar em coluna:** o cliente monta a lista ordenada final dos itens ordenáveis da coluna alvo e chama o reorder. O item movido ganha `plannedDate = data da coluna`; todos os itens da coluna recebem `plannedOrder = índice` (denso). A coluna de origem não é renumerada: a ordem relativa se preserva com buracos.
- **Soltar no pool:** `plannedDate = null`, `plannedOrder = null`. Se a tarefa tem prazo, ela volta pra coluna do prazo em vez de ficar no pool.
- **Colunas com várias pessoas no filtro:** os itens intercalam pelo número. Um reorder renumera todos os itens da coluna, de todas as pessoas.
- Otimista: o cliente reordena o cache do react-query no `onDragEnd` e reverte no erro, com toast.
- Sensor: `PointerSensor` com `distance: 4`, e handler de ativação que ignora alvos dentro de `[data-no-dnd]`. Os elementos interativos do card (título editável, seletores, popovers) recebem `data-no-dnd` além das classes `nodrag nopan` que o canvas já usa. Assim o mesmo corpo serve aos dois hosts.

### Regra de reatribuição e urgente (servidor)

`calendarOrderService.applyOrderRules(taskId)`, chamado depois de qualquer gravação que:

- troque `assigned_to` de uma tarefa existente (`PATCH /workspaces/:w/tasks/:t`, `PATCH .../cards/:c/task/details`, `taskMoveService`, `PATCH /my-tasks/:t/association`), ou
- mude `schedule_mode` para `urgente` (os três PATCH de tarefa), ou
- crie tarefa já `urgente` com responsável (os três POST).

Algoritmo:

1. Tarefa terminal → no-op.
2. `d = plannedDate ?? dueDate::date`. Se `d == null`: urgente → `d = hoje`; senão `plannedOrder = null` e fim (pool).
3. Se `d < hoje` → `d = hoje`. `hoje` no servidor é `America/Sao_Paulo` (`APP_TIMEZONE`, mesma referência do overdue).
4. Irmãs = tarefas ativas do **novo responsável**, exceto a própria, cuja âncora é `d`. Em SQL: `COALESCE(planned_date, due_date::date) = d`, ou, quando `d = hoje`, âncora `< hoje` ou urgente sem datas.
5. `urgente` → `plannedOrder = min(irmãs.plannedOrder) - 1`, ou `0` se nenhuma ordenada. Fica no topo, porque `null` ordena por último.
6. Senão → `plannedOrder = max(irmãs.plannedOrder) + 1`, ou `null` se nenhuma ordenada. Numa coluna sem ordem manual vale a ordem padrão, documentado.

Sem activity log para `planned_date` e `planned_order`: cada drag geraria ruído no histórico da tarefa. Mesma decisão da rota `association`.

### Filtro de status "todos"

- Nova pill `todos` = `draft,pending,in_progress,completed` (tudo menos cancelada). Sem contador.
- Disponível nos dois modos. Na lista, "todos" desliga o pin de urgente no backend (já é o comportamento para filtro fora do subconjunto ativo), mantém as pills de janela e o agrupamento por prazo no cliente, e o `dateColumnMode` fica `default`.
- Trocar para o modo calendário define o status como `todos` uma vez. Sem isso os dias passados ficariam vazios. Voltar pra lista mantém o que estiver selecionado.
- `/my-tasks` aceita `?status=todos` e `?view=calendario` na URL, com os defaults removidos como hoje. A aba do workspace guarda `viewMode` em estado local, como os outros filtros dela.

## Arquitetura

### Banco

Migration `lib/db/drizzle/0040_add_calendar_planning.sql`, idempotente:

```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS planned_date date;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS planned_order integer;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS planned_order integer;
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_planned ON tasks (assigned_to, planned_date) WHERE planned_date IS NOT NULL;
```

Aplicação em dev e prod: executar o SQL diretamente com `pg`. **Não** rodar `drizzle-kit push` no dev: ele enxerga as tabelas `strategy_*` de outra branch como drift. Schema Drizzle em `lib/db/src/schema/tasks.ts` e `meetings.ts` ganha as colunas; depois `npx tsc -b lib/db` para atualizar os `.d.ts`.

### API

**`GET /api/calendar/tasks`** (router novo `routes/calendar.ts`, montado em `/api/calendar`; não fica sob `/my-tasks` porque `/my-tasks/:taskId` capturaria o path)
Query: `from`, `to` (instantes ISO, limites da semana em tz local do cliente, `to` exclusivo), `status` (CSV), `assignedTo` (CSV de `me`, `unassigned` e uuids; default `me`), `workspaceId` (opcional). Com `workspaceId`: escopo daquele workspace, exige membership (403). Sem: escopo do `/my-tasks` (workspaces visíveis do usuário + standalone dele).
Retorna array de tarefas com o select da lista mais `plannedDate`, `plannedOrder`, `approvalStatus`, `parentApprovalStatus`, `description`, `updatedAt`, `cancelledAt`, `blockedSince`, `workspaceName`. Where:

```
escopo AND filtro de pessoas AND NOT (aprovação em draft) AND (
     status IN (ativos ∩ filtro)
  OR (status = 'completed' AND 'completed' ∈ filtro AND completed_at ∈ [from, to))
  OR (status = 'blocked'   AND 'blocked'   ∈ filtro AND COALESCE(cancelled_at, blockedSince) ∈ [from, to))
)
```

Ativas vêm todas porque a ancoragem (hoje, pool, semana) é do cliente. Limite 1000. O select e os filtros ficam em `services/calendarTasksQuery.ts`; os handlers de lista existentes não são tocados.

**`PUT /api/calendar/reorder`** (rota nova `routes/calendar.ts`)

```ts
{
  date: "YYYY-MM-DD",
  items: [{ kind: "task" | "meeting", id }],        // ordem final da coluna alvo
  moved?: { kind: "task", id, target: "day" | "pool" }
}
```

- Autorização por item: tarefa → membro do workspace, ou standalone com `assigned_to = eu`; reunião → `canActOnMeeting`. Qualquer falha → 403, nada gravado.
- Validação: `moved.kind === "meeting"` → 400; `moved` em tarefa terminal → 400; ids duplicados → 400; `target: "pool"` exige `items: []`.
- Transação: `planned_order = índice` para cada item; `moved` com `target: "day"` → `planned_date = date`; `target: "pool"` → `planned_date = null, planned_order = null`.
- Responde `{ ok: true }`.

**`GET /api/meetings?workspaceId=&from=&to=`**
`from`/`to` opcionais. Com eles: `COALESCE(scheduled_start_at, occurred_at) ∈ [from, to)` e `status <> 'canceled'`, ordem crescente por esse timestamp. Sem eles, comportamento atual intacto.

**`GET /api/integrations/google-calendar/events?from=&to=&tz=`**
Generaliza `today-events`: mesma resposta `{ events, cached, noCalendarsSelected }`, mesmos erros (404 não conectado, 401 reauth, 503 flag), cache em memória com chave `userId::from::to::tz` e o mesmo TTL de 10 min, invalidado nos mesmos pontos. Intervalo máximo 31 dias → 400. `today-events` continua existindo; o `AgendaPanel` não muda. `listEvents` segue com `maxResults=100` por calendário, suficiente para uma semana.

**`calendarOrderService.ts`** (novo): `applyOrderRules` conforme a seção de regras. Chamado dentro do `try` best-effort dos handlers, depois do update principal, como o activity log.

### Frontend

**Extração dos corpos de card (pré-requisito, sem mudança de comportamento no canvas)**

- `components/maps/TaskCardBody.tsx`: tudo que o `MindMapNode` renderiza e edita, menos `Handle`, botão "+", mutations por card e `useListWorkspaceMembers`. Inclui a variante muted. Props:

  ```ts
  interface TaskCardBodyProps {
    data: TaskCardData;                 // title, statusVisual, taskId, dueDate, startAt, scheduleMode,
                                        // assignee{Name,Id,AvatarUrl}, description, completedAt,
                                        // parentApprovalStatus, contadores
    selected?: boolean;
    members?: TaskListItemMember[];     // seletor de responsável; ausente → seletor desabilitado
    onTitleSave(next: string): void;
    onStatusChange(status: TaskStatusValue): void;
    onAssigneeChange(userId: string | "unassigned"): void;
    onSchedulePatch(patch: { scheduleMode?: ScheduleModeValue; startAt?: string | null; dueDate?: string | null }): void;
    onOpen(): void;
    onEditingChange?(editing: boolean): void;
    onScheduleOpenChange?(open: boolean): void;
    autoFocusTitle?: boolean; onAutoFocusConsumed?(): void;
    className?: string;
    children?: ReactNode;               // slot do host: Handles e botão "+" no canvas
  }
  ```

  O estado local de edição (título, `pendingMode`, popovers de data/status) mora no corpo. A lógica de `handleScheduleModeChange`/`handleDueDateSelect`/`handleStartAtSelect` do `MindMapNode` (linhas ~324–596) muda de arquivo e passa a emitir um único `onSchedulePatch` em vez de chamar a mutation.
- `MindMapNode` vira: `Handle`s + botão "+" + `useUpdateCard`/`useUpdateTaskStatus`/`useUpdateTaskDetails` + `useListWorkspaceMembers` + `invalidateAll` + propagação otimista `onInlineUpdate`, mapeados para os callbacks do corpo. Mesmos `data` de entrada de hoje; o `canvas.tsx` não muda.
- `components/maps/ApprovalCardBody.tsx`: o `ApprovalNode` menos `Handle`s e botão "+". `ApprovalNode` vira wrapper.
- `components/meetings/EventRow.tsx`: extraído do `AgendaPanel` sem alteração.

**Hook compartilhado de edição por tarefa**

- `hooks/useInlineTaskEditor.ts`: extrai do `TaskListItem` o `patchTask`, `patchStatus`, o estado `localTask` otimista, e a represa de invalidação enquanto o popover de prazo está aberto (`scheduleOpenRef` + `pendingInvalidateRef`, liberada ao fechar e no unmount). Roteia para `/api/my-tasks/:id` ou `/api/workspaces/:w/tasks/:id` conforme `workspaceId`. `TaskListItem` passa a consumir o hook; comportamento idêntico. No calendário a represa evita que a tarefa pule de coluna no meio da configuração de prazo, o mesmo bug que a lista já corrigiu.

**Calendário**

- `lib/calendar/week.ts`: `startOfWeekMonday(ymd)`, `addDays`, `ymdLocal(date)`, `weekBoundsISO(weekStart)` → `{ from, to }`.
- `lib/calendar/placement.ts`: `anchorOfTask`, `placeWeek({ tasks, meetings, events, weekStart, today }) → { days: { date, events, items, terminal }[], pool, showWeekend }` e `sortColumnItems`. Puro, sem React.
- `hooks/useCalendarData.ts`: chaves de query com prefixo da lista (`["/api/my-tasks", "calendar", …]` e `[`/api/workspaces/${ws}/tasks`, "calendar", …]`), assim toda invalidação existente por prefixo também atualiza o calendário. `useCalendarTasks(scope, weekStart, status, assignees)`, `useCalendarMeetings(scope, weekStart)`, `useCalendarEvents(weekStart, enabled)`, `useReorderCalendar(scope)` com update otimista. 503 de reuniões ou Google (flag desligada) é tratado como "sem dados", sem erro na tela.
- `components/calendar/WeekCalendar.tsx`: props `{ scope: { kind: "my" } | { kind: "workspace"; workspaceId }, status, assignees, members, getMembers?, onOpenTask }`. Estado da semana, `DndContext`, cabeçalho com setas e "hoje", colunas, pool.
- `components/calendar/DayColumn.tsx`: `useDroppable` + `SortableContext` vertical; bloco de eventos, itens ordenáveis, terminais.
- `components/calendar/CalendarTaskCard.tsx`: `useSortable` + `TaskCardBody` + `useInlineTaskEditor`. `statusVisual = overdue && ativa ? "overdue" : status`. `members` = membros do workspace da tarefa (`getMembers(task)` no `/my-tasks`, lista do workspace na aba).
- `components/calendar/CalendarApprovalCard.tsx`, `MeetingCard.tsx`, `EventCard.tsx`, `PoolSection.tsx`.
- `components/tasks/ViewModeToggle.tsx`: lista | calendário.
- `lib/taskStatusConstants.ts`: entrada `todos` em `STATUS_OPTIONS` com `apiValue: "draft,pending,in_progress,completed"`; as pills e o `readInitialFilters` passam a aceitar.

**Páginas**

- `pages/my-tasks.tsx` e `pages/workspaces/detail.tsx`: toggle no lado direito da linha de filtros; em modo calendário renderizam `<WeekCalendar>` no lugar do `TaskTable`, escondem `TimeWindowFilterPills` e `AgendaPanel`. Abrir a tarefa usa os mesmos gestos do canvas (duplo clique no card ou botão "abrir") e cai no `openTaskItem` existente (modal em modo card ou tarefa, deep link mantido). O fechamento do modal já invalida a lista; passa a invalidar também as chaves do calendário.

## Alternativas rejeitadas

- **Tabela separada de posicionamento por visualizador** (`calendar_placements(user_id, date, kind, id, order)`): permitiria ordem por quem vê, mas o spec amarra ordem e data pretendida ao responsável e à equipe. Coluna no item é menor e serve o gestor que planeja a semana do outro.
- **Reaproveitar `GET /tasks` com `completedSince/Until`:** o filtro de datas é AND com o status; não expressa "todas ativas OU terminais na janela" numa chamada. Rota dedicada com o mesmo select é mais simples que parametrizar mais o handler de 200 linhas.
- **Endpoint agregado tarefas+reuniões+eventos:** teria que absorver as duas feature flags e três autorizações. Três chamadas seguem o padrão atual e degradam separadamente.
- **`planned_date` como `timestamp` ao meio-dia UTC** (convenção das outras datas): é um campo só de dia; `date` evita o hack e o cliente já lê `YYYY-MM-DD`.
- **Ordem fracionária (rank entre vizinhos):** menos escritas por drag, mas ordem densa é o padrão do repo (`reorderApprovals`, `reorderTemplateSubtasks`, `sidebar/order`).
- **Card do calendário só clicável, sem edição inline:** rejeitado pelo produto. O card é idêntico ao do canvas.

## Efeitos colaterais aceitos

- Um reorder renumera a coluna inteira, inclusive itens de outros responsáveis quando o filtro tem várias pessoas.
- Tarefa reatribuída para uma coluna sem ordem manual fica `null` e cai na ordem padrão, não necessariamente "última".
- Semana passada é somente leitura; itens ativos ancorados nela não aparecem lá, e sim em hoje.
- Eventos do Google não aparecem quando o filtro de pessoas exclui "eu".
- `today-events` e `events` mantêm caches separados em memória, no processo.
- Reunião de série recorrente aparece uma vez por ocorrência sincronizada (janela do sync: 14 dias). Além disso só aparece o evento do Google, sem card de reunião.

## Testes e gates

- **API (vitest + supertest, dev DB):** `calendar.smoke.test.ts` — rota calendar devolve ativas + terminais só na janela, com os campos novos, respeitando `status` e `assignedTo`; reorder grava ordem densa e `planned_date`, pool limpa, 403 em tarefa de outro workspace, 400 em reunião movida e em terminal movida; `applyOrderRules` — max+1, urgente min−1, coluna sem ordem → null, terminal no-op, âncora "hoje" quando prazo passado; reuniões com `from/to`; `events` sem conta → 404 e com intervalo > 31 dias → 400.
- **FE (vitest):** `placement.test.ts` — as regras de ancoragem (concluída, cancelada, urgente, atrasada, prazo na semana futura, pool, `entre`), fim de semana condicional, sort com nulls e tipo, dedupe de eventos, semana passada sem ativas, evento multi-dia.
- **E2E (Playwright, infra do `e2e/`):** `calendar-week.spec.ts` — toggle, card aparece na coluna do prazo, arrastar pra outro dia persiste após reload, reorder dentro da coluna persiste; `canvas-action.spec.ts` continua verde como gate da extração dos corpos.
- **Gates:** typecheck FE e API relativos (zero erro novo; `npx tsc -b lib/db` antes), `vite build`, `pnpm install --frozen-lockfile` intacto (sem dependência nova: `@dnd-kit/*` e `date-fns` já estão no app).
- **Smoke manual no dev (gate humano):** editar título/status/prazo/responsável inline no card do calendário e no canvas; drag de aprovação e de reunião; pool ↔ coluna; "todos" na lista.

## Ambiente dev

- DB dev restaurado em 2026-09-27; o host direto `db.<ref>.supabase.co:5432` responde, o pooler leva alguns minutos. Aplicar a migration por `pg` com o host que estiver de pé.
- Reuniões e Google Calendar exigem `MEETINGS_ENABLED`, `WORKER_URL`, `WORKER_PANEL_TOKEN`, `GOOGLE_CALENDAR_ENABLED` e credenciais Google, ausentes no `.env` local. No dev o calendário mostra tarefas; reuniões e eventos degradam para vazio. Validação visual dessas duas partes exige envs no dev ou fica para prod.

## Fora de escopo

- Expor `planned_date` no modal, na lista, no `PATCH` de tarefa ou no MCP.
- Criar tarefa a partir de uma coluna.
- Visão mensal, múltiplas semanas, realtime.
- Escrita no Google Calendar.
