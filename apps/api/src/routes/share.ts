/**
 * Share-link routes (M4 — read-only public share links).
 *
 * Two surfaces, two trust models:
 *
 *  • OWNER (session-authed): create / list / revoke links for one of the
 *    caller's cars. Same auth pattern as /sync and /api/sync/* — the Better
 *    Auth session is validated FIRST, and the Durable Object is addressed ONLY
 *    via GARAGE_DO.idFromName(verified userId), never from client input.
 *
 *  • PUBLIC (NO session): GET the snapshot + GET a token-scoped image. These
 *    take no session but are safe because every R2 key and the owner/car
 *    identity are derived SERVER-SIDE from the validated share_links row (which
 *    only the authenticated owner could have inserted) — never from the
 *    request (plan Risk #7).
 *
 * Token = bearer credential (plan Risk #7 / db/schema.md §2):
 *  - ≥128-bit entropy from crypto.getRandomValues (24 bytes → URL-safe base64,
 *    32 chars, no padding).
 *  - Only sha256(token) (hex) is stored in D1; we look up by that hash. The raw
 *    token is returned EXACTLY ONCE, at creation.
 *  - Owner list/revoke identify a link by ShareLinkMeta.id — a short PREFIX of
 *    the token hash (useless as a credential, enough to dedupe/revoke).
 *
 * Ordering (D1↔DO is not atomic, plan Risk #7): on create we DO-check the car
 * exists in the caller's DO BEFORE inserting the D1 row. On read, if the snapshot
 * RPC reports the car gone we LAZY-REVOKE (set revoked_at) and serve 410.
 *
 * Timestamps are epoch SECONDS throughout (share_links is pinned to seconds).
 */
import { Hono } from 'hono'
import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  SHARE_CREATE_PATH,
  SHARE_IMG_ROUTE,
  SHARE_LIST_PATH,
  SHARE_PUBLIC_PATH,
  SHARE_REVOKE_PATH,
  SHARE_VIEW_PATH,
  contentTypeForExt,
  createShareRequestSchema,
  parsePhotoKey,
} from '@chudbox/shared'
import type {
  CreateShareResponse,
  FullCarSnapshot,
  PublicCarSnapshot,
  RecordShareViewResponse,
  ShareLinkListResponse,
  ShareLinkMeta,
  ShareScope,
  ShareSnapshotResponse,
} from '@chudbox/shared'
import { createAuth } from '../auth'
import { shareLinks } from '../db/schema'

export const shareApi = new Hono<{ Bindings: Env }>()

/** ShareLinkMeta.id length: a 24-hex-char (96-bit) prefix of the token hash —
 * collision-free in practice, unusable to reconstruct the token or its hash. */
const SHARE_LINK_ID_LEN = 24
/** The create body is a tiny `{ expiresAt? }` JSON object; bound it generously. */
const MAX_CREATE_BODY_BYTES = 4096
/** Edge-cache ceiling for an ACTIVE public response (~60s per-colo, plan). */
const SHARE_EDGE_MAX_AGE = 60
/** Private (browser) cache TTL — deliberately short. We CANNOT revoke a browser's
 * private cache, so almost all caching stays at the EDGE (s-maxage), where a
 * revoke/expiry naturally bounds it and a colo purge can clear it; a short
 * browser max-age means a revoke takes effect quickly even for a client that
 * already fetched the 200. */
const SHARE_BROWSER_MAX_AGE = 5

type ShareLinkRow = typeof shareLinks.$inferSelect

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

/**
 * Re-narrow the STORED scope to one of the two known values, defaulting to the
 * safe 'curated' for anything unexpected. The column is typed + written from a
 * validated enum, but we never trust a stored value blindly (an out-of-band
 * write or a future column change must degrade to the showcase, never silently
 * expose 'full'). This is the ONLY thing that decides what the public route
 * serves — it reads the row, never the request.
 */
function normalizeScope(stored: string): ShareScope {
  return stored === 'full' ? 'full' : 'curated'
}

/**
 * Classify the Content-Length for a MEMORY-BOUNDED body read (mirrors the M3
 * upload guard). A legitimate same-origin JSON POST always sets a finite numeric
 * Content-Length, so we require one and bound it BEFORE the body is touched: a
 * chunked / absent / non-numeric length is 'missing' (411), an over-cap length
 * is 'too-large' (413), otherwise 'ok'.
 */
function classifyContentLength(
  header: string | undefined,
  maxBytes: number,
): 'missing' | 'too-large' | 'ok' {
  if (header === undefined || !/^\d+$/.test(header)) return 'missing'
  return Number(header) > maxBytes ? 'too-large' : 'ok'
}

/**
 * Cache-Control for a PUBLIC share response. Prefer EDGE caching (s-maxage —
 * which a revoke/expiry naturally bounds and a colo purge can clear) over a long
 * private browser max-age (which we cannot revoke). Both are capped to
 * min(SHARE_EDGE_MAX_AGE, seconds-until-expiry) so a link that expires within the
 * next minute is never cached past its own expiry; an active no-expiry link stays
 * edge-cacheable ~60s. Callers reach here only for an ACTIVE link (expiry > now),
 * so the edge TTL is always >= 1.
 */
function shareCacheControl(expiresAt: number | null, now: number): string {
  const untilExpiry = expiresAt != null ? expiresAt - now : SHARE_EDGE_MAX_AGE
  const edge = Math.max(0, Math.min(SHARE_EDGE_MAX_AGE, untilExpiry))
  const browser = Math.min(edge, SHARE_BROWSER_MAX_AGE)
  return `public, max-age=${browser}, s-maxage=${edge}`
}

function db(env: Env) {
  return drizzle(env.DB)
}

async function getSessionUserId(
  env: Env,
  headers: Headers,
): Promise<string | null> {
  const session = await createAuth(env).api.getSession({ headers })
  return session?.user.id ?? null
}

function garageStub(env: Env, userId: string) {
  return env.GARAGE_DO.get(env.GARAGE_DO.idFromName(userId))
}

/** sha256(input) as a lowercase hex string (crypto.subtle, Workers runtime). */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** A fresh URL-safe-base64 bearer token, ≥128-bit entropy (24 random bytes). */
function generateToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function toMeta(row: ShareLinkRow): ShareLinkMeta {
  return {
    id: row.tokenHash.slice(0, SHARE_LINK_ID_LEN),
    carId: row.carId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    viewCount: row.viewCount,
    scope: normalizeScope(row.scope),
  }
}

/** A link is serveable iff not revoked and not past its (optional) expiry. */
function isLinkActive(row: ShareLinkRow, now: number): boolean {
  if (row.revokedAt != null) return false
  if (row.expiresAt != null && row.expiresAt <= now) return false
  return true
}

async function findByHash(env: Env, tokenHash: string): Promise<ShareLinkRow | undefined> {
  const rows = await db(env).select().from(shareLinks).where(eq(shareLinks.tokenHash, tokenHash))
  return rows[0]
}

// ── OWNER: create ───────────────────────────────────────────
shareApi.post(SHARE_CREATE_PATH, async (c) => {
  const userId = await getSessionUserId(c.env, c.req.raw.headers)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const carId = c.req.param('carId')

  // Optional `{ expiresAt }` body — but still memory-bounded BEFORE buffering
  // (same hardening as M3 uploads): require a finite numeric Content-Length
  // within the small JSON cap. A chunked / absent / non-numeric length (which
  // text() would otherwise buffer up to the platform cap) is rejected 411; an
  // over-cap length is 413. The real same-origin client always sends `{...}`.
  const lengthCheck = classifyContentLength(c.req.header('content-length'), MAX_CREATE_BODY_BYTES)
  if (lengthCheck === 'missing') {
    return c.json({ error: 'Content-Length required' }, 411)
  }
  if (lengthCheck === 'too-large') {
    return c.json({ error: 'Payload too large' }, 413)
  }
  const text = await c.req.raw.text()
  let raw: unknown = {}
  if (text.trim() !== '') {
    try {
      raw = JSON.parse(text)
    } catch {
      return c.json({ error: 'Body is not valid JSON' }, 400)
    }
  }
  const parsed = createShareRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, 400)
  }
  const expiresAt = parsed.data.expiresAt ?? null
  // The owner's chosen scope (validated closed enum; defaults to 'curated').
  // This is the ONE point where scope is decided — by the AUTHENTICATED owner,
  // then persisted; the public route never re-derives it from a request.
  const scope: ShareScope = parsed.data.scope

  // DO-CHECK FIRST (D1↔DO not atomic): confirm the car exists in the caller's
  // own DO before inserting any link row. getCarSnapshot returns null when the
  // car is absent/tombstoned. The existence probe only needs the cheap curated
  // snapshot regardless of the link's scope.
  const snapshot = await garageStub(c.env, userId).getCarSnapshot(carId, 'curated')
  if (!snapshot) return c.json({ error: 'Car not found' }, 404)

  const now = nowSeconds()
  // Re-validate expiry against the INSERT clock so it always satisfies the DB
  // CHECK (expires_at > created_at); the zod schema rejected past times against
  // its own clock, but "now" advances between validate and insert.
  if (expiresAt != null && expiresAt <= now) {
    return c.json({ error: 'expiresAt must be in the future' }, 400)
  }

  const token = generateToken()
  const tokenHash = await sha256Hex(token)
  await db(c.env)
    .insert(shareLinks)
    .values({ tokenHash, userId, carId, createdAt: now, expiresAt, revokedAt: null, scope })

  const response: CreateShareResponse = {
    // Clean path URL (BrowserRouter — M5): no more `/#/`. This is the canonical
    // shareable link; the Worker injects Open Graph meta when a crawler fetches
    // the /share/:token document (see lookupCuratedShareSnapshot + index.ts).
    url: `${new URL(c.req.url).origin}/share/${token}`,
    token,
    expiresAt,
  }
  return c.json(response)
})

/**
 * Server-side curated lookup for the Open Graph document handler (index.ts).
 *
 * Resolves a raw share token to its CURATED snapshot for an ACTIVE link, or
 * null for anything else (unknown / revoked / expired / car gone from the DO).
 * SECURITY: this is reached by a PUBLIC, unauthenticated crawler, so it ALWAYS
 * requests the 'curated' scope regardless of the link's stored scope — the
 * link-preview meta must never expose 'full' private data (money/shop/notes,
 * wishlist/todos/issues, salePrice/tradeFor). The owner/car are derived
 * SERVER-SIDE from the validated row, never from the request.
 *
 * Read-only: unlike the snapshot GET it does NOT lazy-revoke on a null snapshot
 * (that route owns the write); the preview simply falls back to the plain SPA
 * shell, and the next snapshot GET performs the revoke.
 */
export async function lookupCuratedShareSnapshot(
  env: Env,
  token: string,
): Promise<PublicCarSnapshot | null> {
  const row = await findByHash(env, await sha256Hex(token))
  if (!row || !isLinkActive(row, nowSeconds())) return null
  const snapshot = await garageStub(env, row.userId).getCarSnapshot(row.carId, 'curated')
  return (snapshot as PublicCarSnapshot | null) ?? null
}

// ── OWNER: list ─────────────────────────────────────────────
shareApi.get(SHARE_LIST_PATH, async (c) => {
  const userId = await getSessionUserId(c.env, c.req.raw.headers)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const carId = c.req.param('carId')
  const rows = await db(c.env)
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.userId, userId), eq(shareLinks.carId, carId)))
  const body: ShareLinkListResponse = { links: rows.map(toMeta) }
  return c.json(body)
})

// ── OWNER: revoke ───────────────────────────────────────────
shareApi.delete(SHARE_REVOKE_PATH, async (c) => {
  const userId = await getSessionUserId(c.env, c.req.raw.headers)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const carId = c.req.param('carId')
  const id = c.req.param('id')

  // Scope to the caller's own (user, car) links, then match the id prefix —
  // a revoke can never reach another user's or another car's links.
  const database = db(c.env)
  const rows = await database
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.userId, userId), eq(shareLinks.carId, carId)))
  const matches = rows.filter((row) => row.tokenHash.startsWith(id))
  if (matches.length === 0) return c.json({ error: 'Share link not found' }, 404)

  const now = nowSeconds()
  for (const match of matches) {
    if (match.revokedAt == null) {
      await database
        .update(shareLinks)
        .set({ revokedAt: now })
        .where(eq(shareLinks.tokenHash, match.tokenHash))
      match.revokedAt = now
    }
  }
  // Idempotent: re-revoking an already-revoked link returns its existing meta.
  return c.json(toMeta(matches[0]))
})

// ── PUBLIC: snapshot ────────────────────────────────────────
shareApi.get(SHARE_PUBLIC_PATH, async (c) => {
  const tokenHash = await sha256Hex(c.req.param('token'))
  const row = await findByHash(c.env, tokenHash)
  if (!row) return c.json({ error: 'Not found' }, 404)
  const now = nowSeconds()
  if (!isLinkActive(row, now)) {
    return c.json({ error: 'This share link is no longer available' }, 410)
  }

  // Owner + car + SCOPE all derived SERVER-SIDE from the stored row (never the
  // request): no query param, body, or header can change which view is served.
  // The DO builds the curated showcase or the full read-only view accordingly;
  // raw private cells only leave the DO when the row itself says 'full'.
  const scope = normalizeScope(row.scope)
  const snapshot = await garageStub(c.env, row.userId).getCarSnapshot(row.carId, scope)
  if (!snapshot) {
    // Lazy-revoke: the car is gone from the owner's DO. Tombstone the link so
    // future hits short-circuit, then 410.
    await db(c.env)
      .update(shareLinks)
      .set({ revokedAt: now })
      .where(eq(shareLinks.tokenHash, tokenHash))
    return c.json({ error: 'This share link is no longer available' }, 410)
  }

  // The snapshot carries photoIds (no URLs); the viewer composes the
  // token-scoped image URL via shareImgPath(token, photoId), served below. The
  // DO built `snapshot` at exactly `scope`, so the discriminant and the car
  // shape always agree (the viewer re-validates this strictly).
  const body: ShareSnapshotResponse =
    scope === 'full'
      ? { scope, car: snapshot as FullCarSnapshot, expiresAt: row.expiresAt }
      : { scope, car: snapshot as PublicCarSnapshot, expiresAt: row.expiresAt }
  c.header('Cache-Control', shareCacheControl(row.expiresAt, now))
  return c.json(body)
})

// ── PUBLIC: record one view ─────────────────────────────────
// Separate from the snapshot GET ON PURPOSE: that response is edge-cached
// (~60s s-maxage), so incrementing there would undercount. This endpoint is
// UNCACHED (Cache-Control: no-store) so every legitimate ping reaches the
// origin. It hashes the token exactly like the GET and bumps view_count ONLY
// for a valid link (exists, not revoked, not expired) via a single atomic SQL
// increment. It returns the same tiny body whether or not the link was valid,
// so it never leaks the link's validity, the owner, or any car internals. The
// counter is a SOFT metric: it is public + unauthenticated, so a determined
// client could inflate it — that is accepted (no tracking/fingerprinting).
shareApi.post(SHARE_VIEW_PATH, async (c) => {
  c.header('Cache-Control', 'no-store')
  const tokenHash = await sha256Hex(c.req.param('token'))
  const row = await findByHash(c.env, tokenHash)
  if (row && isLinkActive(row, nowSeconds())) {
    await db(c.env)
      .update(shareLinks)
      .set({ viewCount: sql`${shareLinks.viewCount} + 1` })
      .where(eq(shareLinks.tokenHash, tokenHash))
  }
  const body: RecordShareViewResponse = { ok: true }
  return c.json(body)
})

// ── PUBLIC: token-scoped image ──────────────────────────────
shareApi.get(SHARE_IMG_ROUTE, async (c) => {
  const tokenHash = await sha256Hex(c.req.param('token'))
  const row = await findByHash(c.env, tokenHash)
  if (!row) return c.json({ error: 'Not found' }, 404)
  const now = nowSeconds()
  if (!isLinkActive(row, now)) {
    return c.json({ error: 'This share link is no longer available' }, 410)
  }

  // Resolve the key SERVER-SIDE: only photos that live under the link's car
  // (and have been uploaded to R2) resolve; everything else is 404.
  const r2Key = await garageStub(c.env, row.userId).resolveSharePhotoKey(
    row.carId,
    c.req.param('photoId'),
  )
  if (!r2Key) return c.json({ error: 'Not found' }, 404)
  // Defensive: never serve a stored key whose embedded owner isn't the link
  // owner (the key is server-derived, but we never trust a value blindly).
  const parsed = parsePhotoKey(r2Key)
  if (!parsed || parsed.userId !== row.userId) {
    return c.json({ error: 'Not found' }, 404)
  }

  const object = await c.env.BUCKET.get(r2Key)
  if (!object) return c.json({ error: 'Not found' }, 404)

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', contentTypeForExt(parsed.ext))
  }
  headers.set('Cache-Control', shareCacheControl(row.expiresAt, now))
  headers.set('ETag', object.httpEtag)
  return new Response(object.body, { headers })
})
