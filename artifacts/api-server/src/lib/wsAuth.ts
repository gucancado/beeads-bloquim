import jwt from "jsonwebtoken";
import type { IncomingMessage } from "node:http";
import { AUTH_COOKIE_NAME } from "./cookies";
import type { AuthPayload } from "../middlewares/auth";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

function parseCookieHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = header.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (!k) continue;
    let v = part.slice(idx + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function verifyAuthCookie(req: IncomingMessage): AuthPayload | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const cookies = parseCookieHeader(header);
  const token = cookies[AUTH_COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET as string) as unknown as AuthPayload;
  } catch {
    return null;
  }
}
