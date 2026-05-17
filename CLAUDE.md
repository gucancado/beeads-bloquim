# MindTask — Guia para Agentes

## Visão Geral

MindTask é uma plataforma web de planejamento e gestão de tarefas baseada em mapas mentais. Equipes criam planos de ação visualmente em um canvas estilo mapa mental (ReactFlow) e transformam cards em tarefas atribuídas a usuários. Suporta aprovações, subtarefas, recorrência, templates, anexos, comentários, busca global e integração com Google Calendar.

## Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| Monorepo | pnpm workspaces |
| Runtime | Node.js 24 |
| Linguagem | TypeScript 5.9 |
| Frontend | React 19 + Vite 7 + Tailwind CSS 4 + ReactFlow |
| Backend | Express 5 (async handlers nativos) |
| Banco | PostgreSQL + Drizzle ORM |
| Validação | Zod v4 (`import { z } from "zod/v4"`), drizzle-zod |
| Auth | JWT via jsonwebtoken + bcryptjs (cookie HttpOnly `token`) |
| Estado | Zustand + React Query (TanStack Query v5) |
| Canvas | ReactFlow (custom nodes: MindMapNode, TextNode, ShapeNode, ApprovalNode, ApprovalJoinNode) |
| Gráficos | Recharts |
| API codegen | Orval (OpenAPI → React Query hooks + Zod schemas) |
| Build | esbuild (CJS bundle para api-server) |
| Realtime | WebSocket (presença de usuários no mapa) |
| Object Storage | Cloudflare R2 (S3-compatible, presigned URLs via `lib/storage`) |
| Rich Text | Tiptap (editor de texto nos TextNodes e descrições) |

## Estrutura do Monorepo

```
artifacts/
  api-server/               # Express 5 API (porta definida por PORT, rota /api)
    src/
      routes/
        index.ts             # Montagem de todas as rotas
        auth.ts              # register, login, logout, me, me/workspaces
        workspaces.ts        # CRUD workspaces, membros, dashboard, sugestões
        maps.ts              # CRUD mapas
        cards.ts             # CRUD cards + task por card + aprovações
        connections.ts       # Conexões entre cards
        myTasks.ts           # Minhas tarefas (CRUD, subtasks, comments, attachments, activities)
        workspaceTasks.ts    # Tarefas do workspace (counts, aprovações, approve/reject)
        tasksSearch.ts       # Busca global de tarefas
        taskTemplates.ts     # CRUD templates + subtasks de template + apply
        comments.ts          # Comentários em cards e tarefas
        textElements.ts      # Elementos de texto livre no mapa
        shapes.ts            # Formas desenhadas no mapa (rect, ellipse, line, image)
        storage.ts           # Upload presigned URL + serve de objetos
        sidebar.ts           # Ordem/estado da sidebar
        recentMaps.ts        # Mapas recentes
        health.ts            # Health check
        integrations/
          google-calendar.ts # OAuth + eventos do Google Calendar
      services/
        approvalActionService.ts    # Aprovar/reprovar tarefas
        approvalChainService.ts     # Cadeia de aprovação sequencial/paralela
        approvalCrudService.ts      # CRUD de aprovadores
        taskActivation.ts           # Ativação de tarefas recorrentes
        taskAttachmentsService.ts   # Lógica de anexos
        taskDuplicateService.ts     # Duplicação de tarefas
        taskStatusService.ts        # Transições de status
        taskSubtasksService.ts      # Lógica de subtarefas
        taskTemplatesService.ts     # Lógica de templates
        taskVisualSyncService.ts    # Sincronização task.status → card.statusVisual
        googleCalendarService.ts    # Integração Google Calendar
      middlewares/
        auth.ts              # JWT middleware + signToken()
        permissions.ts       # requireWorkspaceRole()
        errorHandler.ts      # Error handler global
        rateLimit.ts         # Rate limiting
        requestLogger.ts     # Logger de requisições
      realtime/
        presenceServer.ts    # Servidor WebSocket de presença
        presenceRoom.ts      # Salas de presença por mapa
        presenceTypes.ts     # Tipos de presença

  mindtask-app/              # React + Vite (frontend, porta definida por PORT, rota /)
    src/
      pages/
        login.tsx, register.tsx
        workspaces/index.tsx     # Lista de workspaces
        workspaces/detail.tsx    # Detalhe com tabs: Mapas, Dashboard, Membros
        maps/canvas.tsx          # Canvas ReactFlow com todos os tipos de nodes
        my-tasks.tsx             # Minhas Tarefas com filtros
        templates.tsx            # Gerenciamento de templates de tarefa
        settings/integrations.tsx # Configuração de integrações (Google Calendar)
        not-found.tsx
      components/
        layout/
          AppLayout.tsx          # Sidebar + auth redirect
          GlobalTaskSearch.tsx   # Busca global de tarefas
          SidebarWorkspaceList.tsx # Lista de workspaces na sidebar
          PageBreadcrumb.tsx     # Breadcrumbs
          ThemeToggle.tsx        # Toggle dark/light mode
        maps/
          MindMapNode.tsx        # Node de card com cor por status
          TextNode.tsx           # Node de texto livre (Tiptap)
          TextNodeEditor.tsx     # Editor inline do TextNode
          ShapeNode.tsx          # Node de forma (rect, ellipse, line, image)
          ApprovalNode.tsx       # Node de aprovação (violeta)
          ApprovalJoinNode.tsx   # Ponto de convergência de aprovações
          ApprovalEdge.tsx       # Edge tracejada (aprovação)
          DeletableEdge.tsx      # Edge com botão de deletar
          CommentsSection.tsx    # Seção de comentários inline
          layerOrder.ts          # Ordenação de camadas no canvas
        tasks/
          TaskDetailModal.tsx    # Modal completo de edição de tarefa
          TaskListItem.tsx       # Item de lista de tarefas
          TaskHeaderActions.tsx  # Ações do cabeçalho da tarefa
          TaskDeleteDialog.tsx   # Diálogo de exclusão
          TaskApplyTemplateButton.tsx # Aplicar template à tarefa
          ApprovalTaskView.tsx   # Tela de aprovação (aprovar/reprovar)
          DescriptionEditor.tsx  # Editor de descrição rich text
          PriorityBadge.tsx      # Badge de prioridade
          RecurrencePanel.tsx    # Painel de recorrência
          RecurrencePopover.tsx  # Popover de configuração de recorrência
          AssigneeAvatarPicker.tsx # Seletor de responsável com avatar
          AssigneeFilterPills.tsx  # Filtro por responsável
          AttachmentsSection.tsx   # Seção de anexos
          approval/              # Componentes de aprovação
          subtasks/              # Componentes de subtarefas
          attachments/           # Viewer, thumbnail, tipos de anexo
          association/           # Chips de associação tarefa-card
        templates/
          TemplateDetailModal.tsx # Modal de edição de template
        profile/
          ProfileSheet.tsx       # Sheet de perfil do usuário
      hooks/
        useComments.ts, useGoogleCalendar.ts, useProfile.ts,
        usePositionHistory.ts, useHidden.ts, use-toast.ts
      stores/                   # Zustand stores

  mockup-sandbox/              # Design preview server (rota /__mockup)

lib/
  api-spec/
    openapi.yaml               # Contrato OpenAPI 3.1 completo
    orval.config.ts             # Configuração do Orval
  api-client-react/
    src/
      custom-fetch.ts           # Injeta credentials: "include" em todas as requests
      generated/                # Hooks React Query gerados pelo Orval (NÃO editar)
      index.ts                  # Re-exporta hooks gerados
  api-zod/
    src/
      generated/                # Schemas Zod gerados pelo Orval (NÃO editar)
      index.ts
  db/
    src/schema/
      users.ts                  # users
      workspaces.ts             # workspaces, workspace_members
      maps.ts                   # maps, user_map_access (recentes)
      cards.ts                  # cards, card_connections
      tasks.ts                  # tasks, task_approvals, task_activities, task_subtasks
      comments.ts               # task_comments
      textElements.ts           # map_text_elements
      attachments.ts            # attachments (unificado)
      shapes.ts                 # map_shapes
      integrations.ts           # user_google_calendar_accounts, user_calendar_preferences
  object-storage-web/
    src/
      ObjectUploader.tsx         # Componente de upload
      use-upload.ts              # Hook de upload
      index.ts

scripts/                        # Scripts auxiliares
```

## Comandos Essenciais

```bash
# Dev servers
pnpm --filter @workspace/api-server run dev        # API (Express)
pnpm --filter @workspace/mindtask-app run dev      # Frontend (Vite)

# Banco de dados
pnpm --filter @workspace/db run push               # Aplicar schema ao PostgreSQL

# Codegen (após alterar openapi.yaml)
pnpm --filter @workspace/api-spec run codegen      # Gera hooks e schemas

# Build
pnpm --filter @workspace/api-server run build      # Build de produção do API server
```

## Fluxo de Codegen (OpenAPI → Código Gerado)

1. Editar `lib/api-spec/openapi.yaml` com a nova rota/schema
2. Rodar `pnpm --filter @workspace/api-spec run codegen`
3. O Orval gera automaticamente:
   - Hooks React Query em `lib/api-client-react/src/generated/`
   - Schemas Zod em `lib/api-zod/src/generated/`
4. Implementar a rota no backend (`artifacts/api-server/src/routes/`)
5. Frontend consome via hooks gerados (`import { useXxx } from "@workspace/api-client-react"`)

## Entidades do Banco

| Tabela | Descrição |
|--------|-----------|
| users | Usuários (name, email, passwordHash, avatarUrl) |
| workspaces | Espaços de trabalho |
| workspace_members | Membros com papel (admin/editor/executor) |
| maps | Mapas mentais de um workspace |
| user_map_access | Registro de mapas visitados recentemente |
| cards | Cards no mapa (posição, título, statusVisual) |
| card_connections | Conexões (edges) entre cards |
| tasks | Tarefas vinculadas a cards (status, prioridade, prazo, recorrência, aprovações, created_by) |
| task_approvals | Aprovadores de uma tarefa (ordem, status, modo sequencial/paralelo) |
| task_activities | Log de atividades (mudanças de status, atribuições, etc.) |
| task_subtasks | Subtarefas de uma tarefa |
| task_comments | Comentários em tarefas |
| attachments | Arquivos anexados (unificado — task/card/comment/shape via `entity_kind`+`entity_id`) |
| map_text_elements | Elementos de texto livre no mapa (Tiptap) |
| task_templates | Templates reutilizáveis de tarefa |
| task_template_subtasks | Subtarefas de um template |
| map_shapes | Formas desenhadas (rect, ellipse, line, image) |
| user_google_calendar_accounts | Contas Google Calendar vinculadas |
| user_calendar_preferences | Preferências de calendário |

**Enums relevantes**: task_status (pending, in_progress, completed, overdue, blocked, draft), task_priority (low, medium, high, critical), card_visual_status, workspace_role (admin, editor, executor), approval_status, approval_mode (sequential, parallel), schedule_mode (ate, entre, em, sem_prazo), attachment_kind (standard, deliverable), task_activity_type (task_created, assignee_changed, status_changed, priority_changed, due_date_changed, approval_comment, task_approved, task_rejected, task_duplicated, checklist_items_added, task_moved)

## Rotas de API

### Auth
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/auth/register | Cadastro |
| POST | /api/auth/login | Login |
| POST | /api/auth/logout | Logout |
| GET | /api/auth/me | Usuário atual |
| PATCH | /api/auth/me | Atualizar perfil (nome, avatar) |
| GET | /api/auth/me/workspaces | Workspaces do usuário |

### Workspaces
| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST | /api/workspaces | Listar/criar workspaces |
| GET/PUT/DELETE | /api/workspaces/:id | CRUD workspace |
| PATCH | /api/workspaces/:id/color | Alterar cor |
| PATCH | /api/workspaces/:id/hidden | Ocultar/mostrar |
| GET/POST | /api/workspaces/:id/members | Listar/adicionar membros |
| GET | /api/workspaces/:id/members/suggestions | Sugestões de membros |
| PATCH/PUT/DELETE | /api/workspaces/:id/members/:mId | Atualizar papel/remover membro |
| GET | /api/workspaces/:id/dashboard | Dashboard resumo |

### Mapas
| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST | /api/workspaces/:wId/maps | Listar/criar mapas |
| GET/PUT/DELETE | /api/workspaces/:wId/maps/:mId | CRUD mapa (GET retorna cards + conexões + shapes + textElements) |
| GET | /api/maps/recent | Mapas recentes |

### Cards & Connections
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/workspaces/:wId/maps/:mId/cards | Criar card |
| GET/PUT/DELETE | /api/workspaces/:wId/maps/:mId/cards/:cId | CRUD card |
| POST/DELETE | /api/workspaces/:wId/maps/:mId/cards/:cId/task | Criar/desvincular tarefa |
| PATCH | /api/.../cards/:cId/task/status | Atualizar status (sincroniza card.statusVisual) |
| PATCH | /api/.../cards/:cId/task/details | Atualizar detalhes da tarefa |
| POST/DELETE | /api/workspaces/:wId/maps/:mId/connections | Criar/remover conexão |

### Tarefas (workspace scope)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/workspaces/:wId/tasks | Listar tarefas do workspace |
| POST | /api/workspaces/:wId/tasks | Criar tarefa (grava `created_by = caller`) |
| GET/PATCH | /api/workspaces/:wId/tasks/:tId | Detalhes / editar tarefa |
| DELETE | /api/workspaces/:wId/tasks/:tId | Excluir tarefa (apenas criador OU admin do workspace; rejeita se `created_by` é NULL) |
| PATCH | /api/workspaces/:wId/tasks/:tId/status | Mudar status |
| POST | /api/workspaces/:wId/tasks/:tId/duplicate | Duplicar tarefa |
| GET | /api/workspaces/:wId/tasks/counts | Contadores por status |
| GET | /api/workspaces/:wId/tasks/:tId/activities | Activity log |
| GET | /api/workspaces/:wId/tasks/:tId/subtasks | Listar checklist |
| POST | /api/workspaces/:wId/tasks/:tId/subtasks | Adicionar 1..50 itens (body `{ items: [...] }`, activity batch `checklist_items_added`) |
| PUT | /api/workspaces/:wId/tasks/:tId/subtasks | Replace bulk |
| PATCH | /api/workspaces/:wId/tasks/:tId/subtasks/:sId | Editar item |
| DELETE | /api/workspaces/:wId/tasks/:tId/subtasks/:sId | Remover item |
| GET | /api/workspaces/:wId/tasks/:tId/approvals | Aprovadores |
| POST | /api/workspaces/:wId/tasks/:tId/approvals | Adicionar aprovador |
| DELETE | /api/workspaces/:wId/tasks/:tId/approvals/:aId | Remover aprovador |
| PUT | /api/workspaces/:wId/tasks/:tId/approvals/reorder | Reordenar aprovadores |
| PATCH | /api/workspaces/:wId/tasks/:tId/approval-mode | Mudar modo (sequential/parallel) |
| POST | /api/workspaces/:wId/tasks/:tId/approve | Aprovar |
| POST | /api/workspaces/:wId/tasks/:tId/reject | Reprovar |
| GET | /api/workspaces/:wId/tasks/:tId/consolidated-activities | Histórico consolidado de aprovação |
| GET/POST | /api/workspaces/:wId/tasks/:tId/comments | Comentários da tarefa |

### Minhas Tarefas
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/my-tasks | Listar minhas tarefas (filtro por status, workspace) |
| POST | /api/my-tasks | Criar tarefa standalone |
| GET | /api/my-tasks/:tId | Detalhes da tarefa |
| PATCH | /api/my-tasks/:tId | Atualizar tarefa |
| PATCH | /api/my-tasks/:tId/status | Atualizar status |
| DELETE | /api/my-tasks/:tId | Excluir tarefa (apenas criador — fallback assignee se created_by NULL) |
| PATCH | /api/my-tasks/:tId/association | Associar/desassociar a card/workspace (sem activity log) |
| POST | /api/my-tasks/:tId/move-to-workspace | Mover standalone → workspace (one-way, com activity `task_moved`) |
| GET | /api/my-tasks/:tId/activities | Atividades da tarefa |
| GET | /api/my-tasks/:tId/meta | Metadados da tarefa |
| GET/POST | /api/my-tasks/:tId/comments | Comentários |
| GET/PUT | /api/my-tasks/:tId/subtasks | Listar / replace bulk de subtarefas |
| POST | /api/my-tasks/:tId/subtasks | Adicionar 1..50 itens de checklist (body `{ items: [...] }`) |
| PATCH | /api/my-tasks/:tId/subtasks/:sId | Editar item de checklist |
| DELETE | /api/my-tasks/:tId/subtasks/:sId | Remover item de checklist |
| GET/POST | /api/my-tasks/:tId/attachments | Listar/criar anexos |
| DELETE | /api/my-tasks/:tId/attachments/:aId | Excluir anexo |
| GET | /api/my-tasks/:tId/attachments/:aId/download | Download de anexo |
| GET | /api/my-tasks/members | Membros para filtro |
| GET | /api/my-tasks/counts | Contadores |

### Shapes & Text Elements
| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST | /api/.../maps/:mId/shapes | Listar/criar formas |
| PUT/DELETE | /api/.../maps/:mId/shapes/:sId | Atualizar/excluir forma |
| GET | /api/.../maps/:mId/shapes/:sId/download | Download de imagem da forma |
| POST | /api/.../maps/:mId/shapes/uploads | Upload de imagem para forma |
| POST | /api/.../maps/:mId/text-elements | Criar texto |
| PUT/DELETE | /api/.../maps/:mId/text-elements/:eId | Atualizar/excluir texto |

### Templates
| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST | /api/task-templates | Listar/criar templates |
| GET/PATCH/DELETE | /api/task-templates/:tId | CRUD template |
| POST | /api/task-templates/:tId/subtasks | Adicionar subtask ao template |
| PATCH/DELETE | /api/task-templates/:tId/subtasks/:sId | Atualizar/excluir subtask do template |
| PUT | /api/task-templates/:tId/subtasks/reorder | Reordenar subtasks |
| POST | /api/task-templates/:tId/apply | Aplicar template a uma tarefa |

### Anexos de Tarefas (workspace scope)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST | /api/workspaces/:wId/tasks/:tId/attachments | Listar/criar anexos |
| PATCH | /api/.../attachments/:aId | Atualizar kind (standard/deliverable) |
| DELETE | /api/.../attachments/:aId | Excluir anexo |

### Busca, Storage, Sidebar, Calendar
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/tasks/search | Busca global de tarefas |
| POST | /api/storage/uploads/request-url | URL presigned para upload |
| GET | /api/storage/objects/* | Servir objeto |
| GET | /api/storage/public-objects/* | Servir objeto público |
| GET | /api/sidebar/workspaces | Dados da sidebar |
| PUT | /api/sidebar/order | Reordenar sidebar |
| PATCH | /api/sidebar/workspaces/:wId/expanded | Toggle expandido |
| GET/POST/DELETE | /api/integrations/google-calendar/* | OAuth e eventos do Google Calendar |

## WebSocket / Presença

O backend expõe um servidor WebSocket para presença em tempo real nos mapas:
- `presenceServer.ts` gerencia conexões WebSocket
- `presenceRoom.ts` mantém salas por mapa (quem está online, cursores)
- Autenticação via token JWT no handshake
- Frontend conecta ao entrar no canvas de um mapa

## Convenções de Código

### Zod v4
O projeto usa Zod v4. Os schemas do banco (`lib/db/src/schema/`) importam de `zod/v4` explicitamente. As rotas do backend importam de `zod` (que resolve para v4 pela versão do pacote). Ambas as formas funcionam — ao criar novos arquivos, prefira `zod/v4` para ser explícito:
```typescript
import { z } from "zod/v4";
```

### Express 5
Handlers são async nativamente — não é necessário wrapper try/catch para erros:
```typescript
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  const data = await db.query.xxx.findMany();
  res.json(data);
});
```

### Autenticação
- JWT em cookie HttpOnly `token` (SameSite=Lax, Secure em prod, 7 dias)
- Frontend usa `credentials: "include"` em todas as chamadas via `customFetch` — o cookie é enviado automaticamente, sem header Authorization manual
- Backend aceita cookie `token` (primário) ou header `Authorization: Bearer` (compatibilidade legada)
- `requireAuth` middleware extrai userId do cookie/header e anexa em `req.userId`
- `requireWorkspaceRole(["admin", "editor"])` verifica papel no workspace

### Proxy de Rotas (Coolify)
- `/api/*` → `bloquim-api` (Express, porta `API_PORT`)
- `/*` → `bloquim-web` (Vite SPA, porta `WEB_PORT`)
- Reverse proxy gerenciado pelo Coolify; ambos sobem como containers separados no projeto `bloquim`.

### Sincronização Visual
Ao atualizar `task.status`, o `taskVisualSyncService` atualiza automaticamente `card.statusVisual`. Cores: pending=azul, in_progress=âmbar, completed=esmeralda, overdue=vermelho, blocked=cinza, draft=slate.

### Autoria e exclusão de tarefas (`tasks.created_by`)
Toda tarefa criada após a migration `0027_add_task_created_by` carrega o `created_by` do usuário que disparou o POST. Os DELETE de tarefa usam essa coluna como regra de autorização:

- **Standalone (`DELETE /api/my-tasks/:tId`)**: só o criador apaga. Fallback em `assigned_to` quando `created_by` é NULL (rows pré-migration — em standalone os dois apontam pra mesma pessoa).
- **Workspace (`DELETE /api/workspaces/:wId/tasks/:tId`)**: o criador apaga, ou um admin do workspace (bypass para limpeza de tarefas de ex-membros). Rows com `created_by = NULL` (workspace antigas sem activity `task_created`) são rejeitadas via API — apague pela UI como admin.

A migration faz backfill: standalone → copia de `assigned_to`; workspace → busca o `actor_id` da primeira activity `task_created` da tarefa. Tasks sem essa activity ficam NULL.

### Activity log de checklist e move
Duas operações novas emitem activities dedicadas:

- `checklist_items_added` — uma entrada por chamada de `POST /:tId/subtasks`, com `metadata.itemCount` (string) e `metadata.sampleText` (texto do primeiro item, truncado em 80 chars). Independe de quantos itens foram inseridos: o log fica enxuto mesmo quando o agent dispara batches grandes.
- `task_moved` — uma entrada por chamada de `POST /my-tasks/:tId/move-to-workspace`, com `metadata.toWorkspaceId`, `metadata.fromAssigneeId` e `metadata.toAssigneeId`. `fromWorkspaceId` é implícito null (só standalone → workspace é suportado).

## Regras para Trabalho Multi-Agente

1. **Após alterar `openapi.yaml`**, sempre rodar: `pnpm --filter @workspace/api-spec run codegen`
2. **Nunca editar arquivos gerados** em `lib/api-client-react/src/generated/` ou `lib/api-zod/src/generated/`
3. **Após alterar schema do banco** em `lib/db/src/schema/`, rodar: `pnpm --filter @workspace/db run push`
4. **Hooks customizados** (não gerados pelo Orval) ficam diretamente em `lib/api-client-react/src/` (ex: `text-elements.ts`)
5. **Componentes de UI** usam shadcn/ui em `artifacts/mindtask-app/src/components/ui/`
6. **Manter imports consistentes**: `@workspace/db`, `@workspace/api-client-react`, `@workspace/api-zod`, `@workspace/object-storage-web`
