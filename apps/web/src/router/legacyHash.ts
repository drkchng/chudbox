/**
 * Backward-compat for legacy HashRouter links (M5: BrowserRouter migration).
 *
 * Before clean URLs, every route lived after `#` (e.g. `/#/share/<token>`). The
 * auth landings were quirkier: the reset token sat in the REAL query string
 * BEFORE the `#` (`/?token=…#/auth/reset`), while a verify error was appended
 * INSIDE the hash AFTER the path (`/#/auth/verified?error=…`). Old links of all
 * three shapes are still in the wild (shared builds, bookmarked emails), so we
 * rewrite them to the equivalent clean path on boot.
 *
 * Pure on purpose (takes the hash + search strings, returns the clean URL or
 * null) so it is unit-testable without a DOM; main.tsx applies the result via
 * `history.replaceState` BEFORE React renders, so BrowserRouter reads the
 * corrected location on its first pass (replaceState fires no navigation event,
 * so it MUST precede the render — a post-mount rewrite wouldn't re-route).
 */
export function legacyHashToCleanUrl(hash: string, search: string): string | null {
  // A legacy route hash is `#/…`, optionally carrying its own `?inner=query`.
  // Anything that isn't a `#/`-prefixed path (e.g. an empty hash, or a bare
  // in-page `#anchor`) is left untouched.
  const match = /^#(\/[^?#]*)(\?[^#]*)?$/.exec(hash)
  if (!match) return null
  const path = match[1]
  const hashQuery = match[2] ?? ''
  // Merge the real query string (legacy reset token) with the hash-internal
  // query (legacy verify error); the hash-internal value wins a rare collision.
  const params = new URLSearchParams(search)
  for (const [key, value] of new URLSearchParams(hashQuery)) params.set(key, value)
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}
