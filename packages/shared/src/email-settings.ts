import { z } from "zod";

const singleLine = z.string().trim().max(320).regex(/^[^\r\n]*$/, "Use a single line.");

export const emailSettingsInputSchema = z.object({
  revision: z.string().uuid().nullable(),
  provider: z.enum(["resend", "smtp"]),
  host: singleLine.default(""),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  user: singleLine.default(""),
  credential: z.string().max(2048).regex(/^[^\r\n]*$/, "Use a single line.").nullable().optional(),
  fromName: singleLine.min(1).max(100),
  fromEmail: z.string().trim().email().max(320),
  replyTo: z.union([z.string().trim().email().max(320), z.literal("")]).default(""),
}).strict().superRefine((value, context) => {
  if (value.provider === "smtp" && !/^[a-zA-Z0-9.:[\]-]+$/.test(value.host)) {
    context.addIssue({ code: "custom", path: ["host"], message: "Enter an SMTP hostname or IP address, without a URL or path." });
  }
});

export type EmailSettingsInput = z.infer<typeof emailSettingsInputSchema>;

/** Explicit public projection: never add a credential or ciphertext here. */
export type EmailSettingsView = {
  source: "settings" | "environment" | "none";
  revision: string | null;
  provider: "resend" | "smtp";
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  hasCredential: boolean;
  configured: boolean;
  canSave: boolean;
  lastTestAt: string | null;
};
