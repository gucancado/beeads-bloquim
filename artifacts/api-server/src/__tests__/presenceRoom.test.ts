import { afterEach, describe, expect, it } from "vitest";
import {
  _resetAllRooms,
  getOtherMembers,
  getRoomMembers,
  joinRoom,
  leaveRoom,
  pickColor,
  updateCursor,
} from "../realtime/presenceRoom";
import { CURSOR_COLORS } from "../realtime/presenceTypes";
import {
  HEARTBEAT_TIMEOUT_MS,
  shouldTerminate,
} from "../realtime/presenceServer";

afterEach(() => {
  _resetAllRooms();
});

function makeMember(connectionId: string, color = "blue" as const) {
  return {
    connectionId,
    userId: `user-${connectionId}`,
    name: `User ${connectionId}`,
    avatarUrl: null,
    color,
  };
}

describe("presenceRoom", () => {
  it("join adds member and leave removes; empty room is discarded", () => {
    joinRoom("map-1", makeMember("c1"));
    expect(getRoomMembers("map-1")).toHaveLength(1);
    expect(leaveRoom("map-1", "c1")).toBe(true);
    expect(getRoomMembers("map-1")).toHaveLength(0);
    // After last leave, internal map is gone -> still returns []
    expect(leaveRoom("map-1", "c1")).toBe(false);
  });

  it("getOtherMembers excludes the given connectionId", () => {
    joinRoom("map-2", makeMember("a"));
    joinRoom("map-2", makeMember("b"));
    joinRoom("map-2", makeMember("c"));
    const others = getOtherMembers("map-2", "b");
    expect(others.map((m) => m.connectionId).sort()).toEqual(["a", "c"]);
  });

  it("updateCursor updates x/y for an existing member only", () => {
    joinRoom("map-3", makeMember("c1"));
    expect(updateCursor("map-3", "c1", 10, 20)).toBe(true);
    const [m] = getRoomMembers("map-3");
    expect(m?.x).toBe(10);
    expect(m?.y).toBe(20);
    expect(updateCursor("map-3", "missing", 1, 1)).toBe(false);
    expect(updateCursor("missing-map", "c1", 1, 1)).toBe(false);
  });

  it("pickColor avoids colors already used in the room when possible", () => {
    // Fill 6 of 7 colors
    const taken = CURSOR_COLORS.slice(0, 6);
    taken.forEach((color, i) =>
      joinRoom("map-4", makeMember(`c${i}`, color)),
    );
    const next = pickColor("map-4");
    expect(next).toBe(CURSOR_COLORS[6]);
  });

  it("pickColor allows collisions only when all 7 are used", () => {
    CURSOR_COLORS.forEach((color, i) =>
      joinRoom("map-5", makeMember(`c${i}`, color)),
    );
    const next = pickColor("map-5");
    expect(CURSOR_COLORS).toContain(next);
  });

  it("pickColor for an empty room returns one of the 7 colors", () => {
    const c = pickColor("empty-map");
    expect(CURSOR_COLORS).toContain(c);
  });
});

describe("heartbeat shouldTerminate", () => {
  it("does not terminate fresh sockets", () => {
    const now = 1_000_000;
    expect(shouldTerminate(now, now)).toBe(false);
    expect(shouldTerminate(now, now - 1000)).toBe(false);
  });

  it("does not terminate sockets within the timeout", () => {
    const now = 1_000_000;
    expect(shouldTerminate(now, now - (HEARTBEAT_TIMEOUT_MS - 1))).toBe(false);
    expect(shouldTerminate(now, now - HEARTBEAT_TIMEOUT_MS)).toBe(false);
  });

  it("terminates sockets older than the timeout", () => {
    const now = 1_000_000;
    expect(shouldTerminate(now, now - (HEARTBEAT_TIMEOUT_MS + 1))).toBe(true);
    expect(shouldTerminate(now, now - 60_000)).toBe(true);
  });
});
