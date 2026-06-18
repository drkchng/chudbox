/**
 * First-run migration of the legacy Zustand/localforage blob into the
 * TinyBase stores, plus the units backfill — both sentinel-gated and
 * idempotent (BACKEND_PLAN.md "Migration").
 *
 * - The sentinels (IDB_MIGRATED_VALUE, UNITS_SCHEMA_VERSION_VALUE) live in
 *   the LOCAL-ONLY side store, never in synced Values: if they synced, a
 *   cloud-wins Values merge could clear them and re-fire the import
 *   (duplicate garage) or the backfill (re-tagging landmine).
 * - Writes are chunked car-by-car (one transaction per car → one bounded
 *   persister save each).
 * - The legacy blob is left untouched in localforage as the rollback path.
 * - Amounts/mileage are tagged with the BLOB'S OWN currency/distanceUnit
 *   settings — they were entered under those settings, not the defaults.
 *
 * Everything here is a pure function over injected stores so it can be unit
 * tested without IndexedDB.
 */
import { flattenCar, isValidDateString, parseMileageMiles } from '@chudbox/shared'
import type {
  Car,
  DistanceUnitCode,
  FlattenSettings,
  FlattenedCar,
  MileageRow,
} from '@chudbox/shared'
import type { MergeableStore, Row, Store } from 'tinybase'
import {
  IDB_MIGRATED_VALUE,
  MILEAGE_BACKFILL_VERSION_VALUE,
  PHOTO_PAYLOADS_TABLE,
  UNITS_SCHEMA_VERSION_VALUE,
} from './adapter'

/** localforage key the legacy Zustand persist middleware wrote. */
export const LEGACY_BLOB_KEY = 'garage-store'

/** Current units schema version (guards the backfill; see runUnitsBackfill). */
export const UNITS_SCHEMA_VERSION = 1

/** Current DEC-16 mileage-backfill version (guards runMileageBackfill). */
export const MILEAGE_BACKFILL_VERSION = 1

export interface LegacyState {
  cars: Car[]
  themeId: string
  customAccent: string | null
  currency: string
  distanceUnit: DistanceUnitCode
}

/**
 * Parse the raw localforage value (`{ state: {...}, version: 0 }` — version 0
 * is the implicit zustand default, distinct from backup files' version 1/2).
 * Returns null when absent or unparseable.
 */
export function parseLegacyBlob(raw: unknown): LegacyState | null {
  if (typeof raw !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const state = (parsed as { state?: unknown }).state
  if (typeof state !== 'object' || state === null) return null
  const s = state as Partial<LegacyState> & { cars?: unknown }
  if (!Array.isArray(s.cars)) return null
  return {
    cars: s.cars as Car[],
    themeId: typeof s.themeId === 'string' ? s.themeId : 'garage',
    customAccent: typeof s.customAccent === 'string' ? s.customAccent : null,
    currency: typeof s.currency === 'string' ? s.currency : 'USD',
    distanceUnit: s.distanceUnit === 'km' ? 'km' : 'mi',
  }
}

const CHILD_ROW_SETS = [
  'photos',
  'wishlist',
  'mods',
  'maintenance',
  'todos',
  'issues',
  'mileage',
] as const

/**
 * Flatten nested cars into the stores, chunked car-by-car: each car is ONE
 * store transaction (→ one bounded persister save) plus one side-store
 * transaction for its photo payloads. Strict null rule comes from the shared
 * flattenCar; photo dataUrls land ONLY in the local-only side store.
 */
export function writeNestedCars(
  store: MergeableStore,
  localStore: Store,
  cars: Car[],
  settings: FlattenSettings,
): void {
  for (const car of cars) {
    const flat: FlattenedCar = flattenCar(car, settings)
    store.transaction(() => {
      store.setRow('cars', flat.carId, flat.car as Row)
      for (const tableId of CHILD_ROW_SETS) {
        for (const [rowId, row] of Object.entries(flat[tableId])) {
          store.setRow(tableId, rowId, row as Row)
        }
      }
    })
    const payloads = Object.entries(flat.photoPayloads)
    if (payloads.length > 0) {
      localStore.transaction(() => {
        for (const [photoId, dataUrl] of payloads) {
          localStore.setRow(PHOTO_PAYLOADS_TABLE, photoId, { dataUrl })
        }
      })
    }
  }
}

export type FirstRunImportResult = 'already-imported' | 'no-legacy-data' | 'imported'

export interface FirstRunImportOptions {
  store: MergeableStore
  localStore: Store
  /** Reads the raw legacy blob (browser: localforage.getItem(LEGACY_BLOB_KEY)). */
  readLegacyBlob: () => Promise<unknown>
}

/**
 * Import the legacy blob exactly once per device. Sets the sentinel even when
 * no blob exists, so a blob written later (e.g. by an old tab) can never
 * import into an established store. The blob itself is KEPT for rollback.
 */
export async function runFirstRunImport(
  options: FirstRunImportOptions,
): Promise<FirstRunImportResult> {
  const { store, localStore, readLegacyBlob } = options
  if (localStore.getValue(IDB_MIGRATED_VALUE) === true) return 'already-imported'
  const legacy = parseLegacyBlob(await readLegacyBlob())
  if (legacy === null) {
    localStore.setValue(IDB_MIGRATED_VALUE, true)
    localStore.setValue(UNITS_SCHEMA_VERSION_VALUE, UNITS_SCHEMA_VERSION)
    return 'no-legacy-data'
  }
  // Tag with the blob's OWN settings — see module docblock.
  writeNestedCars(store, localStore, legacy.cars, {
    currency: legacy.currency,
    distanceUnit: legacy.distanceUnit,
  })
  store.transaction(() => {
    store.setValue('themeId', legacy.themeId)
    if (legacy.customAccent !== null) store.setValue('customAccent', legacy.customAccent)
    store.setValue('currency', legacy.currency)
    store.setValue('distanceUnit', legacy.distanceUnit)
  })
  localStore.setValue(IDB_MIGRATED_VALUE, true)
  localStore.setValue(UNITS_SCHEMA_VERSION_VALUE, UNITS_SCHEMA_VERSION)
  return 'imported'
}

export type UnitsBackfillResult = 'noop' | 'applied'

/**
 * Units backfill, gated on UNITS_SCHEMA_VERSION_VALUE. Version 1 is purely
 * ADDITIVE re-tagging: any amount cell missing its currency tag gets the
 * device's current currency, and any parseable mileageRaw missing its
 * canonical mileageMiles gets one. Amounts and raw strings are NEVER
 * converted or rewritten (double-apply of a conversion is the ×100 landmine
 * the sentinel exists to prevent — this backfill has no multiplicative step
 * at all, and the sentinel still guards re-tagging after a currency change).
 */
export function runUnitsBackfill(options: {
  store: MergeableStore
  localStore: Store
}): UnitsBackfillResult {
  const { store, localStore } = options
  const version = localStore.getValue(UNITS_SCHEMA_VERSION_VALUE)
  if (typeof version === 'number' && version >= UNITS_SCHEMA_VERSION) return 'noop'

  const currency = (store.getValue('currency') as string | undefined) ?? 'USD'
  const distanceUnit = ((store.getValue('distanceUnit') as string | undefined) ??
    'mi') as DistanceUnitCode
  store.transaction(() => {
    const tagAmount = (
      tableId: string,
      rowId: string,
      amountCell: string,
      currencyCell: string,
    ): void => {
      if (
        store.hasCell(tableId, rowId, amountCell) &&
        !store.hasCell(tableId, rowId, currencyCell)
      ) {
        store.setCell(tableId, rowId, currencyCell, currency)
      }
    }
    const tagMiles = (
      tableId: string,
      rowId: string,
      rawCell: string,
      milesCell: string,
    ): void => {
      const raw = store.getCell(tableId, rowId, rawCell) as string | undefined
      if (raw === undefined || store.hasCell(tableId, rowId, milesCell)) return
      const miles = parseMileageMiles(raw, distanceUnit)
      if (miles != null) store.setCell(tableId, rowId, milesCell, miles)
    }
    for (const rowId of store.getRowIds('cars')) {
      if ((store.getCell('cars', rowId, 'salePrice') as string | undefined) !== '') {
        tagAmount('cars', rowId, 'salePrice', 'salePriceCurrency')
      }
      tagMiles('cars', rowId, 'mileageRaw', 'mileageMiles')
    }
    for (const rowId of store.getRowIds('wishlist')) {
      tagAmount('wishlist', rowId, 'price', 'priceCurrency')
    }
    for (const rowId of store.getRowIds('mods')) {
      tagAmount('mods', rowId, 'cost', 'costCurrency')
    }
    for (const rowId of store.getRowIds('maintenance')) {
      tagAmount('maintenance', rowId, 'cost', 'costCurrency')
      tagMiles('maintenance', rowId, 'mileageRaw', 'mileageMiles')
      tagMiles('maintenance', rowId, 'nextDueMileageRaw', 'nextDueMileageMiles')
    }
  })
  localStore.setValue(UNITS_SCHEMA_VERSION_VALUE, UNITS_SCHEMA_VERSION)
  return 'applied'
}

export type MileageBackfillResult = 'noop' | 'applied'

/**
 * The set of `mileage` rowIds carrying ANY mergeable stamp — LIVE or TOMBSTONED.
 * The delete-safety gate (§13.5 step 2) inspects THIS, not just live rows: after
 * a user deletes the seeded `${carId}::initial` check-in (tombstone at HLC T1)
 * and the local sentinel is later cleared (restore / needsReseed-style path), a
 * naive re-run would re-write that rowId at T2 > T1, out-stamping the tombstone
 * and RESURRECTING the deleted reading. A tombstoned row keeps its rowId in the
 * mergeable content (its cells become undefined-valued stamps), so it is visible
 * here even though getRowIds() no longer lists it.
 */
function mileageStampRowIds(store: MergeableStore): Set<string> {
  const [[tableStamps]] = store.getMergeableContent()
  const mileageTable = tableStamps['mileage']
  // mileageTable = [rowStamps, tableHlc, tableHash]; [0] is the rowId→stamp map,
  // which retains a tombstoned row's id (its cells become undefined-valued stamps).
  return new Set(mileageTable ? Object.keys(mileageTable[0]) : [])
}

/**
 * DEC-16 BACKFILL (§15.8 Phase 2 / §13.5) — the ONLY backfill in the merge.
 * Sentinel-gated (mileageBackfillVersion, local-only), idempotent, chunked
 * one-car-per-transaction (one bounded fragmented save each). Runs in the
 * pre-attach window (the golden rule) so it never triggers the un-chunkable
 * full-store reconcile (#268). For each car with a non-blank mileageRaw it seeds
 * a deterministic `${carId}::initial` check-in (so two devices that each backfill
 * offline collapse per-cell LWW instead of duplicating — belt; the sentinel is
 * suspenders), preserving the entry-time canonical miles VERBATIM.
 */
export function runMileageBackfill(options: {
  store: MergeableStore
  localStore: Store
}): MileageBackfillResult {
  const { store, localStore } = options
  const version = localStore.getValue(MILEAGE_BACKFILL_VERSION_VALUE)
  if (typeof version === 'number' && version >= MILEAGE_BACKFILL_VERSION) return 'noop'

  const distanceUnit = ((store.getValue('distanceUnit') as string | undefined) ??
    'mi') as DistanceUnitCode
  const stampedRowIds = mileageStampRowIds(store)
  // Cars that already hold a live check-in (a real timeline exists) → never seed.
  const carsWithCheckIns = new Set<string>()
  for (const rowId of store.getRowIds('mileage')) {
    const carId = store.getCell('mileage', rowId, 'carId') as string | undefined
    if (carId != null) carsWithCheckIns.add(carId)
  }
  const createdAt = new Date().toISOString()

  for (const carId of store.getRowIds('cars')) {
    const raw = (store.getCell('cars', carId, 'mileageRaw') as string | undefined) ?? ''
    if (raw.trim() === '') continue // blank → empty timeline (no check-in)

    const seedId = `${carId}::initial`
    // Delete-safety: the deterministic seed already has a stamp (live OR a delete
    // tombstone), OR the car already has a live check-in → never (re-)seed.
    if (stampedRowIds.has(seedId) || carsWithCheckIns.has(carId)) continue

    // valueMiles: preserve the entry-time canonical VERBATIM when present (the
    // entry unit may differ from the current distanceUnit; recomputing would be
    // wrong) — else derive from the raw under the current unit.
    const existingMiles = store.getCell('cars', carId, 'mileageMiles') as number | undefined
    const purchaseDate = store.getCell('cars', carId, 'purchaseDate') as string | undefined
    const carCreatedAt =
      (store.getCell('cars', carId, 'createdAt') as string | undefined) ?? createdAt
    const row: MileageRow = {
      carId,
      valueRaw: raw,
      unit: distanceUnit,
      // The legacy scalar carries no date → purchaseDate if valid, else createdAt
      // (flagged approximate via source='initial').
      date: isValidDateString(purchaseDate) ? purchaseDate : carCreatedAt,
      source: 'initial',
      createdAt,
    }
    const miles = existingMiles != null ? existingMiles : parseMileageMiles(raw, distanceUnit)
    if (miles != null) row.valueMiles = miles // non-parsing text → no canonical

    store.transaction(() => {
      store.setRow('mileage', seedId, row as Row)
    })
  }

  localStore.setValue(MILEAGE_BACKFILL_VERSION_VALUE, MILEAGE_BACKFILL_VERSION)
  return 'applied'
}
