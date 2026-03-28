# MindTask

## Visão Geral

Plataforma web de planejamento e gestão de tarefas baseada em mapas mentais. Permite que equipes criem planos de ação visualmente em um canvas estilo mapa mental e transformem cards em tarefas atribuídas a usuários.

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24
- **Package manager**: pnpm
- **TypeScript**: 5.9
- **Frontend**: React + Vite + Tailwind CSS + React Flow
- **Backend**: Express 5
- **Banco de dados**: PostgreSQL + Drizzle ORM
- **Validação**: Zod (zod/v4), drizzle-zod
- **Auth**: JWT via jsonwebtoken + bcryptjs (token em localStorage key "mindtask_token")
- **Estado**: Zustand + React Query (via Orval codegen)
- **Canvas**: ReactFlow (com ReactFlowProvider, custom nodes MindMapNode)
- **Gráficos**: Recharts
- **API codegen**: Orval (OpenAPI → React Query hooks + Zod schemas)
- **Build**: esbuild (CJS bundle para api-server)

## Estrutura

```
artifacts/
  api-server/         # Express 5 API (porta 8080, rota /api)
    src/
      routes/
        auth.ts       # POST /api/auth/register, /login, /logout, GET /me
        workspaces.ts # CRUD de workspaces, membros, dashboard
        maps.ts       # CRUD de mapas (retorna cards + conexões)
        cards.ts      # CRUD de cards + tasks por card (com sync de status→cor)
        connections.ts # Conexões entre cards (montado em /maps/:mId/connections)
        myTasks.ts    # GET/POST /api/my-tasks, PATCH /:taskId/association
        index.ts      # Montagem de todas as rotas
      middlewares/
        auth.ts       # JWT middleware + signToken()
        permissions.ts # Verificação de papel no workspace

  mindtask-app/       # React + Vite (frontend, porta 24117, rota /)
    src/
      pages/
        login.tsx, register.tsx
        workspaces/index.tsx   # Lista de workspaces com "New Workspace" dialog
        workspaces/detail.tsx  # Detalhe com tabs: Mapas Mentais, Dashboard, Membros
        maps/canvas.tsx        # Canvas ReactFlow com sync de nodes e edges
        my-tasks.tsx           # Minhas Tarefas com filtro por status
      components/
        layout/AppLayout.tsx   # Sidebar + auth redirect via useEffect
        maps/MindMapNode.tsx   # Node customizado com cor por status
        tasks/TaskDetailModal.tsx  # Modal unificado para editar/criar tarefas (standalone ou workspace)

lib/
  api-spec/openapi.yaml  # Contrato de API completo
  api-client-react/      # Hooks React Query gerados (customFetch injeta JWT)
    src/custom-fetch.ts  # Injeta Authorization: Bearer <token> em todas as requests
  api-zod/               # Schemas Zod gerados
  db/src/schema/
    users.ts, workspaces.ts, maps.ts, tasks.ts, cards.ts
```

## Rotas de API

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/auth/register | Cadastro |
| POST | /api/auth/login | Login |
| GET | /api/auth/me | Usuário atual |
| GET/POST | /api/workspaces | Listar/criar workspaces |
| GET/PUT/DELETE | /api/workspaces/:id | Workspace específico |
| POST | /api/workspaces/:id/members | Adicionar membro {email, role} |
| DELETE | /api/workspaces/:id/members/:memberId | Remover membro |
| GET | /api/workspaces/:id/dashboard | Dashboard resumo |
| GET/POST | /api/workspaces/:wId/maps | Listar/criar mapas |
| GET/PUT/DELETE | /api/workspaces/:wId/maps/:mId | Mapa (retorna cards + conexões) |
| POST | /api/workspaces/:wId/maps/:mId/cards | Criar card |
| GET/PUT/DELETE | /api/workspaces/:wId/maps/:mId/cards/:cId | Card específico |
| POST | /api/workspaces/:wId/maps/:mId/cards/:cId/task | Criar tarefa |
| DELETE | /api/workspaces/:wId/maps/:mId/cards/:cId/task | Desvincular tarefa |
| PATCH | /api/workspaces/:wId/maps/:mId/cards/:cId/task/status | Atualizar status (sincroniza card.statusVisual) |
| PATCH | /api/workspaces/:wId/maps/:mId/cards/:cId/task/details | Atualizar detalhes (assignee, deadline, priority) |
| POST | /api/workspaces/:wId/maps/:mId/connections | Criar conexão |
| DELETE | /api/workspaces/:wId/maps/:mId/connections/:connId | Remover conexão |
| GET | /api/my-tasks | Minhas tarefas (do usuário logado) |

## Funcionalidades Implementadas

### Fase 1: Auth + Workspaces
- Registro e login com JWT
- Listagem e criação de workspaces

### Fase 2: Canvas
- Canvas ReactFlow com nodes customizados (MindMapNode)
- Cor do node sincronizada com status da tarefa: pending=azul, in_progress=âmbar, completed=esmeralda, overdue=vermelho
- Criação e deleção de edges (conexões entre cards)
- Sync inteligente: posições dos nodes preservadas no refetch (initializedRef)
- CardPanel (Sheet lateral) para editar card + criar e gerenciar tarefa
- Conversão card → tarefa com um clique

### Fase 3: Gestão completa
- **Workspace Detail**: tabs Mapas Mentais / Dashboard / Membros
  - Adicionar membro via e-mail + papel (admin/editor/executor)
  - Remover membro com confirmação (AlertDialog)
  - Badges de papel com ícones e descrições
- **CardPanel melhorias**:
  - Deletar card com confirmação (AlertDialog)
  - Data de prazo com input HTML date nativo
  - Desvincular tarefa com confirmação
  - Responsável via select de membros do workspace
  - Atualização de status com sync visual no canvas
- **My Tasks**: lista de tarefas com filtro por status

## Papéis de Usuário

- **admin**: Tudo (incluindo gerenciar membros)
- **editor**: Criar/editar mapas, cards, tarefas
- **executor**: Apenas atualizar status das próprias tarefas

## Entidades do Banco

- users, workspaces, workspace_members, maps, cards, card_connections, tasks
- Enums: workspace_role, task_status, task_priority, card_visual_status
- Sincronização automática: ao atualizar task.status → card.status_visual é atualizado na mesma operação

## Notas Técnicas

- TypeScript errors em `@workspace/api-client-react` são de módulo (tsc), não runtime (Vite/tsx ignoram)
- Proxy de rotas: Replit roteia `/api/*` → porta 8080, `/*` → porta 24117
- Autenticação: JWT em `localStorage.getItem("mindtask_token")`, injetado por `customFetch`
- O `customFetch` em `lib/api-client-react/src/custom-fetch.ts` é chamado por todos os hooks gerados

## Comandos

- `pnpm --filter @workspace/api-server run dev` — API server
- `pnpm --filter @workspace/mindtask-app run dev` — Frontend
- `pnpm --filter @workspace/db run push` — Aplicar schema ao banco
- `pnpm --filter @workspace/api-spec run codegen` — Gerar hooks e schemas da API
