import crypto from "node:crypto";

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hmacSha256(value: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

export function encryptSecret(value: string, secret: string) {
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(value: string, secret: string) {
  const [version, ivBase64, tagBase64, ciphertextBase64] = value.split(":");
  if (version !== "v1" || !ivBase64 || !tagBase64 || !ciphertextBase64) {
    throw new Error("Unsupported encrypted secret format.");
  }

  const key = crypto.createHash("sha256").update(secret).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivBase64, "base64"));
  decipher.setAuthTag(Buffer.from(tagBase64, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildDuplicateFingerprint(input: {
  title: string;
  description: string;
  routeUrl: string;
  projectKey: string;
  errorSignature?: string | null;
  selectedElement?: string | null;
}) {
  const normalizedTitle = normalizeText(input.title);
  const normalizedDescription = normalizeText(input.description).slice(0, 220);
  const normalizedUrl = input.routeUrl.split("?")[0].toLowerCase();
  const normalizedError = input.errorSignature ? normalizeText(input.errorSignature).slice(0, 220) : "";
  const normalizedElement = input.selectedElement ? normalizeText(input.selectedElement).slice(0, 160) : "";

  return sha256(`${input.projectKey}|${normalizedUrl}|${normalizedTitle}|${normalizedDescription}|${normalizedError}|${normalizedElement}`);
}

export function calculateSimilarity(left: string, right: string) {
  const leftTokens = new Set(normalizeText(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeText(right).split(" ").filter(Boolean));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

export function randomToken() {
  return crypto.randomBytes(18).toString("hex");
}
