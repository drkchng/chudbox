import { createAuthClient } from 'better-auth/react'
import { inferAdditionalFields } from 'better-auth/client/plugins'

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
// The manual inferAdditionalFields schema mirrors the server's required
// `tosAcceptedVersion` additionalField (apps/api/src/auth.ts) so signUp.email
// accepts the consent field with types intact; the web app never imports
// api types directly.
export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields({
      user: { tosAcceptedVersion: { type: 'number', required: true } },
    }),
  ],
})

/**
 * Callback paths are CLEAN, relative app routes (BrowserRouter — M5).
 *
 * Better Auth validates callbackURL/redirectTo in its origin-check middleware,
 * which for these labels runs with `allowRelativePaths: true` and checks the
 * value against:
 *   /^\/(?!\/|\\|%2f|%5c)[\w\-.\+/@]*(?:\?[\w\-.\+/=&%@]*)?$/
 * A clean path like `/auth/reset` PASSES that regex natively, so no absolute
 * `window.location.origin` prefix is needed. (The old HashRouter paths
 * `/#/auth/...` FAILED it — `#` is outside the allowed char class — which is
 * why a now-removed workaround sent absolute origin-prefixed URLs instead.
 * BrowserRouter has no `#`, so the workaround is gone.)
 */

/**
 * Where the email-verification link lands (clean route). On success Better Auth
 * redirects to this path verbatim; on failure it appends `?error=<code>`, which
 * — with no hash in the way — arrives in `window.location.search` the normal
 * way, where AuthVerified reads it via useSearchParams.
 */
export const VERIFIED_CALLBACK_PATH = '/auth/verified'

/**
 * Where the password-reset link lands (clean route). Better Auth appends the
 * reset token as `?token=…`, which arrives in `window.location.search` the
 * normal way, where AuthReset reads it via useSearchParams.
 */
export const RESET_CALLBACK_PATH = '/auth/reset'
