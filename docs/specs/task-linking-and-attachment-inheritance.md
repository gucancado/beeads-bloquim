# Spec — Vínculo entre tarefas e herança de entregáveis

**Status:** implementada (revisada em 2026-05-20)
**Autor:** gustavo.azvd@gmail.com
**Data:** 2026-05-19 (revisada 2026-05-20)
**Escopo:** monorepo `beeads-bloquim` (MindTask) — backend, frontend, schema, OpenAPI

> **Revisão 2026-05-20** — o design original criava uma tabela `task_links`
> dedicada e uma "seção tarefas ligadas" na UI. Após review do usuário, o
> vínculo passou a ser o existente entre cards no canvas (`card_connections`),
> e a herança ficou gated por `tasks.status = 'completed'` na fonte, com
> estados `available` / `pending` computados em read-time. As seções abaixo
> que ainda mencionam `task_links` refletem o design antigo e estão sendo
> mantidas como histórico; ver § 14 para o modelo vigente.

---

## 1. Resumo

Permitir que uma tarefa A seja **ligada** a uma tarefa B de modo que os **anexos do tipo entregável** de A passem a aparecer entre os anexos de B, **sem duplicar o arquivo físico**. Remover o anexo de B desfaz apenas o vínculo com B — o arquivo permanece em A. A herança propaga-se transitivamente: se um anexo herdado em B for **promovido** a entregável em B, ele flui para tarefas vinculadas a B (B→C), e assim por diante.

---

## 2. Termos

- **Vínculo de tarefa (task link):** relação direcionada `source → target` entre duas tarefas. **Unidirecional, N:N**.
- **Anexo entregável (deliverable):** anexo cujo `kind` em uma tarefa específica é `deliverable`. **A partir desta feature, `kind` é propriedade do vínculo tarefa↔anexo, não do arquivo.**
- **Anexo herdado:** anexo que existe em B porque B está em `task_links` como target de alguma A que contém o anexo como entregável. Em B, ele aparece com `kind = standard` por padrão.
- **Promoção:** ato de marcar um anexo herdado (ou qualquer anexo) em B como `deliverable`, fazendo-o fluir para tarefas C ligadas a B.

---

## 3. Decisões de design (já tomadas)

| # | Decisão |
|---|---------|
| D1 | Vínculo A→B é **unidirecional, N:N**. Uma A pode alimentar várias B; uma B pode receber de várias A. |
| D2 | A herança considera **apenas os entregáveis da própria A** — sub-tarefas de aprovação de A não contribuem mesmo que tenham entregáveis próprios. |
| D3 | `kind` é propriedade do **vínculo tarefa↔anexo**, não do arquivo. O mesmo anexo pode ser `deliverable` em A e `standard` em B. |
| D4 | Delete real (não soft-delete, não desvínculo) de um entregável em A **cascateia** e remove o anexo de todas as B/C/... que o herdaram. Antes do delete, modal de confirmação mostra "Este anexo será removido de N tarefas". |
| D5 | Promoção em B propaga para C. Funciona igual para anexos herdados ou anexos que foram criados diretamente em B. |
| D6 | Desvínculo de anexo em B (não delete): só remove o link B↔anexo. Cascateia o desvínculo para C apenas se o anexo estava como `deliverable` em B (porque era esse vínculo que mantinha o anexo visível em C via B). |
| D7 | **Escopo do vínculo: mesmo plano.** A e B precisam pertencer ao mesmo plano. No schema, plano ≡ tabela `maps`, e tarefa "está em um plano" se `tasks.map_id = :planId` (a coluna `tasks.map_id` é a fonte de verdade — gerenciada por `POST /maps/:mapId/attach-task` e `detach-task` em [routes/maps.ts](repo/artifacts/api-server/src/routes/maps.ts)). Tarefa standalone (`map_id IS NULL`) ou de planos distintos não pode ser source nem target. Sub-tarefas de aprovação **também têm `map_id IS NULL`** (são rejeitadas no attach), portanto a regra exclui-as automaticamente — não precisa de filtro extra. |
| D8 | **Profundidade máxima da cadeia de propagação: 10 níveis.** Guard explícito na travessia BFS, com log de warning se atingido. Acima disso, falha o request e instrui o usuário a quebrar a cadeia. |
| D9 | **Permissão pra criar/remover vínculo: qualquer membro do workspace** (admin, editor **e** executor). Vincular tarefas é tratado como organização do plano, não mutação estrutural sensível. Delete real de arquivo (§5.6) continua restrito a uploader/admin. |

---

## 4. Modelo de dados

### 4.1 Tabela nova: `task_links`

```ts
// lib/db/src/schema/taskLinks.ts
export const taskLinks = pgTable(
  "task_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Plano (≡ map) ao qual A e B pertencem. Redundante com cards.map_id, mas
     * usado como guard hard de escopo e evita join em listagens. */
    planId: uuid("plan_id")
      .notNull()
      .references(() => maps.id, { onDelete: "cascade" }),
    sourceTaskId: uuid("source_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    targetTaskId: uuid("target_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_task_links_source_target").on(table.sourceTaskId, table.targetTaskId),
    check("task_links_no_self_loop", sql`${table.sourceTaskId} <> ${table.targetTaskId}`),
    index("idx_task_links_source").on(table.sourceTaskId),
    index("idx_task_links_target").on(table.targetTaskId),
    index("idx_task_links_plan").on(table.planId),
  ],
);
```

**Notas:**
- `planId` materializa o escopo (D7). Validação no service de POST:
  ```sql
  SELECT id, map_id FROM tasks WHERE id IN (:sourceTaskId, :targetTaskId);
  -- Reject se: linhas < 2, OR alguma map_id IS NULL, OR map_ids divergem, OR map_id <> :planId
  ```
- `workspaceId` redundante mas evita join em listagens (tarefas no mesmo plano sempre estão no mesmo workspace).
- `UNIQUE(source, target)` torna o vínculo idempotente.
- Ciclos longos (A→B→A) **não** são bloqueados em DB — ver §5.5.
- **Não há FK direto pra cards.** Vínculo independe do card visual; sobrevive a deletar/recriar o card desde que `tasks.map_id` continue setado para o plano. Se a tarefa for desanexada do plano, ver §10.7.

### 4.2 Refatoração de `attachments`: tabela join `task_attachments`

Hoje [attachments.ts:41](repo/lib/db/src/schema/attachments.ts#L41) tem `task_id` direto + [kind em attachments.ts:60](repo/lib/db/src/schema/attachments.ts#L60). Migra-se para join table.

```ts
// lib/db/src/schema/taskAttachments.ts
export const taskAttachmentKindEnum = pgEnum("task_attachment_kind", [
  "standard",
  "deliverable",
]);

export const taskAttachments = pgTable(
  "task_attachments",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id, { onDelete: "cascade" }),
    kind: taskAttachmentKindEnum("kind").notNull().default("standard"),
    /** NULL = anexo nativo da tarefa (upload direto). Caso contrário, aponta para
     * a tarefa que originou o vínculo via herança transitiva (rastreabilidade). */
    inheritedFromTaskId: uuid("inherited_from_task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.attachmentId] }),
    index("idx_task_attachments_task").on(table.taskId),
    index("idx_task_attachments_attachment").on(table.attachmentId),
    index("idx_task_attachments_deliverables")
      .on(table.taskId)
      .where(sql`${table.kind} = 'deliverable'`),
  ],
);
```

### 4.3 Mudanças em `attachments`

- **Remover** `taskId` (passou para `task_attachments`).
- **Remover** `kind` (passou para `task_attachments.kind`).
- Manter `cardId`, `commentId`, `mapId`, `planId` — essas entidades **não participam** da feature de herança.
- Ajustar CHECK `attachments_has_anchor` para incluir "existe linha em `task_attachments`". Como CHECK não atravessa tabelas, **substituir por trigger** `trg_attachments_require_anchor` que valida no INSERT/UPDATE.

### 4.4 Migrations em duas fases

Para reduzir risco do breaking change em `attachments`, a refatoração roda em duas migrations separadas. Entre elas, o sistema vive em **dual-write**: o service grava/lê em ambos os lugares.

#### Fase A — `0033_add_task_links_and_attachment_join.sql` (aplicar imediatamente)

Ordem:

1. `CREATE TYPE task_attachment_kind` (idempotente via `IF NOT EXISTS`).
2. `CREATE TABLE task_attachments` com PK composta + índices.
3. **Backfill**: `INSERT INTO task_attachments SELECT task_id, id, kind::task_attachment_kind, NULL, uploaded_by, created_at FROM attachments WHERE task_id IS NOT NULL AND deleted_at IS NULL ON CONFLICT DO NOTHING;`
4. `CREATE TABLE task_links` + índices + CHECK no-self-loop.
5. `ALTER TYPE task_activity_type ADD VALUE IF NOT EXISTS` para os 5 novos tipos.

**Sem drops nesta fase.** `attachments.task_id`, `attachments.kind`, enum `attachment_kind` e CHECK `attachments_has_anchor` permanecem intactos. Sistema legado continua funcional.

#### Fase B — `00XX_drop_legacy_attachment_anchors.sql` (aplicar **depois** que todo o código de service/rotas estiver lendo do join table)

Ordem:

1. `ALTER TABLE attachments DROP CONSTRAINT attachments_has_anchor;`
2. Criar trigger `trg_attachments_require_anchor` (valida `card_id OR comment_id OR map_id OR plan_id OR EXISTS(task_attachments)` no INSERT/UPDATE).
3. `DROP INDEX idx_attachments_task;`
4. `ALTER TABLE attachments DROP COLUMN task_id;`
5. `ALTER TABLE attachments DROP COLUMN kind;`
6. `DROP TYPE attachment_kind;`

**Pré-condição para Fase B:** `git grep -E 'attachments\\.(task_id|kind)|attachments\\.taskId|attachments\\.kind'` em `repo/` retorna zero hits fora do código de migration/schema legacy.

**Dual-write durante a janela A→B:** o `taskAttachmentsService` precisa, em toda criação/promoção/desvínculo, manter `attachments.task_id` + `attachments.kind` sincronizados com a linha "principal" do anexo em `task_attachments` (aquela com `inherited_from_task_id IS NULL`, ou a primeira por created_at). Detalhe de implementação que entra na Fase 2 (refactor de service).

**Reversibilidade:** Fase A é totalmente reversível (drop tables + drop type + drop enum values via recriação). Fase B perde informação se houver `task_attachments` apontando para múltiplas tarefas pelo mesmo anexo — backfill reverso assume 1:1, o que só vale enquanto a feature não foi usada.

---

## 5. Regras de propagação

### 5.1 Estado canônico

Um anexo é **visível** em uma tarefa B se existe linha em `task_attachments(task_id=B, attachment_id=X)`.

### 5.2 Criação de vínculo A→B (`POST /api/workspaces/:wId/tasks/:tId/links`)

Ao criar `task_links(source=A, target=B)`:

```sql
-- Para cada entregável atual de A, inserir um vínculo standard em B
INSERT INTO task_attachments (task_id, attachment_id, kind, inherited_from_task_id, created_by, created_at)
SELECT B, ta.attachment_id, 'standard', A, :userId, now()
FROM task_attachments ta
WHERE ta.task_id = A AND ta.kind = 'deliverable'
ON CONFLICT (task_id, attachment_id) DO NOTHING;
```

Se a inserção promoveu indiretamente (B já tinha o anexo como `deliverable`), nada acontece — o estado se mantém. Não há "merge de kinds".

### 5.3 Promoção de anexo em B para `deliverable` (`PATCH /api/.../tasks/:tId/attachments/:aId` com `kind=deliverable`)

1. `UPDATE task_attachments SET kind='deliverable' WHERE task_id=B AND attachment_id=X;`
2. Para cada `task_links` onde `source=B`, inserir vínculo `standard` no target — mesma lógica de 5.2, escopada a um único anexo.

### 5.4 Rebaixamento (`kind=deliverable → standard` em A)

Quando A deixa de marcar X como deliverable, X deve **sumir** das B que o tinham herdado de A:

```sql
DELETE FROM task_attachments
WHERE attachment_id = :X
  AND inherited_from_task_id = :A
  AND kind = 'standard';
```

Se B promoveu X a `deliverable` (`kind=deliverable` em B), o vínculo B↔X **permanece** — a promoção é independente da origem. Isso é checado por `kind='standard'` no DELETE acima.

A cascata é recursiva: ao deletar B↔X (kind=standard), se X estava sendo propagado de B para C, o mesmo DELETE precisa rodar com `inherited_from_task_id=B`. Implementar como **função recursiva no service**, não trigger — controle explícito é mais auditável.

### 5.5 Ciclos (A→B→A ou A→B→C→A) e profundidade

- **Vínculos:** permitidos. Não há ciclo lógico, é só um grafo direcionado com possíveis ciclos.
- **Propagação:** algoritmo de inserção usa `ON CONFLICT DO NOTHING` + travessia BFS com visited-set. Termina em O(n) pois cada par (task, attachment) é visitado no máximo uma vez.
- **Profundidade máxima: 10 níveis** (D8). O service mantém um contador de níveis na BFS. Se a fronteira atingir nível 11, aborta com erro `LINK_DEPTH_EXCEEDED` (HTTP 422) e loga warning com `{ rootTaskId, attachmentId, depth }`. Mensagem ao usuário: "A cadeia de propagação tem mais de 10 níveis. Remova vínculos intermediários antes de continuar."

### 5.6 Delete real de anexo em A (`DELETE /api/.../tasks/:tId/attachments/:aId`)

**UX:** se o anexo está vinculado a outras tarefas (`SELECT count(*) FROM task_attachments WHERE attachment_id=X`), o frontend mostra modal:

> Este anexo está em **N tarefas** (você incluído). Apagar o arquivo o remove de todas elas. Tem certeza?

Backend: `DELETE FROM attachments WHERE id=:X` (cascateia via FK para `task_attachments`). Soft-delete continua valendo via `attachments.deleted_at` — define `deleted_at = now()` e oculta nas leituras.

### 5.7 Desvínculo de anexo em B (`DELETE /api/.../tasks/:tId/attachments/:aId/link`)

Endpoint **novo**, distinto do delete:

1. Se `task_attachments(task=B, attachment=X).kind = 'deliverable'`: rodar a cascata de rebaixamento da §5.4 com `inherited_from_task_id=B` antes.
2. `DELETE FROM task_attachments WHERE task_id=B AND attachment_id=X;`
3. Arquivo permanece em A (e onde mais estiver).

---

## 6. UI/UX

### 6.1 Onde aparece o vínculo

- **Modal de detalhe da tarefa** ([TaskDetailModal.tsx](repo/artifacts/mindtask-app/src/components/tasks/TaskDetailModal.tsx)) ganha seção **"Tarefas ligadas"** com duas listas: **"Esta tarefa entrega para"** (outgoing — onde a tarefa atual é source) e **"Recebe entregáveis de"** (incoming — target).
- Cada item: avatar do criador da target, título da tarefa, status badge, botão `×` pra remover o vínculo.

### 6.2 Criar vínculo

- Botão **"+ Vincular tarefa"** abre command palette tipo `GlobalTaskSearch`, **restrito ao mesmo plano** da tarefa atual (D7), exclui a tarefa atual e tarefas já vinculadas. Tarefa atual sem plano (standalone) → botão fica desabilitado com tooltip "Anexe esta tarefa a um plano para vinculá-la a outras tarefas".
- Confirmação visual mostra quantos entregáveis serão herdados antes de criar.

### 6.3 Seção de anexos ([AttachmentsSection.tsx](repo/artifacts/mindtask-app/src/components/tasks/AttachmentsSection.tsx))

- Cada item mostra:
  - Badge `Entregável` quando `kind=deliverable` na tarefa atual (cor distintiva).
  - Badge sutil `Herdado de [título da tarefa]` quando `inherited_from_task_id` não é nulo. Clicável → abre a tarefa de origem.
- Toggle "Marcar como entregável" no menu ⋯ do anexo. Disponível para qualquer anexo na tarefa.
- Botões distintos:
  - **Remover desta tarefa** (desvínculo, §5.7) — sempre disponível.
  - **Apagar arquivo** (delete real, §5.6) — disponível só se usuário é uploader ou admin do workspace.

### 6.4 Modal de confirmação no delete real

Quando o anexo está em ≥2 `task_attachments`:

```
Apagar "[filename]"?

Este arquivo está vinculado a 4 tarefas. Apagá-lo o remove de todas elas:
  • Briefing landing page (esta tarefa)
  • Setup ad copy
  • Aprovação visual — Carla
  • Aprovação técnica — Bruno

[Cancelar] [Apagar de todas]
```

---

## 7. API — endpoints novos

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/workspaces/:wId/tasks/:tId/links` | Lista vínculos `{ outgoing: [...], incoming: [...] }`. |
| POST | `/api/workspaces/:wId/tasks/:tId/links` | Body `{ targetTaskId }`. Cria vínculo + roda §5.2. Valida escopo de plano (D7) — retorna 422 `LINK_OUT_OF_PLAN` se A e B não estão no mesmo `map_id` (ou se alguma das duas é standalone). |
| DELETE | `/api/workspaces/:wId/tasks/:tId/links/:linkId` | Remove vínculo + cascata da §5.4 sobre os anexos que tinham `inherited_from_task_id = source`. |
| DELETE | `/api/workspaces/:wId/tasks/:tId/attachments/:aId/link` | Desvínculo de anexo (§5.7). |
| GET | `/api/workspaces/:wId/tasks/:tId/attachments/:aId/usage` | Conta em quantas tarefas o anexo está vinculado. Usado pelo modal §6.4. |

**Permissões (D9):** todos os endpoints de vínculo (`/links*`) usam `requireWorkspaceRole(["admin", "editor", "executor"])`. Não há rota separada para "só assignee" — qualquer membro do workspace que vê o plano pode criar/remover vínculos dentro dele. `DELETE /attachments/:aId` (delete real do arquivo, §5.6) continua exigindo `uploader OR admin`. A cascata invocada no detach (§10.7) **herda a permissão do detach** (`["admin", "editor"]`) — o executor pode criar um vínculo, mas a remoção via detach exige editor+. Isso é intencional: detach já é uma operação restrita; nada muda.

### Endpoints alterados

- `GET /api/workspaces/:wId/tasks/:tId/attachments` — passa a fazer JOIN com `task_attachments`, retorna `kind`, `inheritedFromTaskId`, `inheritedFromTaskTitle` (resolvido server-side).
- `PATCH /api/workspaces/:wId/tasks/:tId/attachments/:aId` — `kind` agora atualiza `task_attachments.kind` (não `attachments.kind`). Promoção para `deliverable` dispara §5.3.
- `DELETE /api/workspaces/:wId/tasks/:tId/attachments/:aId` — **muda semântica**: passa a apagar o arquivo (§5.6). O desvínculo ganha rota separada.
- `POST /api/workspaces/:wId/tasks/:tId/attachments` — INSERT em `attachments` + INSERT em `task_attachments(task=tId, kind='standard')`.

### Rotas `/my-tasks` espelham

Os endpoints `/api/my-tasks/:tId/attachments` recebem o mesmo tratamento. Já existem hoje e cobrem tarefas standalone.

---

## 8. OpenAPI / codegen

Editar [openapi.yaml](repo/lib/api-spec/openapi.yaml) com:

- Novo schema `TaskLink { id, sourceTaskId, targetTaskId, sourceTitle, targetTitle, createdAt, createdBy }`.
- Schema `TaskAttachment` ganha campos `kind: 'standard'|'deliverable'`, `inheritedFromTaskId: string|null`, `inheritedFromTaskTitle: string|null`.
- Novos paths das §7.

Rodar `pnpm --filter @workspace/api-spec run codegen` para regenerar hooks React Query + schemas Zod.

---

## 9. Activity log

Estender o enum `task_activity_type` ([tasks.ts:188](repo/lib/db/src/schema/tasks.ts#L188)) com:

| Novo tipo | Quando | metadata |
|-----------|--------|----------|
| `task_link_created` | POST `/links` | `{ targetTaskId, targetTitle, inheritedCount }` |
| `task_link_removed` | DELETE `/links/:linkId` | `{ targetTaskId, targetTitle }` |
| `attachment_promoted` | PATCH attachment kind→deliverable | `{ attachmentId, filename, propagatedToCount }` |
| `attachment_demoted` | PATCH attachment kind→standard | `{ attachmentId, filename, removedFromCount }` |
| `attachment_unlinked` | DELETE attachment link | `{ attachmentId, filename }` |

Inserção/delete de vínculo grava activity nas **duas** tarefas (source e target) — o usuário em qualquer ponta consegue auditar.

---

## 10. Edge cases

1. **Anexo herdado de A com `kind=deliverable` em A, mas usuário já tinha o mesmo arquivo upado em B:** dois anexos distintos coexistem (são linhas separadas em `attachments`). Não há dedupe por hash.
2. **Tarefa A é deletada:** FK `ON DELETE CASCADE` em `task_attachments.task_id` remove os vínculos de origem. Anexos em B perdem o badge "Herdado de A" mas continuam visíveis (`inherited_from_task_id` vai para NULL via FK rule). UX: tratar `inheritedFromTaskTitle=null` como "Herdado (origem removida)".
3. **Vínculo entre tarefas de planos diferentes ou standalone:** **bloqueado** (D7). POST `/links` retorna 422 `LINK_OUT_OF_PLAN`. UI da palette de "vincular tarefa" (§6.2) já filtra só tarefas do mesmo `mapId`.
4. **Sub-tarefas de aprovação como source/target:** **bloqueadas automaticamente** porque o backend rejeita anexá-las a planos ([routes/maps.ts:260](repo/artifacts/api-server/src/routes/maps.ts#L260) — `task.isApprovalTask === false e task.parentTaskId IS NULL`). Logo, sub-aprovações têm `map_id IS NULL` e a validação de escopo (§4.1) já as exclui sem precisar de filtro extra. D2 (sub-aprovações de A **não contribuem** com entregáveis quando A é source) continua valendo para a parent A — é uma regra de propagação, não de elegibilidade.
5. **Performance:** travessia BFS em propagação com profundidade máxima 10 (D8). Workspaces realistas não devem ter cadeias tão longas; se ocorrer, abortar com `LINK_DEPTH_EXCEEDED` (§5.5).
6. **Concorrência:** dois usuários promovem o mesmo anexo simultaneamente. `ON CONFLICT DO NOTHING` + transação por endpoint garantem convergência.
7. **Tarefa A é desanexada do plano** via `POST /api/workspaces/:wId/maps/:mapId/detach-task` ([routes/maps.ts:384](repo/artifacts/api-server/src/routes/maps.ts#L384)): o vínculo passaria a violar D7. Integração:
   - Antes do `UPDATE tasks SET map_id=NULL`, o handler chama novo passo `taskLinksService.cascadeRemoveForTask(taskId)`:
     1. `SELECT id, source_task_id, target_task_id FROM task_links WHERE source_task_id=:tId OR target_task_id=:tId` → lista L.
     2. Para cada link onde `:tId` é source: rodar cascata de rebaixamento (§5.4) com `inherited_from_task_id=:tId` (remove anexos herdados nas targets/downstream).
     3. `DELETE FROM task_links WHERE id IN L`.
     4. Gravar activity `task_link_removed` em cada outra ponta dos links removidos (não apenas em `:tId`).
   - **Modal de confirmação no frontend** quando L é não-vazia: "Esta tarefa está vinculada a N outras tarefas neste plano. Desanexá-la remove esses vínculos e os anexos herdados. Continuar?"
   - O endpoint de detach **não retorna erro** se há vínculos — só executa a cascata. O modal é UX, não enforcement.
8. **Plano (map) deletado:** FK `ON DELETE CASCADE` em `task_links.plan_id` remove todos os vínculos do plano. A cascata sobre `task_attachments` precisa ser executada no service que apaga o plano (não há trigger transversal). Garantia: nenhum vínculo persiste com `plan_id` inválido.

---

## 11. Não-objetivos

- **Dedupe por hash de arquivo.** Anexos idênticos enviados em A e B continuam sendo dois registros.
- **Reordenação semântica do vínculo.** Não há "tipo" de vínculo (depende-de, bloqueado-por, etc.). É só "entrega para".
- **Permissões granulares por vínculo.** Quem pode ver A vê todos os entregáveis de A em B se vê B. Não há ACL adicional.
- **Notificações push.** Promoção/herança não dispara notificação ao assignee de B nesta primeira versão.

---

## 12. Plano de rollout

1. Branch `feat/task-links-attachment-inheritance` a partir de `master`.
2. Migration `0028` aplicada primeiro em dev (Supabase project ref dev). Validar consultas com `idx_attachments_task` removido.
3. Backfill em dev via dump → restore staging do banco prod.
4. PR único cobrindo: schema + migration + service + rotas + OpenAPI + UI + activity.
5. Em prod: pausar deploy Coolify, aplicar migration via `pg_dump` snapshot + `psql -f 0028.sql`, retomar deploy.
6. Smoke test pós-deploy, em um plano de teste com 3 tarefas A, B, C dentro do mesmo map:
   - Criar A→B; upload em A como `deliverable`; conferir aparição em B com badge "Herdado de A".
   - Promover anexo em B; criar B→C; conferir aparição em C com badge "Herdado de B".
   - Rebaixar em A; conferir sumiço em B (mas permanência em C pois B promoveu).
   - Tentar vincular tarefa standalone → deve falhar com `LINK_OUT_OF_PLAN`.
   - Tentar vincular tarefa de outro plano → deve falhar com `LINK_OUT_OF_PLAN`.

---

## 13. Perguntas em aberto

Resolvidas em 2026-05-19 — ver D7, D8, D9 na §3.

---

## 14. Modelo vigente (após revisão 2026-05-20)

Substitui as §§ 4–10 para fins de implementação. Mantém §11 (não-objetivos) e §12 (rollout) com ajustes pontuais.

### 14.1 Decisões revisadas

| # | Decisão |
|---|---------|
| R1 | **Vínculo entre tarefas = `card_connections`.** A conexão visual no canvas (source_card → target_card) é o vínculo. Não há tabela `task_links`. Não há seção "tarefas ligadas" na UI. |
| R2 | **Herança gated por status.** Para tarefa A com X marcado como deliverable, B (conectada como target) só vê X como **`available`** (clicável) se `A.status = 'completed'`. Senão, B vê como **`pending`** (preview, não-clicável). |
| R3 | **Espelhamento em tempo real.** Quando A muda de status, o estado em B muda no próximo read. Sem snapshots/triggers — é uma JOIN dinâmica. |
| R4 | **Promoção funciona em pending.** O usuário pode marcar como entregável um anexo herdado mesmo no estado pending. Isso cria uma row em `task_attachments(B, X, deliverable, inherited_from=A)` que só fica `available` quando A completa. |
| R5 | **Cadeia A→B→C** requer: card_connection(A→B) + A.completed + (X deliverable em A) + (B promove X) + B.completed. Cada hop precisa de promoção explícita E status completed. |
| R6 | Demote em B com inherited_from != NULL **remove a row** (cai de volta no estado puramente herdado de A, se A→B ainda existir). Demote em B com inherited_from = NULL (native) **só muda kind**. |
| R7 | **Unlink** é uma operação só sobre rows em `task_attachments`. Anexos puramente herdados (sem row) não têm botão "remover" na UI — para parar de receber, o usuário desconecta os cards no canvas. |

### 14.2 Schema

- **`task_attachments`** mantém-se (PK composta, kind, inherited_from_task_id, created_by, created_at). Existe apenas para uploads nativos OU promoções manuais.
- **`task_links`** removida (migration 0035).
- **Trigger `trg_attachments_sync_task_links`** mantida — sincroniza writes legacy em `attachments` → `task_attachments` (POST /storage/uploads/request-url cria a row de join automaticamente).

### 14.3 Listagem `listTaskAttachments(taskId)`

`SELECT ... UNION ALL ...`:

1. **Rows diretas** (task_attachments WHERE task_id = B), com:
   - `state = 'available'` se `inherited_from_task_id IS NULL`, senão `state = inherited_from_task.status = 'completed' ? 'available' : 'pending'`.
2. **Inherited dinâmico** (sem row): para cada `card_connection(src_card→target_card)` onde `target_card.task_id = B`, JOIN com `task_attachments(src_card.task_id, kind='deliverable')`. Filtra `attachments NOT EXISTS` em rows diretas. `state = src_task.status = 'completed' ? 'available' : 'pending'`. `kind` sempre `standard` (visualmente, em B o anexo aparece como comum). `inheritedFromTaskId = src_task.id`.

### 14.4 Endpoints mantidos

| Método | Rota | Função |
|--------|------|--------|
| `GET /workspaces/:wId/tasks/:tId/attachments` | (existente) | retorna lista unificada com `state` e `inheritedFromTaskId`. |
| `PATCH /workspaces/:wId/tasks/:tId/attachments/:aId/kind` | (novo) | promove/demote inheritance-aware. Promover anexo herdado pendente cria a row com `inherited_from_task_id` resolvido por lookup nas conexões. |
| `DELETE /workspaces/:wId/tasks/:tId/attachments/:aId/link` | (novo) | DELETE row em task_attachments. Sem cascata (propagação é dinâmica). |
| `GET /workspaces/:wId/tasks/:tId/attachments/:aId/usage` | (novo) | conta rows diretas em task_attachments — usado pelo modal de confirm-delete. |
| `DELETE /workspaces/:wId/tasks/:tId/attachments/:aId` | (existente) | hard-delete do arquivo (soft-delete em `attachments.deleted_at`). UI mostra modal antes. |

Endpoints removidos vs. design antigo: `/links` (GET/POST), `/links/:linkId` (DELETE). Cascade no detach-task também removida.

### 14.5 UI

- **TaskLinksSection**: removida.
- **AttachmentsSection**: badges `entregável` (kind=deliverable) + `herdado` (state=available com inheritedFromTaskId) ou `pendente` (state=pending). Anexos `pending` aparecem com opacity 50%, cursor `not-allowed`, sem botão de download/remover. Botão promover (★) funciona em pending.
- **DeleteAttachmentDialog**: mantido, com warning de N tarefas.

### 14.6 Smoke tests (dev)

10 cenários cobertos em `c:/tmp/inheritance-smoke.ts`:
- Pending por status pending na fonte → real-time mirror em mudança de status
- Download bloqueado em pending, resolvido em completed
- Cadeia A→B→C com promoção e gating por status em cada hop
- Demote em B com inherited_from removendo row e caindo de volta na herança pura

+6 cenários "pós-conclusão" em `c:/tmp/post-completion-smoke.ts`:
- A completed sem anexos → B vê nada
- Adicionar anexo standard em A completed → B continua sem ver (não é entregável)
- **Marcar X como deliverable em A (já completed) → B herda imediatamente como `available`**
- Upload novo com `kind=deliverable` em A já completed → B herda imediatamente
- Rebaixar entregável em A para standard → some de B

### 14.7 Por que isso funciona sem código adicional

Toda mudança que afeta o que B vê de A é capturada pela JOIN de read-time:

| Evento em A | Como afeta a query em B |
|---|---|
| Upload novo em A com `kind=deliverable` | Trigger `trg_attachments_sync_task_links` cria row em `task_attachments(A, X, deliverable)`. Próxima leitura de B inclui X. |
| Mudar `attachments.kind` de standard→deliverable em A | Trigger sincroniza para `task_attachments.kind`. Próxima leitura de B inclui X. |
| `A.status` mudar para/de `completed` | A query computa `state` via `CASE WHEN src_task.status='completed'`. Próxima leitura reflete. |
| Adicionar/remover `card_connection(A→B)` | A query usa essa conexão na JOIN. Próxima leitura reflete. |
| Soft-delete em A (`attachments.deleted_at`) | A query filtra `WHERE a.deleted_at IS NULL`. |

Não há triggers de propagação, snapshots ou caches a invalidar — o estado canônico é sempre derivado em tempo de leitura.
