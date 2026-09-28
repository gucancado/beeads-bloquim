import { describe, it, expect } from "vitest";
import { statusFilterToApi, TODOS_STATUS } from "./taskStatusConstants";

describe("statusFilterToApi", () => {
  it("todos vira tudo menos cancelada", () => {
    expect(statusFilterToApi(TODOS_STATUS)).toBe("draft,pending,in_progress,completed");
  });
  it("status único passa direto", () => {
    expect(statusFilterToApi("blocked")).toBe("blocked");
  });
});
