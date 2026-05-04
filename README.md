# MindTask (Bloquim)

Plataforma web de gestão de tarefas com mapas mentais visuais.

## Visão geral

O MindTask permite que equipes planejem trabalho diretamente em um canvas estilo mapa mental e transformem cada card em uma tarefa real, com responsáveis, prazos, fluxos de aprovação e colaboração em tempo real. A ideia é unir o pensamento visual (rascunhar ideias, conectar passos, agrupar contextos) com a execução estruturada de tarefas, em um único produto.

## Principais funcionalidades

- **Canvas visual (ReactFlow)** com vários tipos de elementos: cards de tarefa, textos livres (Tiptap), formas geométricas, imagens e nós de aprovação/convergência. Cards têm cor automática conforme o status da tarefa.
- **Gestão de tarefas** com status (pendente, em andamento, concluída, atrasada, bloqueada, rascunho), prioridade, datas de início e prazo, descrição rica, subtarefas ordenáveis, recorrência configurável e duplicação.
- **Fluxos de aprovação** sequenciais ou paralelos, com reordenação de aprovadores, aprovação/reprovação com comentário, histórico consolidado e anexos marcados como entregáveis.
- **Colaboração em tempo real** via WebSocket: presença de usuários nos mapas, comentários em cards e tarefas e log de atividades.
- **Integrações e produtividade**: Google Agenda via OAuth, modelos de tarefa reutilizáveis, busca global de tarefas e anexos via Object Storage com pré-visualização (imagens e PDF).
- **Workspaces multi-tenant** com papéis (Admin, Editor, Executor) e dashboards com gráficos por status e prioridade.

## Stack

- **Frontend**: React 19, Vite 7, Tailwind CSS 4, ReactFlow, Zustand, TanStack React Query v5, Tiptap, Recharts.
- **Backend**: Node.js 24, Express 5, WebSockets via `ws`.
- **Banco de dados**: PostgreSQL com Drizzle ORM.
- **Contrato de API**: OpenAPI 3.1 + Orval (gera hooks React Query e schemas Zod v4).
- **Storage**: Replit Object Storage (upload via presigned URL).
- **Auth**: JWT em cookie HttpOnly.
- **Monorepo**: pnpm workspaces.

## Estrutura do monorepo

```
artifacts/
  mindtask-app/        # Frontend React + Vite
  api-server/          # API Express + servidor WebSocket de presença
  mockup-sandbox/      # Preview de componentes (design sandbox)

lib/
  api-spec/            # Contrato OpenAPI + configuração Orval
  api-client-react/    # Hooks React Query gerados (não editar generated/)
  api-zod/             # Schemas Zod gerados (não editar generated/)
  db/                  # Schema Drizzle + migrações
  object-storage-web/  # Componente e hook de upload
```

## Como rodar localmente

### Pré-requisitos

- Node.js 24
- pnpm
- PostgreSQL acessível e a variável de ambiente `DATABASE_URL` configurada

### Passos

```bash
# 1. Instalar dependências
pnpm install

# 2. Aplicar o schema no banco
pnpm --filter @workspace/db run push

# 3. Subir o backend (API + WebSocket)
pnpm --filter @workspace/api-server run dev

# 4. Em outro terminal, subir o frontend
pnpm --filter @workspace/mindtask-app run dev
```

O frontend atende em `/` e a API em `/api`.

## Geração de código da API

Sempre que o contrato OpenAPI (`lib/api-spec/openapi.yaml`) mudar, rode:

```bash
pnpm --filter @workspace/api-spec run codegen
```

Isso regenera os hooks React Query em `lib/api-client-react/src/generated/` e os schemas Zod em `lib/api-zod/src/generated/`. Esses arquivos não devem ser editados manualmente.

## Build de produção

```bash
pnpm run build
```

O comando roda o typecheck do monorepo e o build de cada pacote que tiver script `build`.

## Notas sobre o ambiente Replit

O projeto roda no Replit usando workflows para subir backend, frontend e sandbox de componentes em paralelo. As variáveis de ambiente (`PORT`, `DATABASE_URL`, credenciais do Google e do Object Storage) são gerenciadas pelo painel do Replit — cada artefato escuta a porta indicada pela variável `PORT` para evitar conflitos no preview.
