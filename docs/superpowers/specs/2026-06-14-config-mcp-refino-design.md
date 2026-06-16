# Refino da página de configuração do MCP (conectar Claude ↔ Bloquim)

**Data:** 2026-06-14
**Status:** design aprovado · Componente B já implementado e verde · falta Componente A
**Repos afetados:** `beeads-bloquim` (frontend) + `bloquim-mcp` (prompt — **feito**)

> **Nota de revisão:** revisão automática via Codex foi tentada mas o job travou ao
> compor o veredito final (sem problemas concretos levantados nos logs interinos —
> confirmou que `tutorial.ts` existe, o contrato bate e o `Collapsible` aceita
> `defaultOpen`). Esta spec foi reconciliada por self-review com o estado real do código.

## Problema

A página `/settings/mcp` ([repo/artifacts/mindtask-app/src/pages/settings/mcp.tsx](../../../artifacts/mindtask-app/src/pages/settings/mcp.tsx))
existe e está acessível (rota em `App.tsx`, item "mcp" no menu de settings do
`AppLayout`), mas falha em guiar um usuário leigo do "quero usar" ao "estou usando".

Problemas identificados na auditoria de UX (ordenados por impacto):

1. **Inversão de prioridade.** O passo-a-passo de conexão — o conteúdo mais
   importante — vive num `Collapsible` **fechado por default**. A lista de 35 tools
   (ruído para o leigo) ocupa o espaço nobre.
2. **Sem "comece por aqui".** Zero frases-gatilho. O usuário conecta e fica sem saber
   o primeiro prompt.
3. **Captura proativa invisível.** O diferencial do produto (o agente oferece registrar
   tarefas sozinho) não é mencionado.
4. **Sem CTA para a skill.** `github.com/gucancado/bloquim-skill` (o que faz o agente
   operar bem) está ausente.
5. **Passos de conexão incompletos.** Faltam: pré-requisito (conta Bloquim), o que
   esperar no OAuth, e **como confirmar que funcionou**.
6. **Sem troubleshooting.** Conector não aparece, OAuth falha, re-link para limpar cache
   de tool description.
7. **Bug: estado `copied` compartilhado.** Um único `copied` para os dois botões de
   copiar — clicar um mostra "copiado" em ambos ([mcp.tsx:49](../../../artifacts/mindtask-app/src/pages/settings/mcp.tsx)).

No lado do MCP: o servidor expõe 3 prompts (`capturar_tarefa`,
`extrair_tarefas_de_reuniao`, `revisao_minhas_tarefas`), nenhum de onboarding/ajuda.

## Decisões (do brainstorming)

| Tema | Decisão |
|---|---|
| Posicionamento | **Claude-first** com seção expansível "outros clientes" (Cursor, Claude Code CLI). |
| Lista de 35 tools | **Demover** para `Collapsible` fechado, no fim da página. |
| Prompt `tutorial` no MCP | **Adicionar** (prompt L2 `tutorial`). A página cita `/tutorial` como passo pós-conexão. |
| CTA da skill | **Proeminente** (card destacado), mas com nota de que o MCP sozinho já funciona. |
| Estrutura da página | 8 blocos, getting-started no topo, tools no fim (aprovada via mockup). |

## Fonte de verdade

O que o usuário consegue fazer = a skill `bloquim` (`~/.claude/skills/bloquim/`,
publicada em `github.com/gucancado/bloquim-skill`):
- `SKILL.md` — mapa das tools, convenções, captura proativa.
- `USE-CASES.md` — frases-gatilho e roteiro de onboarding (origem do "comece por aqui").
- `README.md` — passos de conexão e nota de cache do conector.

A política de captura proativa é **fonte única** em
[bloquim-mcp/src/guidance/capture-policy.ts](../../../../bloquim-mcp/src/guidance/capture-policy.ts)
(`CAPTURE_POLICY`), injetada no handshake via `instructions`. Nada é duplicado: a página
parafraseia em 1 callout; o prompt `tutorial` **importa** `CAPTURE_POLICY`.

URL canônica do servidor MCP: `https://mcp.bloquim.beeads.com.br/mcp`.

---

## Componente A — Rewrite da página `settings/mcp.tsx`

Arquivo único reescrito, mesma escala. Mantém a estética **lowercase** e usa apenas
`@beeads/ui` (`Collapsible`, `Button`, `Skeleton`) + ícones `lucide-react` já em uso.

### Estrutura (8 blocos, topo → base)

1. **Header** — título "conecte o bloquim ao claude" + 1 linha de valor ("gerencie
   tarefas, planos e prazos falando natural — o claude lê e escreve no seu bloquim") +
   URL canônica copiável.
2. **Conectar em 4 passos** — `Collapsible` **`defaultOpen`** (aberto). Passos
   Claude-first (ver "Texto final" abaixo) + caixa de confirmação ("✓ confirme que
   funcionou") + sub-`Collapsible` fechado "outros clientes (Cursor, Claude Code CLI…)".
3. **Comece por aqui** — 3 cards de frase-gatilho, cada um com `CopyButton` próprio.
   Texto do `USE-CASES.md`. Linha "💡 fale natural — não precisa decorar comando."
4. **Callout captura proativa** — 1 frase parafraseando a `CAPTURE_POLICY`.
5. **CTA skill (proeminente)** — card destacado: "turbine o agente (claude code)",
   comando `npx skills add gucancado/bloquim-skill` copiável, botão "abrir no github"
   (link), nota "o mcp sozinho já funciona; a skill é o turbo (claude code / api)".
6. **Se der errado** — `Collapsible` fechado: conector não aparece · login/OAuth falhou ·
   descrições desatualizadas → re-vincular para limpar cache.
7. **Ferramentas (35)** — `Collapsible` **fechado**, no fim. Mantém o fetch de
   `MCP_TOOLS_URL` (`/tools`) + agrupamento por categoria + estados loading/error/empty
   já existentes. Botão de recarregar preservado.
8. **Rodapé** — nota de OAuth existente (acesso autorizado, senha não sai do Bloquim).

### Mudanças de implementação

- **`CopyButton` (novo, local):** pequeno componente com `useState` próprio de `copied`,
  recebendo `value: string`. Substitui o `copied` global e os dois blocos de botão
  duplicados. Reaproveitado em todos os pontos de cópia (URL no header, URL nos passos,
  comando da skill, e cada frase-gatilho). Resolve o bug #7.
- **`CopyableField` (novo, local, opcional):** wrapper `<code> + <CopyButton/>` para os
  campos URL/comando, evitando repetir a marcação.
- Fetch de `/tools` (`fetchTools`, `grouped`, estados) **preservado** sem mudança de
  lógica — só migra para dentro do bloco 7.
- `MCP_ENDPOINT_FALLBACK` mantido como fallback quando o fetch falha.
- Triggers de overlay/colapso seguem o padrão `@beeads/ui` (base-ui), não Radix
  (`render={(props) => <Button {...props}/>}` onde houver trigger com Button).

### Não muda

- Rota (`/settings/mcp`), item de menu, `AppLayout`, breadcrumb.
- Endpoint `/tools` e seu shape (`McpToolsResponse`).

---

## Componente B — Prompt `tutorial` no `bloquim-mcp` — ✅ JÁ IMPLEMENTADO

> **Estado:** implementado em `bloquim-mcp/src/prompts/tutorial.ts` + registrado em
> `index.ts`. `pnpm verify-guidance` passa (15/15, incl. tutorial sem/com tópico).
> **Não re-implementar** — só validar (já validado). As seções do tour são indexadas
> por `topico ∈ {tarefas, planos, reuniao}` (não os exemplos genéricos do esboço
> original abaixo); sem tópico = tour completo + `CONVENCOES` + `CAPTURE_POLICY`.

### Contrato (já codificado no teste)

[bloquim-mcp/scripts/verify-guidance.ts](../../../../bloquim-mcp/scripts/verify-guidance.ts)
**já espera** o 4º prompt (teste pré-escrito = TDD). O contrato exato:

- `PROMPTS.length === 4`, ordem de nomes:
  `capturar_tarefa,extrair_tarefas_de_reuniao,revisao_minhas_tarefas,tutorial`.
- Prompt `tutorial` aceita arg opcional `topico`.
- `getPrompt("tutorial", {})` (sem tópico) → texto inclui `/extrair_tarefas_de_reuniao`
  **e** `Captura proativa`.
- `getPrompt("tutorial", { topico: "reuniao" })` → texto inclui (case-insensitive)
  `reuni`.

### Implementação

- **Novo:** `bloquim-mcp/src/prompts/tutorial.ts` — exporta `tutorial: PromptDef`,
  espelhando a estrutura de `capturar_tarefa.ts`:
  - `name: "tutorial"`, `title` e `description` curtos.
  - `argsSchema: { topico: z.string().optional().describe(...) }`.
  - `handler(args)` retorna `{ messages: [{ role: "user", content: { type: "text",
    text } }] }`.
  - **Conteúdo do `text`:** (1) o que é o Bloquim (1-2 frases); (2) os 3 prompts/atalhos
    nomeados (`/capturar_tarefa`, `/extrair_tarefas_de_reuniao`,
    `/revisao_minhas_tarefas`); (3) 3 frases-gatilho de exemplo (do `USE-CASES.md`);
    (4) `CAPTURE_POLICY` importada e anexada (não reescrita) — garante a string
    "Captura proativa".
  - **`topico`:** quando presente, o texto abre com um foco interpolado
    (ex.: `Foco do tour: ${topico}`) e instrui o agente a priorizar a seção
    correspondente. Os tópicos reconhecidos (ex.: `reuniao`, `revisao`, `captura`,
    `plano`) mapeiam para a seção; tópico livre cai num foco genérico que ecoa o termo.
- **Editar:** `bloquim-mcp/src/prompts/index.ts` — `import { tutorial }` e append em
  `PROMPTS` (após `revisaoMinhasTarefas`, respeitando a ordem do teste).
- `scripts/verify-guidance.ts` — **sem mudança** (já espera 4).
- Registro no servidor é genérico (`register.ts` itera `PROMPTS`) — nada a mudar lá.

---

## Texto final (PT-BR, estética lowercase)

### Bloco 2 — passos de conexão (Claude-first)

1. pré-requisito: ter conta no bloquim (a mesma deste login).
2. no claude → configurações → **conectores** → "add custom connector".
3. nome: `bloquim` · url: `https://mcp.bloquim.beeads.com.br/mcp` (botão copiar).
4. salvar → **vincular** → faça login e autorize. é a tela do bloquim — sua senha não
   é compartilhada com o cliente de ia.

✓ **confirme que funcionou:** peça ao claude *"lista meus workspaces"* — ou rode
`/tutorial` para um tour rápido.

**outros clientes** (collapsible): qualquer cliente compatível com mcp (cursor, claude
code cli…) usa a mesma url + oauth; o caminho até "add custom connector" muda conforme
o app.

### Bloco 3 — comece por aqui

- `/revisao_minhas_tarefas` — ritual de revisão das suas pendências.
- `preciso revisar os criativos amanhã` — solte um compromisso; o claude oferece
  registrar (captura proativa).
- `/extrair_tarefas_de_reuniao` — depois cole a ata; vira uma lista de tarefas.

💡 fale natural — não precisa decorar comando.

### Bloco 4 — captura proativa (callout)

solte um compromisso no meio da conversa ("preciso ligar pro contador dia 25") e o claude
oferece registrar no bloquim — você só confirma. nada é criado sem o seu ok.

### Bloco 5 — CTA skill

**turbine o agente (claude code).** instale a skill `bloquim` e o agente passa a dominar
todos os fluxos (planos, delegação, anexos, busca).

`npx skills add gucancado/bloquim-skill` · [abrir no github]

> o mcp sozinho já funciona — a skill é o turbo, recomendada para claude code / api.

### Bloco 6 — se der errado

- **o conector não aparece depois de salvar** → recarregue o cliente / reabra a tela de
  conectores.
- **falhou no login ou no "autorizar"** → confirme que está logado no bloquim no mesmo
  navegador e tente vincular de novo.
- **as descrições das ferramentas parecem desatualizadas** → remova e adicione o conector
  de novo (re-vincular) para limpar o cache do cliente. não afeta seus dados.

---

## Recomendação sobre o prompt `tutorial`: **SIM**

Custo baixo (1 arquivo + 1 linha no index; teste já existe), valor alto: dá ao usuário
*dentro do Claude* um atalho de ajuda — o passo 1 pós-conexão que a página recomenda.
Reutiliza `CAPTURE_POLICY` como fonte única. Esboço completo na Componente B.

## Plano de testes

- **MCP:** `pnpm verify-guidance` (codifica o contrato dos 4 prompts) deve passar +
  build TypeScript do pacote.
- **Frontend:** gate **relativo** de typecheck (sem erro `tsc` novo — há ~71 erros
  pré-existentes no baseline; o deploy usa `vite build` sem `tsc`). `vite build` verde.
  Smoke manual: cada `CopyButton` independente, collapsibles abrem/fecham, bloco 2 abre
  por default, fetch de `/tools` renderiza e o estado de erro aparece se o fetch falhar.

## Gates

- Parar no plano aprovado antes de implementar a UI.
- **Sem deploy de produção sem revisão humana** (abrir o app local para review ao fim).

## Fora de escopo (follow-up)

- Atualizar `SKILL.md` / `README.md` / `USE-CASES.md` da skill (repo separado
  `gucancado/bloquim-skill`) para refletir "4 prompts" e citar o `tutorial`.
- Qualquer mudança no endpoint `/tools` ou no shape de tools.
