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
- **Auth**: JWT via jsonwebtoken + bcryptjs
- **Estado**: Zustand + React Query (via Orval codegen)
- **Canvas**: ReactFlow
- **Gráficos**: Recharts
- **API codegen**: Orval (OpenAPI → React Query hooks + Zod schemas)
- **Build**: esbuild (CJS bundle para api-server)

## Estrutura

```
artifacts/
  api-server/         # Express 5 API (backend)
    src/
      routes/
        auth.ts       # POST /api/auth/register, /login, /logout, GET /me
        workspaces.ts # CRUD de workspaces, membros, dashboard
        maps.ts       # CRUD de mapas
        cards.ts      # CRUD de cards, conexões, tasks por card
        myTasks.ts    # GET /api/my-tasks
      middlewares/
        auth.ts       # JWT middleware + signToken()
        permissions.ts # Verificação de papel no workspace

  mindtask-app/       # React + Vite (frontend)
    src/
      pages/
        login.tsx, register.tsx
        workspaces/index.tsx, workspaces/detail.tsx
        maps/canvas.tsx
        my-tasks.tsx
      components/
        layout/AppLayout.tsx
        maps/MindMapNode.tsx, CardPanel.tsx

lib/
  api-spec/openapi.yaml  # Contrato de API completo
  api-client-react/      # Hooks React Query gerados
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
| GET/POST | /api/workspaces/:id/members | Membros |
| GET | /api/workspaces/:id/dashboard | Dashboard resumo |
| GET/POST | /api/workspaces/:wId/maps | Mapas |
| GET/PUT/DELETE | /api/workspaces/:wId/maps/:mId | Mapa específico |
| POST | /api/workspaces/:wId/maps/:mId/cards | Criar card |
| GET/PUT/DELETE | /api/.../cards/:cId | Card específico |
| POST/DELETE | /api/.../cards/:cId/task | Tarefa do card |
| PATCH | /api/.../cards/:cId/task/status | Atualizar status (sincroniza card) |
| PATCH | /api/.../cards/:cId/task/details | Atualizar detalhes |
| POST | /api/.../maps/:mId/connections | Conexão entre cards |
| DELETE | /api/.../connections/:connId | Remover conexão |
| GET | /api/my-tasks | Minhas tarefas |

## Papéis de Usuário

- **admin**: Tudo (incluindo gerenciar membros)
- **editor**: Criar/editar mapas, cards, tarefas
- **executor**: Apenas atualizar status das próprias tarefas

## Entidades do Banco

- users, workspaces, workspace_members, maps, cards, card_connections, tasks
- Enums: workspace_role, task_status, task_priority, card_visual_status
- Sincronização automática: ao atualizar task.status → card.status_visual é atualizado na mesma operação

## Comandos

- `pnpm --filter @workspace/api-server run dev` — API server
- `pnpm --filter @workspace/mindtask-app run dev` — Frontend
- `pnpm --filter @workspace/db run push` — Aplicar schema ao banco
- `pnpm --filter @workspace/api-spec run codegen` — Gerar hooks e schemas da API
