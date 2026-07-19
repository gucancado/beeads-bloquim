import { describe, it, expect } from "vitest";
import { parseSinceParam, parseUntilParam } from "../lib/queryDates";

describe("queryDates", () => {
  it("retorna null para ausente/vazio", () => {
    expect(parseSinceParam(undefined)).toBeNull();
    expect(parseUntilParam("")).toBeNull();
  });

  it("aceita ISO completo", () => {
    const d = parseSinceParam("2026-07-01T12:00:00Z") as Date;
    expect(d.toISOString()).toBe("2026-07-01T12:00:00.000Z");
    const u = parseUntilParam("2026-07-01T12:00:00Z") as Date;
    expect(u.toISOString()).toBe("2026-07-01T12:00:00.000Z");
  });

  it("date-only: since = meia-noite SP; until = meia-noite SP do dia seguinte (exclusivo)", () => {
    const s = parseSinceParam("2026-07-01") as Date;
    expect(s.toISOString()).toBe("2026-07-01T03:00:00.000Z"); // 00:00 -03:00
    const u = parseUntilParam("2026-07-01") as Date;
    expect(u.toISOString()).toBe("2026-07-02T03:00:00.000Z");
  });

  it("inválido retorna 'invalid'", () => {
    expect(parseSinceParam("not-a-date")).toBe("invalid");
    expect(parseUntilParam("2026-13-45")).toBe("invalid");
  });
});
