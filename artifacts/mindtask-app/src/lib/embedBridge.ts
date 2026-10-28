/**
 * Protocolo postMessage entre o Bloquim embutido (`/embed/task` e
 * `/embed/workspaces/...`) e o painel
 * (`painel.beeads.com.br`), que abre o modal de tarefa num iframe.
 *
 * ESPELHO de `beeads-central-de-dados/web/src/lib/task-embed-bridge.ts` — mudar
 * um lado exige mudar o outro; os testes dos dois usam as mesmas fixtures.
 *
 * `taskId` já faz parte do `open` para editar/excluir tarefa existente pelo
 * painel; o botão "nova tarefa" manda `null`.
 */
export const EMBED_CHILD_SOURCE = "bloquim-embed";
export const EMBED_PARENT_SOURCE = "bcd-panel";

export type NavigateTarget = { kind: "tasks" } | { kind: "map"; mapId: string };

export type NavigateChildMessage =
  | { source: typeof EMBED_CHILD_SOURCE; type: "navigate"; target: "tasks" }
  | { source: typeof EMBED_CHILD_SOURCE; type: "navigate"; target: "map"; mapId: string };

export type ChangedChildMessage = {
  source: typeof EMBED_CHILD_SOURCE;
  type: "changed";
  what: "plans" | "tasks";
};

export type ChildMessage =
  | { source: typeof EMBED_CHILD_SOURCE; type: "ready" | "closed" }
  | NavigateChildMessage
  | ChangedChildMessage;

/**
 * Comandos do pai para as rotas `/embed/workspaces/...` (lista de tarefas e
 * canvas de plano). `open` continua sendo do `parseParentMessage`.
 */
export type ParentCommand =
  | { source: typeof EMBED_PARENT_SOURCE; type: "init"; returnUrl: string }
  | { source: typeof EMBED_PARENT_SOURCE; type: "navigate"; path: string };

export type OpenTaskMessage = {
  source: typeof EMBED_PARENT_SOURCE;
  type: "open";
  workspaceId: string;
  taskId: string | null;
};

const PROD_PARENT_ORIGINS = ["https://painel.beeads.com.br"];
const DEV_PARENT_ORIGINS = ["http://localhost:3001"];

/** Quem pode embutir e comandar o modal. Localhost só no dev server do Vite. */
export function allowedParentOrigins(isDev: boolean): string[] {
  return isDev ? [...PROD_PARENT_ORIGINS, ...DEV_PARENT_ORIGINS] : [...PROD_PARENT_ORIGINS];
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Valida uma mensagem vinda do pai. Origem fora da allowlist ou shape errado
 * vira `null` — quem chama descarta em silêncio.
 */
export function parseParentMessage(
  origin: string,
  data: unknown,
  allowed: readonly string[],
): OpenTaskMessage | null {
  if (!allowed.includes(origin)) return null;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.source !== EMBED_PARENT_SOURCE || d.type !== "open") return null;
  if (!nonEmptyString(d.workspaceId)) return null;
  const taskId = d.taskId;
  if (taskId !== null && !nonEmptyString(taskId)) return null;
  return { source: EMBED_PARENT_SOURCE, type: "open", workspaceId: d.workspaceId, taskId };
}

/**
 * Segmentos são ids opacos (UUID): só `[A-Za-z0-9_-]`. Isso recusa por
 * construção `.`/`..`, `\`, `%` (nada codificado chega a um roteador que
 * decodifique), query, hash, `//` e barra final.
 */
const EMBED_WORKSPACE_PATH =
  /^\/embed\/workspaces\/[A-Za-z0-9_-]+\/(tasks(\/[A-Za-z0-9_-]+)?|maps\/[A-Za-z0-9_-]+)$/;

/** Rotas de embed que o pai pode mandar o filho abrir: lista, deep link de tarefa e mapa. */
export function isAllowedEmbedPath(path: string): boolean {
  return EMBED_WORKSPACE_PATH.test(path);
}

/**
 * Valida um comando `init`/`navigate` vindo do pai. Origem fora da allowlist,
 * `returnUrl` de outra origem (ou que não é URL) e path fora de
 * `isAllowedEmbedPath` viram `null`.
 */
export function parseParentCommand(
  origin: string,
  data: unknown,
  allowed: readonly string[],
): ParentCommand | null {
  if (!allowed.includes(origin)) return null;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.source !== EMBED_PARENT_SOURCE) return null;
  if (d.type === "init") {
    if (!nonEmptyString(d.returnUrl)) return null;
    let returnOrigin: string;
    try {
      returnOrigin = new URL(d.returnUrl).origin;
    } catch {
      return null;
    }
    if (!allowed.includes(returnOrigin)) return null;
    return { source: EMBED_PARENT_SOURCE, type: "init", returnUrl: d.returnUrl };
  }
  if (d.type === "navigate") {
    if (!nonEmptyString(d.path) || !isAllowedEmbedPath(d.path)) return null;
    return { source: EMBED_PARENT_SOURCE, type: "navigate", path: d.path };
  }
  return null;
}

export function readyMessage(): ChildMessage {
  return { source: EMBED_CHILD_SOURCE, type: "ready" };
}

export function closedMessage(): ChildMessage {
  return { source: EMBED_CHILD_SOURCE, type: "closed" };
}

export function navigateMessage(target: NavigateTarget): NavigateChildMessage {
  return target.kind === "map"
    ? { source: EMBED_CHILD_SOURCE, type: "navigate", target: "map", mapId: target.mapId }
    : { source: EMBED_CHILD_SOURCE, type: "navigate", target: "tasks" };
}

export function changedMessage(what: "plans" | "tasks"): ChangedChildMessage {
  return { source: EMBED_CHILD_SOURCE, type: "changed", what };
}

/** Tema forçado do embed: o painel manda o dele na URL do iframe. */
export function forcedEmbedTheme(search: string): "dark" | "light" {
  return new URLSearchParams(search).get("theme") === "dark" ? "dark" : "light";
}

export function isEmbedPath(pathname: string): boolean {
  return pathname === "/embed" || pathname.startsWith("/embed/");
}

/** Base das rotas de workspace: dentro do embed, os links ficam sob `/embed`. */
export function workspaceRouteBase(workspaceId: string, pathname: string): string {
  return isEmbedPath(pathname) ? `/embed/workspaces/${workspaceId}` : `/workspaces/${workspaceId}`;
}
