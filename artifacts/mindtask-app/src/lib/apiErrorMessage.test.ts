import { describe, it, expect } from "vitest";
import { apiErrorMessage } from "./apiErrorMessage";

describe("apiErrorMessage", () => {
  it("lê data.error do ApiError do customFetch", () => {
    expect(apiErrorMessage({ status: 400, data: { error: "nada pra salvar no modelo" } }, "falhou")).toBe(
      "nada pra salvar no modelo",
    );
  });

  it("aceita body.error legado", () => {
    expect(apiErrorMessage({ body: { error: "x" } }, "falhou")).toBe("x");
  });

  it("mensagem por status tem prioridade", () => {
    expect(
      apiErrorMessage({ status: 403, data: { error: "Forbidden" } }, "falhou", { 403: "sem permissão" }),
    ).toBe("sem permissão");
  });

  it("cai no fallback sem mensagem utilizável", () => {
    expect(apiErrorMessage(new Error("boom"), "falhou")).toBe("falhou");
    expect(apiErrorMessage({ data: { error: "  " } }, "falhou")).toBe("falhou");
    expect(apiErrorMessage(null, "falhou")).toBe("falhou");
  });
});
