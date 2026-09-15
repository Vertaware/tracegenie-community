import { URL } from "node:url";

import type { CookieOptions } from "express";

import { env } from "../../config/env";

export const ADMIN_SESSION_COOKIE_NAME = "tracegenie_admin_session";
export const ADMIN_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // Matches the admin JWT lifetime.

export function buildAdminSessionCookieOptions(): CookieOptions {
  const isProduction = env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: isProduction && !env.SERVE_WEB ? "none" : "strict",
    secure: isProduction && new URL(env.ADMIN_APP_URL).protocol === "https:",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_MS,
  };
}

export function parseCookieValue(cookieHeader: string | undefined, cookieName: string) {
  if (!cookieHeader) {
    return undefined;
  }

  for (const segment of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = segment.trim().split("=");
    if (rawName === cookieName) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return undefined;
}

export function isSafeMethod(method: string) {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

export function extractOriginFromRequest(origin?: string, referer?: string) {
  if (origin) {
    return origin;
  }

  if (!referer) {
    return undefined;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
