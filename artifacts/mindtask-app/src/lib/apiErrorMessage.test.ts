import { describe, it, expect } from "vitest";
import { apiErrorMessage, TEMPLATE_ERRORS_BY_STATUS } from "./apiErrorMessage";

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

  it("traduz 404/500 genéricos do servidor nas telas de modelos, mantendo os demais", () => {
    expect(apiErrorMessage({ status: 404, data: { error: "Not found" } }, "falhou", TEMPLATE_ERRORS_BY_STATUS)).toBe(
      "modelo não encontrado",
    );
    expect(
      apiErrorMessage({ status: 500, data: { error: "Internal Server Error" } }, "falhou", {
        ...TEMPLATE_ERRORS_BY_STATUS,
        403: "sem permissão",
      }),
    ).toBe("erro no servidor. tente novamente");
    expect(
      apiErrorMessage({ status: 400, data: { error: "nada pra salvar no modelo" } }, "falhou", TEMPLATE_ERRORS_BY_STATUS),
    ).toBe("nada pra salvar no modelo");
  });

  it("cai no fallback sem mensagem utilizável", () => {
    expect(apiErrorMessage(new Error("boom"), "falhou")).toBe("falhou");
    expect(apiErrorMessage({ data: { error: "  " } }, "falhou")).toBe("falhou");
    expect(apiErrorMessage(null, "falhou")).toBe("falhou");
  });
});
