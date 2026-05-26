import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { SSO_COOKIE_NAME, AUTH_COOKIE_NAME } from "../lib/cookies";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

export interface AuthPayload {
  userId: string;
  email: string;
  source?: string;
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    // Accept SSO cookie first, fall back to legacy cookie for grace period
    : (req.cookies?.[SSO_COOKIE_NAME] ?? req.cookies?.[AUTH_COOKIE_NAME]);

  if (!token) {
    res.status(401).json({ error: "Unauthorized", message: "No token provided" });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or expired token" });
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    // Accept SSO cookie first, fall back to legacy cookie for grace period
    : (req.cookies?.[SSO_COOKIE_NAME] ?? req.cookies?.[AUTH_COOKIE_NAME]);

  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
      req.user = payload;
    } catch {
    }
  }
  next();
}
