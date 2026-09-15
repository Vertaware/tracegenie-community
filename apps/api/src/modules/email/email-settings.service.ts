import { randomUUID } from "node:crypto";
import type { EmailSettings } from "@prisma/client";
import { createEmailService,type EmailService,type EmailServiceConfig } from "@vertaware/email";
import { emailSettingsInputSchema,type EmailSettingsInput,type EmailSettingsView } from "@tracegenie/shared";

import { env } from "../../config/env";
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { decryptSecret,encryptSecret } from "../../lib/security";

const SETTINGS_ID = "community";
type Sender = { fromName: string; fromEmail: string; replyTo: string };
export type ResolvedEmailSettings = {
  config: EmailServiceConfig | null;
  sender: Sender;
  source: EmailSettingsView["source"];
};

function encryptionKey() {
  if (!env.EMAIL_SETTINGS_ENCRYPTION_KEY) {
    throw new AppError(503, "email.encryption_unavailable", "Email settings are unavailable until the server encryption key is configured. Run npm run setup or set EMAIL_SETTINGS_ENCRYPTION_KEY on the server.");
  }
  return env.EMAIL_SETTINGS_ENCRYPTION_KEY;
}

function environmentSender(): Sender {
  const match = env.EMAIL_FROM.match(/^(.+?)\s*<([^>]+)>$/);
  return {
    fromName: match?.[1].trim().replace(/^"|"$/g, "") || env.REQUESTER_EMAIL_FROM_NAME,
    fromEmail: match?.[2] || env.EMAIL_FROM,
    replyTo: env.REQUESTER_EMAIL_REPLY_TO,
  };
}

function environmentConfig(): EmailServiceConfig | null {
  return env.SMTP_HOST ? {
    provider: "smtp", host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE,
    user: env.SMTP_USER, password: env.SMTP_PASSWORD, from: env.EMAIL_FROM,
  } : null;
}

export function formatSender(sender: Sender) {
  return `${JSON.stringify(sender.fromName)} <${sender.fromEmail}>`;
}

export function publicEmailSettings(record: EmailSettings | null): EmailSettingsView {
  const fallback = environmentSender();
  return {
    source: record ? "settings" : env.SMTP_HOST ? "environment" : "none",
    revision: record?.revision ?? null,
    provider: record?.provider === "resend" || (!record && env.SMTP_HOST === "smtp.resend.com") ? "resend" : "smtp",
    host: record?.host ?? env.SMTP_HOST ?? "",
    port: record?.port ?? env.SMTP_PORT,
    secure: record?.secure ?? env.SMTP_SECURE,
    user: record?.user ?? env.SMTP_USER ?? "",
    fromName: record?.fromName ?? fallback.fromName,
    fromEmail: record?.fromEmail ?? fallback.fromEmail,
    replyTo: record?.replyTo ?? fallback.replyTo,
    hasCredential: record ? Boolean(record.credentialEncrypted) : Boolean(env.SMTP_PASSWORD),
    configured: record ? Boolean(record.host && (!record.user || record.credentialEncrypted)) : Boolean(env.SMTP_HOST && (!env.SMTP_USER || env.SMTP_PASSWORD)),
    canSave: Boolean(env.EMAIL_SETTINGS_ENCRYPTION_KEY),
    lastTestAt: record?.lastTestAt?.toISOString() ?? null,
  };
}

export async function readEmailSettings() {
  return publicEmailSettings(await prisma.emailSettings.findUnique({ where: { id: SETTINGS_ID } }));
}

/** Only reuse an omitted password for the same saved provider, server and login. */
export function prepareEmailSettings(input: EmailSettingsInput, current: EmailSettings | null, key: string) {
  const host = input.provider === "resend" ? "smtp.resend.com" : input.host;
  const port = input.provider === "resend" ? 465 : input.port;
  const secure = input.provider === "resend" ? true : input.secure;
  const user = input.provider === "resend" ? "resend" : input.user;
  const sameAccount = current?.provider === input.provider && current.host === host && current.user === user;
  const credentialEncrypted = !user ? null : input.credential
    ? encryptSecret(input.credential, key)
    : input.credential === undefined && sameAccount ? current.credentialEncrypted : null;
  if (user && !credentialEncrypted) {
    throw new AppError(400, "email.credential_required", input.provider === "resend" ? "Enter your Resend API key." : "Enter the SMTP password for this server and username.");
  }
  return {
    provider: input.provider, host, port, secure, user, credentialEncrypted,
    fromName: input.fromName, fromEmail: input.fromEmail, replyTo: input.replyTo,
    revision: randomUUID(), lastTestAt: null,
  };
}

function staleSettings() {
  return new AppError(409, "email.settings_changed", "Email settings changed in another session. Reload the saved settings before trying again.");
}

export async function saveEmailSettings(payload: unknown) {
  const input = emailSettingsInputSchema.parse(payload);
  const key = encryptionKey();
  return prisma.$transaction(async (tx) => {
    const current = await tx.emailSettings.findUnique({ where: { id: SETTINGS_ID } });
    if ((current?.revision ?? null) !== input.revision) throw staleSettings();
    const data = prepareEmailSettings(input, current, key);
    if (current) {
      const result = await tx.emailSettings.updateMany({ where: { id: SETTINGS_ID, revision: input.revision! }, data });
      if (!result.count) throw staleSettings();
    } else {
      // skipDuplicates turns concurrent initial saves into a clear conflict.
      const result = await tx.emailSettings.createMany({ data: { id: SETTINGS_ID, ...data }, skipDuplicates: true });
      if (!result.count) throw staleSettings();
    }
    return publicEmailSettings(await tx.emailSettings.findUniqueOrThrow({ where: { id: SETTINGS_ID } }));
  });
}

export async function useEnvironmentEmailSettings(revision: string) {
  const result = await prisma.emailSettings.deleteMany({ where: { id: SETTINGS_ID, revision } });
  if (!result.count) throw staleSettings();
  return readEmailSettings();
}

export async function resolveEmailSettings(): Promise<ResolvedEmailSettings> {
  const record = await prisma.emailSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (!record) return {
    source: env.SMTP_HOST ? "environment" : "none", config: environmentConfig(),
    sender: { fromName: env.REQUESTER_EMAIL_FROM_NAME, fromEmail: env.REQUESTER_EMAIL_FROM_EMAIL, replyTo: env.REQUESTER_EMAIL_REPLY_TO },
  };
  let password: string | undefined;
  if (record.credentialEncrypted) {
    try { password = decryptSecret(record.credentialEncrypted, encryptionKey()); }
    catch { throw new AppError(503, "email.credential_unavailable", "The saved email credential cannot be read. Restore the server encryption key or replace the credential in Email settings."); }
  }
  const sender = { fromName: record.fromName, fromEmail: record.fromEmail, replyTo: record.replyTo };
  return {
    source: "settings", sender,
    config: { provider: "smtp", host: record.host, port: record.port, secure: record.secure, user: record.user || undefined, password, from: formatSender(sender) },
  };
}

/** SMTP responses may echo credentials. Never persist or expose raw provider errors. */
export function safeEmailError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "EAUTH") return new AppError(502, "email.authentication_failed", "Email authentication failed. Check your API key or SMTP credentials.");
  if (code === "EENVELOPE" || code === "EMESSAGE") return new AppError(502, "email.sender_rejected", "The mail server rejected the message. Check your verified sending domain, sender address and recipient.");
  return new AppError(502, "email.delivery_failed", "Could not send email. Check the server, port, TLS settings and provider configuration, then try again.");
}

export type InstallationMailer = Omit<EmailService, "isConfigured"> & { isConfigured(): boolean | Promise<boolean> };

export function createInstallationMailer(
  load: () => Promise<ResolvedEmailSettings> = resolveEmailSettings,
  create: typeof createEmailService = createEmailService,
  enabled = env.NODE_ENV !== "test",
): InstallationMailer {
  return {
    async isConfigured() { return enabled && Boolean((await load()).config?.host); },
    async send(message) {
      if (!enabled) return;
      const settings = await load();
      if (!settings.config) throw new AppError(503, "email.not_configured", "Configure email in Settings before sending.");
      try {
        // Resolve at delivery time, including queued messages created before a settings change.
        await create(settings.config).send({
          ...message,
          ...(settings.source === "settings" ? { from: formatSender(settings.sender), replyTo: settings.sender.replyTo || undefined } : {}),
        });
      } catch (error) { throw safeEmailError(error); }
    },
  };
}

export const installationMailer = createInstallationMailer();

export async function sendSettingsTestEmail(to: string, revision: string | null) {
  const settings = await readEmailSettings();
  if (settings.revision !== revision) throw staleSettings();
  if (!settings.configured) throw new AppError(400, "email.not_configured", "Save your email configuration before sending a test.");
  await installationMailer.send({
    to, subject: "TraceGenie Community — email test",
    html: "<p>Your TraceGenie Community email configuration is working.</p><p>This is a test sent from Email settings.</p>",
  });
  if (revision) await prisma.emailSettings.updateMany({ where: { id: SETTINGS_ID, revision }, data: { lastTestAt: new Date() } });
  return { sent: true as const, recipient: to, settings: await readEmailSettings() };
}
