// Sentry instrumentation must load first to patch HTTP/undici before they're
// imported transitively by app.ts.
import "./instrument";
import { createServer } from "node:http";
import app from "./app";
import { startScheduler } from "./scheduler";
import { logger } from "./lib/logger";
import { captureException } from "./lib/sentry";
import { attachPresenceServer } from "./realtime/presenceServer";

// Without this, an unhandled promise rejection in a non-request context
// (scheduler, ws handler) crashes the process silently and we lose the cause.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandledRejection");
  captureException(reason);
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaughtException");
  captureException(err);
});

const rawPort = process.env["API_PORT"] ?? process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "API_PORT (or PORT) environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);
attachPresenceServer(httpServer);

httpServer.listen(port, () => {
  logger.info({ port, env: process.env.NODE_ENV ?? "development" }, "server listening");
  startScheduler();
});
