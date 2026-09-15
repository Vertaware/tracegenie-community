/**
 * @vertaware/email — Public API
 *
 * Re-exports everything consumers need.
 */

// Core service
export { createEmailService, type EmailService, type EmailServiceConfig } from "./email.service.js";

// Transport types
export { type EmailMessage, type EmailTransport } from "./transports/smtp.js";

// Templates
export { wrapInBaseLayout, type LayoutOptions } from "./templates/base-layout.js";
export { renderNewIssueEmail, type NewIssueTemplateData } from "./templates/new-issue.js";
export { renderRequesterStatusEmail, type RequesterStatusTemplateData } from "./templates/requester-status.js";
export { renderRequesterTriageEmail, type RequesterTriageTemplateData } from "./templates/requester-triage.js";
export { renderInviteEmail, renderReporterOtpEmail, renderRequesterConfirmationEmail } from "./templates/reporter-otp.js";
