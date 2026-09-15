import nodemailer from "nodemailer";

export type EmailMessage = { to: string | string[]; subject: string; html: string; from?: string; replyTo?: string };
export type EmailTransport = { send(message: EmailMessage): Promise<void> };
export type SmtpConfig = { host: string; port: number; secure: boolean; user?: string; password?: string; from: string };

export function createSmtpTransport(config: SmtpConfig): EmailTransport {
  const client = nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.secure,
    requireTLS: Boolean(config.user) && !config.secure,
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  return {
    async send(message) {
      const recipients = Array.isArray(message.to) ? message.to : [message.to];
      if (!recipients.length) return;
      const result = await client.sendMail({ ...message, from: message.from ?? config.from, to: recipients });
      if (result.rejected.length) throw new Error("SMTP rejected a notification recipient.");
    },
  };
}
