import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
const level = process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug");

export const logger = pino(
  {
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "req.headers.cookie",
        "req.headers.authorization",
        "password",
        "token",
        "*.password",
        "*.token",
      ],
      remove: true,
    },
  },
  isProduction
    ? pino.destination({ sync: false })
    : pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname",
          singleLine: false,
        },
      }),
);

export type Logger = typeof logger;
