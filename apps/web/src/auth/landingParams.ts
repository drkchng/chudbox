/**
 * Pure readers for the email-landing query params (M5: clean BrowserRouter
 * URLs). The reset token / verify error arrive in the normal query string
 * (`?token=…`, `?error=…`), so these take a plain URLSearchParams (the
 * components pass `useSearchParams()`, which reflects the real query). Kept
 * pure so they unit-test without a DOM.
 */

/**
 * The token to reset a password with, or '' when the link instead carried an
 * `error` (invalid/expired) or no token at all. An error short-circuits the
 * token so the page shows the "link invalid" state, never a reset form.
 */
export function resetTokenFromParams(params: URLSearchParams): string {
  if (params.get('error')) return ''
  return params.get('token') ?? ''
}

/** The verification error code, or '' on success (Better Auth appends
 * `?error=<code>` only on failure). */
export function verifyErrorFromParams(params: URLSearchParams): string {
  return params.get('error') ?? ''
}
