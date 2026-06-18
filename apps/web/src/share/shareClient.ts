// M4 share-links — the client-side network + helper seam, kept framework-free
// so it is fully unit-testable over an injected fetch (the components are thin
// wrappers around these functions).
//
// OWNER surface (session-authed; credentials ride the same-origin request):
//   createShareLink / listShareLinks / revokeShareLink.
// PUBLIC surface (NO session — works logged-out): fetchShareSnapshot. It sends
//   credentials: 'omit' to make the no-auth contract explicit; the server
//   derives owner/car/r2Key from the validated token row, never from the client.
//
// The raw token is a BEARER CREDENTIAL: it is returned by createShareLink ONCE
// and never again — listShareLinks yields only ShareLinkMeta (a short hash
// prefix id, no token, no url). The "copy it now" UX rests on that fact.
import {
  createShareLinkPath,
  shareRevokePath,
  shareSnapshotPath,
  shareSnapshotResponseSchema,
  shareViewPath,
} from '@chudbox/shared'
import type {
  CreateShareRequest,
  CreateShareResponse,
  ShareLinkListResponse,
  ShareLinkMeta,
  ShareScope,
  ShareSnapshotResponse,
} from '@chudbox/shared'

/** Minimal fetch signature (matches the M3 photo-upload seam) so tests inject a stub. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const JSON_HEADERS = { 'content-type': 'application/json' } as const

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown }
    if (body && typeof body.error === 'string') return body.error
  } catch {
    /* non-JSON body — fall through to the status code */
  }
  return `request failed (${res.status})`
}

// ── Owner actions ───────────────────────────────────────────

export interface CreateShareLinkArgs {
  carId: string
  /** Epoch SECONDS, or null for no expiry (the default). */
  expiresAt: number | null
  /**
   * Which view the link grants — 'curated' (build showcase, the default) or
   * 'full' (the owner-equivalent read-only view). The server validates + stores
   * it; this is the owner's choice at create time.
   */
  scope?: ShareScope
  fetchImpl?: FetchLike
}

/**
 * POST a new share link for one of the caller's cars. Returns the raw URL +
 * token EXACTLY ONCE (server stores only sha256(token)); the caller must show
 * it immediately. Throws on any non-2xx.
 */
export async function createShareLink({
  carId,
  expiresAt,
  scope = 'curated',
  fetchImpl = fetch,
}: CreateShareLinkArgs): Promise<CreateShareResponse> {
  const body: CreateShareRequest = { expiresAt, scope }
  const res = await fetchImpl(createShareLinkPath(carId), {
    method: 'POST',
    credentials: 'same-origin',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as CreateShareResponse
}

export interface ListShareLinksArgs {
  carId: string
  fetchImpl?: FetchLike
}

/** GET the caller's share links for a car. Yields ONLY metadata (no raw token). */
export async function listShareLinks({
  carId,
  fetchImpl = fetch,
}: ListShareLinksArgs): Promise<ShareLinkMeta[]> {
  const res = await fetchImpl(createShareLinkPath(carId), {
    method: 'GET',
    credentials: 'same-origin',
  })
  if (!res.ok) throw new Error(await readError(res))
  const data = (await res.json()) as ShareLinkListResponse
  return data.links
}

export interface RevokeShareLinkArgs {
  carId: string
  /** ShareLinkMeta.id — a prefix of the token hash, never the raw token. */
  id: string
  fetchImpl?: FetchLike
}

/** DELETE (revoke) one share link by its public id. Throws on any non-2xx. */
export async function revokeShareLink({
  carId,
  id,
  fetchImpl = fetch,
}: RevokeShareLinkArgs): Promise<void> {
  const res = await fetchImpl(shareRevokePath(carId, id), {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok) throw new Error(await readError(res))
}

// ── Public snapshot fetch (no session) ──────────────────────

/**
 * Discriminated result of fetching a public snapshot. `not-found` (404) and
 * `gone` (410, revoked/expired/lazy-revoked) are distinct, expected outcomes —
 * not errors — so the viewer can show a precise message. `error` covers
 * everything else (5xx, network failure, malformed body).
 */
export type SnapshotResult =
  | { kind: 'ok'; data: ShareSnapshotResponse }
  | { kind: 'not-found' }
  | { kind: 'gone' }
  | { kind: 'error'; message: string }

/**
 * GET a public car snapshot by token. Sends NO credentials (public, works
 * logged-out). Never throws — every failure maps to a SnapshotResult variant
 * the viewer renders.
 */
export async function fetchShareSnapshot(
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<SnapshotResult> {
  let res: Response
  try {
    res = await fetchImpl(shareSnapshotPath(token), {
      method: 'GET',
      credentials: 'omit',
    })
  } catch {
    return { kind: 'error', message: 'Could not reach the server. Check your connection and try again.' }
  }
  if (res.status === 404) return { kind: 'not-found' }
  if (res.status === 410) return { kind: 'gone' }
  if (!res.ok) return { kind: 'error', message: await readError(res) }
  // Validate the untrusted network body against the shared response schema
  // (strict / deny-by-default) before trusting it: a stale cache, a proxy, or a
  // future server change must never cast-and-crash the public viewer.
  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { kind: 'error', message: 'The server returned an unexpected response.' }
  }
  const parsed = shareSnapshotResponseSchema.safeParse(json)
  if (!parsed.success) {
    return { kind: 'error', message: 'The server returned an unexpected response.' }
  }
  return { kind: 'ok', data: parsed.data }
}

// ── Record a view (public, no session, fire-and-forget) ─────

/** Minimal sessionStorage shape so the once-per-session guard is injectable. */
export interface SessionStorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/** sessionStorage key marking a token already counted this browser session. */
export function viewedSessionKey(token: string): string {
  return `chudbox:viewed:${token}`
}

/** The ambient sessionStorage, or undefined under node / SSR (importing is safe). */
function defaultSessionStorage(): SessionStorageLike | undefined {
  return typeof sessionStorage !== 'undefined' ? sessionStorage : undefined
}

export interface RecordShareViewOptions {
  fetchImpl?: FetchLike
  storage?: SessionStorageLike | undefined
}

/**
 * POST one view of a share link — ONCE PER BROWSER SESSION PER TOKEN. The
 * sessionStorage guard (keyed by token) is checked + set BEFORE the request
 * fires, so a page refresh or a remount never re-counts. Public + credential-
 * less (the counter needs no session), and fully FIRE-AND-FORGET: it never
 * throws and never rejects, so the viewer can `void recordShareView(token)`
 * without blocking or breaking the page render. A failed ping (offline, etc.)
 * is silently dropped — this is a soft, approximate metric.
 */
export async function recordShareView(
  token: string,
  { fetchImpl = fetch, storage = defaultSessionStorage() }: RecordShareViewOptions = {},
): Promise<void> {
  if (!token) return
  const key = viewedSessionKey(token)
  try {
    // Already pinged this session → do nothing (a refresh must not re-count).
    if (storage && storage.getItem(key) != null) return
    // Mark BEFORE firing so a rapid refresh/remount can't double-count even if
    // the request is still in flight. sessionStorage can throw (private mode /
    // disabled) — fall through and still ping (worst case: a re-count later).
    storage?.setItem(key, '1')
  } catch {
    /* storage unavailable — proceed without the guard */
  }
  try {
    await fetchImpl(shareViewPath(token), { method: 'POST', credentials: 'omit' })
  } catch {
    /* fire-and-forget: a failed view ping must never surface to the viewer */
  }
}

// ── Expiry helper ───────────────────────────────────────────

/** Result of turning the optional date-picker value into an epoch-seconds expiry. */
export type ExpiryResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string }

/**
 * Convert the optional `YYYY-MM-DD` expiry from the share dialog into the epoch
 * SECONDS the API expects (end of that local day, so the link is usable through
 * the chosen date). Empty input → no expiry (null). A past/invalid date → an
 * error the dialog surfaces. Pure + injectable `now` for tests.
 */
export function expiryInputToEpochSeconds(
  dateStr: string,
  now: Date = new Date(),
): ExpiryResult {
  const trimmed = dateStr.trim()
  if (trimmed === '') return { ok: true, value: null }
  // Interpret the date as the END of that day in local time.
  const at = new Date(`${trimmed}T23:59:59`)
  const ms = at.getTime()
  if (Number.isNaN(ms)) return { ok: false, error: 'Enter a valid expiry date.' }
  const seconds = Math.floor(ms / 1000)
  if (seconds <= Math.floor(now.getTime() / 1000)) {
    return { ok: false, error: 'Expiry must be in the future.' }
  }
  return { ok: true, value: seconds }
}

// ── Clipboard helper ────────────────────────────────────────

interface ClipboardLike {
  writeText: (text: string) => Promise<void>
}

/**
 * Copy `text` to the clipboard. Returns whether it succeeded so the dialog can
 * confirm (and keep the URL visible to copy manually on failure). Injectable
 * clipboard for tests; reads navigator lazily so importing under node is safe.
 */
export async function copyToClipboard(
  text: string,
  clipboard?: ClipboardLike,
): Promise<boolean> {
  const clip =
    clipboard ??
    (typeof navigator !== 'undefined'
      ? (navigator as unknown as { clipboard?: ClipboardLike }).clipboard
      : undefined)
  if (!clip || typeof clip.writeText !== 'function') return false
  try {
    await clip.writeText(text)
    return true
  } catch {
    return false
  }
}

// ── View-count display ──────────────────────────────────────

/**
 * Render a share link's view count for the owner list, e.g. `0 views`,
 * `1 view`, `12 views`. Coerces a missing/negative/non-finite count to 0 and
 * floors fractional values so the label is always a clean integer. The metric
 * counts browser sessions (not guaranteed-unique humans), so the label is
 * deliberately "views", never "visitors".
 */
export function formatViewCount(count: number): string {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  return `${n} ${n === 1 ? 'view' : 'views'}`
}
