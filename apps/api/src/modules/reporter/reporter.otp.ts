import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { hmacSha256 } from "../../lib/security";

export const REPORTER_OTP_TTL_MS = 10 * 60 * 1000;
export const REPORTER_OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const REPORTER_OTP_MAX_ATTEMPTS = 5;

export function hashReporterOtpCode(email: string, code: string) {
  return hmacSha256(`${email.toLowerCase().trim()}:${code.trim()}`, env.JWT_SECRET);
}

export async function createReporterOtp(email: string, code: string, now = new Date()) {
  const normalizedEmail = email.toLowerCase().trim();
  const recentOtp = await prisma.reporterOtp.findFirst({
    where: {
      email: normalizedEmail,
      usedAt: null,
      createdAt: { gt: new Date(now.getTime() - REPORTER_OTP_RESEND_COOLDOWN_MS) },
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });

  if (recentOtp) {
    return { created: false as const };
  }

  await prisma.reporterOtp.updateMany({
    where: {
      email: normalizedEmail,
      usedAt: null,
    },
    data: { usedAt: now },
  });

  const otp = await prisma.reporterOtp.create({
    data: {
      email: normalizedEmail,
      codeHash: hashReporterOtpCode(normalizedEmail, code),
      expiresAt: new Date(now.getTime() + REPORTER_OTP_TTL_MS),
    },
  });

  return { created: true as const, otp };
}

export async function consumeReporterOtp(email: string, code: string, now = new Date()) {
  const normalizedEmail = email.toLowerCase().trim();
  const codeHash = hashReporterOtpCode(normalizedEmail, code);
  const consumed = await prisma.reporterOtp.updateMany({
    where: {
      email: normalizedEmail,
      codeHash,
      usedAt: null,
      expiresAt: { gt: now },
      attemptCount: { lt: REPORTER_OTP_MAX_ATTEMPTS },
    },
    data: {
      usedAt: now,
      lastAttemptAt: now,
    },
  });

  if (consumed.count === 1) {
    return true;
  }

  await prisma.reporterOtp.updateMany({
    where: {
      email: normalizedEmail,
      usedAt: null,
      expiresAt: { gt: now },
      attemptCount: { lt: REPORTER_OTP_MAX_ATTEMPTS },
    },
    data: {
      attemptCount: { increment: 1 },
      lastAttemptAt: now,
    },
  });

  return false;
}
