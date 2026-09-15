import test from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/errors";
import { authService } from "./auth.service";
import { requireAdmin } from "./auth.middleware";

async function runMiddleware(handler: RequestHandler, request: Partial<Request>) {
  return new Promise<unknown>((resolve) => {
    handler(request as Request, {} as Response, ((error?: unknown) => resolve(error)) as NextFunction);
  });
}

function requestWithHeaders(method: string, headers: Record<string, string>): Partial<Request> {
  const normalizedHeaders = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const request: Partial<Request> = {
    method,
  };
  request.header = ((name: string) => normalizedHeaders.get(name.toLowerCase())) as Request["header"];
  return request;
}

test("admin bearer mutations require an allowed origin", async () => {
  const user = await prisma.adminUser.create({
    data: {
      email: `bearer-origin-${Date.now()}@traceitgenie.test`,
      name: "Bearer Origin Admin",
      passwordHash: "not-used",
      role: "ADMIN",
      platformRole: "USER",
    },
  });

  try {
    const { sessionToken } = await authService.createSession(user.id);
    const error = await runMiddleware(
      requireAdmin,
      requestWithHeaders("POST", {
        authorization: `Bearer ${sessionToken}`,
        origin: "https://evil.example",
      }),
    );

    assert.ok(error instanceof AppError);
    assert.equal(error.code, "auth.invalid_origin");
  } finally {
    await prisma.adminUser.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});

test("admin bearer safe reads do not require an origin", async () => {
  const user = await prisma.adminUser.create({
    data: {
      email: `bearer-safe-${Date.now()}@traceitgenie.test`,
      name: "Bearer Safe Admin",
      passwordHash: "not-used",
      role: "ADMIN",
      platformRole: "USER",
    },
  });

  try {
    const { sessionToken } = await authService.createSession(user.id);
    const request = requestWithHeaders("GET", {
      authorization: `Bearer ${sessionToken}`,
    });
    const error = await runMiddleware(requireAdmin, request);

    assert.equal(error, undefined);
    assert.equal(request.adminUser?.id, user.id);
  } finally {
    await prisma.adminUser.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});

test("admin sessions issued before password changes are rejected", async () => {
  const user = await prisma.adminUser.create({
    data: {
      email: `bearer-stale-${Date.now()}@traceitgenie.test`,
      name: "Bearer Stale Admin",
      passwordHash: "not-used",
      role: "ADMIN",
      platformRole: "USER",
    },
  });

  try {
    const { sessionToken } = await authService.createSession(user.id);
    await prisma.adminUser.update({
      where: { id: user.id },
      data: {
        passwordChangedAt: new Date(),
      },
    });
    const error = await runMiddleware(
      requireAdmin,
      requestWithHeaders("GET", {
        authorization: `Bearer ${sessionToken}`,
      }),
    );

    assert.ok(error instanceof AppError);
    assert.equal(error.code, "auth.stale_session");
  } finally {
    await prisma.adminUser.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});
