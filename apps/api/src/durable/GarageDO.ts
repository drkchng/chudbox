/**
 * GarageDO — one Durable Object per user, holding that user's entire garage
 * as a TinyBase MergeableStore persisted to DO SQLite storage.
 *
 * CRITICAL (plan risk #1): the persister MUST run in FRAGMENTED mode.
 * The default JSON mode serializes the whole store (rows + per-cell HLC
 * metadata) into ONE SQLite row and silently breaks sync at Cloudflare's 2 MB
 * row limit. Fragmented mode stores one row per cell. Signature and
 * `{mode: 'fragmented'}` literal verified against the installed tinybase@8.4.2
 * (@types/persisters/persister-durable-object-sql-storage/index.d.ts).
 *
 * Store reference + write bounding (verified against the installed
 * tinybase@8.4.2 sources):
 * - The base WsServerDurableObject constructor runs `await createPersister()`
 *   inside `ctx.blockConcurrencyWhile`, then `persister.load()` +
 *   `persister.startAutoSave()` and attaches its server-side synchronizer —
 *   so by the time ANY fetch/RPC is delivered, `this.store` (assigned inside
 *   our createPersister override) is set, hydrated from SQL, and auto-saving.
 *   `store` is a `declare`d property (NO class-field initializer): the base
 *   constructor may invoke createPersister() synchronously during super(),
 *   and a field initializer running afterwards would clobber the assignment.
 * - `startAutoSave()` registers a did-finish-transaction listener that saves
 *   ONLY that transaction's changes, and the fragmented `setPersisted` writes
 *   one SQL row per changed cell. `applyMergeableChanges` wraps each chunk in
 *   exactly one transaction (applyChanges → fluentTransaction), so EACH
 *   seedGarage/clearGarage batch is its own bounded storage write — the #268
 *   mitigation.
 * - The store is deliberately SCHEMA-LESS: the DO is a dumb replica. A schema
 *   here would let validation drop incoming cells while their merged stamps
 *   survive (raw store and stamp map would diverge), and Values defaults
 *   would fabricate server-stamped settings.
 *
 * These RPC methods are reachable ONLY through the Worker's session-authed
 * routes (/api/sync/* and /sync): the GARAGE_DO namespace is not exposed
 * anywhere else, and the DO name is always idFromName(verified userId).
 *
 * The wrangler migration for this class MUST use `new_sqlite_classes`
 * (SQLite-backed DOs run on the Workers Free plan; `this.ctx.storage.sql`
 * only exists on SQLite-backed classes).
 */
import { createMergeableStore } from 'tinybase'
import type { MergeableStore } from 'tinybase'
import { createDurableObjectSqlStoragePersister } from 'tinybase/persisters/persister-durable-object-sql-storage'
import { WsServerDurableObject } from 'tinybase/synchronizers/synchronizer-ws-server-durable-object'
import {
  DEFAULT_SEED_CHUNK_CELLS,
  GARAGE_TABLE_IDS,
  MAX_SEED_CHUNK_CELLS,
  buildFullSnapshot,
  buildPublicSnapshot,
  countSeedChunkCells,
  decodeSeedChunk,
  joinCar,
} from '@chudbox/shared'
import type {
  CarsRow,
  ChildTableId,
  ClearGarageRequest,
  ClearGarageResponse,
  FlattenedCar,
  FullCarSnapshot,
  GarageValues,
  IssuesRow,
  MaintenanceRow,
  ModsRow,
  PhotosRow,
  PublicCarSnapshot,
  ShareScope,
  SnapshotPhotoInput,
  SyncMetaResponse,
  TodosRow,
  WishlistRow,
} from '@chudbox/shared'

/**
 * Seed outcome. Bad input is reported as a value (not a thrown error): RPC
 * exceptions cross the boundary as opaque rejections and get logged as
 * uncaught DO exceptions, while a discriminated result lets the route map
 * `applied: false` to a clean 400.
 */
export type GarageSeedResult =
  | { applied: true; /** Cell + value stamps the chunk carried. */ cells: number }
  | { applied: false; error: string }

export class GarageDO extends WsServerDurableObject<Env> {
  /** Assigned in createPersister — see module docblock for why `declare`. */
  declare store: MergeableStore | undefined

  override createPersister() {
    const store = createMergeableStore()
    this.store = store
    // FRAGMENTED mode — see module docblock. Do not remove or default this.
    return createDurableObjectSqlStoragePersister(store, this.ctx.storage.sql, {
      mode: 'fragmented',
    })
  }

  private getStore(): MergeableStore {
    if (!this.store) {
      // Unreachable: createPersister runs in the constructor's
      // blockConcurrencyWhile before any fetch/RPC is delivered.
      throw new Error('GarageDO store is not initialized')
    }
    return this.store
  }

  /**
   * M2: apply one bounded chunk of a client's stamped mergeable content
   * BEFORE the synchronizer attaches, so that attach exchanges only genuine
   * deltas (never the un-chunkable full-store setPersisted of TinyBase #268).
   * One chunk = one transaction = one bounded fragmented save. Idempotent:
   * re-applying a chunk is a per-cell LWW no-op (original HLCs preserved).
   *
   * Known nuance (observed against real storage in the test suite): a seeded
   * TOMBSTONE for a cell this store never held live doesn't change the raw
   * store, so the per-transaction auto-save has nothing to persist for it —
   * it exists in the in-memory stamp map only. After a DO restart the next
   * attach re-exchanges exactly those cells from the client (which always
   * retains them); bounded and convergent, so accepted rather than worked
   * around with a full-store save (which would be #268 again).
   */
  seedGarage(encodedChunk: string): GarageSeedResult {
    let chunk
    try {
      chunk = decodeSeedChunk(encodedChunk)
    } catch (error) {
      return {
        applied: false,
        error: error instanceof Error ? error.message : 'invalid seed chunk',
      }
    }
    const cells = countSeedChunkCells(chunk)
    if (cells > MAX_SEED_CHUNK_CELLS) {
      return {
        applied: false,
        error: `seed chunk carries ${cells} cells (max ${MAX_SEED_CHUNK_CELLS})`,
      }
    }
    this.getStore().applyMergeableChanges(chunk)
    return { applied: true, cells }
  }

  /**
   * M2: tombstone the whole garage through the store's delete operations
   * (delRow/delValues — NEVER raw SQL deletes, which would leave stale rows
   * and stamps alive on other devices). The deletions mint fresh HLCs that
   * out-stamp everything previously merged (the store clock has `seenHlc`'d
   * every applied stamp), so the tombstones win under LWW everywhere. Work is
   * split into bounded per-transaction batches: each batch is its own
   * fragmented persister save (#268 again).
   */
  clearGarage(request: ClearGarageRequest): ClearGarageResponse {
    const store = this.getStore()
    const budget = Math.min(
      Math.max(request.maxCellsPerChunk ?? DEFAULT_SEED_CHUNK_CELLS, 1),
      MAX_SEED_CHUNK_CELLS,
    )
    let deletedRows = 0
    let batches = 0
    for (const tableId of store.getTableIds()) {
      let batchRowIds: string[] = []
      let batchCells = 0
      const flush = (): void => {
        if (batchRowIds.length > 0) {
          const rowIds = batchRowIds
          store.transaction(() => {
            for (const rowId of rowIds) {
              store.delRow(tableId, rowId)
            }
          })
          deletedRows += rowIds.length
          batches += 1
          batchRowIds = []
          batchCells = 0
        }
      }
      for (const rowId of store.getRowIds(tableId)) {
        const rowCells = Math.max(store.getCellIds(tableId, rowId).length, 1)
        if (batchCells > 0 && batchCells + rowCells > budget) {
          flush()
        }
        batchRowIds.push(rowId)
        batchCells += rowCells
      }
      flush()
    }
    let deletedValues = 0
    if (store.hasValues()) {
      deletedValues = store.getValueIds().length
      store.transaction(() => {
        store.delValues()
      })
      batches += 1
    }
    return { cleared: true, deletedRows, deletedValues, batches }
  }

  /**
   * M2: live-row counts per table + emptiness (tombstones don't count).
   *
   * Null-awareness (upstream quirk, verified in the installed fragmented
   * persister source): `setPersisted` stores a tombstoned cell/value as
   * `JSON.stringify([undefined])` === `'[null]'`, so after a DO restart
   * `getPersisted` resurrects tombstones as live `null` cells/values (the
   * stamp hash stays consistent — `getValueHash(undefined ?? null)` — so sync
   * is unaffected). The garage schema has no allowNull cells, therefore a
   * null cell here can only be that artifact: rows whose cells are all null
   * and null values are not counted as live.
   */
  getMeta(): SyncMetaResponse {
    const store = this.getStore()
    const liveRowCount = (tableId: string): number => {
      let count = 0
      for (const rowId of store.getRowIds(tableId)) {
        const row = store.getRow(tableId, rowId)
        if (Object.values(row).some((cell) => cell !== null)) {
          count += 1
        }
      }
      return count
    }
    const rowCounts: Record<string, number> = {}
    for (const tableId of GARAGE_TABLE_IDS) {
      rowCounts[tableId] = liveRowCount(tableId)
    }
    for (const tableId of store.getTableIds()) {
      rowCounts[tableId] ??= liveRowCount(tableId)
    }
    const hasValues = store
      .getValueIds()
      .some((valueId) => store.getValue(valueId) !== null)
    const isEmpty =
      !hasValues && Object.values(rowCounts).every((count) => count === 0)
    return { isEmpty, rowCounts, hasValues }
  }

  /**
   * M4: read-only public snapshot of one car for the share-link route, built
   * DO-side AT THE LINK'S STORED SCOPE. The curation (the EXPLICIT allowlist)
   * happens HERE, inside the DO, so raw private cells only ever leave when the
   * link itself is 'full' — and even then only that car's own owner-visible
   * fields. A 'curated' snapshot is byte-identical to before: money, shop,
   * notes, tradeFor, salePrice, r2Key and the whole wishlist/issues/todos tables
   * never cross the RPC boundary. `scope` is supplied by the route FROM THE
   * STORED ROW, never from any client input; it defaults to 'curated' so any
   * caller that omits it gets the safe showcase.
   *
   * Either way the snapshot withholds the raw r2Key / dataUrl (photos carry only
   * photoId+caption+dims; the viewer derives a token-scoped image URL), the
   * userId/email, and every internal row id beyond the photoId — for THIS car
   * only (one DO = one user; one carId = one car).
   *
   * Returns null when the car does not exist (row absent, or fully tombstoned:
   * a DO restart resurrects tombstoned cells as live `null`s — see getMeta —
   * so "no non-null cell" is the not-found test). The share route lazy-revokes
   * and serves 410 on null.
   *
   * No writes. The DO store is schema-less, so child rows are gathered by
   * filtering each child table on its `carId` cell rather than via a TinyBase
   * Index (a one-shot read builds no index cheaper than it scans); joinCar
   * reassembles the nested Car, then the per-photo downscaled dimensions
   * (which joinCar drops) are re-attached from the rows for the snapshot.
   */
  getCarSnapshot(
    carId: string,
    scope: ShareScope = 'curated',
  ): PublicCarSnapshot | FullCarSnapshot | null {
    const store = this.getStore()
    const carRow = store.getRow('cars', carId)
    if (!Object.values(carRow).some((cell) => cell !== null)) {
      return null
    }
    const flat: FlattenedCar = {
      carId,
      car: carRow as unknown as CarsRow,
      photos: this.collectChildRows<PhotosRow>('photos', carId),
      wishlist: this.collectChildRows<WishlistRow>('wishlist', carId),
      mods: this.collectChildRows<ModsRow>('mods', carId),
      maintenance: this.collectChildRows<MaintenanceRow>('maintenance', carId),
      todos: this.collectChildRows<TodosRow>('todos', carId),
      issues: this.collectChildRows<IssuesRow>('issues', carId),
      photoPayloads: {},
    }
    const car = joinCar(flat)
    const photos: SnapshotPhotoInput[] = car.photos.map((photo) => ({
      ...photo,
      width: flat.photos[photo.id]?.width,
      height: flat.photos[photo.id]?.height,
    }))
    const input = { ...car, photos }
    const settings = this.readSettings()
    return scope === 'full'
      ? buildFullSnapshot(input, settings)
      : buildPublicSnapshot(input, settings)
  }

  /**
   * M4: resolve the R2 key for a token-scoped public image — ONLY if the photo
   * row exists under THIS carId AND already carries an r2Key (uploaded to R2;
   * a not-yet-uploaded photo has none). Returns null otherwise, so the share
   * image route serves 404 without ever exposing the raw key to the client.
   */
  resolveSharePhotoKey(carId: string, photoId: string): string | null {
    const store = this.getStore()
    if (store.getCell('photos', photoId, 'carId') !== carId) return null
    const r2Key = store.getCell('photos', photoId, 'r2Key')
    return typeof r2Key === 'string' && r2Key !== '' ? r2Key : null
  }

  /** Child rows whose `carId` cell equals `carId` (tombstoned rows resurrect
   * with a null carId, so they never match). */
  private collectChildRows<T>(
    tableId: ChildTableId,
    carId: string,
  ): Record<string, T> {
    const store = this.getStore()
    const rows: Record<string, T> = {}
    for (const rowId of store.getRowIds(tableId)) {
      if (store.getCell(tableId, rowId, 'carId') === carId) {
        rows[rowId] = store.getRow(tableId, rowId) as unknown as T
      }
    }
    return rows
  }

  /** Read the synced display settings, applying the schema defaults for any
   * the DO has never received (the DO store is deliberately schema-less, so it
   * fabricates no defaults of its own). currency is read but never reaches the
   * snapshot (no money is ever shown). */
  private readSettings(): GarageValues {
    const store = this.getStore()
    const readString = (valueId: string): string | undefined => {
      const value = store.getValue(valueId)
      return typeof value === 'string' && value !== '' ? value : undefined
    }
    const settings: GarageValues = {
      themeId: readString('themeId') ?? 'garage',
      currency: readString('currency') ?? 'USD',
      distanceUnit: store.getValue('distanceUnit') === 'km' ? 'km' : 'mi',
    }
    const customAccent = readString('customAccent')
    if (customAccent !== undefined) settings.customAccent = customAccent
    return settings
  }
}
