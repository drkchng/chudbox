/**
 * Scheme allowlist for USER-ENTERED link fields (mod.link / wishlist.link)
 * before they land in an <a href>. React does not sanitize javascript:/data:
 * hrefs, so an owner-controlled link on a PUBLIC share page would otherwise be
 * a stored-XSS vector one CSP loosening away from exploitable (today the
 * script-src 'self' CSP blocks javascript: navigation — this is the layer
 * beneath it). Only http/https survive; anything unparseable is unsafe.
 */
export function isSafeHref(href: string): boolean {
  try {
    // The base resolves scheme-relative/relative inputs (e.g. a pasted
    // "www.shop.com/part") to https, which is a safe, useful rendering.
    const protocol = new URL(href, 'https://relative.invalid').protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
