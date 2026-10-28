# Barra direita com tarefas e planos do Bloquim — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Barra lateral direita no painel com Tarefas e planos de ação do Bloquim; as telas do Bloquim (lista de tarefas do workspace e canvas do plano) embutidas por iframe no `<main>`, com header e as duas barras mantidos; as duas barras recolhidas e expandindo no hover.

**Architecture:** Dois repos. No **Bloquim**, três rotas novas sob `/embed/` renderizam os mesmos componentes da aba "tarefas" do workspace e do canvas, sem `AppLayout`, com um modo embutido que nunca sai de `/embed/*` e navega com `replace`. No **painel**, um único `BloquimEmbedHost` vive no layout de `[slug]` e troca de tela por postMessage; a barra direita lê planos e contagem via proxies cookie-auth para a API do Bloquim; a URL do painel é a fonte de verdade.

**Tech Stack:** Painel: Next.js 15 App Router, React (19 canary via Next), `@beeads/ui` (Sidebar, Dialog, AlertDialog, Spinner), checks em `tsx` + `node:assert`. Bloquim: Vite 7 + React 19 + wouter + TanStack Query v5, testes `vitest`, API Express.

**Spec:** `C:\Users\gusta\Projetos\beeads-central-de-dados\docs\superpowers\specs\2026-10-28-barra-direita-tarefas-planos-bloquim-design.md` (cópia versionada no Bloquim em `docs/superpowers/specs/`, Task 1).

**Execução e revisão (pedido do Gustavo):** implementação por subagente **Opus** por tarefa; o revisor de cada tarefa e da branch inteira é o **Codex** via skill `codex:rescue` (workaround do sandbox: `-s danger-full-access`, prompt por stdin — memória `codex-sandbox-quebrado-workaround`), no lugar do reviewer padrão da skill.

## Global Constraints

- Repos e branches: Bloquim `C:\Users\gusta\Projetos\beeads-bloquim\repo`, branch `feat/embed-workspace-tasks-and-maps` a partir de `master`; **nunca** commit/merge em `master` do Bloquim (gate humano, PR). Painel `C:\Users\gusta\Projetos\beeads-central-de-dados`, branch `feat/barra-direita-bloquim` a partir de `master`; push em `master` deploya.
- Commits: `git -c user.email=gustavo.azvd@gmail.com -c user.name="Gustavo Azevedo" commit -m "..."`, mensagem em português, 1ª linha < 72 chars, rodapé `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `git add` só com caminho explícito (duas sessões no mesmo worktree são comuns).
- Painel: imports relativos **sem** extensão (`./x`, nunca `./x.js` — passa no tsc e quebra o `next build`); gates `npx tsc --noEmit` + `pnpm build` em `web/` + os checks `pnpm check:<nome>`; checks são `tsx src/lib/<x>.check.ts` com `node:assert`, registrados em `web/package.json`.
- Bloquim: imports como o repo já faz (alias `@/`); testes `pnpm --filter @workspace/mindtask-app test` (vitest); typecheck é **relativo**: `npx tsc -p artifacts/mindtask-app/tsconfig.json --noEmit 2>&1 | grep -c "error TS"` antes e depois, contagem não pode subir (baseline ~71; `pnpm typecheck` é falso-verde por TS6306). Build real: `pnpm --filter @workspace/mindtask-app build`.
- Origens: painel `https://painel.beeads.com.br` (dev `http://localhost:3001` só no Vite dev); Bloquim `https://bloquim.beeads.com.br`, `bloquimAppOrigin()` no painel.
- Protocolo postMessage ESPELHADO: `artifacts/mindtask-app/src/lib/embedBridge.ts` ↔ `web/src/lib/task-embed-bridge.ts`, mesmas fixtures nos dois testes. `open`/`closed` do `/embed/task` ficam intocados.
- Fixtures compartilhadas: `PAINEL="https://painel.beeads.com.br"`, `BLOQUIM="https://bloquim.beeads.com.br"`, `WS="b2c49094-d3b8-4408-ad36-d439e4fdb517"`, `TASK="0f7a3c2e-1b4d-4e5f-9a6b-7c8d9e0f1a2b"`, `MAP="7d2f9b1c-3a4e-4f50-8b6c-9d0e1f2a3b4c"`.
- Nada de nginx: `location ^~ /embed/` já cobre as rotas novas.
- `inert` no iframe só por propriedade do DOM; `style={{ colorScheme }}` do `<iframe>` = tema forçado do embed; `.anon` em nome de plano; Spinner do DS como único indicador de espera.
- Ordem de deploy: Bloquim primeiro (merge do PR por Gustavo), painel depois.

## Review Focus

1. **Membro não-admin** (editor/executor) — barra sem "ver mais", sem "novo plano", sem olho/lixeira; proxies devolvem o 403 do Bloquim, nunca 500. Testes: `right-sidebar.check.ts` (Task 7) e `bloquim-proxy.check.ts` (Task 8).
2. **Comando `navigate` com `path` fora de `/embed/workspaces/...`** (pai com bug ou janela hostil) — o filho ignora. Teste: `isAllowedEmbedPath` em `embedBridge.test.ts` (Task 1).
3. **`returnUrl` do `init` apontando para outra origem** — seria open redirect pelo link `target="_top"`; o filho só aceita URL cuja origem esteja na allowlist. Teste em `embedBridge.test.ts` (Task 1).
4. **Bloquim fora do ar ou 401 ao montar o layout** — a barra aparece degradada (só Tarefas, sem badge) e o layout não cai. Teste: `mergeRightSidebarData` em `right-sidebar.check.ts` (Task 7) com resultados rejeitados.
5. **Troca de tema com a tela embutida visível** — o `src` do iframe não muda (perderia edição); adota o tema só escondido. Teste: `nextFrameTheme` em `bloquim-embed-host.check.ts` (Task 11).

---

## Estrutura de arquivos

**Bloquim (`artifacts/mindtask-app/src`)**
- `lib/embedBridge.ts` — protocolo (ampliado) + `workspaceRouteBase` + `isAllowedEmbedPath`.
- `lib/embedBridge.test.ts` — fixtures espelhadas (ampliado).
- `lib/embedParent.ts` — NOVO: store módulo-nível da origem do pai (`rememberEmbedParent`, `postToEmbedParent`, `isEmbedded`).
- `components/embed/EmbedShell.tsx` — NOVO: casca das páginas de embed (ready/init/navigate, gate de sessão, root transparente, `h-dvh`).
- `components/workspaces/WorkspaceTasksPanel.tsx` — NOVO: a aba "tarefas" extraída de `pages/workspaces/detail.tsx`.
- `pages/workspaces/detail.tsx` — passa a usar `WorkspaceTasksPanel`.
- `pages/maps/canvas.tsx` — `CanvasInner` ganha `embedded`; exporta `CanvasInner`.
- `pages/embed/workspaceTasks.tsx`, `pages/embed/canvas.tsx` — NOVOS: páginas de embed.
- `components/tasks/TaskListItem.tsx`, `components/tasks/ApprovalTaskView.tsx` — prefixo de rota pelo helper; chips relançam ao pai quando embutido.
- `App.tsx` — 3 rotas novas.
- `CLAUDE.md` (raiz do repo) — seção do embed ampliada. `docs/superpowers/specs|plans/` — cópias.

**Painel (`web/src`)**
- `lib/task-embed-bridge.ts` + `.check.ts` — protocolo (ampliado) + `embedPathFor` + `embedSrc`.
- `lib/right-sidebar.ts` + `.check.ts` — NOVO: regras puras da barra (rota ativa, ordem, inicial, "ver mais", contagem, merge degradado).
- `lib/bloquim-proxy.ts` + `.check.ts` — NOVO: mapeamento `BloquimError` → status do proxy.
- `lib/bloquim-client.ts` — `bloquimSend` + `workspaceMaps`, `workspaceTaskCounts`, `createWorkspaceMap`, `setWorkspaceMapHidden`, `deleteWorkspaceMap`.
- `lib/right-sidebar-data.ts` — NOVO (server-only): `getRightSidebarData`.
- `app/api/bloquim/[slug]/sidebar/route.ts`, `app/api/bloquim/[slug]/plans/route.ts`, `app/api/bloquim/[slug]/plans/[mapId]/route.ts` — NOVOS proxies.
- `components/HoverRail.tsx` — NOVO: trilho de 64px com painel absoluto que expande por hover/foco/flag.
- `components/AppSidebar.tsx` — sem botão de recolher; provider controlado pelo `HoverRail`.
- `components/SidebarNav.tsx` — modo teclado liga/desliga `setCollapsed`.
- `components/right-sidebar/AppRightSidebar.tsx`, `RightSidebarLoaded.tsx`, `NewPlanDialog.tsx`, `right-sidebar-store.ts` — NOVOS.
- `components/embed-host/BloquimEmbedHost.tsx`, `embed-host-store.ts`, `lib/bloquim-embed-host.ts` + `.check.ts` — NOVOS.
- `app/[slug]/layout.tsx` — monta `AppRightSidebar` (streaming) e `BloquimEmbedHost`.
- `app/[slug]/tarefas/page.tsx`, `app/[slug]/planos/[mapId]/page.tsx` — NOVOS (validação; renderizam `null`).
- `CLAUDE.md` (feature #47), memória do projeto.

---

# Parte A — Bloquim

### Task 1: Protocolo ampliado em `embedBridge.ts` (+ cópia da spec e do plano)

**Files:**
- Modify: `artifacts/mindtask-app/src/lib/embedBridge.ts`
- Test: `artifacts/mindtask-app/src/lib/embedBridge.test.ts`
- Create: `docs/superpowers/specs/2026-10-28-barra-direita-tarefas-planos-bloquim-design.md`, `docs/superpowers/plans/2026-10-28-barra-direita-tarefas-planos-bloquim.md` (cópias dos arquivos do painel)

**Interfaces:**
- Produces (todas exportadas de `embedBridge.ts`):
  - `type ParentCommand = { source: "bcd-panel"; type: "init"; returnUrl: string } | { source: "bcd-panel"; type: "navigate"; path: string }`
  - `parseParentCommand(origin: string, data: unknown, allowed: readonly string[]): ParentCommand | null` — `init` exige `returnUrl` string cuja `new URL(returnUrl).origin` ∈ `allowed`; `navigate` exige `isAllowedEmbedPath(path)`. `parseParentMessage` (open) NÃO muda.
  - `isAllowedEmbedPath(path: string): boolean` — casa `^/embed/workspaces/[^/?#]+/(tasks(/[^/?#]+)?|maps/[^/?#]+)$` (sem query, sem `..`).
  - `type NavigateTarget = { kind: "tasks" } | { kind: "map"; mapId: string }`
  - `navigateMessage(target: NavigateTarget): { source: "bloquim-embed"; type: "navigate"; target: "tasks" } | { source: "bloquim-embed"; type: "navigate"; target: "map"; mapId: string }`
  - `changedMessage(what: "plans" | "tasks"): { source: "bloquim-embed"; type: "changed"; what }`
  - `workspaceRouteBase(workspaceId: string, pathname: string): string` — `/embed/workspaces/${id}` se `isEmbedPath(pathname)`, senão `/workspaces/${id}`.
  - `ChildMessage` passa a ser a união dos 4 tipos (ready, closed, navigate, changed).

- [ ] **Step 1: Criar a branch e copiar spec + plano**

```bash
cd C:/Users/gusta/Projetos/beeads-bloquim/repo && git checkout master && git pull --ff-only && git checkout -b feat/embed-workspace-tasks-and-maps
cp "C:/Users/gusta/Projetos/beeads-central-de-dados/docs/superpowers/specs/2026-10-28-barra-direita-tarefas-planos-bloquim-design.md" docs/superpowers/specs/
cp "C:/Users/gusta/Projetos/beeads-central-de-dados/docs/superpowers/plans/2026-10-28-barra-direita-tarefas-planos-bloquim.md" docs/superpowers/plans/
```

- [ ] **Step 2: Medir o baseline do typecheck (guardar o número)**

Run: `cd C:/Users/gusta/Projetos/beeads-bloquim/repo && npx tsc -p artifacts/mindtask-app/tsconfig.json --noEmit 2>&1 | grep -c "error TS"`
Expected: um inteiro (≈71). Anotar no commit final como `typecheck baseline N`.

- [ ] **Step 3: Escrever os testes que falham** (acrescentar a `embedBridge.test.ts`, mesmas fixtures do cabeçalho + `const MAP = "7d2f9b1c-3a4e-4f50-8b6c-9d0e1f2a3b4c"`)

```ts
describe("isAllowedEmbedPath", () => {
  it("aceita lista, deep link de tarefa e mapa", () => {
    expect(isAllowedEmbedPath(`/embed/workspaces/${WS}/tasks`)).toBe(true);
    expect(isAllowedEmbedPath(`/embed/workspaces/${WS}/tasks/${TASK}`)).toBe(true);
    expect(isAllowedEmbedPath(`/embed/workspaces/${WS}/maps/${MAP}`)).toBe(true);
  });
  it("recusa fora de /embed, query, segmentos extras e ..", () => {
    expect(isAllowedEmbedPath(`/workspaces/${WS}/tasks`)).toBe(false);
    expect(isAllowedEmbedPath(`/embed/workspaces/${WS}/maps/${MAP}?cardId=x`)).toBe(false);
    expect(isAllowedEmbedPath(`/embed/workspaces/${WS}/maps/${MAP}/x`)).toBe(false);
    expect(isAllowedEmbedPath(`/embed/workspaces/../tasks`)).toBe(false);
    expect(isAllowedEmbedPath("https://evil.example/embed/workspaces/x/tasks")).toBe(false);
  });
});

describe("parseParentCommand", () => {
  const allowed = allowedParentOrigins(false);
  it("aceita init com returnUrl do painel", () => {
    expect(parseParentCommand(PAINEL, { source: "bcd-panel", type: "init", returnUrl: `${PAINEL}/bluma-cf/tarefas` }, allowed))
      .toEqual({ source: "bcd-panel", type: "init", returnUrl: `${PAINEL}/bluma-cf/tarefas` });
  });
  it("recusa init com returnUrl de outra origem ou inválida", () => {
    expect(parseParentCommand(PAINEL, { source: "bcd-panel", type: "init", returnUrl: "https://evil.example/x" }, allowed)).toBeNull();
    expect(parseParentCommand(PAINEL, { source: "bcd-panel", type: "init", returnUrl: "not a url" }, allowed)).toBeNull();
  });
  it("aceita navigate com path permitido e recusa o resto", () => {
    expect(parseParentCommand(PAINEL, { source: "bcd-panel", type: "navigate", path: `/embed/workspaces/${WS}/maps/${MAP}` }, allowed))
      .toEqual({ source: "bcd-panel", type: "navigate", path: `/embed/workspaces/${WS}/maps/${MAP}` });
    expect(parseParentCommand(PAINEL, { source: "bcd-panel", type: "navigate", path: `/workspaces/${WS}` }, allowed)).toBeNull();
  });
  it("recusa origem fora da allowlist e open (que é do parseParentMessage)", () => {
    expect(parseParentCommand("https://evil.example", { source: "bcd-panel", type: "init", returnUrl: PAINEL }, allowed)).toBeNull();
    expect(parseParentCommand(PAINEL, open(), allowed)).toBeNull();
  });
});

describe("mensagens do filho", () => {
  it("navigate tasks / map", () => {
    expect(navigateMessage({ kind: "tasks" })).toEqual({ source: EMBED_CHILD_SOURCE, type: "navigate", target: "tasks" });
    expect(navigateMessage({ kind: "map", mapId: MAP })).toEqual({ source: EMBED_CHILD_SOURCE, type: "navigate", target: "map", mapId: MAP });
  });
  it("changed", () => {
    expect(changedMessage("plans")).toEqual({ source: EMBED_CHILD_SOURCE, type: "changed", what: "plans" });
  });
});

describe("workspaceRouteBase", () => {
  it("prefixa /embed só em rota de embed", () => {
    expect(workspaceRouteBase(WS, `/embed/workspaces/${WS}/tasks`)).toBe(`/embed/workspaces/${WS}`);
    expect(workspaceRouteBase(WS, `/workspaces/${WS}`)).toBe(`/workspaces/${WS}`);
    expect(workspaceRouteBase(WS, "/embed/task")).toBe(`/embed/workspaces/${WS}`);
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `pnpm --filter @workspace/mindtask-app test -- embedBridge`
Expected: FAIL (exports inexistentes).

- [ ] **Step 5: Implementar em `embedBridge.ts`** as funções/tipos da Interfaces; `parseParentCommand` reaproveita `nonEmptyString`; `returnUrl` validada com `new URL()` em `try/catch`.

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @workspace/mindtask-app test -- embedBridge`
Expected: PASS, incluindo os testes antigos de `open`.

- [ ] **Step 7: Commit**

```bash
git add artifacts/mindtask-app/src/lib/embedBridge.ts artifacts/mindtask-app/src/lib/embedBridge.test.ts docs/superpowers/specs/2026-10-28-barra-direita-tarefas-planos-bloquim-design.md docs/superpowers/plans/2026-10-28-barra-direita-tarefas-planos-bloquim.md
git -c user.email=gustavo.azvd@gmail.com -c user.name="Gustavo Azevedo" commit -m "feat(embed): protocolo init/navigate/changed e helper de prefixo de rota"
```

---

### Task 2: `embedParent.ts` + `EmbedShell` (casca das páginas de embed)

**Files:**
- Create: `artifacts/mindtask-app/src/lib/embedParent.ts`
- Create: `artifacts/mindtask-app/src/components/embed/EmbedShell.tsx`
- Test: `artifacts/mindtask-app/src/lib/embedParent.test.ts`

**Interfaces:**
- Consumes: Task 1 (`parseParentCommand`, `readyMessage`, `allowedParentOrigins`, `isEmbedPath`, `ChildMessage`).
- Produces:
  - `embedParent.ts`: `rememberEmbedParent(origin: string): void`; `embedParentOrigin(): string | null`; `postToEmbedParent(msg: ChildMessage, target: { postMessage(msg: unknown, origin: string): void } = window.parent): boolean` (false sem origem conhecida; o `target` injetável existe para o teste rodar sem jsdom); `isEmbedded(pathname: string = window.location.pathname): boolean` (= `isEmbedPath`); `resetEmbedParentForTests(): void`.
  - `EmbedShell({ children }: { children: ReactNode })`: adiciona `embed-transparent` ao `<html>`; posta `ready` a cada origem permitida (`window.parent !== window`); ouve `message` → `parseParentCommand`; `init` → `rememberEmbedParent(e.origin)` + guarda `returnUrl` em state; `navigate` → `navigate(path, { replace: true })` do wouter; gate de sessão: `useGetMe({ query: { retry: false } })` — enquanto carrega, `<Loader2 className="animate-spin" />` centralizado; em erro (sem `user`), renderiza `<p>sua sessão do Bloquim expirou</p>` + `<a target="_top" href={`/login?return_url=${encodeURIComponent(returnUrl ?? "/")}`}>entrar de novo</a>` — **sem** `setLocation("/login")`; com `user`, renderiza `<div className="h-dvh flex flex-col overflow-hidden">{children}</div>`.

- [ ] **Step 1: Teste do store** (`embedParent.test.ts`, vitest; `window.parent` simulado com `vi.spyOn`):

```ts
it("postToEmbedParent é no-op antes do init e posta depois", () => {
  resetEmbedParentForTests();
  const target = { postMessage: vi.fn() };
  expect(postToEmbedParent(readyMessage(), target)).toBe(false);
  rememberEmbedParent(PAINEL);
  expect(postToEmbedParent(changedMessage("tasks"), target)).toBe(true);
  expect(target.postMessage).toHaveBeenCalledWith({ source: "bloquim-embed", type: "changed", what: "tasks" }, PAINEL);
});
it("isEmbedded lê o pathname recebido", () => {
  expect(isEmbedded(`/embed/workspaces/${WS}/tasks`)).toBe(true);
  expect(isEmbedded(`/workspaces/${WS}`)).toBe(false);
});
```
(Sem `window`: o teste não exige jsdom.)

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @workspace/mindtask-app test -- embedParent` → FAIL.
- [ ] **Step 3: Implementar `embedParent.ts`** (variável de módulo `let origin: string | null`).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Implementar `EmbedShell.tsx`** conforme Interfaces. O `ready` é postado uma vez na montagem (não a cada render). Não há teste unitário da casca (jsdom sem harness de iframe no repo); cobertura pelo smoke da Task 12.
- [ ] **Step 6: Typecheck relativo** — contagem de `error TS` igual ao baseline.
- [ ] **Step 7: Commit** — `git add` dos 3 arquivos; mensagem `feat(embed): casca das páginas embutidas com handshake, gate de sessão e store do pai`.

---

### Task 3: Extrair `WorkspaceTasksPanel` e criar `/embed/workspaces/:wsId/tasks[/:taskId]`

**Files:**
- Create: `artifacts/mindtask-app/src/components/workspaces/WorkspaceTasksPanel.tsx`
- Modify: `artifacts/mindtask-app/src/pages/workspaces/detail.tsx` (a aba `tasks`: `TabsContent value="tasks"` ≈ linhas 727–860, o estado das linhas ≈ 198–245 que só ela usa, `openTaskItem`/`handleClosePanel`/`handleCloseTaskSheet`/`handleDeleteCardFromPanel`/`selectStatus`/`changeView`/`toggleAssignee`, o efeito de deep link ≈ 484–502 e os dois `TaskDetailModal` ≈ 1019–1045)
- Create: `artifacts/mindtask-app/src/pages/embed/workspaceTasks.tsx`
- Modify: `artifacts/mindtask-app/src/App.tsx` (rotas)
- Modify: `artifacts/mindtask-app/src/components/tasks/TaskListItem.tsx` (`renderWorkspaceMapCell`, ≈ linhas 565–600)
- Modify: `artifacts/mindtask-app/src/components/tasks/ApprovalTaskView.tsx` (`handleOpenParent`, ≈ linha 345)
- Test: `artifacts/mindtask-app/src/components/tasks/embedLinks.test.ts` (varredura estática)

**Interfaces:**
- Consumes: Task 1 (`workspaceRouteBase`, `navigateMessage`, `changedMessage`), Task 2 (`EmbedShell`, `postToEmbedParent`, `isEmbedded`).
- Produces: `WorkspaceTasksPanel(props: { workspaceId: string; deepLinkTaskId: string | null; embedded: boolean })` — renderiza o cabeçalho (criar + pílulas de status com contagens + `TimeWindowFilterPills` + `ViewModeToggle` + `AssigneeFilterPills`) e `WeekCalendar` | `TaskTable`, mais os dois `TaskDetailModal`. Internamente: `routeBase = workspaceRouteBase(workspaceId, location)`; `taskPath(id) = `${routeBase}/tasks/${id}``; `listPath = embedded ? `${routeBase}/tasks` : `${routeBase}?tab=tasks``; toda chamada `navigate(x)` vira `navigate(x, { replace: embedded })`. Em `embedded`, `handleClosePanel` e `handleCloseTaskSheet` chamam `postToEmbedParent(changedMessage("tasks"))`.

- [ ] **Step 1: Teste estático de "nada sai de /embed"** (`embedLinks.test.ts`): lê com `fs` os arquivos `TaskListItem.tsx`, `ApprovalTaskView.tsx`, `WorkspaceTasksPanel.tsx`, `pages/maps/canvas.tsx` e afirma que **nenhuma** linha contém `` href={`/workspaces/ `` nem `` navigate(`/workspaces/ `` nem `` navigate(`${APP_BASE}/workspaces/ `` (fora de `embedded ? … :` não há como saber estaticamente; a regra é: prefixo sempre por `workspaceRouteBase`).

```ts
// `pages/maps/canvas.tsx` entra na lista na Task 4.
const FILES = ["components/tasks/TaskListItem.tsx", "components/tasks/ApprovalTaskView.tsx", "components/workspaces/WorkspaceTasksPanel.tsx"];
const BANNED = ["href={`/workspaces/", "navigate(`/workspaces/", "navigate(`${APP_BASE}/workspaces/"];
it.each(FILES)("%s não navega com prefixo literal", (f) => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", f), "utf8");
  for (const b of BANNED) expect(src.includes(b)).toBe(false);
});
```

- [ ] **Step 2: Rodar e ver falhar** (hoje `TaskListItem`, `ApprovalTaskView` e `canvas.tsx` têm os literais; `WorkspaceTasksPanel` não existe → `ENOENT` também é falha).
- [ ] **Step 3: Criar `WorkspaceTasksPanel.tsx`** movendo o código da aba (estado, queries `tasksQueryKey`/`countsQueryKey`/`useListWorkspaceMembers`/`useGetMe`, handlers, JSX, os dois modais). `detail.tsx` passa a renderizar `<WorkspaceTasksPanel workspaceId={workspaceId} deepLinkTaskId={deepLinkTaskId} embedded={false} />` dentro do `TabsContent value="tasks"`. Estado que outras abas usam (`workspace`, `isAdmin`, `maps`, membros/convites) fica na página. A página mantém o `useEffect` que troca `activeTab` para `tasks` no deep link.
- [ ] **Step 4: `TaskListItem.renderWorkspaceMapCell`**: `base = workspaceRouteBase(localTask.workspaceId, window.location.pathname)`; quando `isEmbedded()`, o chip de mapa vira `<button type="button" onClick={e => { e.stopPropagation(); postToEmbedParent(navigateMessage({ kind: "map", mapId: localTask.mapId })); }}>` e o de workspace posta `{ kind: "tasks" }`; fora do embed, `<Link href={`${base}/maps/${mapId}`}>` / `<Link href={base}>`.
- [ ] **Step 5: `ApprovalTaskView.handleOpenParent`**: `navigate(`${APP_BASE}${workspaceRouteBase(workspaceId, window.location.pathname)}/tasks/${task.parentTaskId}`, { replace: isEmbedded() })`.
- [ ] **Step 6: Página `pages/embed/workspaceTasks.tsx`**: `useRoute("/embed/workspaces/:wsId/tasks")` + `useRoute("/embed/workspaces/:wsId/tasks/:taskId")`; `<EmbedShell><div className="flex-1 overflow-auto"><div className="pt-6 px-8 max-w-6xl mx-auto"><WorkspaceTasksPanel workspaceId deepLinkTaskId embedded /></div></div></EmbedShell>`. Registrar em `App.tsx`, ANTES de `<Route component={NotFound} />`: `/embed/workspaces/:wsId/tasks/:taskId` e `/embed/workspaces/:wsId/tasks`.
- [ ] **Step 7: Rodar os testes** — `pnpm --filter @workspace/mindtask-app test` → PASS (a lista do `embedLinks` tem só os 3 arquivos desta task).
- [ ] **Step 8: Typecheck relativo + build** — `npx tsc … | grep -c "error TS"` ≤ baseline; `pnpm --filter @workspace/mindtask-app build` → OK.
- [ ] **Step 9: Verificação manual no dev server** (`pnpm --filter @workspace/mindtask-app dev`, logado): `/workspaces/<id>?tab=tasks` idêntico ao de antes (criar, filtros, abrir tarefa, deep link `/workspaces/<id>/tasks/<taskId>`); `/embed/workspaces/<id>/tasks` renderiza a lista sem sidebar e com fundo transparente; abrir tarefa muda a URL para `/embed/workspaces/<id>/tasks/<taskId>` **sem** criar entrada de histórico (voltar sai da página).
- [ ] **Step 10: Commit** — `feat(embed): aba de tarefas do workspace extraída e rota /embed/workspaces/:id/tasks`.

---

### Task 4: Canvas em modo embutido + `/embed/workspaces/:wsId/maps/:mapId` + docs + PR

**Files:**
- Modify: `artifacts/mindtask-app/src/pages/maps/canvas.tsx` (`CanvasInner` ≈ 378; `canvasBasePath` ≈ 426; `navigate` ≈ 617, 1255, 3219, 3226; voltar+breadcrumb ≈ 2928–2944; loading com `AppLayout` ≈ 2919; `CanvasPage` ≈ 3267)
- Create: `artifacts/mindtask-app/src/pages/embed/canvas.tsx`
- Modify: `artifacts/mindtask-app/src/App.tsx`, `artifacts/mindtask-app/src/components/tasks/embedLinks.test.ts` (adiciona `canvas.tsx`), `CLAUDE.md` (raiz)

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `export function CanvasInner({ workspaceId, mapId, embedded = false }: { workspaceId: string; mapId: string; embedded?: boolean })`; `canvasBasePath = `${workspaceRouteBase(workspaceId, location)}/maps/${mapId}``; todo `navigate(canvasBasePath…)` com `{ replace: embedded || <valor atual> }`; em `embedded`: sem o `<Link>` de voltar, `PageBreadcrumb` com itens **sem `href`**, e o retorno é o `<div className="flex-1 flex flex-col …">` sem `AppLayout` (inclusive o ramo de loading); após mutação de renomear o plano (grep `PATCH` em `maps/${mapId}` com `name` dentro de `canvas.tsx` ou hook importado), `postToEmbedParent(changedMessage("plans"))` quando `isEmbedded()`.

- [ ] **Step 1: Ampliar o teste estático** (`embedLinks.test.ts`): adicionar `"pages/maps/canvas.tsx"` a `FILES`. Rodar → FAIL (literal `/workspaces/${workspaceId}` no voltar e no breadcrumb).
- [ ] **Step 2: Implementar o modo embutido em `CanvasInner`** conforme Interfaces (export nomeado; `CanvasPage` default continua igual).
- [ ] **Step 3: Página `pages/embed/canvas.tsx`**: `useRoute("/embed/workspaces/:wsId/maps/:mapId")` → `<EmbedShell><ReactFlowProvider><CanvasInner workspaceId mapId embedded /></ReactFlowProvider></EmbedShell>`. Rota em `App.tsx` antes do `NotFound`.
- [ ] **Step 4: Rodar os testes** → PASS. Typecheck relativo ≤ baseline. Build OK.
- [ ] **Step 5: Verificação manual no dev server**: `/workspaces/<id>/maps/<mapId>` igual ao de antes; `/embed/workspaces/<id>/maps/<mapId>` sem sidebar/voltar, breadcrumb sem link, `?cardId=` abre o card, criar/arrastar/apagar card, menu de modelos; Esc e fechar modal não criam entrada de histórico.
- [ ] **Step 6: `CLAUDE.md` do Bloquim**: na seção do `/embed/task`, documentar as 3 rotas novas, o `EmbedShell`, o protocolo (`init`/`navigate`/`changed`), a regra "prefixo só por `workspaceRouteBase`; entre telas só por mensagem ao pai; `replace` no embed" e o teste `embedLinks.test.ts`.
- [ ] **Step 7: Commit + PR**

```bash
git add artifacts/mindtask-app/src/pages/maps/canvas.tsx artifacts/mindtask-app/src/pages/embed/canvas.tsx artifacts/mindtask-app/src/App.tsx artifacts/mindtask-app/src/components/tasks/embedLinks.test.ts CLAUDE.md
git -c user.email=gustavo.azvd@gmail.com -c user.name="Gustavo Azevedo" commit -m "feat(embed): canvas do plano embutível em /embed/workspaces/:id/maps/:mapId"
git push -u origin feat/embed-workspace-tasks-and-maps
gh pr create --title "Embed: lista de tarefas e canvas do plano para o painel" --body "<resumo + typecheck baseline N → N + link da spec>"
```
Merge é gate humano (Gustavo). Não mergear.

---

# Parte B — Painel

### Task 5: Protocolo ampliado em `task-embed-bridge.ts` (espelho)

**Files:**
- Modify: `web/src/lib/task-embed-bridge.ts`
- Test: `web/src/lib/task-embed-bridge.check.ts` (`pnpm check:task-embed-bridge`)

**Interfaces:**
- Produces:
  - `type ChildMessage = { type: "ready" } | { type: "closed" } | { type: "navigate"; target: "tasks" } | { type: "navigate"; target: "map"; mapId: string } | { type: "changed"; what: "plans" | "tasks" }` — `parseChildMessage` valida os novos (mapId string não-vazia; `what` ∈ {plans,tasks}); shape errado → `null`.
  - `initMessage(returnUrl: string): { source: "bcd-panel"; type: "init"; returnUrl }`
  - `navigateCommand(path: string): { source: "bcd-panel"; type: "navigate"; path }`
  - `type EmbedRoute = { kind: "tasks" } | { kind: "map"; mapId: string }`
  - `embedPathFor(workspaceId: string, route: EmbedRoute): string` → `/embed/workspaces/${ws}/tasks` | `/embed/workspaces/${ws}/maps/${mapId}` (ids com `encodeURIComponent`).
  - `embedSrc(bloquimOrigin: string, path: string, theme: EmbedTheme): string` → `${origin sem barra final}${path}?theme=${theme}`.

- [ ] **Step 1: Asserções novas no check** (fixtures do cabeçalho + `const MAP = "7d2f9b1c-3a4e-4f50-8b6c-9d0e1f2a3b4c"`):

```ts
assert.deepStrictEqual(parseChildMessage(BLOQUIM, { source: "bloquim-embed", type: "navigate", target: "tasks" }, BLOQUIM), { type: "navigate", target: "tasks" });
assert.deepStrictEqual(parseChildMessage(BLOQUIM, { source: "bloquim-embed", type: "navigate", target: "map", mapId: MAP }, BLOQUIM), { type: "navigate", target: "map", mapId: MAP });
assert.strictEqual(parseChildMessage(BLOQUIM, { source: "bloquim-embed", type: "navigate", target: "map" }, BLOQUIM), null);
assert.deepStrictEqual(parseChildMessage(BLOQUIM, { source: "bloquim-embed", type: "changed", what: "plans" }, BLOQUIM), { type: "changed", what: "plans" });
assert.strictEqual(parseChildMessage(BLOQUIM, { source: "bloquim-embed", type: "changed", what: "x" }, BLOQUIM), null);
assert.deepStrictEqual(initMessage("https://painel.beeads.com.br/bluma-cf/tarefas"), { source: "bcd-panel", type: "init", returnUrl: "https://painel.beeads.com.br/bluma-cf/tarefas" });
assert.deepStrictEqual(navigateCommand(`/embed/workspaces/${WS}/tasks`), { source: "bcd-panel", type: "navigate", path: `/embed/workspaces/${WS}/tasks` });
assert.strictEqual(embedPathFor(WS, { kind: "tasks" }), `/embed/workspaces/${WS}/tasks`);
assert.strictEqual(embedPathFor(WS, { kind: "map", mapId: MAP }), `/embed/workspaces/${WS}/maps/${MAP}`);
assert.strictEqual(embedSrc(`${BLOQUIM}/`, `/embed/workspaces/${WS}/tasks`, "dark"), `${BLOQUIM}/embed/workspaces/${WS}/tasks?theme=dark`);
```

- [ ] **Step 2: Criar a branch e rodar o check para ver falhar**

```bash
cd C:/Users/gusta/Projetos/beeads-central-de-dados && git checkout master && git pull --ff-only && git checkout -b feat/barra-direita-bloquim
cd web && pnpm check:task-embed-bridge
```
Expected: erro de tipo/ReferenceError.

- [ ] **Step 3: Implementar** conforme Interfaces (manter `openTaskMessage`, `embedTaskSrc`, `embedTheme`).
- [ ] **Step 4: `pnpm check:task-embed-bridge`** → `task-embed-bridge: ok`.
- [ ] **Step 5: Commit** — `git add web/src/lib/task-embed-bridge.ts web/src/lib/task-embed-bridge.check.ts`; `feat(embed): protocolo init/navigate/changed espelhado do Bloquim`.

---

### Task 6: Regras puras da barra direita (`right-sidebar.ts`)

**Files:**
- Create: `web/src/lib/right-sidebar.ts`, `web/src/lib/right-sidebar.check.ts`
- Modify: `web/package.json` (`"check:right-sidebar": "tsx src/lib/right-sidebar.check.ts"`)

**Interfaces:**
- Consumes: `EmbedRoute` da Task 5.
- Produces:
  - `interface PlanSummary { id: string; name: string; hidden: boolean; updatedAt: string }`
  - `interface RightSidebarData { plans: PlanSummary[]; hiddenPlans: PlanSummary[] | null; openTasks: number | null }`
  - `embedRouteFromPathname(pathname: string, slug: string): EmbedRoute | null` — `/${slug}/tarefas` e `/${slug}/tarefas/…` → tasks; `/${slug}/planos/<id>` com exatamente um segmento → map; senão null.
  - `panelHrefFor(slug: string, route: EmbedRoute): string` → `/${slug}/tarefas` | `/${slug}/planos/${mapId}`.
  - `sortPlans(plans: readonly PlanSummary[]): PlanSummary[]` — `name.localeCompare(other, "pt-BR", { sensitivity: "base" })`, não muta.
  - `planInitial(name: string): string` — 1º caractere não-espaço em maiúscula; vazio → `"?"`.
  - `showVerMais(hiddenPlans: PlanSummary[] | null): boolean` — `!= null && length > 0`.
  - `openTaskCount(counts: Record<string, number>): number` — `draft + pending + in_progress` (ausentes = 0).
  - `mergeRightSidebarData(maps: PromiseSettledResult<PlanSummary[]>, counts: PromiseSettledResult<Record<string, number>>, isAdmin: boolean): RightSidebarData` — maps rejeitado → `plans: []`, `hiddenPlans: null`; maps ok → `plans` = não-ocultos ordenados, `hiddenPlans` = `isAdmin ? ocultos ordenados : null`; counts rejeitado → `openTasks: null`.
  - `isPlanActive(route: EmbedRoute | null, mapId: string): boolean`.

- [ ] **Step 1: Check com as asserções**

```ts
const slug = "bluma-cf";
assert.deepStrictEqual(embedRouteFromPathname(`/${slug}/tarefas`, slug), { kind: "tasks" });
assert.deepStrictEqual(embedRouteFromPathname(`/${slug}/tarefas/x`, slug), { kind: "tasks" });
assert.deepStrictEqual(embedRouteFromPathname(`/${slug}/planos/${MAP}`, slug), { kind: "map", mapId: MAP });
assert.strictEqual(embedRouteFromPathname(`/${slug}/planos`, slug), null);
assert.strictEqual(embedRouteFromPathname(`/${slug}/planos/${MAP}/x`, slug), null);
assert.strictEqual(embedRouteFromPathname(`/${slug}/meta-ads`, slug), null);
assert.strictEqual(embedRouteFromPathname(`/outro/tarefas`, slug), null);
assert.strictEqual(isPlanActive({ kind: "map", mapId: "1" }, "12"), false);
assert.strictEqual(isPlanActive({ kind: "map", mapId: "12" }, "12"), true);
assert.strictEqual(panelHrefFor(slug, { kind: "map", mapId: MAP }), `/${slug}/planos/${MAP}`);
const p = (name: string, hidden = false): PlanSummary => ({ id: name, name, hidden, updatedAt: "2026-10-28T00:00:00Z" });
assert.deepStrictEqual(sortPlans([p("Zeta"), p("ágil"), p("Alfa")]).map(x => x.name), ["ágil", "Alfa", "Zeta"]);
assert.strictEqual(planInitial("  campanha"), "C");
assert.strictEqual(planInitial(""), "?");
assert.strictEqual(showVerMais(null), false);
assert.strictEqual(showVerMais([]), false);
assert.strictEqual(showVerMais([p("x", true)]), true);
assert.strictEqual(openTaskCount({ draft: 2, pending: 14, in_progress: 9, completed: 5, blocked: 1 }), 25);
assert.strictEqual(openTaskCount({}), 0);
const ok = <T,>(value: T): PromiseSettledResult<T> => ({ status: "fulfilled", value });
const bad: PromiseSettledResult<never> = { status: "rejected", reason: new Error("x") };
assert.deepStrictEqual(mergeRightSidebarData(ok([p("B", true), p("A")]), ok({ pending: 1 }), true), { plans: [p("A")], hiddenPlans: [p("B", true)], openTasks: 1 });
assert.deepStrictEqual(mergeRightSidebarData(ok([p("B", true), p("A")]), ok({ pending: 1 }), false), { plans: [p("A")], hiddenPlans: null, openTasks: 1 });
assert.deepStrictEqual(mergeRightSidebarData(bad, bad, true), { plans: [], hiddenPlans: null, openTasks: null });
console.log("right-sidebar: ok");
```

- [ ] **Step 2: Registrar o script e rodar** — `pnpm check:right-sidebar` → FAIL (módulo inexistente).
- [ ] **Step 3: Implementar `right-sidebar.ts`** (puro, sem React).
- [ ] **Step 4: `pnpm check:right-sidebar`** → `right-sidebar: ok`.
- [ ] **Step 5: Commit** — `feat(barra-direita): regras puras de rota ativa, ordem e merge degradado`.

---

### Task 7: Cliente do Bloquim + proxies `/api/bloquim/[slug]/…`

**Files:**
- Modify: `web/src/lib/bloquim-client.ts`
- Create: `web/src/lib/bloquim-proxy.ts`, `web/src/lib/bloquim-proxy.check.ts`, `web/src/lib/right-sidebar-data.ts`
- Create: `web/src/app/api/bloquim/[slug]/sidebar/route.ts`, `web/src/app/api/bloquim/[slug]/plans/route.ts`, `web/src/app/api/bloquim/[slug]/plans/[mapId]/route.ts`
- Modify: `web/package.json` (`"check:bloquim-proxy": "tsx src/lib/bloquim-proxy.check.ts"`)

**Interfaces:**
- Consumes: Task 6 (`PlanSummary`, `RightSidebarData`, `mergeRightSidebarData`); `getAuthUser`, `getRawCookieHeader` (`@/lib/auth`), `userCanAccessSlug` (`@/lib/supabase`), `getClientBySlug` (`@/lib/queries`), `resolveIsAdmin` (`@/lib/is-admin`), `BloquimError`.
- Produces:
  - `bloquim-client.ts`: `bloquimSend<T>(method: "POST" | "PATCH" | "DELETE", path: string, body: unknown | undefined, cookie: string): Promise<T>` (204 → `undefined as T`; não-ok → `BloquimError`); `workspaceMaps(workspaceId, cookie, showHidden: boolean): Promise<PlanSummary[]>` (`GET /workspaces/:id/maps[?showHidden=true]`, mapeia `{id,name,hidden,updatedAt}`); `workspaceTaskCounts(workspaceId, cookie): Promise<Record<string, number>>`; `createWorkspaceMap(workspaceId, name, cookie): Promise<{ id: string; name: string }>`; `setWorkspaceMapHidden(workspaceId, mapId, hidden, cookie): Promise<void>`; `deleteWorkspaceMap(workspaceId, mapId, cookie): Promise<void>`.
  - `bloquim-proxy.ts`: `proxyStatusFor(err: unknown): 401 | 403 | 404 | 502` (BloquimError 401/403/404 passam; demais → 502); `isJsonContentType(h: string | null): boolean` (essência: `split(";")[0].trim().toLowerCase() === "application/json"`); `parsePlanName(body: unknown): string | null` (`name` string, trim, 1..100 chars).
  - `right-sidebar-data.ts` (`import "server-only"`): `getRightSidebarData(workspaceId: string, cookie: string, isAdmin: boolean): Promise<RightSidebarData>` = `Promise.allSettled([workspaceMaps(ws, cookie, isAdmin), workspaceTaskCounts(ws, cookie)])` → `mergeRightSidebarData`. Nunca lança.
  - Rotas (todas `export const dynamic = "force-dynamic"`; auth = `getAuthUser` → 401; `userCanAccessSlug` → 403; `getClientBySlug(slug)?.bloquimWorkspaceId` → 404; erro do Bloquim → `proxyStatusFor`; corpo de erro `{ error: string, message: null }`):
    - `GET /api/bloquim/[slug]/sidebar` → 200 `RightSidebarData` (`isAdmin` via `resolveIsAdmin`).
    - `POST /api/bloquim/[slug]/plans` — 415 se não-JSON; 400 `invalid_input` se `parsePlanName` null; 201 `{ id, name }`.
    - `PATCH /api/bloquim/[slug]/plans/[mapId]` — 415 se não-JSON; body `{ hidden: boolean }` senão 400; 200 `{ id, hidden }`.
    - `DELETE /api/bloquim/[slug]/plans/[mapId]` → 204.

- [ ] **Step 1: Check de `bloquim-proxy`**

```ts
assert.strictEqual(proxyStatusFor(new BloquimError(403, {})), 403);
assert.strictEqual(proxyStatusFor(new BloquimError(404, {})), 404);
assert.strictEqual(proxyStatusFor(new BloquimError(500, {})), 502);
assert.strictEqual(proxyStatusFor(new Error("rede")), 502);
assert.strictEqual(isJsonContentType("application/json; charset=utf-8"), true);
assert.strictEqual(isJsonContentType("text/plain;application/json"), false);
assert.strictEqual(isJsonContentType(null), false);
assert.strictEqual(parsePlanName({ name: "  Lançamento  " }), "Lançamento");
assert.strictEqual(parsePlanName({ name: "" }), null);
assert.strictEqual(parsePlanName({ name: "x".repeat(101) }), null);
assert.strictEqual(parsePlanName(null), null);
console.log("bloquim-proxy: ok");
```
`BloquimError` vem de `bloquim-client.ts`, que é `server-only` — o check roda em `tsx` puro: importar `BloquimError` de um módulo novo `lib/bloquim-error.ts` (mover a classe para lá e re-exportar de `bloquim-client.ts`).

- [ ] **Step 2: Rodar `pnpm check:bloquim-proxy`** → FAIL.
- [ ] **Step 3: Implementar `bloquim-error.ts`, `bloquim-proxy.ts`, as funções do cliente, `right-sidebar-data.ts` e as 3 rotas** conforme Interfaces (molde: `app/api/reunioes/[slug]/coleta/route.ts`).
- [ ] **Step 4: `pnpm check:bloquim-proxy`** → ok; `npx tsc --noEmit` → sem erro.
- [ ] **Step 5: Smoke local das rotas** com `pnpm dev` (porta 3001) e cookie de sessão válido (`.env.local` aponta pra prod — ver memória `dev-auth-sign-test-jwt-quebrado`): `curl -i http://localhost:3001/api/bloquim/<slug>/sidebar` sem cookie → 401; com cookie → 200 com `plans`; `POST …/plans` com `Content-Type: text/plain` → 415.
- [ ] **Step 6: Commit** — `feat(barra-direita): proxies de planos e contagem de tarefas do Bloquim`.

---

### Task 8: `HoverRail` + barra esquerda sem botão de recolher

**Files:**
- Create: `web/src/components/HoverRail.tsx`
- Modify: `web/src/components/AppSidebar.tsx`, `web/src/components/SidebarNav.tsx` (`useSidebarKeyboardNav`)
- Test: `web/src/lib/hover-rail.ts` + `web/src/lib/hover-rail.check.ts` (`"check:hover-rail"`)

**Interfaces:**
- Produces:
  - `lib/hover-rail.ts`: `railExpanded(i: { hover: boolean; focusWithin: boolean; pinned: boolean }): boolean` (OR dos três); `COLLAPSE_DELAY_MS = 150`.
  - `HoverRail({ side, pinned, children, className }: { side: "left" | "right"; pinned?: boolean; children: ReactNode; className?: string })` — wrapper `relative w-16 shrink-0 hidden md:block` + `SidebarProvider collapsed={!expanded} onCollapsedChange={(c) => setPinnedFromNav(!c)} collapsible={false} persist="none"`; estado `hover` (pointerenter → true; pointerleave → false após `COLLAPSE_DELAY_MS`), `focusWithin` (`onFocusCapture`/`onBlurCapture` com `relatedTarget` fora do wrapper), `pinnedFromNav` (escrito pelo `onCollapsedChange`), `expanded = railExpanded({ hover, focusWithin, pinned: pinned || pinnedFromNav })`. Renderiza `children` dentro do provider; o `Sidebar` do DS recebe `className` com `absolute inset-y-0 h-full ${side === "left" ? "left-0" : "right-0 border-l border-sidebar-border/50"} z-30` (+ `shadow-2xl` quando expandido).
  - `AppSidebar`: `SidebarControls` sem o botão (só `ThemeToggle` + `AnonToggle`, sem imports `PanelLeftClose/PanelLeftOpen`); `<HoverRail side="left"><Sidebar className=…><SidebarBody>{nav}</SidebarBody><SidebarControls /><SidebarFooter …/></Sidebar></HoverRail>`.
  - `SidebarNav`: em `useSidebarKeyboardNav`, `const { setCollapsed } = useSidebar();` e um efeito `setCollapsed(!(enabled && kbd))` quando `enabled && ready` muda `kbd` (desliga = `setCollapsed(true)`).

- [ ] **Step 1: Check** (`hover-rail.check.ts`):

```ts
assert.strictEqual(railExpanded({ hover: false, focusWithin: false, pinned: false }), false);
assert.strictEqual(railExpanded({ hover: true, focusWithin: false, pinned: false }), true);
assert.strictEqual(railExpanded({ hover: false, focusWithin: true, pinned: false }), true);
assert.strictEqual(railExpanded({ hover: false, focusWithin: false, pinned: true }), true);
assert.strictEqual(COLLAPSE_DELAY_MS, 150);
// a barra esquerda não tem mais botão de recolher
const src = fs.readFileSync(path.join(__dirname, "..", "components", "AppSidebar.tsx"), "utf8");
assert.ok(!src.includes("PanelLeftClose") && !src.includes("PanelLeftOpen") && !src.includes("persist=\"localStorage\""));
console.log("hover-rail: ok");
```

- [ ] **Step 2: Registrar e rodar** → FAIL.
- [ ] **Step 3: Implementar** `hover-rail.ts`, `HoverRail.tsx`, `AppSidebar.tsx`, `SidebarNav.tsx` conforme Interfaces.
- [ ] **Step 4: `pnpm check:hover-rail`** ok; `npx tsc --noEmit`; `pnpm build`.
- [ ] **Step 5: Verificação no `pnpm dev`** (desktop ≥ md): trilho de 64px; hover expande por cima do conteúdo (o `<main>` não muda de largura — medir `main.getBoundingClientRect().width` antes/depois no console); sai ao tirar o mouse; Tab até um item expande; `→` liga o modo teclado e a barra fica aberta; Esc recolhe; `localStorage.painel_sidebar_collapsed` não é mais escrito; drawer mobile (<md) inalterado.
- [ ] **Step 6: Commit** — `feat(sidebar): barra esquerda recolhida que expande no hover; botão de recolher removido`.

---

### Task 9: Barra direita (`AppRightSidebar`) com streaming no layout e ações de plano

**Files:**
- Create: `web/src/components/right-sidebar/AppRightSidebar.tsx`, `RightSidebarLoaded.tsx`, `NewPlanDialog.tsx`, `right-sidebar-store.ts`, `web/src/components/embed-host/embed-host-store.ts`
- Modify: `web/src/app/[slug]/layout.tsx`

**Interfaces:**
- Consumes: Task 6 (`right-sidebar.ts`), Task 7 (`getRightSidebarData`, rotas), Task 8 (`HoverRail`), `useAnonMode`, DS (`Sidebar`, `SidebarBody`, `SidebarSectionLabel`, `SidebarNavItem`, `Dialog`, `AlertDialog`, `Input`, `Button`, `Spinner`, `Badge`).
- Produces:
  - `right-sidebar-store.ts`: `bumpRightSidebar(): void`, `useRightSidebarVersion(): number` (`useSyncExternalStore`; `getServerSnapshot` = 0).
  - `embed-host-store.ts` (dono: esta task; a Task 10 consome): `warmEmbedHost(): void`, `useEmbedHostWarm(): boolean` (`useSyncExternalStore`; `getServerSnapshot` = false).
  - `AppRightSidebar({ slug, workspaceId, isAdmin, initial }: { slug: string; workspaceId: string; isAdmin: boolean; initial: RightSidebarData | null })` (client): estado `data` semeado por `initial` (re-semeia quando a prop muda); refetch `GET /api/bloquim/${slug}/sidebar` quando `useRightSidebarVersion()` muda e no `focus` da janela (ignora falha). Itens: Tarefas (`ListChecks`, badge `openTasks` quando `!= null`, `active` = rota tasks, `href` = `panelHrefFor`), `SidebarSectionLabel` "planos de ação", `sortPlans(plans)` → `SidebarNavItem` com ícone `<span class="…">{planInitial(name)}</span>`, `label={<span className="anon">{name}</span>}`, `title={anon ? "Plano de ação" : name}`, `active={isPlanActive(route, id)}`, `render` = `next/link`; admin: ações olho/lixeira no hover do item expandido (`group`); "ver mais" (`ChevronDown`, só se `showVerMais(hiddenPlans)`), lista de ocultos com `Badge` "oculto" e ação reexibir; rodapé "novo plano" (`Plus`, admin) → `NewPlanDialog`. Todo item: `onPointerEnter`/`onFocus` → `warmEmbedHost()`. Esqueleto (`Skeleton` do DS × 3) na seção de planos quando `initial === null`.
  - Ações: `POST /plans` → `router.push(panelHrefFor(slug, { kind: "map", mapId: id }))` + `bumpRightSidebar()`; `PATCH` ocultar/reexibir → `bumpRightSidebar()`; `DELETE` após `AlertDialog` ("excluir o plano «nome»? as tarefas dele continuam no workspace") → se era o ativo, `router.push(`/${slug}/tarefas`)`; `bumpRightSidebar()`. Erro → `toast` do DS com "não foi possível …".
  - `RightSidebarLoaded` (server, async): `await data` e renderiza `<AppRightSidebar initial={data} …/>`; usado dentro de `<Suspense fallback={<AppRightSidebar initial={null} …/>}>`.
  - Layout: após o `Promise.all`, `const rightSidebar = workspaceId ? getRightSidebarData(workspaceId, cookie, isAdmin) : null;` (não aguardar); no JSX, à direita de `<div className="flex min-h-0 min-w-0 flex-1 flex-col">…</div>`: `{workspaceId && rightSidebar && (<HoverRail side="right"><Suspense fallback=…><RightSidebarLoaded …/></Suspense></HoverRail>)}`. ⚠️ O `HoverRail` fica FORA do `Suspense` (o trilho não pode piscar).

- [ ] **Step 1: Implementar** os 4 componentes + store + wiring do layout conforme Interfaces.
- [ ] **Step 2: `npx tsc --noEmit`** e `pnpm build` → OK.
- [ ] **Step 3: Verificação no `pnpm dev`** com cookie de prod (workspace `beeads` ou `teste-whatsapp`): trilho direito com ícone de Tarefas + inicial dos planos; hover expande com nomes e badge; como admin: ver mais mostra ocultos; ocultar um plano o move para "ver mais" sem F5; novo plano cria (ver no Bloquim) e navega para `/[slug]/planos/<id>` (404 por enquanto — a página vem na Task 10); modo anônimo embaça os nomes; `/[slug]?share=…` (público) não mostra a barra.
- [ ] **Step 4: Commit** — `feat(barra-direita): tarefas, planos ativos, ver mais e novo plano com dados por streaming`.

---

### Task 10: `BloquimEmbedHost` + páginas `/tarefas` e `/planos/[mapId]`

**Files:**
- Create: `web/src/lib/bloquim-embed-host.ts`, `web/src/lib/bloquim-embed-host.check.ts`, `web/src/components/embed-host/BloquimEmbedHost.tsx` (o `embed-host-store.ts` vem da Task 9)
- Create: `web/src/app/[slug]/tarefas/page.tsx`, `web/src/app/[slug]/planos/[mapId]/page.tsx`
- Modify: `web/src/app/[slug]/layout.tsx` (monta o host dentro do `<main>`), `web/package.json` (`"check:bloquim-embed-host"`)

**Interfaces:**
- Consumes: Task 5 (`parseChildMessage`, `initMessage`, `navigateCommand`, `embedPathFor`, `embedSrc`, `embedTheme`), Task 6 (`embedRouteFromPathname`, `panelHrefFor`), Task 7 (`workspaceMaps`), Task 9 (`bumpRightSidebar`, store de warm).
- Produces:
  - `lib/bloquim-embed-host.ts` (puro): `nextFrameTheme(current: EmbedTheme, resolved: EmbedTheme, visible: boolean): EmbedTheme` (visível → `current`; escondido → `resolved`); `initialSrcRoute(route: EmbedRoute | null): EmbedRoute` (`route ?? { kind: "tasks" }`); `READY_TIMEOUT_MS = 10_000`; `fallbackBloquimHref(bloquimOrigin: string, workspaceId: string, route: EmbedRoute): string` (`/workspaces/${ws}` | `/workspaces/${ws}/maps/${mapId}`).
  - `BloquimEmbedHost({ slug, workspaceId, bloquimOrigin }: { slug: string; workspaceId: string; bloquimOrigin: string })` (client): `route = embedRouteFromPathname(usePathname(), slug)`; `visible = route != null`; monta o `<iframe>` quando `visible || warm`; `src = embedSrc(bloquimOrigin, embedPathFor(workspaceId, initialSrcRoute(routeNaMontagem)), frameTheme)`, `key = frameTheme`; `frameTheme` atualizado por `nextFrameTheme` num efeito sobre `[resolvedTheme, visible]`; `ready` por `parseChildMessage` → `postMessage(initMessage(window.location.href), bloquimOrigin)` e, se `visible`, `postMessage(navigateCommand(embedPathFor(workspaceId, route)))`; efeito em `route` (quando `ready && route`) → `navigateCommand`; `navigate` do filho → `router.push(panelHrefFor(slug, target))`; `changed` → `bumpRightSidebar()`; `ready` recebido de novo (o iframe recarregou — crash do ErrorBoundary do Bloquim) passa pelo MESMO handler, que reenvia `init` e `navigate` (o documento novo nasceu na rota do `src`, não na rota atual). DOM: wrapper `className={visible ? "flex min-h-[60dvh] flex-1 flex-col md:min-h-0" : "hidden"}` (o `min-h` cobre a tela abaixo de `md`, onde o `<main>` não é flex), `inert` por propriedade quando `!visible`, `aria-hidden`; iframe `className="h-full w-full flex-1 border-0 bg-transparent"`, `title="Bloquim"`, `style={{ colorScheme: frameTheme }}`, `tabIndex={visible ? 0 : -1}`; overlay com `<Spinner />` enquanto `visible && !ready && !failed`; `failed` = `load` do iframe disparou e `READY_TIMEOUT_MS` sem `ready` → mensagem "não foi possível carregar o Bloquim" + `<a target="_blank" rel="noreferrer" href={fallbackBloquimHref(...)}>abrir no Bloquim</a>`.
  - Páginas: `tarefas/page.tsx` — `const { client, isPublic } = await loadPageContextNoPeriod(slug); if (isPublic || !client.bloquimWorkspaceId) notFound(); return null;`. `planos/[mapId]/page.tsx` — idem + `const maps = await workspaceMaps(ws, await getRawCookieHeader(), await resolveIsAdmin(ws, cookie)).catch(() => null); if (!maps || !maps.some(m => m.id === mapId)) notFound(); return null;` (`export const dynamic = "force-dynamic"` nas duas).
  - Layout: `<main …>{children}{workspaceId && <BloquimEmbedHost slug={slug} workspaceId={workspaceId} bloquimOrigin={bloquimAppOrigin()} />}</main>` (só no ramo autenticado — o público já retornou antes).

- [ ] **Step 1: Check** (`bloquim-embed-host.check.ts`):

```ts
assert.strictEqual(nextFrameTheme("dark", "light", true), "dark");
assert.strictEqual(nextFrameTheme("dark", "light", false), "light");
assert.deepStrictEqual(initialSrcRoute(null), { kind: "tasks" });
assert.deepStrictEqual(initialSrcRoute({ kind: "map", mapId: MAP }), { kind: "map", mapId: MAP });
assert.strictEqual(READY_TIMEOUT_MS, 10_000);
assert.strictEqual(fallbackBloquimHref(BLOQUIM, WS, { kind: "map", mapId: MAP }), `${BLOQUIM}/workspaces/${WS}/maps/${MAP}`);
assert.strictEqual(fallbackBloquimHref(`${BLOQUIM}/`, WS, { kind: "tasks" }), `${BLOQUIM}/workspaces/${WS}`);
console.log("bloquim-embed-host: ok");
```

- [ ] **Step 2: Registrar e rodar** → FAIL. **Step 3: Implementar** o módulo puro → ok.
- [ ] **Step 4: Implementar `BloquimEmbedHost`, as duas páginas e o wiring do layout** conforme Interfaces.
- [ ] **Step 5: `npx tsc --noEmit`** e `pnpm build` → OK. Confirmar com `pnpm check:task-embed-bridge check:right-sidebar check:bloquim-proxy check:hover-rail check:bloquim-embed-host` (todos ok).
- [ ] **Step 6: Verificação local do que dá** (o embed real só em prod — CSP): `/[slug]/tarefas` renderiza header + barras + spinner e, após 10 s, a mensagem com link "abrir no Bloquim" apontando para `https://bloquim.beeads.com.br/workspaces/<ws>` (o iframe local é bloqueado pelo CSP de prod, é o esperado); `/[slug]/planos/<id inexistente>` → 404; `/[slug]/planos/<id real>` → 200; `/[slug]/planos` → 404; o host fica `hidden`+`inert` em `/[slug]/meta-ads` depois de ter sido aberto; mudar o tema com `/tarefas` aberto não troca o `src` (inspecionar no DOM), e troca depois de ir pra outra página.
- [ ] **Step 7: Commit** — `feat(embed): host único do Bloquim no layout + páginas /tarefas e /planos/[mapId]`.

---

### Task 11: Revisão Codex da branch inteira, docs do painel e memória

**Files:**
- Modify: `CLAUDE.md` (raiz do painel: linha da feature **#47** na tabela da §1; §6 "Chrome de página" ganha a exceção das páginas embutidas sem `PageHeading`)
- Create: `C:\Users\gusta\.claude\projects\c--Users-gusta-Projetos-beeads-central-de-dados\memory\barra-direita-tarefas-planos-bloquim.md` (+ linha em `MEMORY.md`)

- [ ] **Step 1: Revisão Codex** (`codex:rescue`) do diff `master..feat/barra-direita-bloquim` do painel e `master..feat/embed-workspace-tasks-and-maps` do Bloquim, com a spec como contexto; corrigir o que for confirmado (commits próprios).
- [ ] **Step 2: Linha #47 no `CLAUDE.md`** (formato das vizinhas: nome · camada · onde vive · os bug-traps: histórico compartilhado ⇒ `replace`; chip de plano relança ao pai; `returnUrl` só da allowlist; host único e tema congelado; `.anon` nos nomes; só admin cria/oculta/exclui — paridade com a tela, não com a API; ordem de deploy). Memória com o mesmo conteúdo em forma curta + "o que ficou sem smoke".
- [ ] **Step 3: Commit** — `docs: feature 47 (barra direita com tarefas e planos do Bloquim)`.

---

### Task 12: Deploy em ordem e smoke em prod

- [ ] **Step 1 (gate humano): Gustavo mergeia o PR do Bloquim.** Esperar `running:healthy` do app `mindtask-app` no Coolify.
- [ ] **Step 2: Confirmar o CSP das rotas novas**

Run: `curl -sI https://bloquim.beeads.com.br/embed/workspaces/x/tasks | grep -i content-security-policy`
Expected: `frame-ancestors 'self' https://painel.beeads.com.br`.

- [ ] **Step 3: Merge do painel em `master` e push** (`git checkout master && git merge --ff-only feat/barra-direita-bloquim && git push origin master`); acompanhar o deploy `huee78sf2zl6e062pia0ywhg` até `running:healthy`.
- [ ] **Step 4: Smoke em prod** (Playwright headless com cookie de sessão, workspace `beeads`; o projeto já tem o padrão — ver memória `notas-workspace`), gravando o resultado item a item:
  1. hover expande e recolhe as duas barras; `main.getBoundingClientRect().width` igual antes e durante;
  2. Tab até o 1º item da esquerda expande; `→` liga o teclado e a barra fica aberta; Esc recolhe;
  3. `/beeads/tarefas` — spinner some, lista com pílulas de status; criar tarefa "smoke 47" e vê-la na lista; abrir e fechar; a badge de Tarefas sobe sem F5;
  4. clicar no chip de plano de uma tarefa com plano abre `/beeads/planos/<id>` sem remontar o iframe (mesmo `contentWindow` antes/depois);
  5. no canvas: criar um card, abrir com `?cardId=`, apagar; "voltar" do navegador leva à página anterior do painel, não a um estado do iframe;
  6. "novo plano" → cria e navega; "ocultar" → some da lista e aparece em "ver mais"; "reexibir"; "excluir" com confirmação;
  7. membro não-admin (conta de teste): sem ver mais / novo plano / olho / lixeira; `POST …/plans` → 403;
  8. trocar tema com `/tarefas` aberto não recarrega o iframe; navegar pra `/beeads` e voltar aplica o tema;
  9. `?share=` (público): sem barra direita; `/tarefas` → 404;
  10. apagar a tarefa "smoke 47" e o plano de teste.
- [ ] **Step 5: Registrar** no `CLAUDE.md` (#47) e na memória o resultado do smoke (o que passou, o que ficou sem verificar).
