// Shared API contract: route constants + request/response types both the
// Worker (apps/api) and the clients compile against. Implementations land in
// M1 (auth/health), M2 (sync) and M4 (share); only the shapes live here.
import type { Car } from './types'

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

export interface CreateShareLinkRequest {
  /** Epoch seconds; null/absent = no expiry. */
  expiresAt?: number | null
}

export interface CreateShareLinkResponse {
  /**
   * Full share URL containing the raw bearer token — shown ONCE at creation;
   * only sha256(token) is stored server-side.
   */
  url: string
  /** The raw token (also embedded in url). */
  token: string
  carId: string
  /** Epoch seconds. */
  createdAt: number
  /** Epoch seconds; null = no expiry. */
  expiresAt: number | null
}

/** Photo in a share snapshot: dataUrl/r2Key are rewritten to token-scoped /img URLs. */
export interface SharedPhoto {
  id: string
  /** Token-gated image URL (served via /img). */
  url: string
  caption: string
  uploadedAt: string
  width: number | null
  height: number | null
}

/** A read-only nested car snapshot with photo URLs instead of payloads. */
export type SharedCarSnapshot = Omit<Car, 'photos'> & { photos: SharedPhoto[] }

export interface ShareSnapshotResponse {
  car: SharedCarSnapshot
}
