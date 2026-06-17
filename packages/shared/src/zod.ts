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
