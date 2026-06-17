/**
 * Auth email delivery.
 *
 * If RESEND_API_KEY is configured, deliver via the Resend REST API with a
 * plain fetch (no SDK). Otherwise — local dev — log the action link to the
 * console and return. This function never throws: auth flows must not fail
 * because email delivery is unavailable.
 */

export interface EmailEnv {
  RESEND_API_KEY?: string
  AUTH_EMAIL_FROM?: string
}

export interface AuthEmail {
  to: string
  subject: string
  /** The action link (verification / password reset). */
  url: string
  text: string
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
