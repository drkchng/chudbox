import { createAuthClient } from 'better-auth/react'

/**
 * Same-origin Better Auth client.
 *
 * No `baseURL` is passed, so the client resolves to `/api/auth` on the
 * current origin: in dev the Vite proxy forwards `/api` to the local Worker;
 * in production the single Worker serves both the SPA and `/api/auth/*`.
 *
 * Accounts are OPTIONAL. Since M2, SyncGate (mounted at the App level)
 * renders `authClient.useSession()` so the sync controller learns about an
 * existing session at boot; a failed or empty probe simply leaves the app in
 * its normal local-only logged-out state. The hook never throws; network
 * failures land in its `error` field, which callers ignore for rendering
 * decisions.
 */
export const authClient = createAuthClient()

/**
 * Callback URLs MUST be absolute (origin-prefixed), not relative.
 *
 * Better Auth validates callbackURL/redirectTo in its origin-check middleware.
 * A RELATIVE path is checked against this regex:
 *   /^\/(?!\/|\\|%2f|%5c)[\w\-.\+/@]*(?:\?[\w\-.\+/=&%@]*)?$/
 * which does NOT allow `#` — so our HashRouter paths (`/#/auth/...`) are
 * rejected with "Invalid callbackURL". An ABSOLUTE URL instead matches by
 * origin (`pattern === getOrigin(url)`), and Better Auth auto-trusts the
 * baseURL origin (verified: getTrustedOrigins pushes `new URL(baseURL).origin`),
 * so the same-origin app URL passes. Prefix with the live origin.
 */
const APP_ORIGIN = typeof window !== 'undefined' ? window.location.origin : ''

/**
 * Where the email-verification link lands (HashRouter route). On success
 * Better Auth redirects to this URL verbatim; on failure it string-appends
 * `?error=<code>` — which ends up INSIDE the hash, so the verified page reads
 * it via the hash-internal search params.
 */
export const VERIFIED_CALLBACK_PATH = `${APP_ORIGIN}/#/auth/verified`

/**
 * Where the password-reset link lands. Better Auth builds the redirect with
 * `new URL(...).searchParams.set('token', ...)`, which inserts the query
 * BEFORE the hash (`/?token=…#/auth/reset`), so the reset page reads the
 * token from `window.location.search`, not the hash-internal search.
 */
export const RESET_CALLBACK_PATH = `${APP_ORIGIN}/#/auth/reset`
