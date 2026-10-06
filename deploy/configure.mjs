import crypto from "node:crypto";
import fs from "node:fs";
import { parse } from "dotenv";
const [address = "http://localhost:8088", project = "tracegenie-community", image = "tracegenie-community:local", mode] = process.argv.slice(2);
try {
  const url = new URL(address);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Use an origin without a path, credentials or query.");
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("Use HTTPS for a public domain, or HTTP on localhost for a local installation.");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(project)) throw new Error("Installation name must contain lowercase letters, numbers and hyphens.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(image)) throw new Error("Invalid image reference.");
  if (url.protocol === "https:" && url.port) throw new Error("Public HTTPS installations use port 443.");
  const old = mode === "restore" ? parse(fs.readFileSync(0, "utf8")) : {};
  const secret = (name) => {
    if (mode === "restore" && !/^[a-f0-9]{64}$/.test(old[name] ?? "")) throw new Error(`Backup is missing a valid ${name}.`);
    return old[name] || crypto.randomBytes(32).toString("hex");
  };
  const port = Number(url.port || (url.protocol === "https:" ? 80 : 80));
  if (port >= 65535) throw new Error("Choose a port below 65535.");
  const values = {
    COMMUNITY_PACKAGING: "single-container-v1", COMPOSE_PROJECT_NAME: project, COMMUNITY_IMAGE: image, PUBLIC_URL: url.origin,
    SITE_ADDRESS: url.protocol === "https:" ? url.hostname : "http://:8080",
    BIND_ADDRESS: local ? "127.0.0.1" : "0.0.0.0", HTTP_PORT: String(port),
    HTTPS_PORT: url.protocol === "https:" ? "443" : String(port + 1),
    COMMUNITY_DB_PASSWORD: secret("COMMUNITY_DB_PASSWORD"), JWT_SECRET: secret("JWT_SECRET"),
    EMAIL_SETTINGS_ENCRYPTION_KEY: secret("EMAIL_SETTINGS_ENCRYPTION_KEY"),
    COMMUNITY_SETUP_TOKEN: secret("COMMUNITY_SETUP_TOKEN"),
  };
  // Operator-provided SMTP fallback settings survive a restore. Never evaluate .env as shell code.
  for (const [key, value] of Object.entries(old)) if (/^(SMTP_|EMAIL_FROM$|REQUESTER_EMAIL_)/.test(key) && !/[\r\n$]/.test(value)) values[key] = JSON.stringify(value);
  process.stdout.write(Object.entries(values).map(([key,value]) => `${key}=${value}`).join("\n") + "\n");
} catch (error) { console.error(error.message); process.exitCode = 1; }
