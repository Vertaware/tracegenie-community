import { wrapInBaseLayout } from "./base-layout.js";

export type RequesterStatusTemplateData = {
  brandName: string;
  productName: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  emailFooterText?: string | null;
  ticketNumber: number;
  title: string;
  statusLabel: string;
  publicSummary?: string | null;
  nextSteps?: string | null;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderRequesterStatusEmail(data: RequesterStatusTemplateData): string {
  const innerHtml = `
    <p style="margin:0 0 12px;font-size:14px;color:#555551;line-height:1.7;">
      Here is the latest update on your ticket in ${escapeHtml(data.productName)}.
    </p>

    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#121211;line-height:1.4;">
      ${escapeHtml(data.title)}
    </h1>

    <div style="margin:0 0 16px;padding:16px;border:1px solid #EDEDF5;border-radius:10px;background:#FFFFFF;">
      <p style="margin:0 0 6px;font-size:13px;color:#555551;line-height:1.6;">
        Ticket: <strong>#${data.ticketNumber}</strong>
      </p>
      <p style="margin:0;font-size:13px;color:#555551;line-height:1.6;">
        Status: <strong>${escapeHtml(data.statusLabel)}</strong>
      </p>
    </div>

    <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#555551;line-height:1.6;text-transform:uppercase;letter-spacing:0.04em;">
      Latest update
    </p>

    ${
      data.publicSummary
        ? `<div style="margin:0 0 20px;padding:16px;border:1px solid #EDEDF5;border-radius:10px;background:#F9FAFB;">
      <p style="margin:0;font-size:14px;color:#121211;line-height:1.7;">
        ${escapeHtml(data.publicSummary)}
      </p>
    </div>`
        : ""
    }

    ${
      !data.publicSummary
        ? `<div style="margin:0 0 20px;padding:16px;border:1px solid #EDEDF5;border-radius:10px;background:#F9FAFB;">
      <p style="margin:0;font-size:14px;color:#121211;line-height:1.7;">
        Your ticket status changed to ${escapeHtml(data.statusLabel)}.
      </p>
    </div>`
        : ""
    }

    <p style="margin:0 0 8px;font-size:14px;color:#555551;line-height:1.7;">
      Next step: ${escapeHtml(data.nextSteps ?? "We will continue to share updates when there is meaningful progress.")}
    </p>

    <p style="margin:0;font-size:14px;color:#555551;line-height:1.7;">
      You do not need to take any additional action right now.
    </p>
  `;

  return wrapInBaseLayout(innerHtml, {
    productName: data.productName,
    brandName: data.brandName,
    logoUrl: data.logoUrl,
    primaryColor: data.primaryColor,
    accentColor: data.accentColor,
    footerText: data.emailFooterText,
  });
}
