import {
  CURSOR_COLORS,
  type CursorColor,
  type PresenceMemberWithCursor,
} from "./presenceTypes";

export interface PresenceMemberInternal extends PresenceMemberWithCursor {
  lastSeenAt: number;
}

const rooms = new Map<string, Map<string, PresenceMemberInternal>>();

export function pickColor(mapId: string): CursorColor {
  const room = rooms.get(mapId);
  const used = new Set<CursorColor>();
  if (room) {
    for (const m of room.values()) used.add(m.color);
  }
  const free = CURSOR_COLORS.filter((c) => !used.has(c));
  const pool = free.length > 0 ? free : CURSOR_COLORS;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx]!;
}

export function joinRoom(
  mapId: string,
  member: Omit<PresenceMemberInternal, "lastSeenAt" | "x" | "y">,
): PresenceMemberInternal {
  let room = rooms.get(mapId);
  if (!room) {
    room = new Map();
    rooms.set(mapId, room);
  }
  const internal: PresenceMemberInternal = {
    ...member,
    lastSeenAt: Date.now(),
  };
  room.set(member.connectionId, internal);
  return internal;
}

export function leaveRoom(mapId: string, connectionId: string): boolean {
  const room = rooms.get(mapId);
  if (!room) return false;
  const removed = room.delete(connectionId);
  if (room.size === 0) rooms.delete(mapId);
  return removed;
}

export function updateCursor(
  mapId: string,
  connectionId: string,
  x: number,
  y: number,
): boolean {
  const room = rooms.get(mapId);
  if (!room) return false;
  const m = room.get(connectionId);
  if (!m) return false;
  m.x = x;
  m.y = y;
  m.lastSeenAt = Date.now();
  return true;
}

export function getRoomMembers(
  mapId: string,
): PresenceMemberInternal[] {
  const room = rooms.get(mapId);
  if (!room) return [];
  return Array.from(room.values());
}

export function getOtherMembers(
  mapId: string,
  excludeConnectionId: string,
): PresenceMemberInternal[] {
  return getRoomMembers(mapId).filter(
    (m) => m.connectionId !== excludeConnectionId,
  );
}

export function getRoomCount(): number {
  return rooms.size;
}

// Test/cleanup helper
export function _resetAllRooms(): void {
  rooms.clear();
}
