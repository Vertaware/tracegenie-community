import { createSmtpTransport, type EmailMessage, type SmtpConfig } from "./transports/smtp.js";

export type EmailServiceConfig = SmtpConfig & {
  provider: "smtp";
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
};

export type EmailService = {
  /** Send a raw email */
  send(message: EmailMessage): Promise<void>;
  /** Whether the service is configured and operational */
  isConfigured(): boolean;
};

/**
 * Creates a no-op email service that logs warnings instead of sending.
 * Used when no email provider is configured.
 */
function createNoopService(logger: EmailServiceConfig["logger"]): EmailService {
  const log = logger ?? console;
  return {
    async send(message: EmailMessage): Promise<void> {
      log.warn(
        { to: message.to, subject: message.subject },
        "[email] Email service not configured — skipping send",
      );
    },
    isConfigured(): boolean {
      return false;
    },
  };
}

/**
 * Factory: create an email service backed by the chosen provider.
 * If `config` is null/undefined, returns a no-op service that safely skips sends.
 */
export function createEmailService(config?: EmailServiceConfig | null): EmailService {
  if (!config?.host) return createNoopService(config?.logger);
  const transport = createSmtpTransport(config);
  return { send: (message) => transport.send(message), isConfigured: () => true };
}
