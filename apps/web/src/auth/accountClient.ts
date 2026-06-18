// DEC-10 — the client seam for the owner display-name + "show my name on
// shares" consent. Thin wrappers over GET/POST /api/account/display, kept
// framework-free (injectable fetch) so they unit-test without React. These are
// session-authed (the cookie rides the same-origin request); the public share
// viewer never calls them.
import { ACCOUNT_DELETE_PATH, ACCOUNT_DISPLAY_PATH } from '@chudbox/shared'
import type {
  AccountDeleteResponse,
  AccountDisplaySettings,
  UpdateAccountDisplayRequest,
} from '@chudbox/shared'

/** Minimal fetch signature so tests can inject a stub. */
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

/** GET the caller's current { name, showOwnerName }. Throws on any non-2xx. */
export async function getAccountDisplay(
  fetchImpl: FetchLike = fetch,
): Promise<AccountDisplaySettings> {
  const res = await fetchImpl(ACCOUNT_DISPLAY_PATH, {
    method: 'GET',
    credentials: 'same-origin',
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as AccountDisplaySettings
}

/**
 * POST a partial update of the display name and/or consent. Returns the
 * authoritative persisted values (read back server-side). Throws on any non-2xx.
 */
export async function updateAccountDisplay(
  patch: UpdateAccountDisplayRequest,
  fetchImpl: FetchLike = fetch,
): Promise<AccountDisplaySettings> {
  const res = await fetchImpl(ACCOUNT_DISPLAY_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: JSON_HEADERS,
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as AccountDisplaySettings
}

/**
 * Irreversibly delete the CALLER's account + ALL their data (G4 / Law-25
 * right-to-erasure). The target is the session's own user — the server takes the
 * userId ONLY from the validated session and reads NO body, so we send none.
 * Purges the Durable Object garage + every R2 image + the D1 user row (which
 * cascades session/account/share_links). Throws on any non-2xx.
 */
export async function deleteAccount(
  fetchImpl: FetchLike = fetch,
): Promise<AccountDeleteResponse> {
  const res = await fetchImpl(ACCOUNT_DELETE_PATH, {
    method: 'POST',
    credentials: 'same-origin',
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as AccountDeleteResponse
}
