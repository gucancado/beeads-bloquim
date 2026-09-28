import { describe, it, expect } from "vitest";
import { addDaysYmd, startOfWeekMonday, weekDays, weekBoundsISO, ymdLocal } from "./week";

describe("week", () => {
  it("segunda é o início; domingo volta 6 dias", () => {
    expect(startOfWeekMonday("2026-09-28")).toBe("2026-09-28"); // segunda
    expect(startOfWeekMonday("2026-10-01")).toBe("2026-09-28"); // quinta
    expect(startOfWeekMonday("2026-10-04")).toBe("2026-09-28"); // domingo
  });
  it("addDaysYmd cruza mês e ano", () => {
    expect(addDaysYmd("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDaysYmd("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("weekDays tem 7 dias seg→dom", () => {
    expect(weekDays("2026-09-28")).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
    ]);
  });
  it("weekBoundsISO cobre 7 dias locais", () => {
    const { from, to } = weekBoundsISO("2026-09-28");
    expect(ymdLocal(new Date(from))).toBe("2026-09-28");
    expect(ymdLocal(new Date(to))).toBe("2026-10-05");
  });
});
