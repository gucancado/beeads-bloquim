import { describe, expect, it } from "vitest";
import { CalendarPointerSensor } from "./sensor";

// Vitest roda em node: fakes mínimos com só o que o handler usa.
type Fake = { name: string; parent: Fake | null; matches: boolean; closest: (s: string) => Fake | null };

function node(name: string, parent: Fake | null, matches = false): Fake {
  const n: Fake = {
    name, parent, matches,
    closest() {
      for (let cur: Fake | null = n; cur; cur = cur.parent) if (cur.matches) return cur;
      return null;
    },
  };
  return n;
}

function card() {
  const el = node("card", null) as Fake & { contains: (x: Fake) => boolean };
  el.contains = (x: Fake) => {
    for (let cur: Fake | null = x; cur; cur = cur.parent) if (cur === el) return true;
    return false;
  };
  return el;
}

const handler = CalendarPointerSensor.activators[0].handler as unknown as (e: {
  nativeEvent: { isPrimary: boolean; button: number; target: unknown };
  currentTarget: unknown;
}) => boolean;

const fire = (target: unknown, currentTarget: unknown, opts: { isPrimary?: boolean; button?: number } = {}) =>
  handler({ nativeEvent: { isPrimary: opts.isPrimary ?? true, button: opts.button ?? 0, target }, currentTarget });

describe("CalendarPointerSensor activator", () => {
  it("activates on a plain div inside the card", () => {
    const c = card();
    expect(fire(node("div", c), c)).toBe(true);
  });

  it("ignores an input inside the card", () => {
    const c = card();
    expect(fire(node("input", c, true), c)).toBe(false);
  });

  it("ignores descendants of a [data-no-dnd] control", () => {
    const c = card();
    const control = node("data-no-dnd", c, true);
    expect(fire(node("span", control), c)).toBe(false);
  });

  it("ignores targets outside the card (portal)", () => {
    const c = card();
    const portal = node("popover", null);
    expect(fire(node("div", portal), c)).toBe(false);
  });

  it("ignores non-primary pointers and non-left buttons", () => {
    const c = card();
    const t = node("div", c);
    expect(fire(t, c, { isPrimary: false })).toBe(false);
    expect(fire(t, c, { button: 2 })).toBe(false);
  });

  it("still activates when only an ancestor of the card matches the selector", () => {
    const dialog = node("dialog", null, true);
    const c = card();
    c.parent = dialog;
    expect(fire(node("div", c), c)).toBe(true);
  });
});
