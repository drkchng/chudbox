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
 * Where the email-verification link lands (HashRouter route). On success
 * Better Auth redirects to this URL verbatim; on failure it string-appends
 * `?error=<code>` — which ends up INSIDE the hash, so the verified page reads
 * it via the hash-internal search params.
 */
export const VERIFIED_CALLBACK_PATH = '/#/auth/verified'

/**
 * Where the password-reset link lands. Better Auth builds the redirect with
 * `new URL(...).searchParams.set('token', ...)`, which inserts the query
 * BEFORE the hash (`/?token=…#/auth/reset`), so the reset page reads the
 * token from `window.location.search`, not the hash-internal search.
 */
export const RESET_CALLBACK_PATH = '/#/auth/reset'
