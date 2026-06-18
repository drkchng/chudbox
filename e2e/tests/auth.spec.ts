/**
 * Flow 1 — account lifecycle: sign up → verify (via the dev-fallback link) →
 * sign in. Drives the real Better Auth email/password flow with
 * requireEmailVerification against local `wrangler dev`.
 */
import { expect, test } from '@playwright/test'
import {
  closeSettings,
  openSettings,
  signInViaSettings,
  signUpViaSettings,
  uniqueEmail,
} from '../harness/actions'
import { completeEmailVerification } from '../harness/email'
import { getUserByEmail } from '../harness/d1'

const PASSWORD = 'correct-horse-battery-staple'

test('sign up → verify → sign in', async ({ page }) => {
  const email = uniqueEmail('auth')
  const creds = { name: 'Ada Lovelace', email, password: PASSWORD }

  // --- Sign up (no session yet: requireEmailVerification) ---
  await page.goto('/')
  await openSettings(page)
  await signUpViaSettings(page, creds)
  await closeSettings(page)

  // Server-side ground truth: user exists but is unverified. (Each poll spawns a
  // `wrangler d1 execute` subprocess, so poll gently.)
  const pollOpts = { timeout: 20_000, intervals: [500, 1_000, 2_000] }
  await expect.poll(async () => (await getUserByEmail(email))?.email_verified, pollOpts).toBe(0)

  // --- Verify via the emailed link (auto-signs-in) ---
  await completeEmailVerification(page, email)
  await expect.poll(async () => (await getUserByEmail(email))?.email_verified, pollOpts).toBe(1)

  // Back in the app, the account now reads as the verified, signed-in user.
  await page.goto('/')
  await openSettings(page)
  await expect(page.getByText(email, { exact: true })).toBeVisible()
  await expect(page.getByText('Verified', { exact: true })).toBeVisible()

  // --- Sign out, then sign in with the password (exercises the sign-in path) ---
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()

  await signInViaSettings(page, email, PASSWORD)
  await expect(page.getByText('Verified', { exact: true })).toBeVisible()
})

test('sign-in is refused until the email is verified', async ({ page }) => {
  const email = uniqueEmail('unverified')
  const creds = { name: 'Grace Hopper', email, password: PASSWORD }

  await page.goto('/')
  await openSettings(page)
  await signUpViaSettings(page, creds) // signed up, NOT verified

  // Attempt sign-in without verifying — Better Auth returns 403; the modal must
  // surface the unverified state with a resend affordance and stay open.
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Password', { exact: true }).press('Enter')

  await expect(page.getByRole('button', { name: 'Resend verification email' })).toBeVisible()
  // Still on the sign-in modal (not signed in).
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})
