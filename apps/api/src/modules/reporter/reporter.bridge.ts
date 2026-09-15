import crypto from "node:crypto";

import { env } from "../../config/env";
import { AppError } from "../../lib/errors";

const BRIDGE_VERSION = 1;
const BRIDGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type ReporterBridgePayload = {
  version: typeof BRIDGE_VERSION;
  feedbackId: string;
  organizationId: string;
  projectId: string;
  expiresAt: number;
};

function bridgeKey() {
  return crypto.createHash("sha256").update(`tracegenie:reporter-bridge:${env.JWT_SECRET}`).digest();
}

function decodePart(value: string) {
  return Buffer.from(value, "base64url");
}

export function createReporterBridgeToken(
  input: Omit<ReporterBridgePayload, "version" | "expiresAt">,
  expiresAt = Date.now() + BRIDGE_TTL_MS,
) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", bridgeKey(), iv);
  const payload: ReporterBridgePayload = {
    version: BRIDGE_VERSION,
    ...input,
    expiresAt,
  };
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function readReporterBridgeToken(token: string): ReporterBridgePayload {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
      throw new Error("Malformed bridge token.");
    }
    const [ivPart, tagPart, encryptedPart] = parts as [string, string, string];
    const decipher = crypto.createDecipheriv("aes-256-gcm", bridgeKey(), decodePart(ivPart));
    decipher.setAuthTag(decodePart(tagPart));
    const plaintext = Buffer.concat([decipher.update(decodePart(encryptedPart)), decipher.final()]).toString("utf8");
    const payload = JSON.parse(plaintext) as Partial<ReporterBridgePayload>;
    if (
      payload.version !== BRIDGE_VERSION
      || typeof payload.feedbackId !== "string"
      || typeof payload.organizationId !== "string"
      || typeof payload.projectId !== "string"
      || typeof payload.expiresAt !== "number"
    ) {
      throw new Error("Invalid bridge payload.");
    }
    if (payload.expiresAt <= Date.now()) {
      throw new AppError(410, "reporter.bridge_expired", "This report link has expired. Request a new access code from the reporter portal.");
    }
    return payload as ReporterBridgePayload;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, "reporter.bridge_invalid", "This report link is invalid or no longer available.");
  }
}

export function createReporterTrackingUrl(input: Omit<ReporterBridgePayload, "version" | "expiresAt">) {
  const url = new URL("/reporter", env.ADMIN_APP_URL);
  // Fragments are not sent in HTTP requests, keeping the bridge capability out
  // of reverse-proxy, CDN, and application access logs during navigation.
  url.hash = new URLSearchParams({ bridge: createReporterBridgeToken(input) }).toString();
  return url.toString();
}
