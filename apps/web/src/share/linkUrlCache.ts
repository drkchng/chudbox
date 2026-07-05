// Local memory of full share URLs, keyed by ShareLinkMeta.id.
//
// The server stores ONLY sha256(token) and returns the raw URL exactly once at
// creation (bearer-credential rule — see shareClient.ts / routes/share.ts), so
// the owner list can never be re-populated with URLs from the API. This cache
// is the UX valve: the CREATING device remembers the URL in localStorage so the
// owner can re-copy their own links from the dialog's list. A link created on
// another device (or before this cache existed) simply has no entry — the
// dialog explains that instead of showing a copy button.
//
// Storage is injectable (same pattern as recordShareView's SessionStorageLike)
// and every call swallows storage failures (private mode / disabled), because
// remembering a URL is best-effort — never worth breaking the share flow.

/** Minimal localStorage shape so tests can inject a stub. */
export interface LocalStorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

/** localStorage key holding the full share URL for one link id. */
export function shareUrlKey(linkId: string): string {
  return `chudbox:shareUrl:${linkId}`
}

/** The ambient localStorage, or undefined under node / SSR (importing is safe). */
function defaultStorage(): LocalStorageLike | undefined {
  return typeof localStorage !== 'undefined' ? localStorage : undefined
}

/** Remember a freshly-created link's full URL on this device. Best-effort. */
export function rememberShareUrl(
  linkId: string,
  url: string,
  storage: LocalStorageLike | undefined = defaultStorage(),
): void {
  if (!linkId || !url) return
  try {
    storage?.setItem(shareUrlKey(linkId), url)
  } catch {
    /* storage unavailable/full — the create card still shows the URL once */
  }
}

/** The full URL for a link id, iff this device created it. null otherwise. */
export function getShareUrl(
  linkId: string,
  storage: LocalStorageLike | undefined = defaultStorage(),
): string | null {
  try {
    return storage?.getItem(shareUrlKey(linkId)) ?? null
  } catch {
    return null
  }
}

/** Drop a link's remembered URL (call after a successful revoke). */
export function forgetShareUrl(
  linkId: string,
  storage: LocalStorageLike | undefined = defaultStorage(),
): void {
  try {
    storage?.removeItem(shareUrlKey(linkId))
  } catch {
    /* nothing to clean up if storage is unreachable */
  }
}
