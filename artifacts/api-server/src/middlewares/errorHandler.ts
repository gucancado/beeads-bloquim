import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { ApiError } from "../lib/errors";
import { logger } from "../lib/logger";

const isProduction = process.env.NODE_ENV === "production";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation error",
      code: "VALIDATION_ERROR",
      message: "Os dados enviados são inválidos.",
      issues: err.issues.map((i) => ({
        path: i.path.join("."),
        code: i.code,
        message: i.message,
      })),
    });
    return;
  }

  if (err instanceof ApiError) {
    const body: Record<string, unknown> = {
      error: err.name,
      code: err.code,
      message: err.message,
    };
    if (err.details !== undefined) body.details = err.details;
    res.status(err.statusCode).json(body);
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logger.error(
    {
      reqId: req.id,
      method: req.method,
      path: req.originalUrl ?? req.path,
      err: { message, stack },
    },
    "unhandled request error",
  );

  res.status(500).json({
    error: "Internal Server Error",
    code: "INTERNAL_ERROR",
    message: isProduction ? "Ocorreu um erro inesperado. Tente novamente." : message,
    ...(isProduction ? {} : { stack }),
  });
}
