export type CursorColor =
  | "blue"
  | "green"
  | "red"
  | "orange"
  | "purple"
  | "pink"
  | "teal";

export const CURSOR_COLORS: CursorColor[] = [
  "blue",
  "green",
  "red",
  "orange",
  "purple",
  "pink",
  "teal",
];

export interface PresenceMember {
  connectionId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  color: CursorColor;
}

export interface PresenceMemberWithCursor extends PresenceMember {
  x?: number;
  y?: number;
}

// Client -> Server
export type ClientMessage =
  | { type: "join"; mapId: string }
  | { type: "cursor"; x: number; y: number };

// Server -> Client
export type ServerMessage =
  | {
      type: "welcome";
      connectionId: string;
      color: CursorColor;
      peers: PresenceMemberWithCursor[];
    }
  | { type: "peer-join"; member: PresenceMember }
  | { type: "peer-cursor"; connectionId: string; x: number; y: number }
  | { type: "peer-leave"; connectionId: string }
  | { type: "error"; message: string };
