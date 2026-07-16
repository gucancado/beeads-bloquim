# Fix: import do @dagrejs/dagre em mapLayoutService.ts

## Bug original

`artifacts/api-server/src/services/mapLayoutService.ts:2` usava named import:

```ts
import { Graph, layout } from "@dagrejs/dagre";
```

Isso quebrava `tsx watch` (dev server) com:
```
SyntaxError: The requested module '@dagrejs/dagre' does not provide an export named 'Graph'
```

## Desvio do fix prescrito (com evidência)

O fix pedido era default import + destructure:
```ts
import dagre from "@dagrejs/dagre";
const { Graph, layout } = dagre;
```

Apliquei esse fix primeiro, exatamente como especificado. **Ele resolve o tsx, mas quebra o Vitest**: `npx vitest run src/__tests__/mapLayout.test.ts` caiu de 9/9 pra 2/9 passando, com `TypeError: Graph is not a constructor` em `new Graph()`.

### Causa raiz (confirmada com probes empíricos, não suposição)

`@dagrejs/dagre@3.0.0` é dual ESM/CJS com **bug de packaging**: os dois builds divergem entre si sobre onde `Graph` mora.

- **Build ESM** (`dist/dagre.esm.js`, usado por Vitest e Node ESM puro): tem `export { Graph, ... }` nomeado — funciona — mas o objeto `default` exportado é `{ graphlib, version, layout, debug, util }`, **sem `Graph`**. Confirmado também no `.d.ts` do pacote (`dist/types/index.d.ts`): o tipo do `default export` literalmente não inclui `Graph`.
- **Build CJS** (`dist/dagre.cjs.js`, o que o `tsx` acaba resolvendo/interpretando via CJS-interop): `module.exports` tem `Graph` como propriedade própria direta — mas o `import { Graph } from ...` nomeado falha no tsx porque o analisador estático de named-exports do Node (`cjs-module-lexer`) não detecta as propriedades definidas dinamicamente via loop (`Object.defineProperty` genérico, não literal) — daí o `SyntaxError` original.

Ou seja: **named import puro** funciona no Vitest/Node-ESM mas quebra no tsx; **default import puro** funciona no tsx mas quebra no Vitest/Node-ESM. Nenhum import único cobre os dois. Testado com scripts probe (`probe-named.mjs`, `probe-default.mjs`, `probe-ns.mjs`, removidos após uso) rodando `node` puro vs `npx tsx` dentro de `artifacts/api-server`.

### Fix aplicado (dentro do mesmo escopo cirúrgico — só o import + destructure + comentário, no mesmo arquivo)

```ts
import * as dagreModule from "@dagrejs/dagre";
import { NODE_WIDTH, NODE_HEIGHT, type Point } from "../lib/collision";

// dagre@3 é dual ESM/CJS e os dois builds são inconsistentes entre si: no ESM real
// (Vitest, node .mjs) o named export `Graph` existe mas o `default` do pacote NÃO
// inclui Graph (bug de packaging do dagre); no CJS-interop do tsx (dev) é o oposto —
// o named import quebra ("does not provide an export named 'Graph'") e só o `default`
// carrega Graph. Nem named import puro nem default import puro funcionam nos dois
// runners ao mesmo tempo — namespace import + fallback pro `.default` cobre ambos.
const dagreDefault = dagreModule.default as unknown as typeof dagreModule | undefined;
const Graph = dagreModule.Graph ?? dagreDefault?.Graph;
const layout = dagreModule.layout ?? dagreDefault?.layout;
```

Namespace import nunca falha estaticamente (ao contrário do named import), então funciona em qualquer runner. Em runtime, pega `Graph`/`layout` de onde estiverem: direto no namespace (ESM real) ou em `.default` (CJS-interop do tsx). Resto do arquivo (`new Graph()`, `layout(g)`) não mudou.

## Diff final

```diff
--- a/artifacts/api-server/src/services/mapLayoutService.ts
+++ b/artifacts/api-server/src/services/mapLayoutService.ts
@@ -1,7 +1,17 @@
 // artifacts/api-server/src/services/mapLayoutService.ts
-import { Graph, layout } from "@dagrejs/dagre";
+import * as dagreModule from "@dagrejs/dagre";
 import { NODE_WIDTH, NODE_HEIGHT, type Point } from "../lib/collision";
 
+// dagre@3 é dual ESM/CJS e os dois builds são inconsistentes entre si: no ESM real
+// (Vitest, node .mjs) o named export `Graph` existe mas o `default` do pacote NÃO
+// inclui Graph (bug de packaging do dagre); no CJS-interop do tsx (dev) é o oposto —
+// o named import quebra ("does not provide an export named 'Graph'") e só o `default`
+// carrega Graph. Nem named import puro nem default import puro funcionam nos dois
+// runners ao mesmo tempo — namespace import + fallback pro `.default` cobre ambos.
+const dagreDefault = dagreModule.default as unknown as typeof dagreModule | undefined;
+const Graph = dagreModule.Graph ?? dagreDefault?.Graph;
+const layout = dagreModule.layout ?? dagreDefault?.layout;
+
 export type LayoutNode = { id: string; width?: number; height?: number };
 export type LayoutEdge = { source: string; target: string };
```

Nenhum outro arquivo foi tocado.

## Verificações — saídas reais

### 1. Dev server sobe (`pnpm --filter @workspace/api-server run dev`)

```
[23:57:08.922] INFO: SENTRY_DSN not set — error tracking disabled  (module: sentry)
[23:57:11.582] INFO: presence websocket server attached (module: presence, path: /api/realtime/presence)
[23:57:11.591] INFO: server listening (port: 5000, env: development)
[23:57:11.690] INFO: overdue sync started (module: scheduler, intervalMs: 300000)
[23:57:12.190] INFO: overdue sync (module: scheduler, flagged: 0, cleared: 2)
```
Nenhum SyntaxError. Health check:
```
GET http://localhost:5000/api/healthz -> STATUS 200, BODY {"status":"ok"}
```
(Nota: `/api/health` do enunciado não existe; a rota real é `/api/healthz` — confirmado em `src/routes/health.ts`.)
Server derrubado ao final (`taskkill /T /F` na árvore de processos, confirmado sem sobrar `index.ts` rodando).

**Resultado: PASSOU.**

### 2. Unit test da engine (`npx vitest run src/__tests__/mapLayout.test.ts`)

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

**Resultado: PASSOU (9/9).** (Com o fix literal prescrito no enunciado, esse gate tinha caído pra 2/9 — ver seção "Desvio" acima.)

### 3. Smoke do endpoint (`npx vitest run src/__tests__/mapLayout.smoke.test.ts`, com DATABASE_URL/JWT_SECRET)

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
   Duration  48.59s
```

**Resultado: PASSOU (7/7).** Sem timeout, não precisou re-rodar.

### 4. Build de produção (`pnpm --filter @workspace/api-server run build`)

```
building server...
  dist\index.cjs  2.2mb
Done in 8047ms
```

**Resultado: PASSOU.**

Verificação extra (não pedida, mas prudente dado o achado acima): rodei `node dist/index.cjs` pra confirmar que o bundle não tem regressão silenciosa de runtime relacionada ao dagre. O processo encerrou por um guard de config pré-existente e sem relação (`ALLOWED_ORIGINS environment variable is required in production`, disparado por rodar sem `NODE_ENV=development` e sem `ALLOWED_ORIGINS` setado) — não é sintoma de problema com dagre, é um gate de startup já existente no `app.ts`, fora do escopo desta correção. Não investiguei mais a fundo por estar fora do escopo pedido.

## Commit

`fix(api): import robusto do dagre — named import quebrava tsx (dev), default import quebrava Vitest`
