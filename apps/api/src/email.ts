/**
 * Auth email delivery.
 *
 * If RESEND_API_KEY is configured, deliver via the Resend REST API with a
 * plain fetch (no SDK). Otherwise — local dev — log the action link to the
 * console and return. This function never throws: auth flows must not fail
 * because email delivery is unavailable.
 *
 * Emails are sent as multipart `html` + `text`: the branded HTML below is the
 * primary experience, and the plain-text part is the deliverability / screen
 * reader / text-only-client fallback. The HTML is a table-based, inline-CSS,
 * dark-surface design that mirrors the app's "Garage" theme (see the email
 * design spec). All colors are app tokens applied to mail constraints; no
 * external images, no JS, no web fonts relied upon.
 */

export interface EmailEnv {
  RESEND_API_KEY?: string
  AUTH_EMAIL_FROM?: string
}

/** Which auth flow the mail belongs to. Drives copy, subject, and CTA label. */
export type AuthEmailPurpose = 'verification' | 'reset'

export interface AuthEmail {
  to: string
  subject: string
  /** The action link (verification / password reset). */
  url: string
  /** Plain-text part (deliverability + text-only clients). */
  text: string
  /** Branded HTML part (primary experience). */
  html: string
}

// ── Shared style constants ──────────────────────────────────────────────────
//
// Email-safe system stack. Inter leads as harmless progressive enhancement
// (the app font); the design is authored to look right in the fallback because
// custom web fonts are blocked in Outlook/Gmail. px everywhere, never rem.
const FONT =
  "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MONO =
  "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono','Courier New',monospace"

// App tokens (Garage default). Literal hex inlined per cell; contrast computed
// against the #1A1A1A card surface.
const COLOR = {
  page: '#0F0F0F', // --dark, outer page background
  surface: '#1A1A1A', // --surface, 600px card
  inset: '#242424', // --surface-2, raw-URL block
  border: '#2D2D2D', // --border, hairline
  heading: '#FAFAFA', // 16.7:1 on surface
  body: '#E5E5E5', // 13.8:1 on surface
  muted: '#A3A3A3', // 6.9:1 on surface
  accent: '#F97316', // --accent, CTA fill
  accentHover: '#EA580C', // --accent-dim, optional hover
  // CTA label is dark-on-orange (6.84:1, PASS AA) — a deliberate, justified
  // deviation from the app's .btn-primary (white-on-orange, 2.80:1, FAILS AA).
  onAccent: '#0F0F0F',
} as const

// ── Per-purpose copy (single source of truth for both html + text) ──────────
//
// Expiry durations are the REAL Better Auth defaults: both the email
// verification token (emailVerification.expiresIn) and the password reset
// token (resetPasswordTokenExpiresIn) default to 3600s = 1 hour, and neither
// is overridden in auth.ts.
interface AuthEmailCopy {
  subject: string
  preheader: string
  heading: string
  body: string
  ctaLabel: string
  /** Expiry + security notice. Always text, never color-only meaning. */
  securityLine: string
}

const COPY: Record<AuthEmailPurpose, AuthEmailCopy> = {
  verification: {
    subject: 'Verify your Chudbox email',
    preheader: 'Confirm your email to turn on sync and cloud backup.',
    heading: 'Confirm your email',
    body: 'Confirm this address to activate your Chudbox account and turn on cross-device sync and cloud backup. One click does it.',
    ctaLabel: 'Confirm email',
    securityLine:
      "This link expires in about an hour. If you didn't create a Chudbox account, ignore this email.",
  },
  reset: {
    subject: 'Reset your Chudbox password',
    preheader: 'Reset your Chudbox password — this link expires soon.',
    heading: 'Reset your password',
    body: "Set a new password for your Chudbox account. Click below and you'll be back in the garage in a minute.",
    ctaLabel: 'Reset password',
    securityLine:
      "This link expires in about an hour. If you didn't request this, ignore this email — your password stays the same.",
  },
}

/** Escape a string for safe interpolation into HTML text / attribute context. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderText(copy: AuthEmailCopy, url: string): string {
  return [
    `${copy.heading} — Chudbox`,
    '',
    copy.body,
    '',
    `${copy.ctaLabel}:`,
    url,
    '',
    copy.securityLine,
    '',
    '— Chudbox',
  ].join('\n')
}

function renderHtml(copy: AuthEmailCopy, url: string): string {
  const href = escapeHtml(url)
  const subject = escapeHtml(copy.subject)
  const preheader = escapeHtml(copy.preheader)
  const heading = escapeHtml(copy.heading)
  const body = escapeHtml(copy.body)
  const ctaLabel = escapeHtml(copy.ctaLabel)
  const securityLine = escapeHtml(copy.securityLine)

  return `<!DOCTYPE html>
<html lang="en" style="margin:0;padding:0;">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${subject}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  :root { color-scheme: dark light; supported-color-schemes: dark light; }
  body { margin:0 !important; padding:0 !important; width:100% !important; background-color:${COLOR.page}; }
  table { border-collapse:collapse; }
  img { border:0; line-height:100%; outline:none; text-decoration:none; }
  a { text-decoration:none; }
  /* Best-effort hover (clients that keep head styles). Native focus outline
     is intentionally NOT suppressed — keyboard users in webmail need it. */
  .cb-btn:hover, .cb-btn a:hover { background-color:${COLOR.accentHover}; }
  @media only screen and (max-width:600px) {
    .cb-container { width:100% !important; }
    .cb-gutter { padding-left:16px !important; padding-right:16px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${COLOR.page};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COLOR.page};opacity:0;">${preheader}&#8203;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.page}" style="background-color:${COLOR.page};">
    <tr>
      <td align="center" class="cb-gutter" bgcolor="${COLOR.page}" style="padding:24px 16px;background-color:${COLOR.page};">
        <table role="presentation" class="cb-container" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.surface}" style="width:600px;max-width:600px;background-color:${COLOR.surface};border:1px solid ${COLOR.border};border-radius:12px;">
          <tr>
            <td bgcolor="${COLOR.surface}" style="padding:28px 32px;border-bottom:1px solid ${COLOR.border};background-color:${COLOR.surface};font-family:${FONT};font-size:20px;line-height:20px;font-weight:700;letter-spacing:0.5px;color:${COLOR.heading};">CHUDBOX</td>
          </tr>
          <tr>
            <td bgcolor="${COLOR.surface}" style="padding:32px;background-color:${COLOR.surface};">
              <h1 style="margin:0 0 12px 0;font-family:${FONT};font-size:24px;line-height:31px;font-weight:700;color:${COLOR.heading};">${heading}</h1>
              <p style="margin:0 0 28px 0;font-family:${FONT};font-size:16px;line-height:24px;font-weight:400;color:${COLOR.body};">${body}</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px 0;">
                <tr>
                  <td align="left">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="17%" stroke="f" fillcolor="${COLOR.accent}">
                      <w:anchorlock/>
                      <center style="color:${COLOR.onAccent};font-family:${FONT};font-size:16px;font-weight:600;">${ctaLabel}</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-->
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="cb-btn" bgcolor="${COLOR.accent}" style="border-radius:8px;background-color:${COLOR.accent};">
                      <tr>
                        <td align="center" bgcolor="${COLOR.accent}" style="border-radius:8px;background-color:${COLOR.accent};">
                          <a href="${href}" style="display:inline-block;min-width:200px;box-sizing:border-box;text-align:center;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:600;line-height:20px;color:${COLOR.onAccent};text-decoration:none;border-radius:8px;">${ctaLabel}</a>
                        </td>
                      </tr>
                    </table>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-family:${FONT};font-size:13px;line-height:20px;font-weight:400;color:${COLOR.muted};">Button not working? Paste this link into your browser:</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.inset}" style="background-color:${COLOR.inset};border-radius:8px;border:1px solid ${COLOR.border};">
                <tr>
                  <td bgcolor="${COLOR.inset}" style="padding:14px 16px;background-color:${COLOR.inset};font-family:${MONO};font-size:13px;line-height:18px;color:${COLOR.body};word-break:break-all;">
                    <a href="${href}" style="color:${COLOR.body};text-decoration:underline;word-break:break-all;">${href}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0 0;font-family:${FONT};font-size:13px;line-height:20px;font-weight:400;color:${COLOR.muted};">${securityLine}</p>
            </td>
          </tr>
          <tr>
            <td bgcolor="${COLOR.surface}" style="padding:24px 32px;border-top:1px solid ${COLOR.border};background-color:${COLOR.surface};font-family:${FONT};font-size:13px;line-height:20px;font-weight:400;color:${COLOR.muted};">Chudbox · your garage, synced. You received this because this address was used to sign up for or recover a Chudbox account.</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Build the subject, plain-text, and branded HTML parts for an auth email.
 * Pure (no I/O) so it can be unit-tested and rendered for previews — the
 * exact output here is what ships.
 */
export function renderAuthEmail(
  purpose: AuthEmailPurpose,
  url: string,
): { subject: string; text: string; html: string } {
  const copy = COPY[purpose]
  return {
    subject: copy.subject,
    text: renderText(copy, url),
    html: renderHtml(copy, url),
  }
}

export async function sendAuthEmail(
  env: EmailEnv,
  email: AuthEmail,
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    // Dev fallback: surface the action link in the wrangler dev logs.
    console.log(
      `[auth-email] (dev fallback, RESEND_API_KEY not set) to=${email.to} subject="${email.subject}" link=${email.url}`,
    )
    return
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.AUTH_EMAIL_FROM ?? 'Chudbox <onboarding@resend.dev>',
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    })
    if (!res.ok) {
      console.error(
        `[auth-email] Resend returned ${res.status}: ${await res.text()}`,
      )
    }
  } catch (error) {
    console.error('[auth-email] Resend delivery failed:', error)
  }
}
