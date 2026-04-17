import { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger";
import type { AuthRequest } from "./auth";

declare module "express-serve-static-core" {
  interface Request {
    id?: string;
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const reqId = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
  req.id = reqId;
  res.setHeader("x-request-id", reqId);

  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const userId = (req as AuthRequest).user?.userId;

    logger.info(
      {
        reqId,
        method: req.method,
        path: req.originalUrl ?? req.url,
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(1)),
        userId,
      },
      "request",
    );
  });

  next();
}
