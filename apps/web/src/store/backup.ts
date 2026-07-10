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
import type { IssuesSortBy, ItemSortBy, SortDir } from './adapter'
import { writeNestedCars } from './migrate'

const isItemSortBy = (v: unknown): v is ItemSortBy => v === 'category' || v === 'date'
const isIssuesSortBy = (v: unknown): v is IssuesSortBy => v === 'date' || v === 'severity'
const isSortDir = (v: unknown): v is SortDir => v === 'asc' || v === 'desc'

export const BACKUP_VERSION = 2

/**
 * Raw `savedBuilds` table rows (DEC-11 Watching list), keyed by rowId
 * (= sha256(token)). Serialized VERBATIM into the backup: the table is
 * top-level (no carId), so it does NOT ride inside the nested cars and must be
 * carried explicitly or a REPLACE import erases the whole Watching list.
 */
export type SavedBuildsBackupTable = Record<string, Record<string, string | number | boolean>>

export interface BackupV2 {
  version: 2
  exportedAt: string
  cars: Car[]
  themeId: string
  customAccent: string | null
  currency: CurrencyCode
  distanceUnit: DistanceUnitCode
  /** Absent on backups exported before the Watching list existed. */
  savedBuilds?: SavedBuildsBackupTable
  /** Absent on backups exported before per-tab sort/group prefs existed. */
  modsSortBy?: ItemSortBy
  modsSortDir?: SortDir
  maintenanceSortBy?: ItemSortBy
  maintenanceSortDir?: SortDir
  issuesSortBy?: IssuesSortBy
  issuesSortDir?: SortDir
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
  /** Only present on v2 backups that carried a Watching list. */
  savedBuilds: SavedBuildsBackupTable | null
  /** Only present on v2 backups that carried sort/group prefs. */
  modsSortBy: ItemSortBy | null
  modsSortDir: SortDir | null
  maintenanceSortBy: ItemSortBy | null
  maintenanceSortDir: SortDir | null
  issuesSortBy: IssuesSortBy | null
  issuesSortDir: SortDir | null
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
 * Sanitize an untrusted `savedBuilds` backup section down to rows of primitive
 * cells. Rows without a non-empty string `token` are dropped (the token IS the
 * follow — a row without one can never refetch and would render as junk); other
 * cells pass through and the store's TablesSchema drops any it doesn't know.
 */
function normalizeSavedBuilds(raw: unknown): SavedBuildsBackupTable | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const table: SavedBuildsBackupTable = {}
  for (const [rowId, rawRow] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof rawRow !== 'object' || rawRow === null || Array.isArray(rawRow)) continue
    const row: Record<string, string | number | boolean> = {}
    for (const [cellId, value] of Object.entries(rawRow as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        row[cellId] = value
      }
    }
    if (typeof row.token === 'string' && row.token !== '') table[rowId] = row
  }
  return Object.keys(table).length > 0 ? table : null
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
    savedBuilds: isV2 ? normalizeSavedBuilds(obj.savedBuilds) : null,
    modsSortBy: isV2 && isItemSortBy(obj.modsSortBy) ? obj.modsSortBy : null,
    modsSortDir: isV2 && isSortDir(obj.modsSortDir) ? obj.modsSortDir : null,
    maintenanceSortBy: isV2 && isItemSortBy(obj.maintenanceSortBy) ? obj.maintenanceSortBy : null,
    maintenanceSortDir: isV2 && isSortDir(obj.maintenanceSortDir) ? obj.maintenanceSortDir : null,
    issuesSortBy: isV2 && isIssuesSortBy(obj.issuesSortBy) ? obj.issuesSortBy : null,
    issuesSortDir: isV2 && isSortDir(obj.issuesSortDir) ? obj.issuesSortDir : null,
  }
}

export interface BackupSourceState {
  cars: Car[]
  themeId: string
  customAccent: string | null
  currency: CurrencyCode
  distanceUnit: DistanceUnitCode
  /** Raw savedBuilds table rows (store.getTable('savedBuilds')). */
  savedBuilds?: SavedBuildsBackupTable
  /** Optional — callers that don't track these (e.g. tests) get the same
   *  schema defaults a fresh store would materialize. */
  modsSortBy?: ItemSortBy
  modsSortDir?: SortDir
  maintenanceSortBy?: ItemSortBy
  maintenanceSortDir?: SortDir
  issuesSortBy?: IssuesSortBy
  issuesSortDir?: SortDir
}

export function buildBackupV2(state: BackupSourceState): BackupV2 {
  const backup: BackupV2 = {
    version: 2,
    exportedAt: new Date().toISOString(),
    cars: state.cars,
    themeId: state.themeId,
    customAccent: state.customAccent,
    currency: state.currency,
    distanceUnit: state.distanceUnit,
    modsSortBy: state.modsSortBy ?? 'category',
    modsSortDir: state.modsSortDir ?? 'desc',
    maintenanceSortBy: state.maintenanceSortBy ?? 'date',
    maintenanceSortDir: state.maintenanceSortDir ?? 'desc',
    issuesSortBy: state.issuesSortBy ?? 'date',
    issuesSortDir: state.issuesSortDir ?? 'desc',
  }
  // Only carry a non-empty Watching list (keeps old-shaped files byte-stable).
  if (state.savedBuilds && Object.keys(state.savedBuilds).length > 0) {
    backup.savedBuilds = state.savedBuilds
  }
  return backup
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

  // Restore the Watching list (DEC-11): savedBuilds is TOP-LEVEL (no carId), so
  // writeNestedCars never touches it — without this re-write the wholesale
  // reset would silently erase every followed build (and, signed-in, the
  // keep-local reseed would propagate that erasure to the cloud). The cached
  // snapshot side-store is intentionally NOT restored — it refetches by token.
  if (backup.savedBuilds != null) {
    const savedBuilds = backup.savedBuilds
    store.transaction(() => {
      for (const [rowId, row] of Object.entries(savedBuilds)) {
        store.setRow('savedBuilds', rowId, row)
      }
    })
  }

  store.transaction(() => {
    store.setValue('themeId', backup.themeId ?? 'garage')
    if (backup.customAccent !== null) store.setValue('customAccent', backup.customAccent)
    store.setValue('currency', tagWith.currency)
    store.setValue('distanceUnit', tagWith.distanceUnit)
    // Sort/group prefs: absent on v1 and on v2 backups exported before these
    // existed — the TinyBase Values schema's own defaults apply in that case
    // (the reset above already cleared any prior value), so nothing to set.
    if (backup.modsSortBy !== null) store.setValue('modsSortBy', backup.modsSortBy)
    if (backup.modsSortDir !== null) store.setValue('modsSortDir', backup.modsSortDir)
    if (backup.maintenanceSortBy !== null) store.setValue('maintenanceSortBy', backup.maintenanceSortBy)
    if (backup.maintenanceSortDir !== null) store.setValue('maintenanceSortDir', backup.maintenanceSortDir)
    if (backup.issuesSortBy !== null) store.setValue('issuesSortBy', backup.issuesSortBy)
    if (backup.issuesSortDir !== null) store.setValue('issuesSortDir', backup.issuesSortDir)
  })
}
