import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parse } from "dotenv";

export function initializeLocalEnvironment(root) {
  const local = path.join(root, ".local");
  fs.mkdirSync(local, { recursive: true });
  const filename = path.join(root, ".env");
  const existing = fs.existsSync(filename) ? parse(fs.readFileSync(filename, "utf8")) : {};
  const random = () => crypto.randomBytes(32).toString("hex");
  let databasePassword = existing.COMMUNITY_DB_PASSWORD;
  if (!databasePassword && existing.DATABASE_URL) databasePassword = decodeURIComponent(new URL(existing.DATABASE_URL).password);
  databasePassword ||= random();
  const defaults = {
    NODE_ENV: "development", COMMUNITY_DB_PASSWORD: databasePassword,
    DATABASE_URL: `postgresql://community:${encodeURIComponent(databasePassword)}@127.0.0.1:54383/community`,
    API_PORT: "4310", API_BASE_URL: "http://127.0.0.1:4310", VITE_API_BASE_URL: "http://127.0.0.1:4310",
    ADMIN_APP_URL: "http://127.0.0.1:4311", DEMO_APP_URL: "http://127.0.0.1:4312", VITE_DEMO_APP_URL: "http://127.0.0.1:4312",
    CORS_ORIGINS: "http://127.0.0.1:4311,http://127.0.0.1:4312", PUBLIC_APP_ORIGINS: "http://127.0.0.1:4312",
    EMAIL_SETTINGS_ENCRYPTION_KEY: random(), JWT_SECRET: random(), TRUST_PROXY_HOPS: "0",
    ADMIN_SEED_EMAIL: "admin@community.test", ADMIN_SEED_PASSWORD: crypto.randomBytes(18).toString("base64url"), ADMIN_SEED_NAME: "Community Admin",
    STORAGE_DRIVER: "local", STORAGE_LOCAL_ROOT: path.join(local, "uploads"),
    SMTP_HOST: "127.0.0.1", SMTP_PORT: "11325", SMTP_SECURE: "false",
    EMAIL_FROM: "TraceGenie Community <notifications@community.test>",
    REQUESTER_EMAIL_FROM_EMAIL: "notifications@community.test", REQUESTER_EMAIL_REPLY_TO: "support@community.test",
  };
  const missing = Object.entries(defaults).filter(([key]) => !existing[key]);
  if (missing.length) fs.appendFileSync(filename, "\n" + missing.map(([key,value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
  fs.chmodSync(filename, 0o600);
  const complete = { ...defaults, ...Object.fromEntries(Object.entries(existing).filter(([,value]) => value !== "")) };
  const login = path.join(local, "login.txt");
  if (!fs.existsSync(login)) fs.writeFileSync(login, `Local Community login\nEmail: ${complete.ADMIN_SEED_EMAIL}\nPassword: ${complete.ADMIN_SEED_PASSWORD}\n`, { mode: 0o600 });
  return complete;
}
