/**
 * Email notification service for TraceGenie API.
 *
 * Resolves the installation SMTP settings for each send
 * and exposes notification helpers specific to TraceGenie.
 */

import {
renderInviteEmail,
renderNewIssueEmail,
renderReporterOtpEmail,
renderRequesterConfirmationEmail,
type NewIssueTemplateData,
} from "@vertaware/email";

import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { installationMailer } from "./email-settings.service";

const emailService = installationMailer;

/**
 * Send a "new issue" email notification to all active admin users.
 *
 * This should be called fire-and-forget after feedback submission.
 * Failures are logged but never propagated to the caller.
 */
export async function notifyNewIssue(data: NewIssueTemplateData, recipientEmails: string[]): Promise<void> {
  if (!env.EMAIL_NOTIFY_ON_NEW_ISSUE || !(await emailService.isConfigured())) {
    return;
  }

  if (!recipientEmails || recipientEmails.length === 0) {
    logger.warn("[notifications] No target emails configured for project issue notification");
    return;
  }

  try {
    const recipients = recipientEmails;
    const html = renderNewIssueEmail(data);

    await emailService.send({
      to: recipients,
      subject: `[TraceGenie] #${data.ticketNumber} — ${data.title}`,
      html,
    });

    logger.info(
      { ticketNumber: data.ticketNumber, recipientCount: recipients.length },
      "[notifications] New issue email sent",
    );
  } catch (error) {
    // Fire-and-forget: log the error but never let it bubble up
    logger.error({ error, ticketNumber: data.ticketNumber }, "[notifications] Failed to send new issue email");
  }
}

export async function notifyRequesterConfirmation(data: {
  to: string;
  ticketNumber: number;
  title: string;
  productName?: string | null;
  ticketUrl: string;
  myTicketsUrl: string;
}): Promise<void> {
  if (!(await emailService.isConfigured())) {
    return;
  }

  try {
    await emailService.send({
      to: [data.to],
      subject: `[TraceGenie] Report #${data.ticketNumber} was received`,
      html: renderRequesterConfirmationEmail(data),
    });
  } catch (error) {
    logger.error({ error, ticketNumber: data.ticketNumber }, "[notifications] Failed to send requester confirmation");
  }
}

export async function notifyReporterOtp(data: { to: string; code: string }): Promise<{ sent: boolean; skippedReason?: string }> {
  if (!(await emailService.isConfigured())) {
    return { sent: false, skippedReason: "email_not_configured" };
  }

  try {
    await emailService.send({
      to: [data.to],
      subject: "[TraceGenie] Your access code",
      html: renderReporterOtpEmail({ code: data.code }),
    });
    return { sent: true };
  } catch (error) {
    logger.error({ error, to: data.to }, "[notifications] Failed to send reporter OTP");
    return { sent: false, skippedReason: "send_failed" };
  }
}

export async function notifyPasswordReset(data: {
  to: string;
  resetUrl: string;
}): Promise<{ sent: boolean; skippedReason?: string }> {
  if (!(await emailService.isConfigured())) {
    return { sent: false, skippedReason: "email_not_configured" };
  }

  try {
    await emailService.send({
      to: [data.to],
      subject: "[TraceGenie] Reset your password",
      html: `
        <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
          <h1 style="font-size: 20px; margin: 0 0 12px;">Reset your TraceGenie password</h1>
          <p style="margin: 0 0 16px;">Use the link below to set a new password. This link expires in 60 minutes.</p>
          <p style="margin: 0 0 16px;">
            <a href="${data.resetUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 10px 14px; border-radius: 8px; text-decoration: none;">Reset password</a>
          </p>
          <p style="margin: 0; color: #6b7280; font-size: 13px;">If you did not request this, you can ignore this email.</p>
        </div>
      `,
    });
    return { sent: true };
  } catch (error) {
    logger.error({ error, to: data.to }, "[notifications] Failed to send password reset email");
    return { sent: false, skippedReason: "send_failed" };
  }
}

export async function notifyInvite(data: {
  to: string;
  organizationName: string;
  acceptUrl: string;
  invitedByName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  emailFooterText?: string | null;
}): Promise<{ sent: boolean; skippedReason?: string }> {
  if (!(await emailService.isConfigured())) {
    return { sent: false, skippedReason: "email_not_configured" };
  }

  try {
    await emailService.send({
      to: [data.to],
      subject: `[TraceGenie] Join ${data.organizationName}`,
      html: renderInviteEmail(data),
    });
    return { sent: true };
  } catch (error) {
    logger.error({ error, to: data.to }, "[notifications] Failed to send invite email");
    return { sent: false, skippedReason: "send_failed" };
  }
}
