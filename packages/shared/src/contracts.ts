// Shared API contract: route constants + request/response types both the
// Worker (apps/api) and the clients compile against. Implementations land in
// M1 (auth/health), M2 (sync) and M4 (share); mostly shapes live here, plus the
// public-snapshot RESPONSE validator (zod) the share viewer runs over an
// untrusted network body (the request-side validators live in zod.ts).
import { z } from 'zod'
import type { ImageContentType, PhotoExt } from './imagePolicy'
import type { FullCarSnapshot, PublicCarSnapshot, ShareScope } from './publicSnapshot'

// ── Routes ──────────────────────────────────────────────────
/** WebSocket sync endpoint — same-origin so the session cookie rides the upgrade. */
export const SYNC_PATH = '/sync'
/** Better Auth handler mount point ('/api/auth/*'). */
export const AUTH_ROUTE_PREFIX = '/api/auth'
export const HEALTH_ROUTE = '/api/health'
/** Public read-only share snapshots ('/api/share/:token'). */
export const SHARE_ROUTE_PREFIX = '/api/share'

/** POST here to create a share link for one of the caller's cars. */
export function createShareLinkPath(carId: string): string {
  return `/api/cars/${encodeURIComponent(carId)}/share`
}

/** GET here (no account needed) to fetch a shared car snapshot. */
export function shareSnapshotPath(token: string): string {
  return `${SHARE_ROUTE_PREFIX}/${encodeURIComponent(token)}`
}

// ── Image upload + serving (M3) ─────────────────────────────
// Bytes are uploaded same-origin and proxied through the R2 binding
// (env.BUCKET.put) — NO presigned PUT, NO S3 token, NO bucket CORS (the few-
// hundred-KB downscaled files sit far under the 100 MB request-body cap, and
// Worker CPU billing excludes I/O wait). Logged-OUT clients never call these:
// photos stay local base64 until sign-in (BACKEND_PLAN.md "Image pipeline").

/** Same-origin upload endpoint (session-authed; multipart/form-data). */
export const UPLOAD_PATH = '/api/uploads'
/** Prefix for the auth/token-gated image-serving route ('/img/<r2Key>'). */
export const IMG_PATH_PREFIX = '/img'
/** FormData field carrying the encoded image blob in an UPLOAD_PATH request. */
export const UPLOAD_FILE_FIELD = 'file'

/** Decomposed R2 photo key. `ext` reflects the ACTUALLY-encoded format. */
export interface PhotoKeyParts {
  userId: string
  carId: string
  photoId: string
  ext: PhotoExt
}

/**
 * R2 object key for a photo: `u/<userId>/<carId>/<photoId>.<ext>`. The `userId`
 * prefix is derived SERVER-SIDE from the validated session — never trusted from
 * the client. Ids are crypto.randomUUID()s (slash-free, URL-safe), so no escaping.
 */
export function buildPhotoKey({ userId, carId, photoId, ext }: PhotoKeyParts): string {
  return `u/${userId}/${carId}/${photoId}.${ext}`
}

const PHOTO_KEY_EXTS: readonly string[] = ['webp', 'jpg']

/**
 * Parse + validate an R2 photo key. Returns `null` for ANY malformed key (wrong
 * prefix, path traversal, empty/extra segments, unknown extension) so the
 * server can reject it before authorizing (it compares the parsed `userId`
 * against the session before serving/deleting the object).
 */
export function parsePhotoKey(key: string): PhotoKeyParts | null {
  if (typeof key !== 'string' || key.length === 0) return null
  const segments = key.split('/')
  if (segments.length !== 4) return null
  const [prefix, userId, carId, file] = segments
  if (prefix !== 'u') return null
  for (const seg of [userId, carId, file]) {
    if (!seg || seg === '.' || seg === '..') return null
  }
  const dot = file.lastIndexOf('.')
  // Need a non-empty name AND a non-empty extension.
  if (dot <= 0 || dot === file.length - 1) return null
  const photoId = file.slice(0, dot)
  const ext = file.slice(dot + 1)
  if (photoId === '.' || photoId === '..') return null
  if (!PHOTO_KEY_EXTS.includes(ext)) return null
  return { userId, carId, photoId, ext: ext as PhotoExt }
}

/**
 * Public path that serves a stored object: `/img/<r2Key>`. The key is already
 * URL-safe (UUID segments) and its slashes are real path separators, so it is
 * concatenated verbatim (NOT percent-encoded).
 */
export function imgPath(r2Key: string): string {
  return `${IMG_PATH_PREFIX}/${r2Key}`
}

/**
 * Non-file form fields the client sends to UPLOAD_PATH alongside the encoded
 * image blob (UPLOAD_FILE_FIELD). Validated server-side by `uploadFieldsSchema`
 * (zod.ts). `width`/`height` are the intended stored dimensions from
 * computeTargetSize; the server records the bytes' real dimensions in the row.
 */
export interface UploadFormFields {
  carId: string
  photoId: string
  width: number
  height: number
  caption?: string
}

/** UPLOAD_PATH success body — exactly the cells written to the synced photos row. */
export interface UploadResponse {
  /** `u/<userId>/<carId>/<photoId>.<ext>` (server-derived prefix). */
  r2Key: string
  width: number
  height: number
  /** The format actually encoded + stored (drives the key extension). */
  contentType: ImageContentType
}

// ── Common shapes ───────────────────────────────────────────
export interface HealthResponse {
  ok: true
}

export interface ApiErrorResponse {
  error: string
}

// ── Sync seed protocol (M2) ─────────────────────────────────
// Chunked, stamped DO seeding/clearing — ALL bulk migration writes go through
// these BEFORE the WS synchronizer attaches (plan: "Critical persistence
// detail" / Migration golden rule / Risk #1). Chunks carry mergeable content
// with the ORIGINAL HLC stamps (see seed.ts), never plain values.

/** POST one SeedChunkRequest per chunk (session-authed). */
export const SYNC_SEED_PATH = '/api/sync/seed'
/** POST to tombstone the whole cloud garage in bounded batches (session-authed). */
export const SYNC_CLEAR_PATH = '/api/sync/clear'
/** GET the DO's row counts / emptiness (session-authed). */
export const SYNC_META_PATH = '/api/sync/meta'

/**
 * Default cell budget per seed chunk / per clear batch. ~50 B of fragmented
 * SQL write per cell puts this comfortably below the ~200 KB single-save zone
 * of TinyBase #268; the M2 gate measures the real ceiling.
 */
export const DEFAULT_SEED_CHUNK_CELLS = 256
/**
 * Server-enforced hard ceiling on cells per applied chunk (the chunker only
 * exceeds `maxCellsPerChunk` for a single oversized row, and no garage-schema
 * row comes near this).
 */
export const MAX_SEED_CHUNK_CELLS = 2048
/** Server-enforced bound on the /api/sync/seed request body. */
export const MAX_SEED_BODY_BYTES = 1_048_576

export interface SeedChunkRequest {
  /** One `encodeSeedChunk(...)` payload (see seed.ts). */
  chunk: string
  /** 0-based position of this chunk in the batch (advisory; chunks commute). */
  index: number
  /** Total number of chunks in the batch. */
  total: number
}

export interface SeedChunkResponse {
  applied: true
  index: number
  total: number
  /** Cell + value stamps the applied chunk carried. */
  cells: number
}

export interface ClearGarageRequest {
  /**
   * Cell budget per tombstoning batch (each batch is its own transaction →
   * its own bounded fragmented save). Defaults to DEFAULT_SEED_CHUNK_CELLS;
   * clamped to [1, MAX_SEED_CHUNK_CELLS].
   */
  maxCellsPerChunk?: number
}

export interface ClearGarageResponse {
  cleared: true
  /** Live rows tombstoned across all tables. */
  deletedRows: number
  /** Values tombstoned. */
  deletedValues: number
  /** Bounded transactions (= persister saves) the clear was split into. */
  batches: number
}

export interface SyncMetaResponse {
  /** True iff the DO store has no live rows and no values (tombstones may exist). */
  isEmpty: boolean
  /** Live-row counts per table (every garage table, plus any extras present). */
  rowCounts: Record<string, number>
  hasValues: boolean
}

// ── Share API (M4) ──────────────────────────────────────────
// Timestamps are epoch SECONDS — pinned repo-wide (plan: share_links DDL).
//
// Two surfaces:
//  • OWNER (session-authed): create / list / revoke share links for a car.
//  • PUBLIC (NO session): GET the snapshot + GET token-scoped images. Every R2
//    key and the owner/car identity are derived SERVER-SIDE from the validated
//    token row — never from client input (plan Risk #7).
//
// The raw token is a BEARER CREDENTIAL: only sha256(token) is stored; it is
// returned exactly ONCE at creation. Owner list/revoke therefore identify a
// link by ShareLinkMeta.id — a short PREFIX of the token hash (NOT the raw
// token, NOT the full hash).

// Route PATTERNS (Hono-style, for the Worker to register).
/** POST — create a share link for one of the caller's cars. */
export const SHARE_CREATE_PATH = '/api/cars/:carId/share'
/** GET — list the caller's share links for a car (same URL as create, GET). */
export const SHARE_LIST_PATH = '/api/cars/:carId/share'
/** DELETE — revoke one share link by its ShareLinkMeta.id (token-hash prefix). */
export const SHARE_REVOKE_PATH = '/api/cars/:carId/share/:id'
/** GET (public, no session) — the read-only car snapshot. */
export const SHARE_PUBLIC_PATH = `${SHARE_ROUTE_PREFIX}/:token`
/** GET (public, no session) — a token-scoped image, resolved to R2 server-side. */
export const SHARE_IMG_ROUTE = `${SHARE_ROUTE_PREFIX}/:token/img/:photoId`
/**
 * POST (public, no session) — record ONE view of a valid share link. Kept
 * SEPARATE from the snapshot GET (which is edge-cached ~60s, so incrementing
 * there would undercount) and served UNCACHED (Cache-Control: no-store). Bumps
 * view_count only for a link that exists, isn't revoked and isn't expired; it
 * returns the same tiny body either way (never leaking owner/car internals or
 * even the link's validity).
 */
export const SHARE_VIEW_PATH = `${SHARE_ROUTE_PREFIX}/:token/view`

/** DELETE here to revoke one share link (`id` = ShareLinkMeta.id). */
export function shareRevokePath(carId: string, id: string): string {
  return `${createShareLinkPath(carId)}/${encodeURIComponent(id)}`
}

/**
 * Token-scoped public image URL: `/api/share/<token>/img/<photoId>`. The viewer
 * builds this from a snapshot photoId + the token already in its own route; the
 * server validates the token, derives the owner/car/r2Key SERVER-SIDE, and
 * streams the R2 object — so the raw r2Key and the owner-only /img path never
 * leave the server. Both segments are percent-encoded (UUIDs need none, but
 * tokens may carry URL-safe-base64 chars and we stay defensive).
 */
export function shareImgPath(token: string, photoId: string): string {
  return `${SHARE_ROUTE_PREFIX}/${encodeURIComponent(token)}/img/${encodeURIComponent(photoId)}`
}

/**
 * Public view-recording URL: `/api/share/<token>/view`. The viewer POSTs this
 * once per browser session (sessionStorage-guarded) right after the snapshot
 * loads; the server validates the token and bumps view_count for a valid link
 * only. Token is percent-encoded (URL-safe base64 needs none, but stay defensive).
 */
export function shareViewPath(token: string): string {
  return `${SHARE_ROUTE_PREFIX}/${encodeURIComponent(token)}/view`
}

/**
 * Body of POST SHARE_VIEW_PATH. Deliberately content-free: it must not reveal
 * whether the link was valid (and thus whether the count moved) or anything
 * about the owner/car — the viewer fires it fire-and-forget and ignores the body.
 */
export interface RecordShareViewResponse {
  ok: true
}

export interface CreateShareRequest {
  /**
   * Epoch SECONDS. Absent/null = NO expiry (the default). When present it must
   * be a positive integer strictly in the future (see createShareRequestSchema).
   */
  expiresAt?: number | null
  /**
   * Which view the link grants. Chosen by the AUTHENTICATED owner and STORED on
   * the row; the public route reads it from storage, never from the viewer.
   * Absent = 'curated' (the safe default). See ShareScope.
   */
  scope?: ShareScope
}

export interface CreateShareResponse {
  /**
   * Full share URL containing the raw bearer token — shown ONCE at creation;
   * only sha256(token) is stored server-side.
   */
  url: string
  /** The raw token (also embedded in url). Shown once; never persisted raw. */
  token: string
  /** Epoch seconds; null = no expiry. */
  expiresAt: number | null
}

/**
 * Minimum length (hex chars) of a ShareLinkMeta.id — the prefix of sha256(token)
 * that list/revoke match on. At 24 hex chars the id carries 96 bits of the hash:
 * far past the birthday-collision danger zone for a single owner's per-car link
 * set (billions of links before a ~50% prefix collision), yet still short enough
 * to be useless as a credential (it is a slice of the PUBLIC hash, never the raw
 * token). The Worker derives the id with `tokenHash.slice(0, SHARE_LINK_ID_MIN_LEN)`
 * (apps/api routes/share.ts) — keep that slice length >= this floor so prefixes
 * stay collision-safe.
 */
export const SHARE_LINK_ID_MIN_LEN = 24

/**
 * Owner-facing metadata for one share link. Deliberately carries NO raw token
 * and NO full token hash — `id` is a short prefix of the hash (>= SHARE_LINK_ID_MIN_LEN
 * chars), enough to revoke/dedupe in the share dialog, useless as a credential.
 */
export interface ShareLinkMeta {
  /** Stable public id = a >=SHARE_LINK_ID_MIN_LEN-char prefix of sha256(token). Used for list/revoke. */
  id: string
  carId: string
  /** Epoch seconds. */
  createdAt: number
  /** Epoch seconds; null = no expiry. */
  expiresAt: number | null
  /** Epoch seconds; null = still active. */
  revokedAt: number | null
  /**
   * Total recorded views of this link (POST SHARE_VIEW_PATH bumps it per
   * browser session). A SOFT/approximate count — it counts sessions, not
   * guaranteed-unique humans, and is publicly POSTable — so the UI labels it
   * "views", not "visitors".
   */
  viewCount: number
  /** Which view this link grants ('curated' showcase or 'full' read-only). */
  scope: ShareScope
}

export interface ShareLinkListResponse {
  links: ShareLinkMeta[]
}

/**
 * Public GET response — a DISCRIMINATED UNION on the server-authoritative
 * `scope`. The viewer turns each photo's photoId into an image via
 * shareImgPath(token, photoId); `expiresAt` lets it show a countdown.
 *
 *  • scope: 'curated' → `car` is the allowlisted PublicCarSnapshot (the showcase
 *    — never a full Car).
 *  • scope: 'full'    → `car` is the FullCarSnapshot (the owner-equivalent
 *    read-only view, still r2Key/userId/email-free).
 *
 * `scope` comes from the STORED share_links row, NEVER from the request, so a
 * viewer holding a 'curated' link can never receive 'full' data. The strict
 * response schema below rejects a body whose `car` shape disagrees with `scope`.
 */
export type ShareSnapshotResponse =
  | {
      scope: 'curated'
      car: PublicCarSnapshot
      /** Epoch seconds; null = no expiry. */
      expiresAt: number | null
    }
  | {
      scope: 'full'
      car: FullCarSnapshot
      /** Epoch seconds; null = no expiry. */
      expiresAt: number | null
    }

// ── Public snapshot RESPONSE validator (M4 polish) ──────────
// The public viewer fetches this body over the network with NO session and
// renders it directly, so it validates the JSON before trusting it (a stale
// cache, a proxy, or a future server change must not crash the viewer). This is
// the ONE response-side zod schema; request/form validators stay in zod.ts.
//
// It mirrors publicSnapshot.ts EXACTLY and is strict (deny-by-default): an extra
// key — i.e. a field the curator started leaking — fails validation instead of
// reaching the page. `z.infer` is assignable to the contract types above
// (cross-checked in contracts.test.ts).

/** Allowlisted statuses a public snapshot may carry, kept in lockstep with the
 * curated shape (publicSnapshot.ts copies car.status verbatim) so the share
 * viewer never rejects a snapshot the curator legitimately emits. The Record is
 * keyed by the FULL status union, so adding a CarStatus member fails the build
 * HERE until it is allowlisted; the tuple below (which feeds z.enum) is in turn
 * checked to contain only allowlisted keys. */
const PUBLIC_STATUS_ALLOWLIST = {
  current: true,
  'for-sale': true,
  'for-trade': true,
  totaled: true,
  sold: true,
} as const satisfies Record<PublicCarSnapshot['status'], true>

// Derived from the allowlist (single source of truth); the cast restores the
// literal tuple z.enum needs from Object.keys' widened string[].
const PUBLIC_CAR_STATUSES = Object.keys(PUBLIC_STATUS_ALLOWLIST) as [
  keyof typeof PUBLIC_STATUS_ALLOWLIST,
  ...(keyof typeof PUBLIC_STATUS_ALLOWLIST)[],
]

const publicPhotoSchema = z.strictObject({
  photoId: z.string(),
  caption: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
})

const publicModSchema = z.strictObject({
  name: z.string(),
  category: z.string(),
  description: z.string(),
  installedDate: z.string(),
  link: z.string(),
  addedAt: z.string(),
})

const publicMaintenanceSchema = z.strictObject({
  service: z.string(),
  date: z.string(),
  mileageRaw: z.string().optional(),
  mileageMiles: z.number().optional(),
  nextDueDate: z.string().optional(),
  nextDueMileageRaw: z.string().optional(),
  nextDueMileageMiles: z.number().optional(),
  createdAt: z.string(),
})

const publicSettingsSchema = z.strictObject({
  themeId: z.string(),
  customAccent: z.string().optional(),
  distanceUnit: z.enum(['mi', 'km']),
})

/** Validates a PublicCarSnapshot — strict, so any non-allowlisted key is rejected. */
export const publicCarSnapshotSchema = z.strictObject({
  year: z.string(),
  make: z.string(),
  model: z.string(),
  trim: z.string(),
  color: z.string(),
  nickname: z.string(),
  mileageRaw: z.string(),
  mileageMiles: z.number().optional(),
  status: z.enum(PUBLIC_CAR_STATUSES),
  purchaseDate: z.string().optional(),
  saleDate: z.string().optional(),
  createdAt: z.string(),
  coverPhotoId: z.string().optional(),
  photos: z.array(publicPhotoSchema),
  mods: z.array(publicModSchema),
  maintenance: z.array(publicMaintenanceSchema),
  settings: publicSettingsSchema,
})

// ── Full-scope snapshot validators ──────────────────────────
// The 'full' link's body is validated just as strictly (deny-by-default): each
// schema is a strictObject, so a field the FULL curator started leaking that is
// not named here fails validation rather than reaching the viewer. These extend
// the curated shapes with exactly the owner-only fields buildFullSnapshot emits.

const fullModSchema = z.strictObject({
  name: z.string(),
  category: z.string(),
  description: z.string(),
  installedDate: z.string(),
  link: z.string(),
  addedAt: z.string(),
  cost: z.number().optional(),
  shop: z.string().optional(),
})

const fullMaintenanceSchema = z.strictObject({
  service: z.string(),
  date: z.string(),
  mileageRaw: z.string().optional(),
  mileageMiles: z.number().optional(),
  nextDueDate: z.string().optional(),
  nextDueMileageRaw: z.string().optional(),
  nextDueMileageMiles: z.number().optional(),
  createdAt: z.string(),
  cost: z.number().optional(),
  shop: z.string().optional(),
  notes: z.string().optional(),
})

const fullWishlistSchema = z.strictObject({
  name: z.string(),
  link: z.string(),
  price: z.number().optional(),
  category: z.string(),
  notes: z.string(),
  status: z.enum(['wanted', 'ordered', 'installed']),
  addedAt: z.string(),
})

const fullTodoSchema = z.strictObject({
  text: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
  done: z.boolean(),
  createdAt: z.string(),
})

const fullIssueSchema = z.strictObject({
  title: z.string(),
  description: z.string(),
  severity: z.enum(['minor', 'moderate', 'critical']),
  status: z.enum(['open', 'in-progress', 'resolved']),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
})

const fullSettingsSchema = z.strictObject({
  themeId: z.string(),
  customAccent: z.string().optional(),
  distanceUnit: z.enum(['mi', 'km']),
  currency: z.string(),
})

/** Validates a FullCarSnapshot — strict, so any non-allowlisted key is rejected. */
export const fullCarSnapshotSchema = z.strictObject({
  year: z.string(),
  make: z.string(),
  model: z.string(),
  trim: z.string(),
  color: z.string(),
  nickname: z.string(),
  mileageRaw: z.string(),
  mileageMiles: z.number().optional(),
  status: z.enum(PUBLIC_CAR_STATUSES),
  purchaseDate: z.string().optional(),
  saleDate: z.string().optional(),
  createdAt: z.string(),
  coverPhotoId: z.string().optional(),
  salePrice: z.string().optional(),
  tradeFor: z.string().optional(),
  photos: z.array(publicPhotoSchema),
  mods: z.array(fullModSchema),
  maintenance: z.array(fullMaintenanceSchema),
  wishlist: z.array(fullWishlistSchema),
  todos: z.array(fullTodoSchema),
  issues: z.array(fullIssueSchema),
  settings: fullSettingsSchema,
})

/**
 * Validates the public GET /api/share/:token body (ShareSnapshotResponse).
 * DISCRIMINATED on `scope`: a 'curated' body is held to the curated allowlist,
 * a 'full' body to the full allowlist — so the viewer can never be tricked into
 * rendering a 'full' car under a 'curated' link (or vice versa), and an extra
 * key under either shape is rejected before it reaches the page.
 */
export const shareSnapshotResponseSchema = z.discriminatedUnion('scope', [
  z.strictObject({
    scope: z.literal('curated'),
    car: publicCarSnapshotSchema,
    /** Epoch seconds; null = no expiry. */
    expiresAt: z.number().nullable(),
  }),
  z.strictObject({
    scope: z.literal('full'),
    car: fullCarSnapshotSchema,
    /** Epoch seconds; null = no expiry. */
    expiresAt: z.number().nullable(),
  }),
])
