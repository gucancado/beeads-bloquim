import { randomUUID } from "node:crypto";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { db } from "@workspace/db";
import { maps, users, workspaceMembers } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { verifyAuthCookie } from "../lib/wsAuth";
import {
  getOtherMembers,
  joinRoom,
  leaveRoom,
  pickColor,
  updateCursor,
} from "./presenceRoom";
import type {
  ClientMessage,
  PresenceMember,
  ServerMessage,
} from "./presenceTypes";
import type { AuthPayload } from "../middlewares/auth";

const log = logger.child({ module: "presence" });

const REALTIME_PATH = "/api/realtime/presence";
// Tick frequently enough that the worst-case removal time stays under 35s
// even when a pong arrives right before the connection dies.
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const HEARTBEAT_TIMEOUT_MS = 30_000;
const MAX_CURSOR_RATE_HZ = 60;
const MIN_CURSOR_INTERVAL_MS = 1000 / MAX_CURSOR_RATE_HZ;

/**
 * Pure helper used by the heartbeat tick. A connection should be terminated
 * when no pong (or other liveness signal) has been observed for longer than
 * the timeout, regardless of when the previous tick fired.
 */
export function shouldTerminate(
  now: number,
  lastPongAt: number,
  timeoutMs: number = HEARTBEAT_TIMEOUT_MS,
): boolean {
  return now - lastPongAt > timeoutMs;
}
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PresenceSocket extends WebSocket {
  connectionId?: string;
  user?: AuthPayload;
  joinedMapId?: string;
  lastCursorAt?: number;
  lastPongAt?: number;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch (err) {
    log.warn({ err }, "failed to send ws message");
  }
}

function broadcast(
  mapId: string,
  excludeConnectionId: string | null,
  msg: ServerMessage,
  registry: Map<string, PresenceSocket>,
): void {
  const payload = JSON.stringify(msg);
  for (const ws of registry.values()) {
    if (ws.joinedMapId !== mapId) continue;
    if (excludeConnectionId && ws.connectionId === excludeConnectionId) continue;
    if (ws.readyState !== WebSocket.OPEN) continue;
    try {
      ws.send(payload);
    } catch (err) {
      log.warn({ err }, "broadcast send failed");
    }
  }
}

async function userHasMapAccess(
  userId: string,
  mapId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ workspaceId: maps.workspaceId })
    .from(maps)
    .where(eq(maps.id, mapId))
    .limit(1);
  if (!row) return false;
  const [member] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, row.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return !!member;
}

async function loadUserProfile(
  userId: string,
): Promise<{ name: string; avatarUrl: string | null } | null> {
  const [u] = await db
    .select({ name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return null;
  return { name: u.name, avatarUrl: u.avatarUrl ?? null };
}

export function attachPresenceServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  const registry = new Map<string, PresenceSocket>();

  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = req.url ?? "";
    const pathname = url.split("?")[0];
    if (pathname !== REALTIME_PATH) {
      // No other ws handlers exist on this server — close the dangling
      // upgrade so it doesn't hang the connection.
      socket.write(
        "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
      socket.destroy();
      return;
    }
    const auth = verifyAuthCookie(req);
    if (!auth) {
      socket.write(
        "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const psock = ws as PresenceSocket;
      psock.user = auth;
      wss.emit("connection", psock, req);
    });
  });

  wss.on("connection", (ws: PresenceSocket) => {
    ws.lastPongAt = Date.now();
    ws.on("pong", () => {
      ws.lastPongAt = Date.now();
    });

    ws.on("message", async (raw) => {
      let msg: ClientMessage;
      try {
        const text = raw.toString();
        if (text.length > 4096) {
          send(ws, { type: "error", message: "message too large" });
          return;
        }
        msg = JSON.parse(text) as ClientMessage;
      } catch {
        send(ws, { type: "error", message: "invalid json" });
        return;
      }
      if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
        send(ws, { type: "error", message: "invalid message" });
        return;
      }

      if (msg.type === "join") {
        if (ws.joinedMapId) {
          send(ws, { type: "error", message: "already joined" });
          return;
        }
        const mapId = (msg as { mapId: string }).mapId;
        if (typeof mapId !== "string" || !UUID_REGEX.test(mapId)) {
          send(ws, { type: "error", message: "invalid mapId" });
          ws.close(1008, "invalid mapId");
          return;
        }
        const user = ws.user!;
        try {
          const allowed = await userHasMapAccess(user.userId, mapId);
          if (!allowed) {
            send(ws, { type: "error", message: "forbidden" });
            ws.close(4403, "forbidden");
            return;
          }
          const profile = await loadUserProfile(user.userId);
          if (!profile) {
            ws.close(4401, "user not found");
            return;
          }
          const connectionId = randomUUID();
          const color = pickColor(mapId);
          const member: PresenceMember = {
            connectionId,
            userId: user.userId,
            name: profile.name,
            avatarUrl: profile.avatarUrl,
            color,
          };
          joinRoom(mapId, member);
          ws.connectionId = connectionId;
          ws.joinedMapId = mapId;
          registry.set(connectionId, ws);

          const peers = getOtherMembers(mapId, connectionId).map((m) => ({
            connectionId: m.connectionId,
            userId: m.userId,
            name: m.name,
            avatarUrl: m.avatarUrl,
            color: m.color,
            x: m.x,
            y: m.y,
          }));
          send(ws, {
            type: "welcome",
            connectionId,
            color,
            peers,
          });
          broadcast(mapId, connectionId, { type: "peer-join", member }, registry);
        } catch (err) {
          log.error({ err }, "join failed");
          ws.close(1011, "internal error");
        }
        return;
      }

      if (msg.type === "cursor") {
        if (!ws.joinedMapId || !ws.connectionId) return;
        const now = Date.now();
        if (
          ws.lastCursorAt !== undefined &&
          now - ws.lastCursorAt < MIN_CURSOR_INTERVAL_MS
        ) {
          // Defensive rate limit; silently drop.
          return;
        }
        ws.lastCursorAt = now;
        const x = (msg as { x: number }).x;
        const y = (msg as { y: number }).y;
        if (typeof x !== "number" || typeof y !== "number") return;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        updateCursor(ws.joinedMapId, ws.connectionId, x, y);
        broadcast(
          ws.joinedMapId,
          ws.connectionId,
          {
            type: "peer-cursor",
            connectionId: ws.connectionId,
            x,
            y,
          },
          registry,
        );
        return;
      }
    });

    const handleClose = () => {
      const mapId = ws.joinedMapId;
      const connectionId = ws.connectionId;
      if (mapId && connectionId) {
        leaveRoom(mapId, connectionId);
        registry.delete(connectionId);
        broadcast(
          mapId,
          connectionId,
          { type: "peer-leave", connectionId },
          registry,
        );
      }
      ws.joinedMapId = undefined;
      ws.connectionId = undefined;
    };

    ws.on("close", handleClose);
    ws.on("error", (err) => {
      log.warn({ err }, "ws error");
    });
  });

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const ws of wss.clients as Set<PresenceSocket>) {
      const lastPongAt = ws.lastPongAt ?? now;
      if (shouldTerminate(now, lastPongAt)) {
        try {
          ws.terminate();
        } catch {
          // ignore
        }
        continue;
      }
      try {
        ws.ping();
      } catch {
        try {
          ws.terminate();
        } catch {
          // ignore
        }
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => {
    clearInterval(heartbeat);
  });

  log.info({ path: REALTIME_PATH }, "presence websocket server attached");
  return wss;
}
