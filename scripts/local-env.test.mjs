import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeLocalEnvironment } from "./local-env.mjs";
test("fresh local install generates private credentials and preserves them across restart", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tg-env-"));
  try {
    const first = initializeLocalEnvironment(root);
    const second = initializeLocalEnvironment(root);
    assert.deepEqual(second, first);
    assert.equal(fs.statSync(path.join(root, ".env")).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(root, ".local/login.txt")).mode & 0o777, 0o600);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("copying the documented env example still generates every bootstrap requirement", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tg-env-"));
  try {
    fs.copyFileSync(new URL("../.env.example", import.meta.url), path.join(root, ".env"));
    const result = initializeLocalEnvironment(root);
    for (const key of ["COMMUNITY_DB_PASSWORD", "DATABASE_URL", "JWT_SECRET", "ADMIN_SEED_PASSWORD", "EMAIL_SETTINGS_ENCRYPTION_KEY"]) assert.ok(result[key], key);
    assert.equal(initializeLocalEnvironment(root).JWT_SECRET, result.JWT_SECRET);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("an existing database URL and custom settings survive initialization", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tg-env-"));
  try {
    fs.writeFileSync(path.join(root, ".env"), "DATABASE_URL=postgresql://community:retained@127.0.0.1:54383/community\nJWT_SECRET=retained-jwt\nSMTP_HOST=custom.mail\n");
    const result = initializeLocalEnvironment(root);
    assert.equal(result.COMMUNITY_DB_PASSWORD, "retained");
    assert.equal(result.JWT_SECRET, "retained-jwt");
    assert.equal(result.SMTP_HOST, "custom.mail");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
