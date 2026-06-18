/**
 * Email-verify helper (Mode 1, no real mail).
 *
 * Better Auth 1.6.18 issues the email-verification token as a STATELESS signed
 * JWT embedded in the verify URL — it is NOT written to the D1 `verification`
 * table (confirmed empirically: that table is empty for a fresh signup). So the
 * only place the usable link exists locally is the dev-fallback console line
 * that apps/api/src/email.ts logs when RESEND_API_KEY is unset:
 *
 *   [auth-email] (dev fallback, RESEND_API_KEY not set) to=<email>
 *     subject="Verify your Chudbox email" link=<url>
 *
 * devServer.mjs tees wrangler dev's output to WRANGLER_LOG, and this helper
 * tails that file for the line matching one email + subject, then returns the
 * link. (The D1 `verification` table IS used for password-reset tokens — see
 * d1.ts if you ever need those.)
 */
import { readFile } from 'node:fs/promises'
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { VERIFY_EMAIL_SUBJECT, WRANGLER_LOG } from './config'

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface AuthEmailLinkOptions {
  email: string
  /** Defaults to the verification subject; pass RESET_EMAIL_SUBJECT for resets. */
  subject?: string
  timeoutMs?: number
  pollMs?: number
  logFile?: string
}

/**
 * Resolve the most recent dev-fallback auth link for `email` from the wrangler
 * log. Polls because the email send is fire-and-forget (a beat after the
 * sign-up response). Throws (with the file path) if none appears in time.
 */
export async function waitForAuthEmailLink(options: AuthEmailLinkOptions): Promise<string> {
  const {
    email,
    subject = VERIFY_EMAIL_SUBJECT,
    timeoutMs = 20_000,
    pollMs = 250,
    logFile = WRANGLER_LOG,
  } = options
  const deadline = Date.now() + timeoutMs
  const toNeedle = `to=${email}`
  let lastError = ''
  while (Date.now() < deadline) {
    const link = await findLink(logFile, toNeedle, subject)
    if (link) return link
    lastError = `no "[auth-email] … ${toNeedle} … subject=\"${subject}\"" line yet`
    await delay(pollMs)
  }
  throw new Error(
    `waitForAuthEmailLink timed out after ${timeoutMs}ms (${lastError}); log: ${logFile}`,
  )
}

async function findLink(
  logFile: string,
  toNeedle: string,
  subject: string,
): Promise<string | null> {
  let text: string
  try {
    text = await readFile(logFile, 'utf8')
  } catch {
    return null // log not created yet
  }
  // Newest matching line wins (a "resend" produces a fresh link).
  const matches = text
    .split('\n')
    .filter(
      (line) =>
        line.includes('[auth-email]') &&
        line.includes(toNeedle) &&
        line.includes(subject),
    )
  const line = matches.at(-1)
  if (!line) return null
  const marker = 'link='
  const idx = line.indexOf(marker)
  if (idx === -1) return null
  return line.slice(idx + marker.length).trim()
}

/**
 * Drive a verification to completion in `page`: fetch the link from the log,
 * navigate to it (Better Auth verifies, auto-signs-in via the session cookie,
 * and 302-redirects to the clean /auth/verified route), and assert the success
 * landing. After this the browser context holds an authenticated session.
 */
export async function completeEmailVerification(page: Page, email: string): Promise<void> {
  const link = await waitForAuthEmailLink({ email })
  await page.goto(link)
  await expect(page).toHaveURL(/\/auth\/verified/)
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible()
}
