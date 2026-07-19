# Plano — refino da página /settings/mcp (Componente A)

**Spec:** [specs/2026-06-14-config-mcp-refino-design.md](../specs/2026-06-14-config-mcp-refino-design.md)
**Escopo:** rewrite de um arquivo. Componente B (prompt `tutorial` no MCP) já feito e verde.
**Arquivo único:** `repo/artifacts/mindtask-app/src/pages/settings/mcp.tsx`

## Pré-condições (verificadas)

- `@beeads/ui` `Collapsible` = base-ui `CollapsibleRootProps` → aceita `defaultOpen`.
- Endpoint `/tools` (`MCP_TOOLS_URL`) e shape `McpToolsResponse` inalterados.
- Estética lowercase + tokens `@beeads/ui` mantidos.

## Tarefas (sequenciais, mesmo arquivo)

### T1 — Helper `CopyButton` (corrige bug do `copied` compartilhado)
- Componente local com `useState` próprio. Props: `value: string`, `label?: string`,
  `className?`. Reusa `useToast` no catch de clipboard.
- Substitui o `copied` no nível da página e os dois blocos de botão duplicados.

### T2 — Bloco 1 (header) + bloco 8 (rodapé)
- Título "conecte o bloquim ao claude" + 1 linha de valor.
- URL canônica num `CopyableField` (code + `CopyButton`). `mcpEndpoint` = `data?.mcp_endpoint ?? MCP_ENDPOINT_FALLBACK` (mantido).
- Rodapé: nota OAuth existente.

### T3 — Bloco 2 (conectar em 4 passos), `Collapsible defaultOpen`
- 4 passos Claude-first (texto da spec). Passo da URL reusa `CopyableField`.
- Caixa "✓ confirme que funcionou" (peça "lista meus workspaces" / `/tutorial`).
- Sub-`Collapsible` fechado "outros clientes".

### T4 — Bloco 3 (comece por aqui)
- 3 cards de frase-gatilho, cada um com `CopyButton`. Texto do USE-CASES.md.
- Linha "💡 fale natural — não precisa decorar comando."

### T5 — Bloco 4 (callout captura proativa)
- 1 frase parafraseando `CAPTURE_POLICY` (não cita arquivo, não duplica política).

### T6 — Bloco 5 (CTA skill, proeminente)
- Card destacado: comando `npx skills add gucancado/bloquim-skill` (`CopyButton`) +
  botão "abrir no github" (`render={(props) => <Button {...props}/>}`, link
  `https://github.com/gucancado/bloquim-skill`) + nota "mcp sozinho já funciona".

### T7 — Bloco 6 (troubleshooting) + bloco 7 (tools)
- Bloco 6: `Collapsible` fechado, 3 itens (conector não aparece / OAuth / re-link cache).
- Bloco 7: `Collapsible` fechado no fim. Move o fetch de `/tools` + `grouped` +
  estados loading/error/empty + botão recarregar pra dentro, sem mudar a lógica.

## Verificação

1. `pnpm --filter @workspace/mindtask-app exec tsc --noEmit` → **gate relativo**: nenhum
   erro novo em `mcp.tsx` (baseline FE tem ~71 erros pré-existentes).
2. `pnpm --filter @workspace/mindtask-app run build` (vite) → verde.
3. Smoke manual no app local: cada `CopyButton` independente (não acende os outros);
   bloco 2 abre por default; collapsibles 6/7 abrem/fecham; lista de tools carrega;
   estado de erro do fetch aparece se `/tools` falhar.

## Gate final

Subir app local, abrir `/settings/mcp`, entregar link pra revisão humana **antes de
qualquer deploy de produção**.
