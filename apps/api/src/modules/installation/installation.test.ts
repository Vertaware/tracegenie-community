import assert from "node:assert/strict";
import test from "node:test";
import { installationInputSchema, validSetupToken } from "./installation.router";
const input = { token: "a".repeat(64), name: "Owner", email: "OWNER@example.test", password: "a-long-password", projectName: "Project" };
test("setup input normalizes email and bounds password bytes without truncation", () => {
  assert.equal(installationInputSchema.parse(input).email, "owner@example.test");
  for (const password of ["short", "x".repeat(73), "é".repeat(40)]) assert.equal(installationInputSchema.safeParse({ ...input, password }).success, false);
  assert.equal(installationInputSchema.safeParse({ ...input, unknown: true }).success, false);
});
test("a disabled or mismatched bootstrap code is rejected", () => {
  assert.equal(validSetupToken(input.token, undefined), false);
  assert.equal(validSetupToken(input.token, "b".repeat(64)), false);
  assert.equal(validSetupToken(input.token, input.token), true);
});

test("self-hosted cookies stay same-site and require TLS on HTTPS installations", async () => {
  const { env } = await import("../../config/env");
  const { buildAdminSessionCookieOptions } = await import("../auth/auth.session");
  const previous = { NODE_ENV: env.NODE_ENV, SERVE_WEB: env.SERVE_WEB, ADMIN_APP_URL: env.ADMIN_APP_URL };
  try {
    env.NODE_ENV = "production"; env.SERVE_WEB = true;
    env.ADMIN_APP_URL = "http://localhost:8088";
    assert.equal(buildAdminSessionCookieOptions().sameSite, "strict");
    assert.equal(buildAdminSessionCookieOptions().secure, false);
    env.ADMIN_APP_URL = "https://feedback.example.test";
    assert.equal(buildAdminSessionCookieOptions().secure, true);
    assert.equal(buildAdminSessionCookieOptions().httpOnly, true);
  } finally { Object.assign(env, previous); }
});
