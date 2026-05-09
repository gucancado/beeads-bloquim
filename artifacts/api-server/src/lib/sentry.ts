import * as Sentry from "@sentry/node";
import type { Express } from "express";
import { logger } from "./logger";

let initialized = false;

/**
 * Initialize Sentry. No-op when SENTRY_DSN is unset, so dev/CI environments
 * stay quiet. Must be called before app.use(...) so the SDK can wrap Express.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info({ module: "sentry" }, "SENTRY_DSN not set — error tracking disabled");
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE,
    // Sample 10% of traces in prod; full in non-prod. Adjust later.
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  });

  initialized = true;
  logger.info({ module: "sentry", env: process.env.NODE_ENV }, "Sentry initialized");
}

/**
 * Attach the Express error handler. Call AFTER all routes, BEFORE the app's
 * own errorHandler. No-op when Sentry wasn't initialized.
 */
export function attachSentryErrorHandler(app: Express): void {
  if (!initialized) return;
  Sentry.setupExpressErrorHandler(app);
}

/**
 * Capture a non-request exception (e.g. scheduler failure, unhandledRejection).
 * No-op when Sentry wasn't initialized.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
