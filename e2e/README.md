# E2E — fluxo "nova tarefa" (Minhas Tarefas)

Cobre o caminho que quebrou em 2026-08-18: criar tarefa em `/my-tasks`, atribuir
workspace dentro do modal e editar status / responsável / plano / prioridade /
título sem fechar. Sem o fix de escopo do `TaskDetailModal`, o teste falha no
passo do status (o PATCH ia pra `/api/my-tasks/:id/status` → 403).

O Playwright **não** é dependência do monorepo (evita mexer no `pnpm-lock.yaml`,
que precisa ser regenerado com a pnpm exata do Dockerfile). Instale fora da árvore:

```bash
mkdir -p /tmp/bloquim-e2e && cd /tmp/bloquim-e2e
npm init -y && npm i -D @playwright/test && npx playwright install chromium
```

## Rodando

1. **Usuários fixos** (o `/api/auth/register` é rate-limited por IP — 1h):

```bash
cd lib/db
DATABASE_URL='<dev>' node ../../e2e/seed-users.mjs   # e2e_tasks_owner@ / e2e_tasks_mate@test.local
```

2. **API** (dev):

```bash
pnpm --filter @workspace/api-server run dev          # :5000
```

3. **Front**: o dev server do Vite serve centenas de módulos e derruba o browser
   com `ERR_INSUFFICIENT_RESOURCES` em máquina apertada. Rode contra o build:

```bash
pnpm --filter @workspace/mindtask-app run build
node e2e/serve.mjs artifacts/mindtask-app/dist/public 3100 http://localhost:5000
```

4. **Teste**:

```bash
cd /tmp/bloquim-e2e
WEB_BASE_URL=http://localhost:3100 API_BASE_URL=http://localhost:5000 \
  npx playwright test --config <repo>/e2e/playwright.config.ts <repo>/e2e/my-tasks-create.spec.ts
```

O spec cria workspace + plano por execução e apaga o workspace no fim. Se uma
execução falhar no meio, sobra um workspace `E2E Tarefas <timestamp>` no dev DB.
