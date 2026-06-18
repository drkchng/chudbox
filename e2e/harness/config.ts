/**
 * Shared constants + absolute paths for the Mode-1 E2E harness (local
 * `wrangler dev`). Imported by both `playwright.config.ts` and the test helpers.
 *
 * NOTE: `e2e/harness/devServer.mjs` recomputes the SAME paths from its own
 * location (it is plain ESM and cannot import this TS module under tsc). If you
 * move/rename any of these, update devServer.mjs in lock-step.
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url))

/** Repo layout anchors. */
export const E2E_DIR = resolve(HARNESS_DIR, '..')
export const REPO_ROOT = resolve(E2E_DIR, '..')
export const API_DIR = join(REPO_ROOT, 'apps', 'api')

/** Runtime scratch (gitignored). Recreated fresh on every server boot. */
export const TMP_DIR = join(E2E_DIR, '.tmp')
/** Isolated wrangler local-persistence dir (emulated D1/R2/DO live here). */
export const STATE_DIR = join(TMP_DIR, 'state')
/** wrangler dev stdout/stderr is teed here; the email helper tails it. */
export const WRANGLER_LOG = join(TMP_DIR, 'wrangler-dev.log')

/**
 * Fixed port so BETTER_AUTH_URL (and therefore the verification-link origin)
 * matches the address Playwright drives. Override with E2E_PORT if 8788 clashes.
 */
export const PORT = Number(process.env.E2E_PORT ?? 8788)

/**
 * Drive the app on `localhost` (NOT 127.0.0.1): Better Auth issues the
 * auto-sign-in session cookie for the request host, and the verification link
 * it logs uses `localhost` (from BETTER_AUTH_URL). Using the same hostname
 * everywhere keeps that cookie in scope. wrangler still binds 127.0.0.1, which
 * `localhost` resolves to.
 */
export const BASE_URL = `http://localhost:${PORT}`

/** Subject line of the verification email (email.ts COPY.verification.subject). */
export const VERIFY_EMAIL_SUBJECT = 'Verify your Chudbox email'
/** Subject line of the password-reset email (email.ts COPY.reset.subject). */
export const RESET_EMAIL_SUBJECT = 'Reset your Chudbox password'
