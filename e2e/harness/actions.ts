/**
 * Reusable UI flows shared by the specs. Selectors lean on roles / visible text
 * / labels / placeholders (no brittle CSS), matching what a user sees. The few
 * `.modal-backdrop` class hooks are existing, stable app affordances.
 *
 * Field-locator note: the auth modals (SignUp/SignIn) associate <label> with
 * <input> via htmlFor/id, so getByLabel works there; AddCarModal does NOT, so
 * its fields are located by their (unique-per-modal) placeholders.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { completeEmailVerification } from './email'

/** Monotonic, randomness-free unique email (uniqueness only — never asserted on). */
let emailSeq = 0
export function uniqueEmail(prefix = 'e2e'): string {
  emailSeq += 1
  return `${prefix}-${Date.now().toString(36)}-${process.pid.toString(36)}-${emailSeq}@example.test`
}

export interface NewCar {
  year: string
  make: string
  model: string
  /** Entered in the app's CURRENT distance unit (default mi). */
  mileage?: string
}

/** Open the Settings slide-panel (gear button exists on Garage and Car pages). */
export async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
}

/** Close the Settings panel by clicking its backdrop (it has no Escape handler). */
export async function closeSettings(page: Page): Promise<void> {
  // The backdrop is a full-viewport sibling BEHIND the right-hand panel; its
  // top-left corner is always clear of the panel.
  await page.locator('.modal-backdrop').first().click({ position: { x: 5, y: 5 } })
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeHidden()
}

/**
 * Add a car from the Garage via AddCarModal. The header trigger is "Add Car"
 * and the form submit is "Add car" — exact (case-sensitive) names keep them
 * distinct (Playwright role-name matching is case-insensitive by default).
 */
export async function addCar(page: Page, car: NewCar): Promise<void> {
  await page.getByRole('button', { name: 'Add Car', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Add car' })).toBeVisible()
  await page.getByPlaceholder('2020').fill(car.year)
  await page.getByPlaceholder('Toyota').fill(car.make)
  await page.getByPlaceholder('Supra').fill(car.model)
  if (car.mileage !== undefined) await page.getByPlaceholder('45000').fill(car.mileage)
  await page.getByRole('button', { name: 'Add car', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Add car' })).toBeHidden()
}

/** Open a car's profile from its garage card; resolves once on /car/:id. */
export async function openCar(page: Page, car: NewCar): Promise<void> {
  await page.getByRole('heading', { name: `${car.make} ${car.model}`, exact: true }).click()
  await expect(page).toHaveURL(/\/car\/[^/]+$/)
}

/** Log a mod on the open Car profile and wait for it to appear in the list. */
export async function addMod(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Mods', exact: true }).click()
  await page.getByRole('button', { name: 'Add Mod', exact: true }).click()
  const nameField = page.getByPlaceholder('Coilover Kit')
  await nameField.fill(name)
  // Submit via Enter to avoid the toggle/submit "Add Mod" ambiguity once the form is open.
  await nameField.press('Enter')
  await expect(page.getByText(name, { exact: true })).toBeVisible()
}

export interface Credentials {
  name: string
  email: string
  password: string
}

/**
 * Create an account through Settings → Account → "Create account". Stops at the
 * "Check your inbox" confirmation (requireEmailVerification: no session yet).
 * Assumes the Settings panel is OPEN.
 */
export async function signUpViaSettings(page: Page, creds: Credentials): Promise<void> {
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible()
  await page.getByLabel('Name').fill(creds.name)
  await page.getByLabel('Email').fill(creds.email)
  await page.getByLabel('Password', { exact: true }).fill(creds.password)
  await page.getByLabel('Confirm password').fill(creds.password)
  await page.getByLabel('Confirm password').press('Enter')
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
}

/**
 * Sign in through Settings → Account → "Sign in". Resolves once the Account
 * section reflects the signed-in user. Assumes the Settings panel is OPEN and
 * the email is already verified.
 */
export async function signInViaSettings(page: Page, email: string, password: string): Promise<void> {
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Password', { exact: true }).press('Enter')
  // Sign-in modal closes on success and the Account block now shows the email.
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeHidden()
  await expect(page.getByText(email, { exact: true })).toBeVisible()
}

/**
 * Full account bring-up used by the share flow: sign up, verify (auto-signs-in
 * via the verify link), and land back on the garage signed-in. Assumes you
 * start on the garage ('/') with the Settings panel CLOSED.
 */
export async function signUpAndVerify(page: Page, creds: Credentials): Promise<void> {
  await openSettings(page)
  await signUpViaSettings(page, creds)
  await closeSettings(page)
  await completeEmailVerification(page, creds.email) // navigates to /auth/verified, sets session
  await page.goto('/') // re-enter the SPA signed-in; SyncGate begins negotiation
}

/**
 * Wait until the Settings → Account sync indicator reads "Synced". For a fresh
 * account with local cars and an empty cloud, the controller runs seed →
 * verify-seed → attach, so "Synced" guarantees the local cars (and their mods)
 * reached the owner's Durable Object — the precondition for sharing. Leaves the
 * Settings panel closed.
 */
export async function waitForSynced(page: Page): Promise<void> {
  await openSettings(page)
  await expect(page.getByText('Synced', { exact: true })).toBeVisible({ timeout: 30_000 })
  await closeSettings(page)
}
