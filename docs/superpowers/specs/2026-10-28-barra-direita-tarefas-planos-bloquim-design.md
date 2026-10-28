# Barra lateral direita: tarefas e planos de ação do Bloquim dentro do painel

**Data:** 2026-10-28 · **Status:** rascunho para aprovação · **Repos:** `beeads-central-de-dados` (painel) e `beeads-bloquim` (Bloquim)

Mockup aprovado em 2026-10-28 (companion visual: `.superpowers/brainstorm/70961-1793186068/content/layout-barras.html`).

---

## 1. Intenção e porquê

O painel (BCD) é onde a equipe olha os dados do cliente; o Bloquim é onde ela gerencia as tarefas e os planos de ação do mesmo cliente. Hoje os dois vivem em abas diferentes, e a única ponte é o botão "nova tarefa" do header (feature #37), que embute o modal de tarefa do Bloquim num iframe.

O pedido é trazer a **gestão de tarefas e planos para dentro do painel**: uma barra lateral **direita**, análoga à esquerda, com o item **Tarefas** (a lista de tarefas do workspace, com as mesmas funções do Bloquim) e a **lista de planos de ação ativos** (clicar abre o mapa do plano, com todas as funções do canvas). Ao abrir tarefas ou um plano, o header e as duas barras **ficam** — só o conteúdo central troca.

O critério de sucesso dado pelo Gustavo é **paridade funcional com a UI do Bloquim**: criar, editar e gerenciar tarefas e planos; todas as funções do mapa; os filtros da lista de tarefas. Isso fecha a decisão de arquitetura: **as telas são as do próprio Bloquim, embutidas por iframe** (o mesmo mecanismo do `/embed/task`), nunca copiadas. Copiar `TaskTable`/`WeekCalendar`/`TaskDetailModal`/o canvas ReactFlow congelaria a cópia no dia seguinte.

Junto veio uma mudança de comportamento das barras: **as duas ficam recolhidas (só ícones) e expandem ao passar o mouse**. O botão de expandir/recolher da barra esquerda **sai**.

## 2. Objetivos, não-objetivos, anti-objetivos

**Objetivos**
- Barra direita fixa em desktop, com Tarefas (+ contagem de abertas), planos ativos, "ver mais" (planos ocultos) e "novo plano".
- Página `/[slug]/tarefas` = lista de tarefas do workspace do Bloquim, idêntica à aba "tarefas" do workspace no Bloquim (criar, filtros de status/janela/responsável, lista × calendário, abrir/editar tarefa, duplicar, aprovações, anexos…).
- Página `/[slug]/planos/[mapId]` = canvas do plano, idêntico ao do Bloquim (cards, conexões, formas, textos, modelos de plano, comentários, modal de card…).
- Header + barra esquerda + barra direita permanecem nas duas páginas; o iframe ocupa o `<main>` inteiro.
- As duas barras recolhidas por padrão, expansão por hover (e por foco de teclado), flutuando por cima do conteúdo.
- Gerenciar planos a partir da barra: criar, ocultar/reexibir, excluir (admin, como no Bloquim).

**Não-objetivos (v1)**
- Mobile: a barra direita não existe abaixo de `md`, como o header. As rotas novas funcionam se digitadas, só sem o atalho.
- Modo teclado (setas/Enter) da `SidebarNav` na barra direita.
- Refletir na URL do painel a tarefa aberta dentro do iframe (`?task=`).
- Busca global de tarefas (`GlobalTaskSearch`), "minhas tarefas" (cross-workspace), abas dashboard/membros do workspace do Bloquim.
- Plano "concluído": o Bloquim não tem esse conceito (`maps.hidden` é o único estado). **"Ver mais" mostra só os ocultos** — aprovado no mockup.
- Modo anônimo dentro do iframe (limitação já documentada da feature #37).

**Anti-objetivos (o que faria isso falhar mesmo funcionando)**
- Duas implementações da mesma tela (uma no Bloquim, outra no painel) que divergem.
- Hover que empurra o conteúdo: gráficos e tabelas re-renderizando a cada passada de mouse.
- O botão "voltar" do navegador andando dentro do iframe em vez de no painel (o histórico de sessão é compartilhado entre pai e iframe).
- Link dentro do iframe que leva o iframe para uma rota do Bloquim fora de `/embed/*` (vira o Bloquim inteiro, com sidebar e tudo, dentro do painel — a armadilha do `ApprovalTaskView` já conhecida).

## 3. Restrições

- **Iframe cross-subdomínio, same-site**: `painel.beeads.com.br` embute `bloquim.beeads.com.br`. O cookie SSO `__beeads_session` (`Domain=.beeads.com.br`, `SameSite=Lax`) é enviado em requests same-site, então a API do Bloquim autentica dentro do iframe sem nada novo. Já é assim no `/embed/task`.
- **CSP do Bloquim**: só `location ^~ /embed/` libera `frame-ancestors` para o painel (nginx com `rewrite ^ /index.html break;` — `try_files` NÃO serve, reentra em `location /` e aplica `X-Frame-Options: SAMEORIGIN`). As rotas novas ficam sob `/embed/`, **sem mudança de nginx**.
- **Dev local não exercita o embed** (CSP só libera o painel de prod; `allowedParentOrigins` aceita `http://localhost:3001` só no dev server do Vite). Verificação real é em prod, depois do deploy — como na feature #37.
- **Histórico compartilhado**: toda navegação do wouter dentro do iframe que fizer `push` entra no histórico do navegador do usuário.
- **Hidden maps só para admin**: `GET /api/workspaces/:id/maps?showHidden=true` devolve ocultos apenas quando o papel do usuário é admin (`routes/maps.ts`). Criar exige admin/editor; ocultar e excluir exigem admin.
- **Bug-traps do iframe** herdados da feature #37 e obrigatórios aqui: `inert` por propriedade do DOM (React 19 canary no App Router); `style={{ colorScheme }}` do `<iframe>` igual ao `forcedTheme` do documento embutido; tema congelado enquanto a tela está em uso; `ready` chegando de novo (recarga por crash do ErrorBoundary) tratado sem reenviar comandos.
- **Bloquim**: sempre feature branch; nunca commit/merge em `master` sem pedido explícito; deploy sai do `master` por webhook do Coolify. O `pnpm typecheck` do `mindtask-app` é falso-verde (TS6306) e o baseline tem ~71 erros — gate é **relativo** (nenhum erro novo), medido com `npx tsc -p tsconfig.json --noEmit` antes e depois.
- **Painel**: push em `master` deploya. `pnpm build` (web) + `tsc --noEmit` + checks antes de pushar. `docs/superpowers/` é gitignored — esta spec vive aqui, não no git.
- **Ordem de deploy**: Bloquim primeiro, painel depois. Com o painel na frente, o iframe carregaria uma rota que o Bloquim ainda não tem (o SPA fallback serve `index.html` e o wouter cai no "não encontrado").

## 4. O desenho — o que foi decidido

### 4.1 As barras (painel)

**Trilho de 64px com só ícones, nas duas laterais.** Ao passar o mouse sobre o trilho (ou ao focar um elemento dentro dele com o teclado), o painel da barra expande para 288px (`w-72` do DS) **por cima** do `<main>`, com sombra, e volta a recolher quando o mouse sai (pequeno atraso de ~150ms para não piscar ao cruzar a borda). O conteúdo central nunca se move.

Mecanismo: um wrapper de largura fixa (`w-16`, `relative`) que reserva o espaço no flex do layout, e o `Sidebar` do DS posicionado `absolute inset-y-0` dentro dele, controlado por `SidebarProvider collapsed={!expanded} collapsible={false}` (modo controlado do provider; o `persist`/`storageKey` atuais saem — a chave `painel_sidebar_collapsed` fica órfã no `localStorage`, inofensiva). O DS já troca `w-16`/`w-72` e esconde rótulos pelo `collapsed`; o painel só decide **quando** expandir. A lógica de hover/foco é UM hook/wrapper compartilhado pelas duas barras (`components/HoverRail.tsx`, prop `side`), para elas não divergirem.

**Barra esquerda** (`AppSidebar`): o botão de recolher (`PanelLeftClose/Open` em `SidebarControls`) **sai**. Tema e modo anônimo continuam no rodapé. Nav, teclado, `MobileChrome` (drawer abaixo de `md`) e `PublicShell` (modo público) ficam como estão. Com o **modo teclado** da `SidebarNav` ligado (setas percorrendo o menu), a barra fica expandida enquanto o modo durar — senão o usuário navega entre ícones sem rótulo. A `SidebarNav` já está dentro do provider e usa `useSidebar().setCollapsed(false/true)` ao ligar/desligar o modo; o `AppSidebar` recebe isso pelo `onCollapsedChange` do provider controlado e compõe: `expanded = hover || focusWithin || tecladoLigado`.

**Barra direita** (`AppRightSidebar`, nova): desktop-only (`hidden md:flex`), montada no layout de `[slug]` só quando `client.bloquimWorkspaceId` existe e **não** no modo público. Reusa `Sidebar`/`SidebarBody`/`SidebarNavItem`/`SidebarSectionLabel` do DS (borda à esquerda em vez de à direita via `className`; o `cn` do DS é tailwind-merge). Conteúdo, de cima para baixo:

1. **Tarefas** — ícone `ListChecks`, rótulo "Tarefas", badge com a contagem de tarefas abertas do workspace (`draft + pending + in_progress`, a mesma definição de `workspaceOpenTasks`, lida de `GET /api/workspaces/:id/tasks/counts`). Recolhido, o DS mostra a badge como bolha sobre o ícone. Ativo em `/[slug]/tarefas` e em qualquer sub-rota dela.
2. Rótulo de seção **"planos de ação"** (some no recolhido, como o DS faz).
3. **Planos ativos** (`hidden=false`), em ordem alfabética de nome (estável e varrível; o Bloquim devolve em ordem de inserção). Ícone = inicial do nome num quadrado arredondado (o Bloquim não tem ícone/cor por plano). Ativo quando a rota é `/[slug]/planos/<id>` (comparação exata, nunca prefixo — `/planos/1` casaria `/planos/12`). No hover do item expandido, para **admin**: ação "ocultar" (olho) e "excluir" (lixeira, com confirmação por `AlertDialog`).
4. **ver mais** — chevron; só existe quando há planos ocultos a mostrar (ou seja, só para admin, porque a API não devolve ocultos a outros papéis). Clicar alterna a lista dos ocultos logo abaixo (chip "oculto", tom `muted`), com a ação "reexibir" no hover. Estado em React (reseta ao trocar de workspace).
5. Rodapé: **novo plano** (`Plus`) — pede o nome num `Dialog` do DS, cria e navega para o plano novo. **Só admin**: a API aceita editor (`POST /maps` com `["admin","editor"]`), mas a tela do Bloquim (`detail.tsx`, botão "Novo Plano" sob `isAdmin`) esconde de editor, e o critério aqui é paridade com a tela. Consequência prática: a barra só precisa de `resolveIsAdmin`, que já existe — nenhum papel novo a trafegar.

Nomes de plano recebem a classe `.anon` (modo anônimo embaça; é texto identificável como o nome de número de WhatsApp), e o `title` do item vira genérico no modo anônimo, pelo mesmo motivo da `SidebarNav`.

**Dados da barra**: o layout de `[slug]` monta uma promessa `getRightSidebarData(workspaceId, cookie, isAdmin)` → `{ plans, hiddenPlans | null, openTasks }` (duas chamadas ao Bloquim em paralelo: `maps[?showHidden=true]` e `tasks/counts`) e a entrega por **streaming** (`Suspense`, mesmo padrão do `HeaderFleetRowLoaded`): a barra aparece na hora com "Tarefas" e um esqueleto na seção de planos, e completa quando a promessa resolve. Não entra na cadeia serial da página. Falha do Bloquim degrada em silêncio (barra só com Tarefas sem badge).

**Atualização sem F5**: a barra é client component e sabe refazer a própria leitura por `GET /api/bloquim/[slug]/sidebar` (proxy abaixo). Refaz quando: o iframe avisa `changed` (ver protocolo), uma ação da própria barra conclui (criar/ocultar/excluir), ou a janela recupera o foco. Nada de `router.refresh()` para isso — ele re-renderiza o layout inteiro (linha da frota do header incluída).

### 4.2 As páginas (painel)

- `app/[slug]/tarefas/page.tsx` e `app/[slug]/planos/[mapId]/page.tsx`. Server components com `loadPageContextNoPeriod(slug)`; `notFound()` no modo público, sem `bloquimWorkspaceId`, e (na de plano) se o `mapId` não estiver na lista de planos que o usuário enxerga — isso cobre plano de outro workspace e plano oculto para não-admin com um só teste. `/[slug]/planos` sem id = 404.
- Sem `PageHeading` nem `PeriodCard`: o conteúdo é o do Bloquim, e a barra direita acesa diz onde se está. (Minha escolha — a §6 do CLAUDE.md pede `PageHeading` em página de cliente, e aqui a tela é chrome-less de propósito.)
- Continuam **rotas de dashboard** para `header-nav.ts` (header completo, com linha da frota): o pedido é "menus laterais e superior mantidos", e o header enxuto das rotas de configuração esconderia justamente a linha do workspace.
- **Um iframe só, vivo no layout** (`BloquimEmbedHost`, client component montado dentro do `<main>` ao lado de `{children}`, só quando há `bloquimWorkspaceId` e fora do modo público). As páginas `/tarefas` e `/planos/[mapId]` fazem a validação no servidor e **não desenham nada** — o host olha o `pathname` e se mostra (preenchendo o `<main>`, `flex-1 min-h-0`; o `<main>` já é `md:flex md:flex-col`) quando a rota é de embed, e se esconde (`hidden` + `inert` por propriedade) nas outras. Motivo, medido em prod em 2026-10-28: o Bloquim é um bundle único de 2,26 MB (~805 KB comprimidos, `immutable` por 1 ano) sem split por rota; remontar o iframe a cada troca tarefas ↔ plano re-executaria tudo isso (0,3–0,6 s) mais as chamadas de API. Com um host só, trocar de tela é uma mensagem `navigate` ao filho, e o bundle executa uma vez por workspace.
- **A URL do painel é a única fonte de verdade.** O filho nunca navega sozinho entre telas: quando o usuário clica num link que trocaria de tela, ele posta `navigate` ao pai; o pai faz `router.push`; o host reage à mudança de `pathname` e manda `navigate {path}` ao filho, que só então troca de rota (com `replace`). Sem loop: o filho só anda por comando. No carregamento inicial, o `src` do iframe já é a rota de embed da página atual (`?theme=`); mudanças seguintes vão por mensagem.
- **Pré-montagem no hover**: passar o mouse (ou focar) um item da barra direita monta o host escondido se ainda não existir — o mesmo truque do `TaskEmbedLauncher` no "+" do header. Ao clicar, o bundle já está executado.
- Spinner do DS por cima até o `ready`; se o `load` do iframe acontecer e o `ready` não chegar em 10s, mensagem "não foi possível carregar o Bloquim" com link para abrir a mesma tela no Bloquim em nova aba. Troca de tema do painel com a tela embutida visível **não remonta** o iframe (perderia a edição em curso): o tema novo é adotado só quando o host estiver escondido (mesma regra de congelamento do modal de tarefa). O host vive enquanto o usuário estiver no workspace; o layout de `[slug]` remonta ao trocar de cliente, e o host junto.
- Trocar de plano pela barra (`/planos/A` → `/planos/B`) é `navigate` ao filho, não remontagem.

### 4.3 As rotas de embed (Bloquim)

Três rotas novas no `App.tsx`, todas sob `/embed/` (CSP e `forcedTheme` já cobrem):

| Rota | Renderiza |
|---|---|
| `/embed/workspaces/:wsId/tasks` | `WorkspaceTasksPanel` (a aba "tarefas" do workspace), sem `AppLayout` |
| `/embed/workspaces/:wsId/tasks/:taskId` | idem, com a tarefa aberta (deep link, como `/workspaces/:wsId/tasks/:taskId`) |
| `/embed/workspaces/:wsId/maps/:mapId` | `CanvasInner` dentro de `ReactFlowProvider`, sem `AppLayout`; `?cardId=` abre o card como hoje |

**Extração, não cópia.** A aba "tarefas" de `pages/workspaces/detail.tsx` (o `TabsContent value="tasks"`, hoje linhas ~727–860, mais o estado, as queries, `openTaskItem`, os handlers de fechar e os dois `TaskDetailModal` do fim do arquivo) vira o componente `WorkspaceTasksPanel`, e a página do workspace passa a renderizá-lo dentro da aba — **mesmo componente nos dois lugares**, sem mudança de comportamento no Bloquim. Idem para o canvas: `CanvasInner` ganha o modo embutido por prop; `CanvasPage` (rota normal) segue igual e `EmbedCanvasPage` é só outro invólucro.

**Modo embutido** (`embedded: true`, derivado de `isEmbedPath(location)` ou passado por prop — o builder escolhe; um helper `workspaceRouteBase(workspaceId)` em `lib/embedBridge.ts` devolve `/embed/workspaces/:id` ou `/workspaces/:id` e é a única fonte de prefixo):

- Toda navegação **dentro da mesma tela** que hoje faz `navigate(...)` (abrir tarefa por deep link, `?cardId=`, `onAutoCreated`/`onDuplicated`, fechar modal, `ApprovalTaskView.handleOpenParent` com seu `APP_BASE`) usa o prefixo do helper **e `{ replace: true }`** — o iframe nunca acrescenta entrada ao histórico; o "voltar" do navegador é sempre do painel. Fora do embed, nada muda. Navegação **entre telas** (da lista para um plano, do plano para a lista) nunca é feita pelo filho: ele posta `navigate` ao pai e espera o comando de volta (§4.2 e §4.4).
- O que levaria o iframe para fora de `/embed/*` é **removido ou relançado ao pai**: o botão de voltar e os links do breadcrumb do canvas somem (o breadcrumb fica como rótulo simples, "workspace › plano", para orientar); o chip de nome do plano em `TaskListItem` (`showMapName`, link para `/workspaces/:ws/maps/:map`) vira um botão que posta `navigate {target:"map", mapId}`; o chip de workspace (`/workspaces/:ws`), se renderizado, posta `navigate {target:"tasks"}`. Um teste no Bloquim (grep por `href="/workspaces` e `navigate(` nos componentes que o embed usa) protege a regra.
- Sem redirect para `/login`: as páginas de embed não passam pelo `useGetMe` do `AppLayout`. Se a API responder 401, a página mostra "sua sessão do Bloquim expirou" com um link `target="_top"` para o login do Bloquim com `return_url` = a URL do painel que o pai mandou no `init`.
- `html.embed-transparent` como no `/embed/task` (o fundo do painel aparece atrás; o canvas tem o próprio fundo pontilhado). Altura: o conteúdo ocupa `100dvh` do iframe com rolagem interna (a aba de tarefas já é `flex-1 overflow-auto`).

### 4.4 Protocolo postMessage

Extensão do contrato espelhado `embedBridge.ts` (Bloquim) ↔ `task-embed-bridge.ts` (painel). `open`/`closed` do `/embed/task` ficam intocados. Mesmas fixtures nos dois testes; mudar um lado exige mudar o outro.

| Sentido | Mensagem | Quando |
|---|---|---|
| filho → pai | `{source:"bloquim-embed", type:"ready"}` | ao montar (já existe); o pai tira o spinner e responde `init` |
| pai → filho | `{source:"bcd-panel", type:"init", returnUrl}` | resposta ao `ready`; `returnUrl` é a URL atual do painel (para o link de login). Workspace/plano/tarefa vêm da URL do iframe, não da mensagem |
| pai → filho | `{source:"bcd-panel", type:"navigate", path}` | o `pathname` do painel mudou para outra rota de embed; `path` é a rota de embed correspondente (`/embed/workspaces/:ws/tasks` ou `/embed/workspaces/:ws/maps/:id`). O filho valida que `path` começa com `/embed/` e navega com `replace` |
| filho → pai | `{source:"bloquim-embed", type:"navigate", target:"tasks"}` / `{…, target:"map", mapId}` | clique em algo que, no Bloquim, sairia da tela; o pai faz `router.push` para `/[slug]/tarefas` ou `/[slug]/planos/[mapId]` |
| filho → pai | `{source:"bloquim-embed", type:"changed", what:"plans" \| "tasks"}` | depois de criar/renomear/ocultar/excluir plano, ou de fechar o modal de tarefa / mudar status; o pai refaz a leitura da barra direita |

Validação como hoje: origem na allowlist, `source` e shape exatos, senão `null` e descarte em silêncio. O filho só posta para a origem do pai que aprendeu no primeiro `init` (antes disso, anuncia `ready` a cada origem permitida, como o `/embed/task` faz).

### 4.5 Proxies no painel

Route handlers em `app/api/bloquim/[slug]/…`, todos com cookie de sessão + `userCanAccessSlug` (nunca share token), repassando o cookie ao Bloquim. O Bloquim segue sendo a autoridade de papel (admin/editor) — o painel só esconde botões, não decide permissão.

| Rota | Faz |
|---|---|
| `GET …/sidebar` | `{ plans, hiddenPlans \| null, openTasks }` — a mesma leitura do layout |
| `POST …/plans` `{name}` | `POST /api/workspaces/:id/maps` → `{ id }` |
| `PATCH …/plans/[mapId]` `{hidden}` | `PATCH /api/workspaces/:id/maps/:mapId/hidden` |
| `DELETE …/plans/[mapId]` | `DELETE /api/workspaces/:id/maps/:mapId` |

Em `lib/bloquim-client.ts`: `workspaceMaps`, `workspaceTaskCounts`, `createWorkspaceMap`, `setWorkspaceMapHidden`, `deleteWorkspaceMap` (ao lado de `workspaceOpenTasks`/`createBloquimMeeting`; o `bloquimGet` ganha irmãos `bloquimSend` para POST/PATCH/DELETE, ou o builder generaliza o que `createBloquimMeeting` já faz). Erros do Bloquim viram o status equivalente (401 → 401, 403 → 403, 404 → 404, resto 502 com mensagem curta) — a mensagem interna do Bloquim não chega ao usuário.

## 5. Verificação

- **Painel**: checks puros novos `check:right-sidebar` (`lib/right-sidebar.ts`: ordem dos planos, item ativo com a armadilha de prefixo, soma de abertas, quando "ver mais" existe) e `check:hover-rail` se houver lógica pura de expansão (composição hover/foco/teclado); `check:task-embed-bridge` ampliado com as fixtures novas; `tsc --noEmit`; `pnpm build`. Asserção de que `AppSidebar.tsx` não importa mais `PanelLeftClose`/`PanelLeftOpen`.
- **Bloquim**: `embedBridge.test.ts` com as mesmas fixtures; teste de `workspaceRouteBase`; teste que varre os componentes usados pelo embed procurando link/navigate para `/workspaces` sem o helper; `vitest run`; typecheck relativo (contagem de erros antes = depois).
- **Smoke em prod** (Playwright headless, usuário logado, workspace interno `beeads`), nesta ordem depois dos dois deploys: hover expande e recolhe as duas barras sem mover o conteúdo; foco por Tab expande; `/tarefas` carrega a lista com os filtros e cria uma tarefa; abrir a tarefa e fechar; `/planos/<id>` carrega o canvas, cria e apaga um card; "novo plano" cria e navega; ocultar → aparece em "ver mais" → reexibir; "voltar" do navegador sai da página do painel (não anda dentro do iframe); link do plano na lista de tarefas abre a página de plano do painel; 401 simulado mostra a mensagem com link `_top`.
- **Revisão**: Codex (`codex:rescue`) revisa o diff dos dois repos antes do deploy, conforme o pedido ("implementação com opus, revisão com codex").

## 6. Entrega

- Bloquim: branch `feat/embed-workspace-tasks-and-maps` → PR; merge em `master` é gate humano (Gustavo). Deploy sai do `master` por webhook.
- Painel: branch de feature, merge em `master` (push deploya) **depois** do Bloquim estar no ar. Confirmar com `curl -I https://bloquim.beeads.com.br/embed/workspaces/x/tasks` que o `Content-Security-Policy: frame-ancestors` vem com o painel.
- Documentar: linha da feature no `CLAUDE.md` do painel (#47) e o contrato ampliado no `CLAUDE.md` do Bloquim (seção do embed), além da memória do projeto.

## 7. O que fica com o builder

- O corte exato da extração de `WorkspaceTasksPanel` e do modo embutido de `CanvasInner` (o contrato é: mesmo componente dentro e fora do embed; prefixo de rota só pelo helper).
- Timings e classes da expansão (transição, atraso de recolher, sombra, `z-index` — abaixo dos overlays do DS em `z-50`, acima do `<main>`).
- Esqueleto da seção de planos enquanto a promessa não resolve; ícone e tom dos chips.
- Forma do `BloquimEmbedHost` (como ele preenche o `<main>` enquanto a página não desenha nada; como detecta "rota de embed" a partir do `pathname` sem duplicar a lista de rotas) e do hook de hover compartilhado.
- Se o helper de prefixo entra no `embedBridge.ts` ou num `lib/routes.ts` próprio.

## 8. Decisões tomadas por mim (conferir ao ler)

1. Expansão **flutua por cima** do conteúdo (mockup aprovado) em vez de empurrar.
2. "Ver mais" = **só planos ocultos** (mockup aprovado); sem derivar "concluído".
3. Navegação interna do embed sempre com **`replace`** — o "voltar" do navegador pertence ao painel.
4. Planos em **ordem alfabética**; ícone = inicial do nome.
5. Badge de Tarefas = `draft + pending + in_progress` (igual a `workspaceOpenTasks`).
6. Páginas novas **sem `PageHeading`** e tratadas como **rotas de dashboard** (header completo).
7. Criar/ocultar/excluir plano pela **barra**, via proxies para a API do Bloquim (a UI de MapCard do Bloquim não é embutida — a lista já mora na barra).
8. Barra direita e páginas **fora do modo público** e **fora do mobile**.
9. Dados da barra por **streaming** no layout + **refetch por mensagem** (sem `router.refresh()`).
10. Modo teclado da `SidebarNav` **mantém a barra esquerda expandida**.
11. Troca de tema com a tela embutida aberta **não remonta** o iframe.
12. "Novo plano", ocultar e excluir são **só admin** — paridade com a tela do Bloquim, não com a API (que aceita editor em criar e excluir). Levantado pela checagem do builder; resolvido pelo critério da própria spec.
13. **Um iframe só, no layout**, trocando de tela por mensagem, e **pré-montado no hover** da barra direita — resposta à pergunta do Gustavo sobre performance (bundle único de ~805 KB comprimidos, sem split por rota).
14. A **URL do painel é a fonte de verdade** da tela embutida; o filho só troca de tela por comando do pai.

## 9. Se um dia o Bloquim for descontinuado

Pergunta do Gustavo em 2026-10-28, e a aprovação foi condicionada à resposta. O que este desenho deixa pronto e o que não resolve:

- **Fica e se reaproveita**: barra direita, rotas `/tarefas` e `/planos/[mapId]`, validação no servidor, proxies, leitura da barra. Hoje elas embutem; amanhã renderizariam componentes locais no lugar do host. E a extração feita no Bloquim (`WorkspaceTasksPanel`, `CanvasInner` com prefixo de rota por helper) é justamente o recorte que se levantaria para o painel — mesmo `@beeads/ui`, mesmos tokens.
- **Se descarta**: `BloquimEmbedHost`, o protocolo postMessage e as rotas `/embed/*`.
- **O que o iframe não resolve, e nenhum desenho de tela resolveria**: tarefas, planos, cards, aprovações, anexos, recorrência e modelos vivem no banco e na API Express do Bloquim, e o Bloquim é o provedor de identidade do SSO (`__beeads_session`, `/api/auth/me/*`). Descontinuá-lo é migrar esse backend e a autenticação. A UI é a parte menor desse trabalho.
- **Regra para manter a saída aberta**: nada do lado do painel pode depender de o conteúdo ser um iframe além do próprio host — a barra, as páginas e os proxies falam com a API do Bloquim, nunca com a janela embutida.
