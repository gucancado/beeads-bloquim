// artifacts/api-server/src/lib/queryDates.ts
// Parsing dos query params temporais dos endpoints de análise/listagem.
// Contrato: `since` é inclusivo (>=), `until` é exclusivo (<).
// Data-only (YYYY-MM-DD) é interpretada em America/Sao_Paulo (-03:00 fixo,
// Brasil não tem DST desde 2019); para `until`, data-only vira meia-noite
// do dia SEGUINTE — equivalente a "fim do dia" sem aritmética de fuso.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const SP_OFFSET = "-03:00";

export function parseSinceParam(raw: string | undefined): Date | null | "invalid" {
  if (raw === undefined || raw === "") return null;
  const d = new Date(DATE_ONLY.test(raw) ? `${raw}T00:00:00${SP_OFFSET}` : raw);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

export function parseUntilParam(raw: string | undefined): Date | null | "invalid" {
  if (raw === undefined || raw === "") return null;
  if (DATE_ONLY.test(raw)) {
    const d = new Date(`${raw}T00:00:00${SP_OFFSET}`);
    if (Number.isNaN(d.getTime())) return "invalid";
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}
