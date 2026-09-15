/**
 * @vertaware/email — New Issue Notification Template
 *
 * Rendered when a user submits feedback via the TraceGenie widget.
 * All admin users receive this notification.
 */

import { wrapInBaseLayout } from "./base-layout.js";

export type NewIssueTemplateData = {
  ticketNumber: number;
  title: string;
  description: string;
  severity: string;
  issueType: string;
  reporterName?: string | null;
  reporterEmail?: string | null;
  currentUrl?: string | null;
  projectName: string;
  projectKey: string;
  adminConsoleUrl: string;
  feedbackId: string;
  releaseRegression?: {
    fixedTicketNumber: number;
    fixedTitle: string;
    fixedAppVersion: string;
    fixedBuildNumber?: string | null;
    fixedReleaseChannel?: string | null;
    fixedAt?: string | Date | null;
  } | null;
};

const severityColors: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: "#FDF1F0", text: "#8f2d26", border: "#f6d1ce" },
  high:     { bg: "#FDF7EB", text: "#7a4a0f", border: "#f5e0b5" },
  medium:   { bg: "#F7F8FF", text: "#292251", border: "#C8CAFE" },
  low:      { bg: "#EEF8F1", text: "#175f31", border: "#c5e8d0" },
};

const issueTypeLabels: Record<string, string> = {
  bug: "Bug",
  ux: "UX Issue",
  enhancement: "Enhancement",
  performance: "Performance",
  data: "Data Issue",
  other: "Other",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatReleaseLabel(regression: NonNullable<NewIssueTemplateData["releaseRegression"]>): string {
  return [
    regression.fixedAppVersion,
    regression.fixedBuildNumber ? `build ${regression.fixedBuildNumber}` : null,
    regression.fixedReleaseChannel,
  ].filter(Boolean).join(" / ");
}

function formatFixedAt(fixedAt: string | Date | null | undefined): string | null {
  if (!fixedAt) {
    return null;
  }

  const date = fixedAt instanceof Date ? fixedAt : new Date(fixedAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

export function renderNewIssueEmail(data: NewIssueTemplateData): string {
  const severity = data.severity.toLowerCase();
  const colors = severityColors[severity] ?? severityColors.medium;
  const issueLabel = issueTypeLabels[data.issueType.toLowerCase()] ?? data.issueType;
  const viewUrl = `${data.adminConsoleUrl}/issues/${data.feedbackId}`;
  const releaseRegressionHtml = data.releaseRegression ? `
    <!-- Release regression alert -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid #f6d1ce;border-radius:8px;overflow:hidden;">
      <tr>
        <td style="padding:14px 16px;background:#FDF1F0;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#8f2d26;">
            Release regression detected
          </p>
          <p style="margin:0;font-size:13px;color:#4f1f1a;line-height:1.6;">
            This matching fingerprint was previously fixed by ticket #${data.releaseRegression.fixedTicketNumber}
            (${escapeHtml(data.releaseRegression.fixedTitle)}) in ${escapeHtml(formatReleaseLabel(data.releaseRegression))}${formatFixedAt(data.releaseRegression.fixedAt) ? ` on ${escapeHtml(formatFixedAt(data.releaseRegression.fixedAt)!)}.` : "."}
          </p>
        </td>
      </tr>
    </table>
  ` : "";

  const truncatedDescription = data.description.length > 300
    ? `${escapeHtml(data.description.slice(0, 300))}…`
    : escapeHtml(data.description);

  const innerHtml = `
    <!-- Ticket badge -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <span style="display:inline-block;font-size:12px;font-weight:600;color:#121211;background:#F1F1EF;border:1px solid #E2E2DF;border-radius:6px;padding:4px 10px;letter-spacing:0.02em;">
            #${data.ticketNumber}
          </span>
          <span style="display:inline-block;margin-left:8px;font-size:12px;font-weight:600;color:${colors.text};background:${colors.bg};border:1px solid ${colors.border};border-radius:6px;padding:4px 10px;text-transform:capitalize;">
            ${escapeHtml(severity)}
          </span>
          <span style="display:inline-block;margin-left:8px;font-size:12px;font-weight:500;color:#555551;background:#f1f1ef;border-radius:6px;padding:4px 10px;">
            ${escapeHtml(issueLabel)}
          </span>
        </td>
      </tr>
    </table>

    <!-- Title -->
    <h1 style="margin:20px 0 8px;font-size:20px;font-weight:600;color:#121211;line-height:1.4;">
      ${escapeHtml(data.title)}
    </h1>

    <!-- Description -->
    <p style="margin:0 0 24px;font-size:14px;color:#555551;line-height:1.7;">
      ${truncatedDescription}
    </p>

    ${releaseRegressionHtml}

    <!-- Metadata table -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border:1px solid #EDEDF5;border-radius:8px;overflow:hidden;">
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#74736f;background:#F9FAFB;border-bottom:1px solid #EDEDF5;width:120px;font-weight:500;">
          Project
        </td>
        <td style="padding:10px 16px;font-size:13px;color:#121211;background:#F9FAFB;border-bottom:1px solid #EDEDF5;">
          ${escapeHtml(data.projectName)} <span style="color:#74736f;">(${escapeHtml(data.projectKey)})</span>
        </td>
      </tr>
      ${data.reporterName || data.reporterEmail ? `
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#74736f;background:#FFFFFF;border-bottom:1px solid #EDEDF5;font-weight:500;">
          Reporter
        </td>
        <td style="padding:10px 16px;font-size:13px;color:#121211;background:#FFFFFF;border-bottom:1px solid #EDEDF5;">
          ${escapeHtml(data.reporterName ?? "")}${data.reporterEmail ? ` <span style="color:#74736f;">&lt;${escapeHtml(data.reporterEmail)}&gt;</span>` : ""}
        </td>
      </tr>` : ""}
      ${data.currentUrl ? `
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#74736f;background:#F9FAFB;font-weight:500;">
          Page URL
        </td>
        <td style="padding:10px 16px;font-size:13px;color:#121211;background:#F9FAFB;word-break:break-all;">
          ${escapeHtml(data.currentUrl)}
        </td>
      </tr>` : ""}
    </table>

    <!-- CTA button -->
    <table role="presentation" cellpadding="0" cellspacing="0">
      <tr>
        <td style="border-radius:8px;background:#121211;">
          <a href="${escapeHtml(viewUrl)}" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;">
            View in Console &rarr;
          </a>
        </td>
      </tr>
    </table>
  `;

  return wrapInBaseLayout(innerHtml, { productName: "TraceGenie" });
}
