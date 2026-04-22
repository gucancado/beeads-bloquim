import { useCallback, useEffect, useRef, useState } from "react";
import type { CursorColor } from "./cursorColors";

export interface PresencePeer {
  connectionId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  color: CursorColor;
  x?: number;
  y?: number;
}

type ServerMessage =
  | {
      type: "welcome";
      connectionId: string;
      color: CursorColor;
      peers: PresencePeer[];
    }
  | { type: "peer-join"; member: PresencePeer }
  | { type: "peer-cursor"; connectionId: string; x: number; y: number }
  | { type: "peer-leave"; connectionId: string }
  | { type: "error"; message: string };

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
const MIN_SEND_INTERVAL_MS = 50; // ~20 Hz

function buildWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/realtime/presence`;
}

export interface UsePresenceChannelResult {
  peers: PresencePeer[];
  sendCursor: (x: number, y: number) => void;
  ownConnectionId: string | null;
  connected: boolean;
}

export function usePresenceChannel(mapId: string | null): UsePresenceChannelResult {
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [ownConnectionId, setOwnConnectionId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectIdxRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const closedByUserRef = useRef(false);
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);
  const lastSentAtRef = useRef(0);
  const flushTimerRef = useRef<number | null>(null);
  const lastSentValueRef = useRef<{ x: number; y: number } | null>(null);

  const sendIfReady = useCallback((payload: object) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, []);

  const flushCursor = useCallback(() => {
    flushTimerRef.current = null;
    const pending = pendingCursorRef.current;
    if (!pending) return;
    pendingCursorRef.current = null;
    lastSentAtRef.current = Date.now();
    lastSentValueRef.current = pending;
    sendIfReady({ type: "cursor", x: pending.x, y: pending.y });
  }, [sendIfReady]);

  const sendCursor = useCallback(
    (x: number, y: number) => {
      const last = lastSentValueRef.current;
      if (last && last.x === x && last.y === y && !pendingCursorRef.current) {
        return;
      }
      pendingCursorRef.current = { x, y };
      const now = Date.now();
      const wait = MIN_SEND_INTERVAL_MS - (now - lastSentAtRef.current);
      if (wait <= 0) {
        if (flushTimerRef.current !== null) {
          window.clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        flushCursor();
      } else if (flushTimerRef.current === null) {
        flushTimerRef.current = window.setTimeout(flushCursor, wait);
      }
    },
    [flushCursor],
  );

  useEffect(() => {
    if (!mapId) return;
    closedByUserRef.current = false;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const url = buildWsUrl();
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) {
          ws.close();
          return;
        }
        reconnectIdxRef.current = 0;
        setConnected(true);
        try {
          ws.send(JSON.stringify({ type: "join", mapId }));
        } catch {
          // ignore
        }
      };

      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data) as ServerMessage;
        } catch {
          return;
        }
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "welcome") {
          setOwnConnectionId(msg.connectionId);
          setPeers(msg.peers);
        } else if (msg.type === "peer-join") {
          setPeers((prev) => {
            if (prev.some((p) => p.connectionId === msg.member.connectionId)) {
              return prev;
            }
            return [...prev, msg.member];
          });
        } else if (msg.type === "peer-cursor") {
          setPeers((prev) =>
            prev.map((p) =>
              p.connectionId === msg.connectionId
                ? { ...p, x: msg.x, y: msg.y }
                : p,
            ),
          );
        } else if (msg.type === "peer-leave") {
          setPeers((prev) =>
            prev.filter((p) => p.connectionId !== msg.connectionId),
          );
        }
      };

      ws.onerror = () => {
        // onclose will follow
      };

      ws.onclose = () => {
        wsRef.current = null;
        setConnected(false);
        setOwnConnectionId(null);
        setPeers([]);
        if (!closedByUserRef.current && !cancelled) {
          scheduleReconnect();
        }
      };
    };

    const scheduleReconnect = () => {
      if (cancelled || closedByUserRef.current) return;
      const idx = Math.min(
        reconnectIdxRef.current,
        RECONNECT_DELAYS_MS.length - 1,
      );
      const delay = RECONNECT_DELAYS_MS[idx]!;
      reconnectIdxRef.current = idx + 1;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    connect();

    const handleBeforeUnload = () => {
      closedByUserRef.current = true;
      try {
        wsRef.current?.close(1000);
      } catch {
        // ignore
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      cancelled = true;
      closedByUserRef.current = true;
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingCursorRef.current = null;
      lastSentValueRef.current = null;
      lastSentAtRef.current = 0;
      try {
        wsRef.current?.close(1000);
      } catch {
        // ignore
      }
      wsRef.current = null;
      setPeers([]);
      setConnected(false);
      setOwnConnectionId(null);
    };
  }, [mapId]);

  return { peers, sendCursor, ownConnectionId, connected };
}
