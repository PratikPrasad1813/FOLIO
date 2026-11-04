// Cohesive, email-client-compatible HTML & plain-text design system for Folio.
// Built on table layouts, inline CSS, responsive media queries, and Outlook VML
// fallbacks, with zero external image dependencies so blocked-image clients render
// with complete visual fidelity.

const FONT_SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'DM Sans', Roboto, Helvetica, Arial, sans-serif";
const FONT_SERIF = "Georgia, 'Instrument Serif', 'Times New Roman', serif";
const FONT_MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

export type EmailHeroTone = "editorial" | "security";

export function escapeHtml(raw: unknown): string {
  const value = String(raw ?? "");
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Formats a recipient's display name for greetings without inventing names or
 * allowing extreme lengths to break mobile layouts.
 */
export function formatRecipientName(rawName: string | null | undefined, maxLength = 46): string | null {
  if (!rawName || typeof rawName !== "string") return null;
  const cleaned = rawName.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (cleaned.length <= maxLength) return cleaned;
  const sliced = cleaned.slice(0, maxLength - 1).trimEnd();
  const lastSpace = sliced.lastIndexOf(" ");
  return `${lastSpace >= 20 ? sliced.slice(0, lastSpace) : sliced}…`;
}

export function formatGreetingLine(rawName: string | null | undefined): string {
  const formatted = formatRecipientName(rawName);
  return formatted ? `Hello ${formatted},` : "Hello,";
}

export function normalizeAppOrigin(rawOrigin?: string | null): string {
  const candidate = (rawOrigin || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").trim();
  try {
    return new URL(candidate).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export interface EmailButtonProps {
  label: string;
  href: string;
  tone?: EmailHeroTone;
}

export function renderEmailButton({ label, href, tone = "editorial" }: EmailButtonProps): string {
  const bg = tone === "security" ? "#1E293B" : "#1F1B2D";
  const border = tone === "security" ? "#334155" : "#322B47";
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 24px 0;">
  <tr>
    <td align="left" style="border-radius:10px;" bgcolor="${bg}">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" style="height:48px;v-text-anchor:middle;width:250px;" arcsize="20%" strokecolor="${border}" fillcolor="${bg}">
        <w:anchorlock/>
        <center style="color:#FFFFFF;font-family:${FONT_SANS};font-size:14px;font-weight:600;letter-spacing:0.1px;">${safeLabel} &rarr;</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-- -->
      <a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="em-btn" style="display:inline-block;padding:14px 26px;font-family:${FONT_SANS};font-size:14px;font-weight:600;line-height:20px;color:#FFFFFF;text-decoration:none;background-color:${bg};border:1px solid ${border};border-radius:10px;letter-spacing:0.1px;-webkit-text-size-adjust:none;">
        ${safeLabel}&nbsp;&nbsp;&rarr;
      </a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`.trim();
}

export function renderEmailParagraph(htmlText: string, options?: { muted?: boolean; compact?: boolean }): string {
  const color = options?.muted ? "#6E6A7C" : "#373445";
  const size = options?.muted ? "13.5px" : "15px";
  const margin = options?.compact ? "0 0 12px 0" : "0 0 18px 0";
  return `<p style="margin:${margin};font-family:${FONT_SANS};font-size:${size};line-height:1.68;color:${color};word-break:break-word;">${htmlText}</p>`;
}

export function renderEmailDivider(): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;">
  <tr>
    <td style="height:1px;line-height:1px;font-size:1px;background-color:#ECE9F2;">&nbsp;</td>
  </tr>
</table>`.trim();
}

export interface EmailStepItem {
  number: string;
  title: string;
  description: string;
}

export function renderEmailStepList(steps: EmailStepItem[]): string {
  const rows = steps
    .map(
      (step, index) => `
  <tr>
    <td style="padding:${index === 0 ? "0" : "10px"} 0 0 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAF9FC;border:1px solid #EAE6F3;border-radius:12px;">
        <tr>
          <td class="em-step-cell" style="padding:16px 18px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="38" valign="top" style="padding-right:12px;">
                  <div style="width:28px;height:28px;line-height:28px;text-align:center;border-radius:8px;background-color:#EFEBF8;border:1px solid #DFD7F0;font-family:${FONT_SANS};font-size:11px;font-weight:700;color:#6E56A8;letter-spacing:0.4px;">
                    ${escapeHtml(step.number)}
                  </div>
                </td>
                <td valign="top">
                  <div style="font-family:${FONT_SANS};font-size:14px;font-weight:600;line-height:1.4;color:#221F2D;margin:0 0 4px 0;">
                    ${escapeHtml(step.title)}
                  </div>
                  <div style="font-family:${FONT_SANS};font-size:13.5px;line-height:1.58;color:#615D70;margin:0;">
                    ${escapeHtml(step.description)}
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>`,
    )
    .join("");

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 8px 0;">
  ${rows}
</table>`.trim();
}

export interface EmailKeyValueRow {
  label: string;
  value: string;
}

export function renderEmailMetadataCard(title: string, rows: EmailKeyValueRow[]): string {
  const items = rows
    .map(
      (row, idx) => `
        <tr>
          <td style="padding:${idx === 0 ? "0" : "10px"} 12px 0 0;font-family:${FONT_SANS};font-size:12.5px;line-height:1.5;color:#787387;white-space:nowrap;vertical-align:top;width:36%;">
            ${escapeHtml(row.label)}
          </td>
          <td style="padding:${idx === 0 ? "0" : "10px"} 0 0 0;font-family:${FONT_SANS};font-size:13px;font-weight:600;line-height:1.5;color:#252231;word-break:break-word;vertical-align:top;">
            ${escapeHtml(row.value)}
          </td>
        </tr>`,
    )
    .join("");

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;background-color:#F9F9FB;border:1px solid #E7E5F0;border-radius:12px;">
  <tr>
    <td style="padding:18px 20px;">
      <div style="font-family:${FONT_SANS};font-size:10.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#7B758B;margin:0 0 12px 0;">
        ${escapeHtml(title)}
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${items}
      </table>
    </td>
  </tr>
</table>`.trim();
}

export function renderEmailCallout(options: {
  title: string;
  body: string;
  tone?: "security" | "calm";
  actionLabel?: string;
  actionHref?: string;
}): string {
  const isSecurity = options.tone === "security";
  const bg = isSecurity ? "#FCF8F3" : "#F7F5FC";
  const border = isSecurity ? "#EEDCC5" : "#E3DCF2";
  const accent = isSecurity ? "#9A6324" : "#6D56A6";
  const titleColor = isSecurity ? "#422A11" : "#272038";

  const actionHtml =
    options.actionLabel && options.actionHref
      ? `<div style="margin-top:10px;"><a href="${escapeHtml(options.actionHref)}" target="_blank" rel="noopener noreferrer" style="font-family:${FONT_SANS};font-size:13px;font-weight:600;color:${accent};text-decoration:underline;">${escapeHtml(options.actionLabel)} &rarr;</a></div>`
      : "";

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 8px 0;background-color:${bg};border:1px solid ${border};border-left:3px solid ${accent};border-radius:10px;">
  <tr>
    <td style="padding:16px 18px;">
      <div style="font-family:${FONT_SANS};font-size:13.5px;font-weight:600;line-height:1.45;color:${titleColor};margin:0 0 5px 0;">
        ${escapeHtml(options.title)}
      </div>
      <div style="font-family:${FONT_SANS};font-size:13px;line-height:1.6;color:#5D586B;margin:0;">
        ${escapeHtml(options.body)}
      </div>
      ${actionHtml}
    </td>
  </tr>
</table>`.trim();
}

export function renderEmailFallbackLink(href: string, label = "If the button above does not open in your mail client, copy and paste this direct link into your browser:"): string {
  const safeHref = escapeHtml(href);
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 6px 0;background-color:#F8F7FA;border:1px solid #EAE7F1;border-radius:10px;">
  <tr>
    <td style="padding:14px 16px;">
      <div style="font-family:${FONT_SANS};font-size:12px;line-height:1.55;color:#736E82;margin:0 0 6px 0;">
        ${escapeHtml(label)}
      </div>
      <div style="font-family:${FONT_MONO};font-size:11.5px;line-height:1.55;color:#4B3D73;word-break:break-all;">
        <a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="color:#4B3D73;text-decoration:underline;word-break:break-all;">${safeHref}</a>
      </div>
    </td>
  </tr>
</table>`.trim();
}

export interface EmailDocumentOptions {
  subject: string;
  preheader: string;
  heroTone?: EmailHeroTone;
  eyebrow: string;
  headlineHtml: string;
  heroSubtitle: string;
  greeting: string;
  bodyHtml: string;
  appOrigin: string;
  recipientEmail: string;
  footerReason: string;
}

export function renderEmailDocument(options: EmailDocumentOptions): string {
  const tone = options.heroTone ?? "editorial";
  const heroBg = tone === "security" ? "#131926" : "#181622";
  const topBarColor = tone === "security" ? "#5A78A8" : "#9681CB";
  const eyebrowBg = tone === "security" ? "#1E293D" : "#262235";
  const eyebrowBorder = tone === "security" ? "#314260" : "#3A3450";
  const eyebrowText = tone === "security" ? "#BDD0EE" : "#D4C8F2";
  const heroSubColor = tone === "security" ? "#B5C0D4" : "#BEB9CC";
  const origin = normalizeAppOrigin(options.appOrigin);
  const year = new Date().getUTCFullYear();

  // Hidden preheader padding ensures inbox snippet previews never pull raw table text.
  const preheaderSpacer = "&#847; &zwnj; &nbsp; ".repeat(34);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(options.subject)}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #F4F3EF; }
    @media only screen and (max-width: 620px) {
      .em-shell { padding: 16px 10px !important; }
      .em-card { width: 100% !important; border-radius: 14px !important; }
      .em-hero { padding: 28px 22px 26px 22px !important; }
      .em-body { padding: 26px 22px 24px 22px !important; }
      .em-footer { padding: 22px 22px 26px 22px !important; }
      .em-h1 { font-size: 25px !important; line-height: 1.22 !important; }
      .em-step-cell { padding: 14px 14px !important; }
      .em-btn { display: block !important; text-align: center !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#F4F3EF;color:#24222F;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F4F3EF;opacity:0;">
    ${escapeHtml(options.preheader)} ${preheaderSpacer}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F4F3EF">
    <tr>
      <td align="center" class="em-shell" style="padding:38px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="em-card" style="width:100%;max-width:600px;background-color:#FFFFFF;border:1px solid #E4E1EC;border-radius:16px;overflow:hidden;">
          <!-- Top Accent Bar -->
          <tr>
            <td height="4" bgcolor="${topBarColor}" style="height:4px;line-height:4px;font-size:4px;background-color:${topBarColor};">&nbsp;</td>
          </tr>

          <!-- Branded Charcoal / Midnight Hero -->
          <tr>
            <td bgcolor="${heroBg}" class="em-hero" style="padding:34px 40px 32px 40px;background-color:${heroBg};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle">
                    <a href="${escapeHtml(origin)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:inline-block;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td width="28" height="28" align="center" valign="middle" bgcolor="#2C273D" style="width:28px;height:28px;border-radius:7px;background-color:#2C273D;border:1px solid #453E5E;font-family:${FONT_SERIF};font-style:italic;font-size:16px;font-weight:700;color:#EAE4FA;line-height:26px;">
                            f
                          </td>
                          <td style="padding-left:9px;font-family:${FONT_SANS};font-size:20px;font-weight:700;letter-spacing:-0.6px;color:#FFFFFF;line-height:1;">
                            folio<span style="color:${topBarColor};">.</span>
                          </td>
                        </tr>
                      </table>
                    </a>
                  </td>
                  <td align="right" valign="middle">
                    <span style="display:inline-block;padding:5px 10px;border-radius:999px;background-color:${eyebrowBg};border:1px solid ${eyebrowBorder};font-family:${FONT_SANS};font-size:10px;font-weight:700;letter-spacing:1.25px;text-transform:uppercase;color:${eyebrowText};">
                      ${escapeHtml(options.eyebrow)}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top:26px;">
                    <h1 class="em-h1" style="margin:0 0 10px 0;font-family:${FONT_SANS};font-size:29px;font-weight:600;line-height:1.2;letter-spacing:-0.65px;color:#FFFFFF;">
                      ${options.headlineHtml}
                    </h1>
                    <p style="margin:0;font-family:${FONT_SANS};font-size:14.5px;line-height:1.62;color:${heroSubColor};max-width:490px;">
                      ${escapeHtml(options.heroSubtitle)}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Light Content Body -->
          <tr>
            <td bgcolor="#FFFFFF" class="em-body" style="padding:34px 40px 30px 40px;background-color:#FFFFFF;">
              <p style="margin:0 0 18px 0;font-family:${FONT_SANS};font-size:16px;font-weight:600;line-height:1.5;color:#1F1D2B;word-break:break-word;">
                ${escapeHtml(options.greeting)}
              </p>
              ${options.bodyHtml}
              ${renderEmailDivider()}
              <p style="margin:0;font-family:${FONT_SANS};font-size:13.5px;line-height:1.65;color:#6E6A7C;">
                With care,<br />
                <strong style="color:#252232;font-weight:600;">The Folio Team</strong>
              </p>
            </td>
          </tr>

          <!-- Sophisticated Footer -->
          <tr>
            <td bgcolor="#FAF9F6" class="em-footer" style="padding:24px 40px 28px 40px;background-color:#FAF9F6;border-top:1px solid #ECE9F1;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:${FONT_SANS};font-size:12px;font-weight:600;color:#3D394C;padding-bottom:6px;">
                    folio. &mdash; A little clarity. A lot of possibility.
                  </td>
                </tr>
                <tr>
                  <td style="font-family:${FONT_SANS};font-size:12px;line-height:1.6;color:#7B7689;padding-bottom:14px;word-break:break-word;">
                    ${escapeHtml(options.footerReason)}
                  </td>
                </tr>
                <tr>
                  <td style="font-family:${FONT_SANS};font-size:12px;line-height:1.6;color:#7B7689;">
                    <a href="${escapeHtml(`${origin}/overview`)}" target="_blank" rel="noopener noreferrer" style="color:#5B488E;text-decoration:none;font-weight:600;">Workspace</a>
                    &nbsp;&nbsp;&middot;&nbsp;&nbsp;
                    <a href="${escapeHtml(`${origin}/settings`)}" target="_blank" rel="noopener noreferrer" style="color:#6A6578;text-decoration:none;">Account settings</a>
                    &nbsp;&nbsp;&middot;&nbsp;&nbsp;
                    <a href="${escapeHtml(`${origin}/privacy`)}" target="_blank" rel="noopener noreferrer" style="color:#6A6578;text-decoration:none;">Privacy</a>
                    &nbsp;&nbsp;&middot;&nbsp;&nbsp;
                    <a href="${escapeHtml(`${origin}/terms`)}" target="_blank" rel="noopener noreferrer" style="color:#6A6578;text-decoration:none;">Terms</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:12px;font-family:${FONT_SANS};font-size:11px;line-height:1.5;color:#9590A3;">
                    &copy; ${year} Folio. Sent to ${escapeHtml(options.recipientEmail)}.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function italicSerifAccent(word: string, tone: EmailHeroTone = "editorial"): string {
  const color = tone === "security" ? "#C5D7F7" : "#D8CCF8";
  return `<span style="font-family:${FONT_SERIF};font-style:italic;font-weight:400;color:${color};">${escapeHtml(word)}</span>`;
}
