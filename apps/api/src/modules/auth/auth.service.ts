import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { AdminRole,PlatformRole } from "@prisma/client";

import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { randomToken,sha256 } from "../../lib/security";
import { notifyPasswordReset } from "../email/notifications";
import { writePlatformAudit } from "../organizations/access";

type AdminTokenPayload = {
  sub: string;
  email: string;
  role: AdminRole;
  platformRole: PlatformRole;
  passwordChangedAt?: string | null;
};

const ADMIN_JWT_ISSUER = "tracegenie-api";
const ADMIN_JWT_AUDIENCE = "tracegenie-admin";
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export class AuthService {
  async seedDefaultAdmin() {
    if (!env.ADMIN_SEED_EMAIL || !env.ADMIN_SEED_PASSWORD) {
      throw new AppError(500, "auth.seed_not_configured", "Admin seed credentials are not configured.");
    }

    const seedEmail = env.ADMIN_SEED_EMAIL.toLowerCase().trim();
    const existing = await prisma.adminUser.findUnique({
      where: { email: seedEmail },
    });

    if (existing) {
      return existing;
    }

    const passwordHash = await bcrypt.hash(env.ADMIN_SEED_PASSWORD, 10);

    return prisma.adminUser.create({
      data: {
        email: seedEmail,
        name: env.ADMIN_SEED_NAME ?? "TraceGenie Admin",
        passwordHash,
        role: "ADMIN",
        platformRole: "USER",
        isActive: true,
      },
    });
  }

  async signup(input: { email: string; password: string; name: string }) {
    const normalizedEmail = input.email.toLowerCase().trim();
    const existing = await prisma.adminUser.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      throw new AppError(400, "auth.email_in_use", "A user with this email already exists.");
    }

    const passwordHash = await bcrypt.hash(input.password, 10);

    const user = await prisma.adminUser.create({
      data: {
        email: normalizedEmail,
        name: input.name.trim(),
        passwordHash,
        role: "ADMIN",
        platformRole: "USER",
        isActive: true,
      },
    });

    return this.createSession(user.id);
  }

  async login(email: string, password: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await prisma.adminUser.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.isActive) {
      throw new AppError(401, "auth.invalid_credentials", "Invalid email or password.");
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      throw new AppError(401, "auth.invalid_credentials", "Invalid email or password.");
    }

    await prisma.adminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.createSession(user.id);
  }

  async requestPasswordReset(email: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await prisma.adminUser.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.isActive) {
      return { ok: true };
    }

    const token = randomToken() + randomToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
    await prisma.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        consumedAt: now,
      },
    });
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt,
      },
    });

    const resetUrl = `${env.ADMIN_APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    const emailDelivery = await notifyPasswordReset({
      to: user.email,
      resetUrl,
    });
    await writePlatformAudit({
      actorUserId: user.id,
      eventType: "auth.password_reset_requested",
      afterJson: {
        email: user.email,
        emailDelivery,
      },
    });

    return { ok: true };
  }

  async resetPassword(input: { token: string; password: string }) {
    const now = new Date();
    const tokenHash = sha256(input.token);
    const passwordHash = await bcrypt.hash(input.password, 10);
    let userId = "";

    await prisma.$transaction(async (transaction) => {
      const consumed = await transaction.passwordResetToken.updateMany({
        where: {
          tokenHash,
          consumedAt: null,
          expiresAt: {
            gt: now,
          },
          user: {
            isActive: true,
          },
        },
        data: {
          consumedAt: now,
        },
      });
      if (consumed.count !== 1) {
        throw new AppError(400, "auth.invalid_password_reset", "This password reset link is invalid or expired.");
      }

      const resetToken = await transaction.passwordResetToken.findUniqueOrThrow({
        where: { tokenHash },
      });
      userId = resetToken.userId;

      await transaction.adminUser.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash,
          lastLoginAt: now,
          passwordChangedAt: now,
        },
      });
      await writePlatformAudit({
        actorUserId: resetToken.userId,
        eventType: "auth.password_reset_completed",
      }, transaction);
    });

    return this.createSession(userId);
  }

  async createSession(userId: string) {
    const user = await prisma.adminUser.findUniqueOrThrow({
      where: { id: userId },
    });

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        platformRole: user.platformRole,
        passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
      } satisfies AdminTokenPayload,
      env.JWT_SECRET,
      {
        expiresIn: "12h",
        issuer: ADMIN_JWT_ISSUER,
        audience: ADMIN_JWT_AUDIENCE,
      },
    );

    return {
      sessionToken: token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        platformRole: user.platformRole,
      },
    };
  }

  verifyToken(token: string) {
    try {
      return jwt.verify(token, env.JWT_SECRET, {
        issuer: ADMIN_JWT_ISSUER,
        audience: ADMIN_JWT_AUDIENCE,
      }) as AdminTokenPayload;
    } catch (error) {
      throw new AppError(401, "auth.invalid_token", "Your session has expired. Please sign in again.", error);
    }
  }
}

export const authService = new AuthService();
