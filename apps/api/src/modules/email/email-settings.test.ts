import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import type { EmailSettings } from "@prisma/client";
import { emailSettingsInputSchema, type EmailSettingsInput } from "@tracegenie/shared";
import type { EmailServiceConfig } from "@vertaware/email";

import { decryptSecret, encryptSecret } from "../../lib/security";
import { createInstallationMailer, formatSender, prepareEmailSettings, publicEmailSettings, safeEmailError, type ResolvedEmailSettings } from "./email-settings.service";

const key = randomBytes(32).toString("hex");
const input: EmailSettingsInput = {
  revision: null, provider: "resend", host: "ignored.example.test", port: 25, secure: false, user: "ignored",
  credential: "re_test_not_a_real_key", fromName: "Community", fromEmail: "reports@example.test", replyTo: "",
};
function record(): EmailSettings {
  return { id: "community", ...prepareEmailSettings(input, null, key), updatedAt: new Date() };
}

test("Resend fixes its SMTP connection and encrypts credentials with randomized authenticated encryption", () => {
  const first = record();
  const second = record();
  assert.equal(first.host, "smtp.resend.com");
  assert.equal(first.port, 465);
  assert.equal(first.secure, true);
  assert.equal(first.user, "resend");
  assert.notEqual(first.credentialEncrypted, input.credential);
  assert.notEqual(first.credentialEncrypted, second.credentialEncrypted);
  assert.equal(decryptSecret(first.credentialEncrypted!, key), input.credential);
  assert.throws(() => decryptSecret(first.credentialEncrypted!, randomBytes(32).toString("hex")));
});

test("public settings never return a plaintext key or encrypted credential", () => {
  const stored = record();
  const view = publicEmailSettings(stored);
  assert.equal(view.hasCredential, true);
  assert.equal(view.source, "settings");
  assert.equal(view.configured, true);
  assert.ok(!JSON.stringify(view).includes(input.credential!));
  assert.ok(!JSON.stringify(view).includes(stored.credentialEncrypted!));
  assert.ok(!("credential" in view));
  assert.ok(!("credentialEncrypted" in view));
});

test("ordinary edits preserve the saved key; replacing it encrypts the new value and clears test status", () => {
  const stored = { ...record(), lastTestAt: new Date() };
  const kept = prepareEmailSettings({ ...input, credential: undefined, fromName: "Updated" }, stored, key);
  assert.equal(kept.credentialEncrypted, stored.credentialEncrypted);
  assert.equal(kept.lastTestAt, null);
  assert.notEqual(kept.revision, stored.revision);
  const replaced = prepareEmailSettings({ ...input, credential: "re_replacement_fixture" }, stored, key);
  assert.equal(decryptSecret(replaced.credentialEncrypted!, key), "re_replacement_fixture");
  assert.throws(() => prepareEmailSettings({ ...input, credential: null }, stored, key), /API key/);
});

test("changing providers, hosts or users never reuses a hidden credential", () => {
  const stored = record();
  assert.throws(() => prepareEmailSettings({ ...input, provider: "smtp", user: "resend", host: "elsewhere.test", credential: undefined }, stored, key), /SMTP password/);
  const smtp = { ...stored, provider: "smtp", host: "smtp.example.test", user: "sender" };
  for (const changes of [{ host: "other.example.test", user: "sender" }, { host: smtp.host, user: "other" }]) {
    assert.throws(() => prepareEmailSettings({ ...input, provider: "smtp", ...changes, credential: undefined }, smtp, key), /SMTP password/);
  }
  const anonymous = prepareEmailSettings({ ...input, provider: "smtp", user: "", credential: undefined }, stored, key);
  assert.equal(anonymous.credentialEncrypted, null);
});

test("invalid input and header injection fail validation without reflecting credential values", () => {
  for (const invalid of [
    { fromName: "Name\r\nBcc: someone@example.test" }, { fromEmail: "not-email" }, { replyTo: "wrong" },
    { credential: "secret\nvalue" }, { provider: "smtp", host: "https://host.test/path" }, { port: 70000 },
    { provider: "custom-provider" }, { revision: "stale" }, { unknownCredential: "secret" },
  ]) assert.equal(emailSettingsInputSchema.safeParse({ ...input, ...invalid }).success, false);
  assert.equal(emailSettingsInputSchema.safeParse(input).success, true);
  assert.equal(formatSender({ fromName: 'Support "Team"', fromEmail: input.fromEmail, replyTo: "" }), '"Support \\"Team\\"" <reports@example.test>');
});

test("SMTP failures expose a fixed actionable error, never the provider response", () => {
  for (const code of ["EAUTH", "EENVELOPE", "EMESSAGE", "ECONNECTION", undefined]) {
    const error = safeEmailError({ code, message: `Authentication failed for ${input.credential}`, response: input.credential });
    assert.equal(error.statusCode, 502);
    assert.ok(!JSON.stringify(error).includes(input.credential!));
    assert.ok(!error.message.includes(input.credential!));
  }
});

test("each delivery reads current settings, so existing API and worker mailers pick up new keys and sender addresses", async () => {
  let password = "first-key";
  let fromEmail = "first@example.test";
  let loads = 0;
  const deliveries: Array<{ config: EmailServiceConfig; message: unknown }> = [];
  const mailer = createInstallationMailer(async () => {
    loads++;
    return {
      source: "settings", sender: { fromName: "Team", fromEmail, replyTo: "reply@example.test" },
      config: { provider: "smtp", host: "smtp.example.test", port: 465, secure: true, user: "sender", password, from: fromEmail },
    };
  }, (config) => ({
    isConfigured: () => true,
    send: async (message) => { deliveries.push({ config: config!, message }); },
  }), true);
  assert.equal(await mailer.isConfigured(), true);
  await mailer.send({ to: "admin@example.test", subject: "First", html: "<p>Test</p>", from: "old-snapshot@example.test" });
  password = "replacement-key";
  fromEmail = "replacement@example.test";
  await mailer.send({ to: "admin@example.test", subject: "Second", html: "<p>Test</p>", from: "old-snapshot@example.test" });
  assert.equal(loads, 3);
  assert.equal(deliveries[0].config.password, "first-key");
  assert.equal(deliveries[1].config.password, "replacement-key");
  assert.deepEqual(deliveries[1].message, {
    to: "admin@example.test", subject: "Second", html: "<p>Test</p>",
    from: '"Team" <replacement@example.test>', replyTo: "reply@example.test",
  });
});

test("environment fallback retains per-message sender identities and does not report absent mail as sent", async () => {
  const settings: ResolvedEmailSettings = {
    source: "environment", sender: { fromName: "Fallback", fromEmail: "fallback@example.test", replyTo: "" },
    config: { provider: "smtp", host: "127.0.0.1", port: 1025, secure: false, from: "fallback@example.test" },
  };
  let actual: unknown;
  const mailer = createInstallationMailer(async () => settings, () => ({ isConfigured: () => true, send: async (message) => { actual = message; } }), true);
  const message = { to: "admin@example.test", subject: "Test", html: "<p>Test</p>", from: "snapshot@example.test" };
  await mailer.send(message);
  assert.deepEqual(actual, message);
  settings.config = null;
  assert.equal(await mailer.isConfigured(), false);
  await assert.rejects(mailer.send(message), /Configure email/);
});

test("delivery errors are sanitized before reaching notification logs or API responses", async () => {
  const mailer = createInstallationMailer(async () => ({
    source: "settings", sender: { fromName: "Team", fromEmail: input.fromEmail, replyTo: "" },
    config: { provider: "smtp", host: "smtp.example.test", port: 465, secure: true, from: input.fromEmail },
  }), () => ({ isConfigured: () => true, send: async () => { throw { code: "EAUTH", response: "re_do_not_log_me" }; } }), true);
  await assert.rejects(mailer.send({ to: input.fromEmail, subject: "Test", html: "Test" }), (error: Error) => {
    assert.match(error.message, /authentication failed/);
    assert.ok(!JSON.stringify(error).includes("re_do_not_log_me"));
    return true;
  });
});

test("authenticated ciphertext cannot be modified unnoticed", () => {
  const encrypted = encryptSecret("fixture", key).split(":");
  encrypted[3] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decryptSecret(encrypted.join(":"), key));
});
