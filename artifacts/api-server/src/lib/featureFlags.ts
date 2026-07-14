import type { Request, Response, NextFunction } from "express";

export type StorageProvider = "disabled" | "s3";

export function getStorageProvider(): StorageProvider {
  const raw = (process.env.STORAGE_PROVIDER ?? "disabled").toLowerCase();
  return raw === "s3" ? "s3" : "disabled";
}

export function isStorageEnabled(): boolean {
  return getStorageProvider() !== "disabled";
}

export function isGoogleCalendarEnabled(): boolean {
  const flag = (process.env.GOOGLE_CALENDAR_ENABLED ?? "false").toLowerCase();
  if (flag !== "true") return false;
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

export function isMeetingsEnabled(): boolean {
  const flag = (process.env.MEETINGS_ENABLED ?? "false").toLowerCase();
  if (flag !== "true") return false;
  return Boolean(process.env.WORKER_URL && process.env.WORKER_PANEL_TOKEN);
}

export function requireStorage(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isStorageEnabled()) {
    res.status(503).json({
      error: "storage_disabled",
      message:
        "Upload de arquivos está desabilitado neste ambiente (STORAGE_PROVIDER=disabled).",
    });
    return;
  }
  next();
}

export function requireGoogleCalendar(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isGoogleCalendarEnabled()) {
    res.status(503).json({
      error: "google_calendar_disabled",
      message:
        "Integração com Google Calendar está desabilitada neste ambiente.",
    });
    return;
  }
  next();
}

export function requireMeetings(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isMeetingsEnabled()) {
    res.status(503).json({
      error: "meetings_disabled",
      message: "Integração de reuniões está desabilitada neste ambiente.",
    });
    return;
  }
  next();
}
