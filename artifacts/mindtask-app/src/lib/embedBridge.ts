/**
 * Protocolo postMessage entre o Bloquim embutido (`/embed/task`) e o painel
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

export type ChildMessage = { source: typeof EMBED_CHILD_SOURCE; type: "ready" | "closed" };

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

export function readyMessage(): ChildMessage {
  return { source: EMBED_CHILD_SOURCE, type: "ready" };
}

export function closedMessage(): ChildMessage {
  return { source: EMBED_CHILD_SOURCE, type: "closed" };
}

/** Tema forçado do embed: o painel manda o dele na URL do iframe. */
export function forcedEmbedTheme(search: string): "dark" | "light" {
  return new URLSearchParams(search).get("theme") === "dark" ? "dark" : "light";
}

export function isEmbedPath(pathname: string): boolean {
  return pathname === "/embed" || pathname.startsWith("/embed/");
}
