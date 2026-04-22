import { memo } from "react";
import { useStore } from "reactflow";
import { cursorColorHex } from "./cursorColors";
import type { PresencePeer } from "./usePresenceChannel";

interface Props {
  peers: PresencePeer[];
}

function CursorArrow({ color }: { color: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.35))" }}
    >
      <path
        d="M2 2 L2 18 L7 13.5 L10 20 L13 18.5 L10 12 L17 12 Z"
        fill={color}
        stroke="white"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PresenceCursorsOverlayInner({ peers }: Props) {
  // Subscribe to viewport so cursors stay anchored to flow coordinates.
  const tx = useStore((s) => s.transform[0]);
  const ty = useStore((s) => s.transform[1]);
  const zoom = useStore((s) => s.transform[2]);

  const visiblePeers = peers.filter(
    (p) => typeof p.x === "number" && typeof p.y === "number",
  );

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 5,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transformOrigin: "0 0",
          transform: `translate(${tx}px, ${ty}px) scale(${zoom})`,
          width: 0,
          height: 0,
          pointerEvents: "none",
        }}
      >
        {visiblePeers.map((p) => {
          const color = cursorColorHex(p.color);
          const initials = (p.name || "?").trim().charAt(0).toUpperCase();
          const shortName = (p.name || "").trim().split(/\s+/)[0] ?? "";
          return (
            <div
              key={p.connectionId}
              style={{
                position: "absolute",
                left: `${p.x}px`,
                top: `${p.y}px`,
                transform: `scale(${1 / zoom})`,
                transformOrigin: "0 0",
                pointerEvents: "none",
                willChange: "left, top, transform",
              }}
            >
              <CursorArrow color={color} />
              <div
                style={{
                  position: "absolute",
                  left: "16px",
                  top: "18px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  background: color,
                  color: "white",
                  padding: "2px 8px 2px 2px",
                  borderRadius: "999px",
                  fontSize: "11px",
                  fontWeight: 500,
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                  maxWidth: "180px",
                }}
              >
                {p.avatarUrl ? (
                  <img
                    src={p.avatarUrl}
                    alt=""
                    style={{
                      width: "18px",
                      height: "18px",
                      borderRadius: "999px",
                      objectFit: "cover",
                      border: "1.5px solid white",
                      flexShrink: 0,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "18px",
                      height: "18px",
                      borderRadius: "999px",
                      background: "rgba(255,255,255,0.25)",
                      border: "1.5px solid white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "10px",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {initials}
                  </div>
                )}
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: "140px",
                  }}
                >
                  {shortName}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const PresenceCursorsOverlay = memo(PresenceCursorsOverlayInner);
