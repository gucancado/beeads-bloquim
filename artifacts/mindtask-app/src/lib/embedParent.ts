import { isEmbedPath, type ChildMessage } from "@/lib/embedBridge";

/**
 * Origem do pai (painel) das rotas `/embed/workspaces/...`, aprendida no
 * `init` pelo `EmbedShell`. Fica em variável de módulo para que qualquer
 * componente dentro do embed (lista, canvas) avise o pai sem prop drilling.
 * Antes do `init` não há para quem postar: `postToEmbedParent` vira no-op.
 */
let parentOrigin: string | null = null;

export type EmbedParentTarget = { postMessage(msg: unknown, origin: string): void };

export function rememberEmbedParent(origin: string): void {
  parentOrigin = origin;
}

export function embedParentOrigin(): string | null {
  return parentOrigin;
}

/** Posta para o pai com a origem exata aprendida no `init`. `false` sem origem. */
export function postToEmbedParent(
  msg: ChildMessage,
  target: EmbedParentTarget = window.parent,
): boolean {
  if (!parentOrigin) return false;
  target.postMessage(msg, parentOrigin);
  return true;
}

export function isEmbedded(pathname: string = window.location.pathname): boolean {
  return isEmbedPath(pathname);
}

export function resetEmbedParentForTests(): void {
  parentOrigin = null;
}
