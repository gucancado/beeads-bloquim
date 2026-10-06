import { describe, it, expect } from "vitest";
import { formatPlanCounts, selectionFromNodes, skippedDescription } from "./planTemplates";

describe("selectionFromNodes", () => {
  it("separa por tipo, envia aprovação e imagem, ignora joinnode e não-selecionados", () => {
    const s = selectionFromNodes([
      { id: "c1", type: "mindmap", selected: true },
      { id: "ap", type: "approvalnode", selected: true },
      { id: "join-c1", type: "joinnode", selected: true },
      { id: "t1", type: "textnode", selected: true },
      { id: "img", type: "shapenode", selected: true, data: { type: "image" } },
      { id: "r1", type: "shapenode", selected: false, data: { type: "rect" } },
    ]);
    expect(s).toEqual({ cardIds: ["c1", "ap"], textElementIds: ["t1"], shapeIds: ["img"], usable: true });
  });

  it("só aprovação/imagem selecionada não é aproveitável", () => {
    const s = selectionFromNodes([
      { id: "ap", type: "approvalnode", selected: true },
      { id: "img", type: "shapenode", selected: true, data: { type: "image" } },
    ]);
    expect(s.usable).toBe(false);
  });

  it("forma não-imagem é aproveitável", () => {
    expect(selectionFromNodes([{ id: "r", type: "shapenode", selected: true, data: { type: "rect" } }]).usable).toBe(true);
  });
});

describe("skippedDescription", () => {
  it("sem nada de fora → undefined", () => {
    expect(skippedDescription({ approvals: 0, images: 0 })).toBeUndefined();
  });
  it("singular e plural", () => {
    expect(skippedDescription({ approvals: 1, images: 0 })).toBe("1 aprovação ficou de fora");
    expect(skippedDescription({ approvals: 0, images: 3 })).toBe("3 imagens ficaram de fora");
    expect(skippedDescription({ approvals: 2, images: 1 })).toBe("2 aprovações e 1 imagem ficaram de fora");
  });
});

describe("formatPlanCounts", () => {
  it("lista só o que existe, em minúsculas", () => {
    expect(formatPlanCounts({ cards: 5, connections: 4, texts: 2, shapes: 1 })).toBe("5 tarefas · 2 textos · 1 forma");
    expect(formatPlanCounts({ cards: 1, connections: 0, texts: 0, shapes: 0 })).toBe("1 tarefa");
    expect(formatPlanCounts({ cards: 0, connections: 0, texts: 1, shapes: 2 })).toBe("1 texto · 2 formas");
    expect(formatPlanCounts({ cards: 0, connections: 0, texts: 0, shapes: 0 })).toBe("vazio");
  });
});
