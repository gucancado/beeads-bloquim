import type { CookieOptions } from "express";

// Legacy cookie — kept for ~2 weeks grace period so active sessions are not
// invalidated on migration day. Read by requireAuth alongside SSO_COOKIE_NAME.
export const AUTH_COOKIE_NAME = "token";

// New shared cookie visible across all *.beeads.com.br subdomains (SSO).
export const SSO_COOKIE_NAME = "__beeads_session";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const isProd = process.env.NODE_ENV === "production";

// COOKIE_DOMAIN permite compartilhar o cookie entre subdomínios do mesmo site
// (ex.: ".beeads.com.br" deixa bloquim.beeads.com.br e painel.beeads.com.br
// enxergarem o mesmo token). Não setar em dev/test pra não quebrar localhost.
const cookieDomain = process.env.COOKIE_DOMAIN || undefined;

const baseAuthOptions: CookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax",
  path: "/",
  maxAge: SEVEN_DAYS_MS,
};

// Legacy cookie options (unchanged — no explicit domain unless COOKIE_DOMAIN is set).
export const authCookieOptions: CookieOptions = {
  ...baseAuthOptions,
  ...(cookieDomain ? { domain: cookieDomain } : {}),
};

// SSO cookie options — domain is always .beeads.com.br in production so the
// cookie is readable by painel.beeads.com.br, agentes.beeads.com.br, etc.
export const ssoCookieOptions: CookieOptions = {
  ...baseAuthOptions,
  domain: isProd ? ".beeads.com.br" : undefined,
};

const baseClearOptions: CookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax",
  path: "/",
};

export const clearAuthCookieOptions: CookieOptions = {
  ...baseClearOptions,
  ...(cookieDomain ? { domain: cookieDomain } : {}),
};

export const clearSsoCookieOptions: CookieOptions = {
  ...baseClearOptions,
  domain: isProd ? ".beeads.com.br" : undefined,
};
