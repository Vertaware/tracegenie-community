/**
 * @vertaware/email — Base HTML layout
 *
 * Shared email wrapper with Vertaware branding.
 * Every template receives its inner content and this function wraps it
 * in the branded header/footer chrome.
 *
 * Colors from the Vertaware palette:
 *   Primary:   #7B68EE (violet)   #C8CAFE (light violet)   #F7F8FF (near-white)
 *   Secondary: #FB773C (orange)   #FFBEA2 (peach)          #FFF2EC (cream)
 *   Neutrals:  #292251 (navy)     #EDEDF5 (light gray)     #FAFBFE (off-white)
 */

export type LayoutOptions = {
  /** Product name shown in the header/body context, e.g. "Acme Portal" */
  productName: string;
  /** Optional sender/brand label shown in the header/footer, e.g. "Vertaware Support" */
  brandName?: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  footerText?: string | null;
  /** Year for copyright footer */
  year?: number;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function wrapInBaseLayout(innerHtml: string, options: LayoutOptions): string {
  const year = options.year ?? new Date().getFullYear();
  const brandName = options.brandName ?? options.productName;
  const primaryColor = options.primaryColor ?? "#121211";
  const accentColor = options.accentColor ?? "#C8CAFE";
  const footerText = options.footerText
    ? `${escapeHtml(options.footerText)}<br />`
    : `This is an automated notification from ${escapeHtml(brandName)} regarding ${escapeHtml(options.productName)}.<br />`;
  const headerBrand = options.logoUrl
    ? `<img src="${escapeHtml(options.logoUrl)}" alt="${escapeHtml(brandName)}" style="display:block;max-height:32px;max-width:180px;" />`
    : `<span style="font-size:22px;font-weight:700;color:${primaryColor};letter-spacing:-0.02em;">${escapeHtml(brandName)}</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${options.productName}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="padding:24px 32px;background-color:#FFFFFF;border:1px solid #EDEDF5;border-bottom:none;border-radius:12px 12px 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    ${headerBrand}
                  </td>
                  <td align="right">
                    <span style="font-size:12px;color:#74736f;font-weight:500;">${escapeHtml(options.productName)}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color:#FFFFFF;padding:32px;border-left:1px solid #EDEDF5;border-right:1px solid #EDEDF5;">
              ${innerHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background-color:${accentColor};border:1px solid #EDEDF5;border-top:none;border-radius:0 0 12px 12px;">
              <p style="margin:0;font-size:12px;line-height:1.6;">
                ${footerText}
                &copy; ${year} Vertaware. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
