import test from "node:test";
import assert from "node:assert/strict";

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { sha256 } from "../../lib/security";
import { authService } from "./auth.service";

const adminPayload = {
  sub: "admin-user-id",
  email: "admin@example.test",
  role: "ADMIN",
  platformRole: "USER",
};

test("admin session verification requires the TraceGenie admin token audience", () => {
  const legacyToken = jwt.sign(adminPayload, env.JWT_SECRET, { expiresIn: "12h" });
  const wrongAudienceToken = jwt.sign(adminPayload, env.JWT_SECRET, {
    expiresIn: "12h",
    issuer: "tracegenie-api",
    audience: "tracegenie-widget",
  });
  const adminToken = jwt.sign(adminPayload, env.JWT_SECRET, {
    expiresIn: "12h",
    issuer: "tracegenie-api",
    audience: "tracegenie-admin",
  });

  for (const token of [legacyToken, wrongAudienceToken]) {
    assert.throws(
      () => authService.verifyToken(token),
      (error) => error instanceof AppError && error.code === "auth.invalid_token",
    );
  }

  assert.equal(authService.verifyToken(adminToken).sub, adminPayload.sub);
});

async function createPasswordResetUser(email: string, password = "OldPassword123!") {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.adminUser.create({
    data: {
      email,
      name: "Password Reset User",
      passwordHash,
      role: "ADMIN",
      platformRole: "USER",
      isActive: true,
    },
  });
}

async function cleanupPasswordResetUser(userId: string, email: string) {
  await prisma.platformAuditEvent.deleteMany({
    where: { actorUserId: userId },
  });
  await prisma.adminUser.delete({
    where: { id: userId },
  }).catch(() => undefined);
  await prisma.adminUser.delete({
    where: { email },
  }).catch(() => undefined);
}

test("password reset request creates a single active token without exposing account existence", async () => {
  const email = `reset-request-${Date.now()}@example.test`;
  const user = await createPasswordResetUser(email);

  try {
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256("existing-reset-token"),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    assert.deepEqual(await authService.requestPasswordReset(email), { ok: true });
    assert.deepEqual(await authService.requestPasswordReset(`missing-${email}`), { ok: true });

    const tokens = await prisma.passwordResetToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(tokens.length, 2);
    assert.ok(tokens[0]?.consumedAt);
    assert.equal(tokens[1]?.consumedAt, null);

    const missingUser = await prisma.adminUser.findUnique({
      where: { email: `missing-${email}` },
    });
    assert.equal(missingUser, null);
  } finally {
    await cleanupPasswordResetUser(user.id, email);
  }
});

test("password reset consumes the token and updates the password once", async () => {
  const email = `reset-confirm-${Date.now()}@example.test`;
  const user = await createPasswordResetUser(email);
  const token = "valid-reset-token-1234567890";

  try {
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const session = await authService.resetPassword({
      token,
      password: "NewPassword123!",
    });
    assert.equal(session.user.email, email);

    const updated = await prisma.adminUser.findUniqueOrThrow({
      where: { id: user.id },
    });
    assert.equal(await bcrypt.compare("NewPassword123!", updated.passwordHash), true);
    assert.equal(await bcrypt.compare("OldPassword123!", updated.passwordHash), false);
    assert.ok(updated.passwordChangedAt);

    const consumed = await prisma.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: sha256(token) },
    });
    assert.ok(consumed.consumedAt);

    await assert.rejects(
      () => authService.resetPassword({ token, password: "AnotherPassword123!" }),
      (error) => error instanceof AppError && error.code === "auth.invalid_password_reset",
    );
  } finally {
    await cleanupPasswordResetUser(user.id, email);
  }
});

test("password reset token can only be consumed once under concurrent attempts", async () => {
  const email = `reset-concurrent-${Date.now()}@example.test`;
  const user = await createPasswordResetUser(email);
  const token = "concurrent-reset-token-1234567890";

  try {
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const results = await Promise.allSettled([
      authService.resetPassword({ token, password: "NewPassword123!" }),
      authService.resetPassword({ token, password: "AnotherPassword123!" }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected") as Array<PromiseRejectedResult>;

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0]?.reason instanceof AppError);
    assert.equal((rejected[0]?.reason as AppError).code, "auth.invalid_password_reset");

    const consumed = await prisma.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: sha256(token) },
    });
    assert.ok(consumed.consumedAt);
  } finally {
    await cleanupPasswordResetUser(user.id, email);
  }
});
