/**
 * Mensagem exibível de um erro do customFetch. O ApiError guarda o corpo em
 * `.data` (não `.body`); `.body` é aceito por compatibilidade. `byStatus`
 * substitui mensagens genéricas do servidor (ex.: 403 "Forbidden").
 */
export function apiErrorMessage(
  e: unknown,
  fallback: string,
  byStatus?: Record<number, string>,
): string {
  const err = (e ?? {}) as {
    status?: unknown;
    data?: { error?: unknown } | null;
    body?: { error?: unknown } | null;
  };
  if (typeof err.status === "number" && byStatus?.[err.status]) return byStatus[err.status];
  const v = err.data?.error ?? err.body?.error;
  return typeof v === "string" && v.trim() ? v : fallback;
}
