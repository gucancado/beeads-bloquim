import type { CorsOptions } from "cors";

const LOCALHOST_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function parseAllowedOriginsEnv(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function buildAllowedOrigins(): string[] {
  const fromEnv = parseAllowedOriginsEnv();
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && fromEnv.length === 0) {
    throw new Error(
      "ALLOWED_ORIGINS environment variable is required in production",
    );
  }

  return fromEnv;
}

const allowedOrigins = buildAllowedOrigins();
const allowDevLocalhost = process.env.NODE_ENV !== "production";

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalized = origin.replace(/\/$/, "");

    if (allowedOrigins.includes(normalized)) {
      callback(null, true);
      return;
    }

    if (allowDevLocalhost && LOCALHOST_REGEX.test(normalized)) {
      callback(null, true);
      return;
    }

    // Lazy require to avoid circular import at module load
    void import("./logger").then(({ logger }) =>
      logger.warn({ origin }, "cors blocked origin"),
    );
    callback(null, false);
  },
  credentials: true,
};
