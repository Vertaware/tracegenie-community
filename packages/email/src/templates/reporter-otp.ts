import { wrapInBaseLayout } from "./base-layout.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderReporterOtpEmail(data: { code: string; productName?: string }): string {
  const productName = data.productName ?? "TraceGenie";
  const innerHtml = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#121211;line-height:1.4;">
      Your ${escapeHtml(productName)} access code
    </h1>
    <p style="margin:0 0 20px;font-size:14px;color:#555551;line-height:1.7;">
      Use this code to view your reported items. It expires in 10 minutes.
    </p>
    <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:6px;color:#121211;">
      ${escapeHtml(data.code)}
    </p>
  `;

  return wrapInBaseLayout(innerHtml, { productName });
}

export function renderRequesterConfirmationEmail(data: {
  ticketNumber: number;
  title: string;
  productName?: string | null;
  ticketUrl: string;
  myTicketsUrl: string;
}): string {
  const productName = data.productName ?? "TraceGenie";
  const innerHtml = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#121211;line-height:1.4;">
      Report #${data.ticketNumber} was received
    </h1>
    <p style="margin:0 0 20px;font-size:14px;color:#555551;line-height:1.7;">
      We received your report for ${escapeHtml(productName)}.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EDEDF5;border-radius:8px;overflow:hidden;">
      <tr>
        <td style="padding:10px 16px;font-size:13px;color:#74736f;background:#F9FAFB;width:120px;font-weight:500;">
          Title
        </td>
        <td style="padding:10px 16px;font-size:13px;color:#121211;background:#F9FAFB;">
          ${escapeHtml(data.title)}
        </td>
      </tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
      <tr>
        <td style="border-radius:8px;background:#6554C0;">
          <a href="${escapeHtml(data.ticketUrl)}" target="_blank" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">
            View ticket
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:16px 0 0;font-size:14px;line-height:1.7;">
      <a href="${escapeHtml(data.myTicketsUrl)}" target="_blank" style="color:#6554C0;text-decoration:underline;">
        View all my tickets
      </a>
    </p>
  `;

  return wrapInBaseLayout(innerHtml, { productName });
}

export function renderInviteEmail(data: {
  organizationName: string;
  acceptUrl: string;
  invitedByName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  emailFooterText?: string | null;
}): string {
  const primaryColor = data.primaryColor ?? "#121211";
  const innerHtml = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#121211;line-height:1.4;">
      Join ${escapeHtml(data.organizationName)} on TraceGenie
    </h1>
    <p style="margin:0 0 20px;font-size:14px;color:#555551;line-height:1.7;">
      ${data.invitedByName ? `${escapeHtml(data.invitedByName)} invited you to collaborate on product issues.` : "You were invited to collaborate on product issues."}
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0">
      <tr>
        <td style="border-radius:8px;background:${primaryColor};">
          <a href="${escapeHtml(data.acceptUrl)}" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;">
            Accept invite
          </a>
        </td>
      </tr>
    </table>
  `;

  return wrapInBaseLayout(innerHtml, {
    productName: "TraceGenie",
    brandName: data.organizationName,
    logoUrl: data.logoUrl,
    primaryColor: data.primaryColor,
    accentColor: data.accentColor,
    footerText: data.emailFooterText,
  });
}
