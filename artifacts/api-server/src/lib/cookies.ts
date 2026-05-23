import type { CookieOptions } from "express";

export const AUTH_COOKIE_NAME = "token";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// COOKIE_DOMAIN permite compartilhar o cookie entre subdomínios do mesmo site
// (ex.: ".beeads.com.br" deixa bloquim.beeads.com.br e painel.beeads.com.br
// enxergarem o mesmo token). Não setar em dev/test pra não quebrar localhost.
const cookieDomain = process.env.COOKIE_DOMAIN || undefined;

export const authCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: SEVEN_DAYS_MS,
  ...(cookieDomain ? { domain: cookieDomain } : {}),
};

export const clearAuthCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  ...(cookieDomain ? { domain: cookieDomain } : {}),
};
