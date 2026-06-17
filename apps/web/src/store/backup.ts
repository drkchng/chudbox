/**
 * JSON backup export/import (BACKEND_PLAN.md "Migration", plan F2).
 *
 * Export is v2: { version: 2, exportedAt, cars (nested, reassembled from the
 * tables), themeId, customAccent, currency, distanceUnit }.
 *
 * Import accepts BOTH:
 * - v2 — amounts/mileage are re-tagged with the BACKUP's own settings (they
 *   were exported under them), and currency/distanceUnit Values are restored
 *   from the backup;
 * - legacy v1 — { version: 1, exportedAt, cars, themeId, customAccent }, NO
 *   currency/distanceUnit. Amounts/mileage are tagged with the importing
 *   device's CURRENT settings (same unrecoverability caveat as live data),
 *   and the device's currency/distanceUnit Values are left untouched —
 *   exactly what the legacy import did.
 *
 * Import is REPLACE: the mergeable store is reset WHOLESALE (stamp map
 * included, via setMergeableContent of empty content — NOT delRow tombstones,
 * which would carry fresh HLCs that out-stamp and delete cloud data on a
 * later attach). The caller is responsible for re-negotiating sync after a
 * replace (see sync.ts notifyLocalReplaced / NEEDS_RESEED_VALUE).
 */
import type { Car, CurrencyCode, DistanceUnitCode, FlattenSettings } from '@chudbox/shared'
import type { MergeableContent, MergeableStore, Store } from 'tinybase'
import { PHOTO_PAYLOADS_TABLE } from './adapter'
import { writeNestedCars } from './migrate'

export const BACKUP_VERSION = 2

export interface BackupV2 {
  version: 2
  exportedAt: string
  cars: Car[]
  themeId: string
  customAccent: string | null
  currency: CurrencyCode
  distanceUnit: DistanceUnitCode
}

/** Normalized result of parsing either backup format. */
export interface ParsedBackup {
  version: 1 | 2
  exportedAt: string | null
  cars: Car[]
  themeId: string | null
  customAccent: string | null
  /** Only present on v2. */
  currency: string | null
  /** Only present on v2. */
  distanceUnit: DistanceUnitCode | null
}

/** Empty MergeableContent in the fully-hashed shape setMergeableContent validates. */
export function emptyMergeableContent(): MergeableContent {
  return [
    [{}, '', 0],
    [{}, '', 0],
  ] as unknown as MergeableContent
}

/** Defensive defaults for user-supplied backup files (the legacy import cast blindly). */
function normalizeCar(raw: Car): Car {
  return {
    ...raw,
    coverPhoto: raw.coverPhoto ?? null,
    photos: raw.photos ?? [],
    wishlist: raw.wishlist ?? [],
    mods: raw.mods ?? [],
    maintenance: raw.maintenance ?? [],
    todos: raw.todos ?? [],
    issues: raw.issues ?? [],
  }
}

/**
 * Parse an untrusted backup JSON value. Mirrors the legacy leniency (anything
 * with a `cars` array is accepted as v1) but recognizes `version: 2`.
 */
export function parseBackup(data: unknown): ParsedBackup | null {
  if (typeof data !== 'object' || data === null) return null
  const obj = data as Record<string, unknown>
  if (!Array.isArray(obj.cars)) return null
  const isV2 = obj.version === 2
  return {
    version: isV2 ? 2 : 1,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : null,
    cars: (obj.cars as Car[]).map(normalizeCar),
    themeId: typeof obj.themeId === 'string' ? obj.themeId : null,
    customAccent: typeof obj.customAccent === 'string' ? obj.customAccent : null,
    currency: isV2 && typeof obj.currency === 'string' ? obj.currency : null,
    distanceUnit: isV2 && (obj.distanceUnit === 'mi' || obj.distanceUnit === 'km')
      ? obj.distanceUnit
      : null,
  }
}

export interface BackupSourceState {
  cars: Car[]
  themeId: string
  customAccent: string | null
  currency: CurrencyCode
  distanceUnit: DistanceUnitCode
}

export function buildBackupV2(state: BackupSourceState): BackupV2 {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    cars: state.cars,
    themeId: state.themeId,
    customAccent: state.customAccent,
    currency: state.currency,
    distanceUnit: state.distanceUnit,
  }
}

export interface ApplyBackupOptions {
  store: MergeableStore
  localStore: Store
  backup: ParsedBackup
}

/** Replace the local garage with the backup's content. See module docblock. */
export function applyBackupImport(options: ApplyBackupOptions): void {
  const { store, localStore, backup } = options
  // Device settings captured BEFORE the reset wipes Values (v1 tagging rule).
  const deviceCurrency = (store.getValue('currency') as string | undefined) ?? 'USD'
  const deviceDistanceUnit = ((store.getValue('distanceUnit') as string | undefined) ??
    'mi') as DistanceUnitCode

  const tagWith: FlattenSettings =
    backup.version === 2
      ? {
          currency: backup.currency ?? deviceCurrency,
          distanceUnit: backup.distanceUnit ?? deviceDistanceUnit,
        }
      : { currency: deviceCurrency, distanceUnit: deviceDistanceUnit }

  // Wholesale reset: data AND stamp history (no tombstones minted).
  store.setMergeableContent(emptyMergeableContent())
  localStore.delTable(PHOTO_PAYLOADS_TABLE)

  writeNestedCars(store, localStore, backup.cars, tagWith)

  store.transaction(() => {
    store.setValue('themeId', backup.themeId ?? 'garage')
    if (backup.customAccent !== null) store.setValue('customAccent', backup.customAccent)
    store.setValue('currency', tagWith.currency)
    store.setValue('distanceUnit', tagWith.distanceUnit)
  })
}
