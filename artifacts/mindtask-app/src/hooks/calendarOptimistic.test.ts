import { describe, it, expect } from "vitest";
import { applyOptimistic } from "./useCalendarData";

describe("applyOptimistic", () => {
  it("mescla só as linhas do patch", () => {
    const rows = [{ id: "a", plannedOrder: null, plannedDate: null }, { id: "b", plannedOrder: 3, plannedDate: "2026-10-01" }];
    expect(applyOptimistic(rows, { a: { plannedOrder: 0, plannedDate: "2026-10-02" } })).toEqual([
      { id: "a", plannedOrder: 0, plannedDate: "2026-10-02" },
      { id: "b", plannedOrder: 3, plannedDate: "2026-10-01" },
    ]);
  });
  it("undefined continua undefined", () => {
    expect(applyOptimistic(undefined, {})).toBeUndefined();
  });
});
