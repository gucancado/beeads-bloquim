/**
 * Helper de "return URL" pra fluxos cross-subdomínio (login do Bloquim sendo
 * usado por outros apps em .beeads.com.br, ex.: painel.beeads.com.br).
 *
 * Apenas hosts terminados em `.beeads.com.br` (ou localhost em dev) são
 * aceitos. Qualquer outro return_url é descartado pra evitar open-redirect.
 */

const ALLOWED_SUFFIX = ".beeads.com.br";

/**
 * Lê `return_url` da query string atual (ou string passada explicitamente).
 * Retorna URL absoluta sanitizada, ou null se ausente/inválida.
 */
export function readReturnUrl(search?: string): string | null {
  const sp = new URLSearchParams(search ?? (typeof window !== "undefined" ? window.location.search : ""));
  const raw = sp.get("return_url");
  if (!raw) return null;

  try {
    const u = new URL(raw);
    if (isHostAllowed(u.hostname) && (u.protocol === "https:" || u.protocol === "http:")) {
      return u.toString();
    }
  } catch {
    // fallback: caminho relativo a partir da raiz (ex.: "/my-tasks")
    if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  }
  return null;
}

function isHostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "beeads.com.br") return true;
  if (h.endsWith(ALLOWED_SUFFIX)) return true;
  return false;
}

/**
 * Propaga o `return_url` da página atual pra outro link interno
 * (ex.: de /login pra /register e vice-versa).
 */
export function withReturnUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const ret = readReturnUrl();
  if (!ret) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}return_url=${encodeURIComponent(ret)}`;
}
