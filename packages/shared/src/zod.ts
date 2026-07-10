// Shared request/form validators for the surfaces that exist today (kept
// deliberately modest — grows with the API in M1+). The web forms collect
// CarDetails (add/edit car); settings writes land in the synced Values.
import { z } from 'zod'
import { MAX_SEED_CHUNK_CELLS } from './contracts'
import type { CarStoredStatus } from './types'

/** All storable car statuses (mirrors CarStoredStatus in types.ts). */
export const CAR_STORED_STATUSES = [
  'current',
  'for-sale',
  'for-trade',
  'totaled',
  'sold',
] as const satisfies readonly CarStoredStatus[]

export const carStoredStatusSchema = z.enum(CAR_STORED_STATUSES)

/**
 * The add/edit car form payload — the editable free-text fields of a car.
 * Everything is store-as-entered free text ('' allowed; dates are NOT coerced
 * to Date — see plan risk #10), so validation is structural: right keys,
 * right types, no extras.
 */
export const carDetailsSchema = z.strictObject({
  year: z.string(),
  make: z.string(),
  model: z.string(),
  trim: z.string(),
  color: z.string(),
  mileage: z.string(),
  nickname: z.string(),
  purchaseDate: z.string(),
  saleDate: z.string(),
  status: carStoredStatusSchema,
  salePrice: z.string(),
  tradeFor: z.string(),
})

/** Car create payload: full details (id/createdAt are generated server of record side). */
export const carCreateSchema = carDetailsSchema
/** Car update payload: any subset of the details. */
export const carUpdateSchema = carDetailsSchema.partial()

export type CarCreateInput = z.infer<typeof carCreateSchema>
export type CarUpdateInput = z.infer<typeof carUpdateSchema>

/** Synced settings (the Values surface). currency is an ISO-4217 alpha code. */
export const garageValuesSchema = z.strictObject({
  themeId: z.string(),
  customAccent: z.string().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'expected an ISO-4217 alpha code'),
  distanceUnit: z.enum(['mi', 'km']),
  modsSortBy: z.enum(['category', 'date']).optional(),
  modsSortDir: z.enum(['asc', 'desc']).optional(),
  maintenanceSortBy: z.enum(['category', 'date']).optional(),
  maintenanceSortDir: z.enum(['asc', 'desc']).optional(),
  issuesSortBy: z.enum(['date', 'severity']).optional(),
  issuesSortDir: z.enum(['asc', 'desc']).optional(),
})

export type GarageValuesInput = z.infer<typeof garageValuesSchema>

// ── Sync seed protocol bodies (M2) ──────────────────────────
// Envelope validation only: the chunk string itself is decoded + structurally
// validated by decodeSeedChunk/isSeedChunk (seed.ts) inside the DO.

/** Body of POST /api/sync/seed (SeedChunkRequest). */
export const seedChunkRequestSchema = z
  .strictObject({
    chunk: z.string().min(1),
    index: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  })
  .refine((body) => body.index < body.total, {
    message: 'index must be < total',
  })

/** Body of POST /api/sync/clear (ClearGarageRequest); {} allowed. */
export const clearGarageRequestSchema = z.strictObject({
  maxCellsPerChunk: z.number().int().min(1).max(MAX_SEED_CHUNK_CELLS).optional(),
})

// ── Image upload form-fields (M3) ───────────────────────────
// The non-file fields of a multipart UPLOAD_PATH request (the image Blob rides
// in UPLOAD_FILE_FIELD and is validated separately). width/height arrive as
// FormData strings, so they are coerced to positive integers. z.infer is
// assignable to the UploadFormFields contract (cross-checked in zod.test.ts).

/** Generous upper bound — decoupled from the FREE policy's maxEdgePx so a future
 * paid tier raising the cap needs no schema change. */
const MAX_IMAGE_EDGE_PX = 100_000

/**
 * carId/photoId must each be a SINGLE URL-safe path segment so the built R2 key
 * always round-trips through parsePhotoKey (buildPhotoKey/parsePhotoKey stay
 * provably inverse). The client mints these with crypto.randomUUID() via
 * newId(); this charset — ASCII letters, digits, '-' and '_' — covers that and
 * rejects everything that would corrupt the key or strand the object:
 * '/' (extra segments), '.'/'..'/leading dots (path traversal, parse failure),
 * and NUL/control bytes. Bounded length keeps a key well under R2 limits.
 */
const photoKeySegmentSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'must be a URL-safe id segment (A-Z a-z 0-9 - _)')

/** Body (form fields) of POST /api/uploads (UploadFormFields). */
export const uploadFieldsSchema = z.strictObject({
  carId: photoKeySegmentSchema,
  photoId: photoKeySegmentSchema,
  /** Intended stored dimensions from computeTargetSize; arrive as form strings. */
  width: z.coerce.number().int().min(1).max(MAX_IMAGE_EDGE_PX),
  height: z.coerce.number().int().min(1).max(MAX_IMAGE_EDGE_PX),
  caption: z.string().max(2000).optional(),
})

export type UploadFieldsInput = z.infer<typeof uploadFieldsSchema>

// ── Share link create body (M4) ─────────────────────────────
// expiresAt is OPTIONAL — absent/null means NO expiry (the default; revoke is
// always available). When present it must be a positive integer epoch-SECONDS
// strictly in the FUTURE: this rejects zero, negatives, non-integers and any
// already-elapsed timestamp at validation time. The server independently
// re-checks (DB CHECK expires_at > created_at) since "now" advances between
// validation and insert. z.infer is assignable to CreateShareRequest
// (cross-checked in zod.test.ts).
// `scope` is the owner's per-link visibility choice ('curated' | 'listing' |
// 'full'), validated as a closed enum. Absent → 'curated' (the safe default), so
// an old client that never sends it keeps getting the showcase. The server stores
// the parsed value on the row; the public route reads it from storage, never from
// the viewer — so this is the ONLY place a client can influence scope, and only
// the authenticated owner reaches it. 'listing' (DEC-14) is the For-Sale preset.
export const createShareRequestSchema = z.strictObject({
  expiresAt: z
    .number()
    .int()
    .positive()
    .refine((seconds) => seconds > Math.floor(Date.now() / 1000), {
      message: 'expiresAt must be a future epoch-seconds timestamp',
    })
    .nullish(),
  scope: z.enum(['curated', 'listing', 'full']).default('curated'),
})

export type CreateShareRequestInput = z.infer<typeof createShareRequestSchema>

// ── Account display settings (DEC-10) ───────────────────────
// Update the owner's display NAME (= user.name) and/or the `show_owner_name`
// consent on the D1 user row. Both fields are OPTIONAL (a partial update — omit
// one to leave it unchanged); `.refine` rejects an empty `{}` so a no-op write
// never reaches D1. `name` is trimmed + bounded and must be NON-EMPTY (the
// account name is NOT NULL in D1, and an empty name reads as "no name" on shares
// — clearing the name is what the consent toggle is for, not a blank string).
export const updateAccountDisplaySchema = z
  .strictObject({
    name: z.string().trim().min(1, 'Enter a display name').max(120).optional(),
    showOwnerName: z.boolean().optional(),
  })
  .refine((body) => body.name !== undefined || body.showOwnerName !== undefined, {
    message: 'Provide a name and/or showOwnerName to update',
  })

export type UpdateAccountDisplayInput = z.infer<typeof updateAccountDisplaySchema>

// ── DEC-13 VIN — LIGHT validation (a nudge, NOT a block) ────
// A modern VIN is 17 characters of the ISO-3779 charset (which excludes I, O and
// Q to avoid confusion with 1 and 0). We store the VIN verbatim as untrusted
// free text (snapshots render it as text — no injection surface), so this is
// purely an inline "this doesn't look like a VIN" HINT for the car form: it
// never rejects a save. RN-safe (pure string logic, no DOM).
export const VIN_LENGTH = 17
const VIN_CHARSET = /^[A-HJ-NPR-Z0-9]+$/

/**
 * A soft, human-readable warning for a VIN that doesn't look right, or null when
 * it's blank (no VIN) or plausibly a VIN. Trims + upper-cases before checking,
 * mirroring how a real VIN is normalized — the caller still stores the raw input.
 */
export function vinHint(raw: string): string | null {
  const value = raw.trim().toUpperCase()
  if (value === '') return null
  if (value.length !== VIN_LENGTH) {
    return `A VIN is usually ${VIN_LENGTH} characters — this is ${value.length}.`
  }
  if (!VIN_CHARSET.test(value)) {
    return 'A VIN uses letters and numbers only (no I, O, or Q).'
  }
  return null
}
