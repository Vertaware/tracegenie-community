import test from "node:test";
import assert from "node:assert/strict";

import { prisma } from "../../lib/prisma";
import {
  consumeReporterOtp,
  createReporterOtp,
  hashReporterOtpCode,
  REPORTER_OTP_MAX_ATTEMPTS,
  REPORTER_OTP_RESEND_COOLDOWN_MS,
} from "./reporter.otp";

function testEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@traceitgenie.test`;
}

test("reporter OTP hashes with email-bound HMAC and can be consumed once", async () => {
  const email = testEmail("reporter-otp-consume");

  try {
    const created = await createReporterOtp(email, "123456");
    assert.equal(created.created, true);
    const stored = await prisma.reporterOtp.findFirstOrThrow({ where: { email } });
    assert.equal(stored.codeHash, hashReporterOtpCode(email, "123456"));
    assert.notEqual(stored.codeHash, hashReporterOtpCode("other@example.test", "123456"));

    assert.equal(await consumeReporterOtp(email, "123456"), true);
    assert.equal(await consumeReporterOtp(email, "123456"), false);
  } finally {
    await prisma.reporterOtp.deleteMany({ where: { email } });
  }
});

test("reporter OTP resend cooldown avoids creating duplicate live codes", async () => {
  const email = testEmail("reporter-otp-cooldown");
  const now = new Date();

  try {
    const first = await createReporterOtp(email, "123456", now);
    const second = await createReporterOtp(email, "654321", new Date(now.getTime() + REPORTER_OTP_RESEND_COOLDOWN_MS - 1));
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(await prisma.reporterOtp.count({ where: { email, usedAt: null } }), 1);
  } finally {
    await prisma.reporterOtp.deleteMany({ where: { email } });
  }
});

test("reporter OTP invalid attempts lock out the live code", async () => {
  const email = testEmail("reporter-otp-attempts");

  try {
    await createReporterOtp(email, "123456");
    for (let index = 0; index < REPORTER_OTP_MAX_ATTEMPTS; index += 1) {
      assert.equal(await consumeReporterOtp(email, "000000"), false);
    }
    assert.equal(await consumeReporterOtp(email, "123456"), false);

    const stored = await prisma.reporterOtp.findFirstOrThrow({ where: { email } });
    assert.equal(stored.attemptCount, REPORTER_OTP_MAX_ATTEMPTS);
    assert.ok(stored.lastAttemptAt);
  } finally {
    await prisma.reporterOtp.deleteMany({ where: { email } });
  }
});
