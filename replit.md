# MindTask

## Visão Geral

Plataforma web de planejamento e gestão de tarefas baseada em mapas mentais. Permite que equipes criem planos de ação visualmente em um canvas estilo mapa mental e transformem cards em tarefas atribuídas a usuários. Suporta fluxos de aprovação, subtarefas, recorrência, templates reutilizáveis, anexos com entregáveis, comentários, busca global, presença em tempo real e integração com Google Calendar.

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24
- **Package manager**: pnpm
- **TypeScript**: 5.9
- **Frontend**: React 19 + Vite 7 + Tailwind CSS 4 + ReactFlow
- **Backend**: Express 5
- **Banco de dados**: PostgreSQL + Drizzle ORM
- **Validação**: Zod (zod/v4), drizzle-zod
- **Auth**: JWT via jsonwebtoken + bcryptjs (cookie HttpOnly `token`; backend ainda aceita `Authorization: Bearer` por compatibilidade)
- **Estado**: Zustand + React Query v5 (via Orval codegen)
- **Canvas**: ReactFlow (custom nodes: MindMapNode, TextNode, ShapeNode, ApprovalNode, ApprovalJoinNode)
- **Gráficos**: Recharts
- **API codegen**: Orval (OpenAPI → React Query hooks + Zod schemas)
- **Build**: esbuild (CJS bundle para api-server)
- **Realtime**: WebSocket (presença de usuários no mapa)
- **Object Storage**: Replit Object Storage (upload via presigned URL)
- **Rich Text**: Tiptap (TextNodes e descrições de tarefas)

## Estrutura

```
artifacts/
  api-server/               # Express 5 API (rota /api)
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
        taskTemplates.ts     # CRUD templates + subtasks + apply
        comments.ts          # Comentários em cards e tarefas
        textElements.ts      # Elementos de texto livre no mapa
        shapes.ts            # Formas no mapa (rect, ellipse, line, image) + upload de imagem
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

  mindtask-app/              # React + Vite (frontend, rota /)
    src/
      pages/
        login.tsx, register.tsx
        workspaces/index.tsx     # Lista de workspaces
        workspaces/detail.tsx    # Detalhe com tabs: Mapas, Dashboard, Membros
        maps/canvas.tsx          # Canvas ReactFlow
        my-tasks.tsx             # Minhas Tarefas com filtros
        templates.tsx            # Gerenciamento de templates
        settings/integrations.tsx # Integrações (Google Calendar)
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
          CommentsSection.tsx    # Comentários inline
          layerOrder.ts          # Ordenação de camadas
        tasks/
          TaskDetailModal.tsx    # Modal completo de edição de tarefa
          TaskListItem.tsx       # Item de lista
          TaskHeaderActions.tsx  # Ações do cabeçalho
          TaskDeleteDialog.tsx   # Diálogo de exclusão
          TaskApplyTemplateButton.tsx # Aplicar template
          ApprovalTaskView.tsx   # Tela de aprovação
          DescriptionEditor.tsx  # Editor rich text
          PriorityBadge.tsx      # Badge de prioridade
          RecurrencePanel.tsx    # Painel de recorrência
          RecurrencePopover.tsx  # Popover de recorrência
          AssigneeAvatarPicker.tsx # Seletor de responsável
          AssigneeFilterPills.tsx  # Filtro por responsável
          AttachmentsSection.tsx   # Seção de anexos
          approval/              # Componentes de aprovação
          subtasks/              # Componentes de subtarefas (SortableSubtask, SubtasksList)
          attachments/           # Viewer, thumbnail, preview PDF
          association/           # Chips de associação tarefa-card
        templates/
          TemplateDetailModal.tsx
        profile/
          ProfileSheet.tsx
      hooks/
        useComments.ts, useGoogleCalendar.ts, useProfile.ts,
        usePositionHistory.ts, useHidden.ts, use-toast.ts

  mockup-sandbox/              # Design preview server (rota /__mockup)

lib/
  api-spec/openapi.yaml        # Contrato OpenAPI 3.1 completo
  api-client-react/             # Hooks React Query gerados (customFetch envia cookie via credentials: "include")
    src/custom-fetch.ts         # Injeta credentials: "include"
    src/generated/              # Código gerado pelo Orval (NÃO editar)
  api-zod/                      # Schemas Zod gerados (NÃO editar em generated/)
  db/src/schema/
    users.ts, workspaces.ts, maps.ts, tasks.ts, cards.ts,
    comments.ts, textElements.ts, attachments.ts, shapes.ts, integrations.ts
  object-storage-web/           # Componente e hook de upload
```

## Rotas de API

### Auth
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/auth/register | Cadastro |
| POST | /api/auth/login | Login |
| POST | /api/auth/logout | Logout |
| GET | /api/auth/me | Usuário atual |
| PATCH | /api/auth/me | Atualizar perfil |
| GET | /api/auth/me/workspaces | Workspaces do usuário |

### Workspaces
| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST | /api/workspaces | Listar/criar |
| GET/PUT/DELETE | /api/workspaces/:id | CRUD workspace |
| PATCH | /api/workspaces/:id/color | Alterar cor |
| PATCH | /api/workspaces/:id/hidden | Ocultar/mostrar |
| GET/POST | /api/workspaces/:id/members | Membros |
| GET | /api/workspaces/:id/members/suggestions | Sugestões |
| PATCH/PUT/DELETE | /api/workspaces/:id/members/:mId | Papel/remover membro |
| GET | /api/workspaces/:id/dashboard | Dashboard |

### Mapas
| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST | /api/workspaces/:wId/maps | Listar/criar |
| GET/PUT/DELETE | /api/workspaces/:wId/maps/:mId | CRUD (GET retorna cards+conexões+shapes+textElements) |
| GET | /api/maps/recent | Recentes |

### Cards & Connections
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/.../maps/:mId/cards | Criar card |
| GET/PUT/DELETE | /api/.../maps/:mId/cards/:cId | CRUD card |
| POST/DELETE | /api/.../cards/:cId/task | Criar/desvincular tarefa |
| PATCH | /api/.../cards/:cId/task/status | Status (sync visual) |
| PATCH | /api/.../cards/:cId/task/details | Detalhes |
| POST/DELETE | /api/.../maps/:mId/connections | Conexões |

### Tarefas (workspace scope)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/workspaces/:wId/tasks | Listar |
| GET | /api/workspaces/:wId/tasks/counts | Contadores |
| GET/POST | /api/.../tasks/:tId/approvals | Aprovadores |
| DELETE | /api/.../tasks/:tId/approvals/:aId | Remover aprovador |
| PUT | /api/.../tasks/:tId/approvals/reorder | Reordenar |
| PATCH | /api/.../tasks/:tId/approval-mode | Modo (sequential/parallel) |
| POST | /api/.../tasks/:tId/approve | Aprovar |
| POST | /api/.../tasks/:tId/reject | Reprovar |
| GET | /api/.../tasks/:tId/consolidated-activities | Histórico consolidado |
| GET/POST | /api/.../tasks/:tId/comments | Comentários |
| GET/POST | /api/.../tasks/:tId/attachments | Anexos |
| PATCH | /api/.../tasks/:tId/attachments/:aId | Atualizar kind |
| DELETE | /api/.../tasks/:tId/attachments/:aId | Excluir anexo |

### Minhas Tarefas
| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST | /api/my-tasks | Listar/criar |
| GET/PATCH/DELETE | /api/my-tasks/:tId | CRUD |
| PATCH | /api/my-tasks/:tId/status | Status |
| PATCH | /api/my-tasks/:tId/association | Associar a card |
| GET | /api/my-tasks/:tId/activities | Atividades |
| GET | /api/my-tasks/:tId/meta | Metadados |
| GET/POST | /api/my-tasks/:tId/comments | Comentários |
| GET/PUT | /api/my-tasks/:tId/subtasks | Subtarefas |
| GET/POST | /api/my-tasks/:tId/attachments | Anexos |
| DELETE | /api/my-tasks/:tId/attachments/:aId | Excluir anexo |
| GET | /api/my-tasks/:tId/attachments/:aId/download | Download |
| GET | /api/my-tasks/members | Membros (filtro) |
| GET | /api/my-tasks/counts | Contadores |

### Shapes & Text Elements
| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST | /api/.../maps/:mId/shapes | Listar/criar |
| PUT/DELETE | /api/.../maps/:mId/shapes/:sId | Atualizar/excluir |
| GET | /api/.../shapes/:sId/download | Download imagem |
| POST | /api/.../shapes/uploads | Upload imagem |
| POST | /api/.../maps/:mId/text-elements | Criar |
| PUT/DELETE | /api/.../text-elements/:eId | Atualizar/excluir |

### Templates
| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST | /api/task-templates | Listar/criar |
| GET/PATCH/DELETE | /api/task-templates/:tId | CRUD |
| POST | /api/task-templates/:tId/subtasks | Adicionar subtask |
| PATCH/DELETE | /api/task-templates/:tId/subtasks/:sId | Atualizar/excluir subtask |
| PUT | /api/task-templates/:tId/subtasks/reorder | Reordenar |
| POST | /api/task-templates/:tId/apply | Aplicar a tarefa |

### Busca, Storage, Sidebar, Calendar
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /api/tasks/search | Busca global |
| POST | /api/storage/uploads/request-url | URL presigned |
| GET | /api/storage/objects/*, /api/storage/public-objects/* | Servir objetos |
| GET | /api/sidebar/workspaces | Dados sidebar |
| PUT | /api/sidebar/order | Reordenar |
| PATCH | /api/sidebar/workspaces/:wId/expanded | Toggle expandido |
| * | /api/integrations/google-calendar/* | OAuth + eventos Google Calendar |

## Funcionalidades Implementadas

### Auth & Perfil
- Registro e login com JWT (cookie HttpOnly)
- Edição de perfil (nome, avatar)
- Dark/light mode

### Workspaces
- CRUD de workspaces com cor customizável
- Gerenciamento de membros (adicionar via email, alterar papel, remover)
- Papéis: admin (tudo), editor (criar/editar), executor (apenas status próprio)
- Dashboard com gráficos (Recharts): tarefas por status, prioridade
- Sidebar com ordenação e collapse de workspaces
- Ocultar workspaces da sidebar

### Canvas (Mapas Mentais)
- Canvas ReactFlow com múltiplos tipos de nodes
- **MindMapNode**: card com cor por status da tarefa (pending=azul, in_progress=âmbar, completed=esmeralda, overdue=vermelho, blocked=cinza, draft=slate)
- **TextNode**: texto livre com editor Tiptap, resize, formatação
- **ShapeNode**: formas geométricas (retângulo, elipse, linha) e imagens
- **ApprovalNode**: node de aprovação (violeta) para fluxo de aprovação
- **ApprovalJoinNode**: ponto de convergência de aprovações
- Edges: DeletableEdge (com botão X), ApprovalEdge (tracejada)
- Criação e deleção de conexões entre cards
- Sync inteligente de posições no refetch
- Ordenação de camadas (z-index) dos elementos

### Tarefas
- Conversão card → tarefa com um clique
- Tarefas standalone (sem card vinculado) via "Minhas Tarefas"
- Associação/desassociação tarefa ↔ card
- Status: pending, in_progress, completed, overdue, blocked, draft
- Prioridade: low, medium, high, critical
- Responsável via select de membros do workspace
- Data de prazo com modos de agendamento (até, entre, em)
- Data de início
- Descrição rica com Tiptap
- Subtarefas ordenáveis (drag and drop)
- Recorrência configurável (diária, semanal, mensal, anual, periódica, personalizada)
- Duplicação de tarefas
- Log de atividades (histórico de mudanças)
- Filtro por status, responsável, workspace

### Aprovações
- Adicionar aprovadores a uma tarefa (cria tarefa de aprovação vinculada)
- Modo sequencial ou paralelo
- Reordenação de aprovadores (drag and drop)
- Aprovar/reprovar com comentário
- Histórico consolidado (atividades + comentários da tarefa pai e aprovadores)
- Entregáveis: anexos marcados como "deliverable" ficam visíveis nas tarefas de aprovação

### Comentários
- Comentários em tarefas (com suporte a ocultação)
- Comentários em cards

### Anexos
- Upload de arquivos via Object Storage (presigned URL)
- Listagem, download e exclusão de anexos
- Tipos: standard e deliverable
- Preview de imagens e PDF
- Viewer modal com navegação

### Templates
- CRUD de templates de tarefa
- Subtarefas no template (CRUD + reordenação)
- Aplicar template a tarefa existente (cria subtarefas)

### Busca Global
- Busca de tarefas por título em todos os workspaces

### Google Calendar
- OAuth com Google
- Visualização de eventos do calendário
- Configuração de calendários (seleção, cores)

### WebSocket / Presença
- Presença em tempo real nos mapas (quem está online)
- Salas por mapa com autenticação JWT

## Entidades do Banco

- **users**: id, name, email, passwordHash, avatarUrl
- **workspaces**: id, name, hidden, colorIndex, createdBy
- **workspace_members**: id, workspaceId, userId, role (admin/editor/executor)
- **maps**: id, workspaceId, name, hidden, createdBy
- **map_visited**: registro de mapas visitados recentemente
- **cards**: id, mapId, title, description, positionX/Y, statusVisual, taskId
- **card_connections**: id, mapId, sourceCardId, targetCardId
- **tasks**: id, mapId, workspaceId, title, description, assignedTo, status, priority, dueDate, startAt, scheduleMode, completedAt, recurrence, parentTaskId, isApprovalTask, approvalStatus, approvalMode, parentApprovalStatus
- **task_approvals**: id, taskId, approverUserId, approvalTaskId, order, status
- **task_activities**: id, taskId, actorId, type, metadata
- **task_subtasks**: id, taskId, title, completed, order
- **task_comments**: id, taskId, authorId, content, hidden
- **file_uploads**: id, objectPath, fileName, fileSize, mimeType, uploadedBy
- **attachment_links**: id, fileUploadId, taskId, kind (standard/deliverable)
- **map_text_elements**: id, mapId, content (Tiptap JSON), positionX/Y, width, height, fontSize, color
- **task_templates**: id, workspaceId, title, description, priority, createdBy
- **task_template_subtasks**: id, templateId, title, order
- **map_shapes**: id, mapId, type (rect/ellipse/line/image), positionX/Y, width, height, rotation, color, filled, strokeStyle, x1/y1/x2/y2, fileUploadId
- **user_google_calendar_accounts**: id, userId, googleAccountEmail, tokens
- **user_calendar_preferences**: id, userId, googleCalendarId, calendarName, calendarColor

**Enums**: task_status, task_priority, card_visual_status, workspace_role, approval_status, approval_mode, parent_approval_status, schedule_mode, attachment_kind

## Papéis de Usuário

- **admin**: Tudo (incluindo gerenciar membros, excluir workspace)
- **editor**: Criar/editar mapas, cards, tarefas
- **executor**: Apenas atualizar status das próprias tarefas

## Notas Técnicas

- Proxy de rotas: Replit roteia `/api/*` → API server, `/*` → Frontend Vite
- Autenticação: JWT em cookie HttpOnly `token` (SameSite=Lax, Secure em prod, 7 dias). Frontend usa `credentials: "include"`.
- O `customFetch` em `lib/api-client-react/src/custom-fetch.ts` é chamado por todos os hooks gerados
- Zod v4: schemas do banco importam de `zod/v4` explicitamente; rotas do backend importam de `zod` (resolve para v4 via versão do pacote). Ao criar novos arquivos, preferir `zod/v4`
- Express 5: async handlers nativos (não precisa de try/catch wrapper)
- Sincronização visual: task.status → card.statusVisual é automática via taskVisualSyncService
- Arquivos gerados pelo Orval em `api-client-react/src/generated/` e `api-zod/src/generated/` NÃO devem ser editados manualmente
- Após alterar `openapi.yaml`, rodar `pnpm --filter @workspace/api-spec run codegen`
- Após alterar schema do banco, rodar `pnpm --filter @workspace/db run push`

## Comandos

- `pnpm --filter @workspace/api-server run dev` — API server
- `pnpm --filter @workspace/mindtask-app run dev` — Frontend
- `pnpm --filter @workspace/db run push` — Aplicar schema ao banco
- `pnpm --filter @workspace/api-spec run codegen` — Gerar hooks e schemas da API
- `pnpm --filter @workspace/api-server run build` — Build de produção
