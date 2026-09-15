import type { NextFunction,Request,Response } from "express";

import { AdminRole } from "@prisma/client";

import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { asyncMiddleware } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { authService } from "./auth.service";
import {
ADMIN_SESSION_COOKIE_NAME,
extractOriginFromRequest,
isSafeMethod,
parseCookieValue,
} from "./auth.session";

declare module "express-serve-static-core" {
  interface Request {
    adminUser?: {
      id: string;
      email: string;
      role: string;
      platformRole: string;
      name: string;
    };
  }
}

async function authenticateRequest(request: Request) {
  const authorization = request.header("authorization");
  const bearerToken = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
  const cookieToken = parseCookieValue(request.header("cookie"), ADMIN_SESSION_COOKIE_NAME);
  const token = bearerToken ?? cookieToken;

  if (!token) {
    throw new AppError(401, "auth.missing_token", "Admin authentication is required.");
  }

  const payload = authService.verifyToken(token);
  const user = await prisma.adminUser.findUnique({
    where: { id: payload.sub },
  });

  if (!user || !user.isActive) {
    throw new AppError(401, "auth.invalid_user", "Your admin account is unavailable.");
  }
  const currentPasswordVersion = user.passwordChangedAt?.toISOString() ?? null;
  if ((payload.passwordChangedAt ?? null) !== currentPasswordVersion) {
    throw new AppError(401, "auth.stale_session", "Your admin session is no longer valid.");
  }

  request.adminUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    platformRole: user.platformRole,
    name: user.name,
  };

  if (token && !isSafeMethod(request.method)) {
    const requestOrigin = extractOriginFromRequest(request.header("origin"), request.header("referer"));
    if (!requestOrigin || !env.corsOrigins.includes(requestOrigin)) {
      throw new AppError(403, "auth.invalid_origin", "This request origin is not allowed.");
    }
  }
}

export const requireGlobalAdmin = asyncMiddleware(async (request: Request, _response: Response, next: NextFunction) => {
  await authenticateRequest(request);

  if (request.adminUser?.platformRole !== "GLOBAL_ADMIN") {
    throw new AppError(403, "auth.global_admin_required", "TraceGenie global admin access is required.");
  }

  next();
});

export const requireAdmin = asyncMiddleware(async (request: Request, _response: Response, next: NextFunction) => {
  await authenticateRequest(request);

  next();
});

export function requireRole(...allowedRoles: AdminRole[]) {
  return asyncMiddleware(async (request: Request, _response: Response, next: NextFunction) => {
    await authenticateRequest(request);

    if (!request.adminUser || !allowedRoles.includes(request.adminUser.role as AdminRole)) {
      throw new AppError(403, "auth.insufficient_role", "Your account does not have permission to perform this action.");
    }

    next();
  });
}
