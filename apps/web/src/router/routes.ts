/**
 * Canonical clean-URL route patterns (BrowserRouter — M5).
 *
 * Exported as a single source of truth so App's <Route> table and the routing
 * tests stay in lock-step: a test asserts each clean path resolves to exactly
 * one of these patterns (and that the legacy-hash shim rewrites old `/#/…`
 * links onto them). These are plain strings (no JSX), so importing them under
 * the node test env pulls in none of the page/component tree.
 */
export const ROUTES = {
  garage: '/',
  car: '/car/:id',
  /** Public, read-only shared build (no account required). */
  share: '/share/:token',
  /** Email landing: password reset. */
  authReset: '/auth/reset',
  /** Email landing: post-verification notice. */
  authVerified: '/auth/verified',
} as const
