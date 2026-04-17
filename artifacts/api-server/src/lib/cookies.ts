import type { CookieOptions } from "express";

export const AUTH_COOKIE_NAME = "token";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const authCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: SEVEN_DAYS_MS,
};

export const clearAuthCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
};
