/**
 * TinyBase-backed implementation of the legacy Zustand store surface.
 *
 * The adapter exposes the EXACT GarageState hook/action/selector shape the
 * components were written against, but every read comes from the shared
 * MergeableStore (normalized tables, see @chudbox/shared schema.ts) and every
 * action is a setRow/setPartialCell/delRow against it.
 *
 * Read model: a per-car cache of joined nested Car objects, invalidated by
 * table/row listeners. `state.cars` is an array of cached references that is
 * only rebuilt when car data actually changed, and only the DIRTY cars are
 * re-joined (O(rows-for-that-car) via the shared carId indexes) — the garage
 * list never re-runs a full nested join per card, and untouched Car objects
 * keep their identity so `s.cars.find(...)` selectors don't re-render.
 *
 * Strict null rule: all create paths reuse the shared flattenCar (single
 * source of truth — 0 / false / '' are written explicitly; cells are omitted
 * iff null/undefined). Update paths write per-field, and only re-tag a
 * currency cell when the AMOUNT field itself is in the patch — re-flattening
 * a whole row on update would silently re-tag old amounts with the current
 * currency (the exact corruption flatten.ts warns about).
 *
 * setCurrency / setDistanceUnit are Values writes ONLY. The legacy in-place
 * rewrite of stored amounts (the lossy bug M2 fixes) is gone; amounts keep
 * the currency they were entered in (per-row *Currency tags) and mileage
 * keeps its raw entry string.
 *
 * Photo payloads (base64 dataUrls) NEVER touch the mergeable store: they live
 * in the local-only side store (PHOTO_PAYLOADS_TABLE), keyed by photoId. The
 * read path resolves a photo row without an r2Key from that table ('' when
 * missing — e.g. another device's photo before M3).
 */
import {
  CHILD_TABLE_IDS,
  CURRENCIES,
  carIdIndexId,
  createGarageIndexes,
  flattenCar,
  isValidDateString,
  joinCar,
  newId,
  parseMileageMiles,
} from '@chudbox/shared'
import type {
  Car,
  CarDetails,
  CarsRow,
  ChildTableId,
  CurrencyCode,
  DistanceUnitCode,
  FlattenSettings,
  FlattenedCar,
  Issue,
  IssuesRow,
  MaintenanceRecord,
  MaintenanceRow,
  MileageCheckIn,
  Mod,
  ModsRow,
  Photo,
  PhotoSource,
  PhotosRow,
  Todo,
  TodoPriority,
  TodosRow,
  WishlistItem,
  WishlistRow,
} from '@chudbox/shared'
import type { Id, Indexes, MergeableStore, Row, Store } from 'tinybase'
import type { StoredPhoto } from '../utils/image'
import type { StoredCar, StoredMaintenance } from '../types'

// ── Local-only side store layout (never synced) ─────────────
/** photoId → { dataUrl } rows. */
export const PHOTO_PAYLOADS_TABLE = 'photoPayloads'
/** Per-device migration sentinel: the legacy Zustand blob was imported. */
export const IDB_MIGRATED_VALUE = 'idbMigrated'
/** Per-device units-backfill sentinel (guards re-tagging). */
export const UNITS_SCHEMA_VERSION_VALUE = 'unitsSchemaVersion'
/** userId this device has completed sync negotiation with. */
export const PAIRED_USER_VALUE = 'pairedUserId'
/** Local data was wholesale-replaced (backup import) → cloud must be re-seeded. */
export const NEEDS_RESEED_VALUE = 'needsReseed'
/**
 * Per-device sentinel: the base64 photo backlog has been fully uploaded to R2.
 * Local-only (never synced) like the other sentinels — cleared when a new
 * offline/failed photo creates a backlog so the next online sweep retries.
 */
export const PHOTOS_MIGRATED_VALUE = 'photosMigratedToR2'
/**
 * Per-device DEC-16 mileage-backfill sentinel (§15.8 Phase 2). Local-only —
 * never synced — for the same reason as unitsSchemaVersion: a cloud-wins Values
 * merge could clear a synced sentinel and re-fire the backfill. (Belt: the
 * deterministic `${carId}::initial` rowId + the live-OR-tombstoned stamp gate in
 * migrate.ts make a re-fire idempotent and resurrection-safe anyway.)
 */
export const MILEAGE_BACKFILL_VERSION_VALUE = 'mileageBackfillVersion'

// ── Input shapes for create actions (identical to the old store) ──
// DEC-6: addPhoto accepts an optional attach target. `source` defaults to 'car'
// (General); `sourceId` is the parent loggable's rowId when attaching inline on
// a mod/maintenance/issue/todo row. R2 keying is unchanged (source/sourceId are
// metadata cells, not in the key), so the upload pipeline is untouched.
type PhotoInput = Pick<Photo, 'dataUrl' | 'caption'> & {
  source?: PhotoSource
  sourceId?: string
}
/** DEC-16: a logged odometer reading. unit is the CURRENT distanceUnit (frozen at entry). */
type LogMileageInput = { value: string; date?: string }
type WishlistInput = Omit<WishlistItem, 'id' | 'status' | 'addedAt'>
type ModInput = Omit<Mod, 'id' | 'addedAt'>
type MaintenanceInput = Omit<MaintenanceRecord, 'id' | 'createdAt'>
type IssueInput = Pick<Issue, 'title' | 'description' | 'severity'>

export interface GarageState {
  cars: StoredCar[]

  // Theme
  themeId: string
  customAccent: string | null
  setTheme: (themeId: string) => void
  setCustomAccent: (hex: string) => void

  // Settings
  currency: CurrencyCode
  distanceUnit: DistanceUnitCode
  setCurrency: (to: CurrencyCode) => void
  setDistanceUnit: (to: DistanceUnitCode) => void

  // Cars
  addCar: (data: CarDetails) => string
  updateCar: (id: string, data: Partial<CarDetails>) => void
  deleteCar: (id: string) => void
  getCar: (id: string) => Car | undefined

  // Photos
  addPhoto: (carId: string, photo: PhotoInput) => void
  deletePhoto: (carId: string, photoId: string) => void
  setCoverPhoto: (carId: string, photoId: string) => void
  /** DEC-6: pick ANY photo as the hero banner (mirrors setCoverPhoto). */
  setBannerPhoto: (carId: string, photoId: string) => void

  // Wishlist
  addWishlistItem: (carId: string, data: WishlistInput) => void
  updateWishlistItem: (carId: string, itemId: string, data: Partial<WishlistItem>) => void
  deleteWishlistItem: (carId: string, itemId: string) => void

  // Mods
  addMod: (carId: string, data: ModInput) => void
  updateMod: (carId: string, modId: string, data: Partial<Mod>) => void
  deleteMod: (carId: string, modId: string) => void

  // Maintenance
  addMaintenance: (carId: string, data: MaintenanceInput) => void
  updateMaintenance: (carId: string, recId: string, data: Partial<MaintenanceRecord>) => void
  deleteMaintenance: (carId: string, recId: string) => void

  // Mileage check-ins (DEC-16)
  logMileage: (carId: string, data: LogMileageInput) => void
  deleteMileage: (carId: string, checkInId: string) => void

  // Todos
  addTodo: (carId: string, text: string, priority?: TodoPriority) => void
  toggleTodo: (carId: string, todoId: string) => void
  deleteTodo: (carId: string, todoId: string) => void
  updateTodo: (carId: string, todoId: string, data: Partial<Todo>) => void

  // Issues
  addIssue: (carId: string, data: IssueInput) => void
  updateIssue: (carId: string, issueId: string, data: Partial<Issue>) => void
  deleteIssue: (carId: string, issueId: string) => void
}

export interface GarageAdapter {
  store: MergeableStore
  localStore: Store
  indexes: Indexes
  getState: () => GarageState
  subscribe: (listener: () => void) => () => void
}

/**
 * Optional R2 side-effects (M3). Injected by the browser entrypoint so the
 * adapter stays a pure tables↔Car seam: when absent (e.g. unit tests, the
 * logged-out path) addPhoto/deletePhoto/deleteCar make NO network call and
 * behave exactly as in M2. Both hooks are best-effort and fire-and-forget.
 */
export interface PhotoHooks {
  /** Called after addPhoto's optimistic local write — uploads when signed-in. */
  onPhotoAdded?: (carId: string, photoId: string, dataUrl: string, caption: string) => void
  /** Called on deletePhoto/deleteCar with the r2Keys of removed uploaded photos. */
  onPhotosDeleted?: (r2Keys: string[]) => void
}

const now = (): string => new Date().toISOString()

/** Timestamp cell each child table is ordered by (tie-broken by rowId). The
 * mileage timeline is primarily ordered by `date` (then createdAt); the single
 * sort cell here is `date` (the full (date, createdAt) sort is a read-model
 * concern, applied where the timeline is consumed). */
const SORT_CELL: Record<ChildTableId, string> = {
  photos: 'uploadedAt',
  wishlist: 'addedAt',
  mods: 'addedAt',
  maintenance: 'createdAt',
  todos: 'createdAt',
  issues: 'createdAt',
  mileage: 'date',
}

/** DEC-6 photo-bearing child tables whose delete must RE-PARENT attached photos
 * to General (the §15.10 coupling invariant). `mileage` is intentionally NOT a
 * member yet (the PhotoSource union stays closed until DEC-16 opts in). */
type PhotoBearingItemTable = 'mods' | 'maintenance' | 'issues' | 'todos'

// Per-field update keys that map 1:1 onto cells (strict-null-safe: all are
// non-nullable strings/booleans in the domain model).
const CAR_DIRECT = [
  'year',
  'make',
  'model',
  'trim',
  'color',
  'nickname',
  'purchaseDate',
  'saleDate',
  'status',
  'tradeFor',
] as const
const WISHLIST_DIRECT = ['name', 'link', 'category', 'notes', 'status', 'addedAt'] as const
const MOD_DIRECT = [
  'name',
  'category',
  'description',
  'installedDate',
  'shop',
  'link',
  'addedAt',
] as const
const MAINT_DIRECT = ['service', 'date', 'shop', 'notes', 'nextDueDate', 'createdAt'] as const
const TODO_DIRECT = ['text', 'priority', 'done', 'createdAt'] as const
const ISSUE_DIRECT = ['title', 'description', 'severity', 'status', 'createdAt'] as const

export function createGarageAdapter(
  store: MergeableStore,
  localStore: Store,
  photoHooks: PhotoHooks = {},
): GarageAdapter {
  const indexes = createGarageIndexes(store)

  // ── Read model: per-car join cache ─────────────────────────
  const carCache = new Map<string, StoredCar>()
  /** `${tableId} ${rowId}` → owning carId (for delete invalidation). */
  const owners = new Map<string, string>()
  let dirtyCars: Set<string> | 'all' = 'all'
  let valuesDirty = true
  let carsArray: StoredCar[] = []
  let state: GarageState | null = null

  const listeners = new Set<() => void>()
  let notifyScheduled = false
  const scheduleNotify = (): void => {
    state = null
    if (!notifyScheduled) {
      notifyScheduled = true
      queueMicrotask(() => {
        notifyScheduled = false
        for (const listener of listeners) listener()
      })
    }
  }
  const markCarDirty = (carId: string): void => {
    if (dirtyCars !== 'all') dirtyCars.add(carId)
    scheduleNotify()
  }
  const markAllDirty = (): void => {
    dirtyCars = 'all'
    scheduleNotify()
  }
  const markValuesDirty = (): void => {
    valuesDirty = true
    scheduleNotify()
  }

  store.addRowListener('cars', null, (_store, _tableId, rowId) => {
    markCarDirty(rowId)
  })
  for (const tableId of CHILD_TABLE_IDS) {
    store.addRowListener(tableId, null, (_store, _tableId, rowId) => {
      const key = `${tableId} ${rowId}`
      const previousOwner = owners.get(key)
      const carId = store.getCell(tableId, rowId, 'carId') as string | undefined
      if (carId === undefined) {
        owners.delete(key)
        if (previousOwner !== undefined) markCarDirty(previousOwner)
        else markAllDirty()
      } else {
        owners.set(key, carId)
        if (previousOwner !== undefined && previousOwner !== carId) markCarDirty(previousOwner)
        markCarDirty(carId)
      }
    })
  }
  store.addValuesListener(() => markValuesDirty())
  // Payload changes outside an action (import flows) are rare → coarse.
  localStore.addTableListener(PHOTO_PAYLOADS_TABLE, () => markAllDirty())

  const sortedRowIds = (tableId: ChildTableId, rowIds: Id[]): Id[] => {
    const cellId = SORT_CELL[tableId]
    return [...rowIds].sort((a, b) => {
      const ta = (store.getCell(tableId, a, cellId) as string | undefined) ?? ''
      const tb = (store.getCell(tableId, b, cellId) as string | undefined) ?? ''
      if (ta !== tb) return ta < tb ? -1 : 1
      return a < b ? -1 : a > b ? 1 : 0
    })
  }

  const joinCarFromStore = (carId: string): StoredCar | undefined => {
    if (!store.hasRow('cars', carId)) return undefined
    const flat: FlattenedCar = {
      carId,
      car: store.getRow('cars', carId) as unknown as CarsRow,
      photos: {},
      wishlist: {},
      mods: {},
      maintenance: {},
      todos: {},
      issues: {},
      mileage: {},
      photoPayloads: {},
    }
    for (const tableId of CHILD_TABLE_IDS) {
      const rowIds = sortedRowIds(tableId, indexes.getSliceRowIds(carIdIndexId(tableId), carId))
      const target = flat[tableId] as Record<string, Row>
      for (const rowId of rowIds) {
        target[rowId] = store.getRow(tableId, rowId) as Row
        owners.set(`${tableId} ${rowId}`, carId)
      }
    }
    for (const photoId of Object.keys(flat.photos)) {
      flat.photoPayloads[photoId] =
        (localStore.getCell(PHOTO_PAYLOADS_TABLE, photoId, 'dataUrl') as string | undefined) ?? ''
    }
    const car = joinCar(flat) as StoredCar
    // Enrich joined photos with the R2 metadata off the synced row. The shared
    // Photo shape has no place for r2Key/width/height (joinCar drops them), but
    // resolvePhotoSrc needs r2Key to serve via /img. dataUrl stays the raw
    // local payload (or '' once uploaded) so backups keep their bytes.
    for (const photo of car.photos as StoredPhoto[]) {
      const row = flat.photos[photo.id]
      if (row.r2Key != null) photo.r2Key = row.r2Key
      if (row.width != null) photo.width = row.width
      if (row.height != null) photo.height = row.height
    }
    // Re-attach the canonical miles values joinCar drops (same pattern as
    // r2Key above), so the UI can convert to the active display unit. Absent
    // ⇔ non-numeric raw — left undefined so the display falls back to verbatim.
    if (flat.car.mileageMiles != null) car.mileageMiles = flat.car.mileageMiles
    for (const rec of car.maintenance as StoredMaintenance[]) {
      const row = flat.maintenance[rec.id]
      if (row.mileageMiles != null) rec.mileageMiles = row.mileageMiles
      if (row.nextDueMileageMiles != null) rec.nextDueMileageMiles = row.nextDueMileageMiles
    }
    return car
  }

  const rebuildCars = (): void => {
    if (dirtyCars === 'all') {
      carCache.clear()
      owners.clear()
    }
    const liveIds = store.getRowIds('cars')
    const liveSet = new Set(liveIds)
    for (const cachedId of [...carCache.keys()]) {
      if (!liveSet.has(cachedId)) carCache.delete(cachedId)
    }
    for (const carId of liveIds) {
      if (dirtyCars === 'all' || dirtyCars.has(carId) || !carCache.has(carId)) {
        const car = joinCarFromStore(carId)
        if (car) carCache.set(carId, car)
      }
    }
    carsArray = [...liveIds]
      .sort((a, b) => {
        const ta = (store.getCell('cars', a, 'createdAt') as string | undefined) ?? ''
        const tb = (store.getCell('cars', b, 'createdAt') as string | undefined) ?? ''
        if (ta !== tb) return ta < tb ? -1 : 1
        return a < b ? -1 : a > b ? 1 : 0
      })
      .map((carId) => carCache.get(carId))
      .filter((car): car is StoredCar => car !== undefined)
    dirtyCars = new Set()
  }

  // ── Write helpers ───────────────────────────────────────────
  const settings = (): FlattenSettings => ({
    currency: (store.getValue('currency') as string | undefined) ?? 'USD',
    distanceUnit: ((store.getValue('distanceUnit') as string | undefined) ?? 'mi') as DistanceUnitCode,
  })

  /**
   * Flatten ONE child item by round-tripping it through the shared flattenCar
   * on a shell car — guarantees create-path rows are byte-identical to what
   * the migration produces (single source of truth for the strict null rule
   * and currency tagging).
   */
  const flattenOne = (
    carId: string,
    // The nested-Car field names (photos/…/mileageLog), NOT the table ids — the
    // mileage child lives under `Car.mileageLog`, distinct from the legacy scalar
    // `Car.mileage` string.
    children: Partial<
      Pick<Car, 'photos' | 'wishlist' | 'mods' | 'maintenance' | 'todos' | 'issues' | 'mileageLog'>
    >,
  ): FlattenedCar =>
    flattenCar(
      {
        id: carId,
        year: '',
        make: '',
        model: '',
        trim: '',
        color: '',
        mileage: '',
        nickname: '',
        purchaseDate: '',
        saleDate: '',
        status: 'current',
        salePrice: '',
        tradeFor: '',
        coverPhoto: null,
        createdAt: '',
        photos: [],
        wishlist: [],
        mods: [],
        maintenance: [],
        todos: [],
        issues: [],
        ...children,
      },
      settings(),
    )

  const hasCar = (carId: string): boolean => store.hasRow('cars', carId)
  const childBelongs = (tableId: ChildTableId, rowId: string, carId: string): boolean =>
    store.getCell(tableId, rowId, 'carId') === carId

  /**
   * DEC-6 delete cascade (§15.10): deleting a photo-bearing item RE-PARENTS its
   * attached photos to General rather than destroying them. The authoritative
   * move is `delCell sourceId` (sourceId-resolution is the source of truth — a
   * dangling/absent sourceId resolves to General); `source='car'` keeps the
   * advisory hint current. Must run in the SAME transaction as the item delRow.
   *
   * Critically this NEVER routes through onPhotosDeleted — these are valuable
   * R2-backed photos being merely re-tagged, not deleted. Only deleteCar /
   * deletePhoto destroy R2 bytes.
   */
  const reparentItemPhotosToGeneral = (carId: string, itemId: string): void => {
    for (const photoId of indexes.getSliceRowIds(carIdIndexId('photos'), carId)) {
      if (store.getCell('photos', photoId, 'sourceId') === itemId) {
        store.delCell('photos', photoId, 'sourceId')
        store.setCell('photos', photoId, 'source', 'car')
      }
    }
  }

  /** Delete a photo-bearing item, re-parenting its photos to General first. */
  const deleteItemWithReparent = (
    tableId: PhotoBearingItemTable,
    carId: string,
    itemId: string,
  ): void => {
    if (!childBelongs(tableId, itemId, carId)) return
    store.transaction(() => {
      reparentItemPhotosToGeneral(carId, itemId)
      store.delRow(tableId, itemId)
    })
  }

  const setAmountCells = (
    tableId: 'wishlist' | 'mods' | 'maintenance',
    rowId: string,
    amountCell: 'price' | 'cost',
    currencyCell: 'priceCurrency' | 'costCurrency',
    amount: number | null,
  ): void => {
    if (amount === null) {
      store.delCell(tableId, rowId, amountCell)
      store.delCell(tableId, rowId, currencyCell)
    } else {
      store.setCell(tableId, rowId, amountCell, amount)
      store.setCell(tableId, rowId, currencyCell, settings().currency)
    }
  }

  const setMileageCells = (
    tableId: 'cars' | 'maintenance',
    rowId: string,
    rawCell: 'mileageRaw' | 'nextDueMileageRaw',
    milesCell: 'mileageMiles' | 'nextDueMileageMiles',
    raw: string,
  ): void => {
    store.setCell(tableId, rowId, rawCell, raw)
    const miles = parseMileageMiles(raw, settings().distanceUnit)
    if (miles != null) store.setCell(tableId, rowId, milesCell, miles)
    else store.delCell(tableId, rowId, milesCell)
  }

  /**
   * DEC-16 dual-write (§15.8 Phase 3): mirror the car's CURRENT odometer — the
   * latest live check-in by (date, createdAt) — into the legacy scalar
   * cars.mileageRaw/mileageMiles, so un-upgraded readers AND the still-scalar
   * snapshot builder stay correct. valueMiles is copied VERBATIM from the
   * winning check-in's canonical cell (never re-parsed under a maybe-different
   * current unit). No live check-ins (all deleted) → clear the scalar to '' so
   * the timeline-empty state shows no mileage. MUST run inside the caller's
   * transaction. Additive-forever: the scalar is never dropped.
   */
  const mirrorLatestMileage = (carId: string): void => {
    let best: { date: string; createdAt: string; raw: string; miles: number | undefined } | null = null
    // Scan the live rows directly (NOT the carId index): this runs inside the
    // caller's transaction, where index slices are not yet recomputed but the
    // store's own rows already reflect the just-applied setRow/delRow.
    for (const rowId of store.getRowIds('mileage')) {
      if (store.getCell('mileage', rowId, 'carId') !== carId) continue
      const date = (store.getCell('mileage', rowId, 'date') as string | undefined) ?? ''
      const createdAt = (store.getCell('mileage', rowId, 'createdAt') as string | undefined) ?? ''
      if (best == null || date > best.date || (date === best.date && createdAt > best.createdAt)) {
        best = {
          date,
          createdAt,
          raw: (store.getCell('mileage', rowId, 'valueRaw') as string | undefined) ?? '',
          miles: store.getCell('mileage', rowId, 'valueMiles') as number | undefined,
        }
      }
    }
    store.setCell('cars', carId, 'mileageRaw', best?.raw ?? '')
    if (best?.miles != null) store.setCell('cars', carId, 'mileageMiles', best.miles)
    else store.delCell('cars', carId, 'mileageMiles')
  }

  // ── Actions (identical signatures to the legacy store) ─────
  const setTheme = (themeId: string): void => {
    store.transaction(() => {
      store.setValue('themeId', themeId)
      store.delValue('customAccent') // legacy set customAccent: null
    })
  }

  const setCustomAccent = (hex: string): void => {
    store.transaction(() => {
      store.setValue('themeId', 'custom')
      store.setValue('customAccent', hex)
    })
  }

  const setCurrency = (to: CurrencyCode): void => {
    // Values write ONLY: stored amounts keep their entry currency tags. The
    // legacy in-place conversion of every amount was lossy and is gone.
    if (!CURRENCIES[to] || settings().currency === to) return
    store.setValue('currency', to)
  }

  const setDistanceUnit = (to: DistanceUnitCode): void => {
    // Values write ONLY: mileageRaw stays exactly as entered; mileageMiles
    // was canonicalized at entry time and stays correct.
    if (settings().distanceUnit === to) return
    store.setValue('distanceUnit', to)
  }

  // DEC-4 (log-first): returns the freshly-minted id so the caller can navigate
  // straight to the new car's profile (`navigate('/car/' + id)`).
  const addCar = (data: CarDetails): string => {
    const createdAt = now()
    const car: Car = {
      ...data,
      id: newId(),
      coverPhoto: null,
      createdAt,
      photos: [],
      wishlist: [],
      mods: [],
      maintenance: [],
      todos: [],
      issues: [],
    }
    const flat = flattenCar(car, settings())
    store.transaction(() => {
      // The car row keeps the scalar mileageRaw/mileageMiles as the latest-check-in
      // MIRROR (dual-write, §15.8 Phase 3) — flattenCar already wrote them.
      store.setRow('cars', flat.carId, flat.car as Row)
      // DEC-16: an entered odometer becomes the FIRST check-in so "current = latest
      // check-in" holds for brand-new cars too (the backfill is sentinel-gated and
      // won't revisit cars added after it ran). A user-authored reading → random id
      // (the deterministic `${carId}::initial` is reserved for the migration seed).
      if (data.mileage != null && data.mileage.trim() !== '') {
        const cs = settings()
        const checkIn: MileageCheckIn = {
          id: newId(),
          value: data.mileage,
          unit: cs.distanceUnit,
          date: isValidDateString(data.purchaseDate) ? data.purchaseDate : createdAt,
          source: 'initial',
          createdAt,
        }
        const childFlat = flattenOne(flat.carId, { mileageLog: [checkIn] })
        store.setRow('mileage', checkIn.id, childFlat.mileage[checkIn.id] as Row)
      }
    })
    return flat.carId
  }

  const updateCar = (id: string, data: Partial<CarDetails>): void => {
    if (!hasCar(id)) return
    store.transaction(() => {
      for (const key of CAR_DIRECT) {
        const value = data[key]
        if (value !== undefined) store.setCell('cars', id, key, value)
      }
      if (data.mileage !== undefined) {
        setMileageCells('cars', id, 'mileageRaw', 'mileageMiles', data.mileage)
      }
      if (data.salePrice !== undefined) {
        store.setCell('cars', id, 'salePrice', data.salePrice)
        if (data.salePrice !== '') {
          store.setCell('cars', id, 'salePriceCurrency', settings().currency)
        } else {
          store.delCell('cars', id, 'salePriceCurrency')
        }
      }
    })
  }

  const deleteCar = (id: string): void => {
    if (!hasCar(id)) return
    const photoIds = indexes.getSliceRowIds(carIdIndexId('photos'), id)
    const r2Keys = photoIds
      .map((photoId) => store.getCell('photos', photoId, 'r2Key') as string | undefined)
      .filter((key): key is string => key != null)
    store.transaction(() => {
      for (const tableId of CHILD_TABLE_IDS) {
        for (const rowId of indexes.getSliceRowIds(carIdIndexId(tableId), id)) {
          store.delRow(tableId, rowId)
        }
      }
      store.delRow('cars', id)
    })
    localStore.transaction(() => {
      for (const photoId of photoIds) localStore.delRow(PHOTO_PAYLOADS_TABLE, photoId)
    })
    if (r2Keys.length > 0) photoHooks.onPhotosDeleted?.(r2Keys)
  }

  const getCar = (id: string): Car | undefined => getState().cars.find((c) => c.id === id)

  const addPhoto = (carId: string, { dataUrl, caption, source, sourceId }: PhotoInput): void => {
    if (!hasCar(carId)) return
    const photo: Photo = { id: newId(), dataUrl, caption, uploadedAt: now() }
    // DEC-6 (§15.2): attach to a loggable item iff a real sourceId is given AND
    // the item belongs to THIS car (the immutability invariant — a photo never
    // moves cars). `source` is the advisory hint; `sourceId` is the source of
    // truth. flattenCar omits `source` for General and writes `sourceId` iff set.
    if (source != null && source !== 'car' && sourceId != null && sourceId !== '') {
      photo.source = source
      photo.sourceId = sourceId
    }
    const flat = flattenOne(carId, { photos: [photo] })
    // Optimistic local write first: the photo shows instantly as base64 and the
    // row listener's join already sees the payload. The upload (signed-in +
    // online only) then swaps in the r2Key in the background; logged-out this
    // hook is absent → pure local, no network (M2 behavior unchanged).
    localStore.setRow(PHOTO_PAYLOADS_TABLE, photo.id, { dataUrl })
    store.setRow('photos', photo.id, flat.photos[photo.id] as Row)
    photoHooks.onPhotoAdded?.(carId, photo.id, dataUrl, caption)
  }

  const deletePhoto = (carId: string, photoId: string): void => {
    if (!childBelongs('photos', photoId, carId)) return
    const r2Key = store.getCell('photos', photoId, 'r2Key') as string | undefined
    store.transaction(() => {
      store.delRow('photos', photoId)
      // DEC-6 (§15.10): clear BOTH soft pointers that may target this photo.
      if (store.getCell('cars', carId, 'coverPhoto') === photoId) {
        store.delCell('cars', carId, 'coverPhoto') // legacy set coverPhoto: null
      }
      if (store.getCell('cars', carId, 'bannerPhoto') === photoId) {
        store.delCell('cars', carId, 'bannerPhoto')
      }
    })
    localStore.delRow(PHOTO_PAYLOADS_TABLE, photoId)
    if (r2Key != null) photoHooks.onPhotosDeleted?.([r2Key])
  }

  const setCoverPhoto = (carId: string, photoId: string): void => {
    if (!hasCar(carId)) return
    store.setCell('cars', carId, 'coverPhoto', photoId)
  }

  // DEC-6: the hero banner is a per-car single-cell soft pointer, mirroring
  // setCoverPhoto — "exactly one banner" for free under per-cell LWW. Only a
  // photo that belongs to this car may be picked (the resolution chain is
  // bannerPhoto → coverPhoto → first → none; a dangling pointer just falls
  // through). deletePhoto already clears this cell (§15.10).
  const setBannerPhoto = (carId: string, photoId: string): void => {
    if (!childBelongs('photos', photoId, carId)) return
    store.setCell('cars', carId, 'bannerPhoto', photoId)
  }

  const addWishlistItem = (carId: string, data: WishlistInput): void => {
    if (!hasCar(carId)) return
    const item: WishlistItem = { ...data, id: newId(), status: 'wanted', addedAt: now() }
    const flat = flattenOne(carId, { wishlist: [item] })
    store.setRow('wishlist', item.id, flat.wishlist[item.id] as Row)
  }

  const updateWishlistItem = (
    carId: string,
    itemId: string,
    data: Partial<WishlistItem>,
  ): void => {
    if (!childBelongs('wishlist', itemId, carId)) return
    store.transaction(() => {
      for (const key of WISHLIST_DIRECT) {
        const value = data[key]
        if (value !== undefined) store.setCell('wishlist', itemId, key, value)
      }
      if (data.price !== undefined) {
        setAmountCells('wishlist', itemId, 'price', 'priceCurrency', data.price)
      }
    })
  }

  const deleteWishlistItem = (carId: string, itemId: string): void => {
    if (!childBelongs('wishlist', itemId, carId)) return
    store.delRow('wishlist', itemId)
  }

  const addMod = (carId: string, data: ModInput): void => {
    if (!hasCar(carId)) return
    const mod: Mod = { ...data, id: newId(), addedAt: now() }
    const flat = flattenOne(carId, { mods: [mod] })
    store.setRow('mods', mod.id, flat.mods[mod.id] as Row)
  }

  const updateMod = (carId: string, modId: string, data: Partial<Mod>): void => {
    if (!childBelongs('mods', modId, carId)) return
    store.transaction(() => {
      for (const key of MOD_DIRECT) {
        const value = data[key]
        if (value !== undefined) store.setCell('mods', modId, key, value)
      }
      if (data.cost !== undefined) {
        setAmountCells('mods', modId, 'cost', 'costCurrency', data.cost)
      }
    })
  }

  const deleteMod = (carId: string, modId: string): void => {
    deleteItemWithReparent('mods', carId, modId)
  }

  const addMaintenance = (carId: string, data: MaintenanceInput): void => {
    if (!hasCar(carId)) return
    const record: MaintenanceRecord = { ...data, id: newId(), createdAt: now() }
    const flat = flattenOne(carId, { maintenance: [record] })
    store.setRow('maintenance', record.id, flat.maintenance[record.id] as Row)
  }

  const updateMaintenance = (
    carId: string,
    recId: string,
    data: Partial<MaintenanceRecord>,
  ): void => {
    if (!childBelongs('maintenance', recId, carId)) return
    store.transaction(() => {
      for (const key of MAINT_DIRECT) {
        const value = data[key]
        if (value !== undefined) store.setCell('maintenance', recId, key, value)
      }
      if (data.mileage !== undefined) {
        if (data.mileage === null) {
          // null and '' are distinct round-trippable states: null = no cells.
          store.delCell('maintenance', recId, 'mileageRaw')
          store.delCell('maintenance', recId, 'mileageMiles')
        } else {
          setMileageCells('maintenance', recId, 'mileageRaw', 'mileageMiles', data.mileage)
        }
      }
      if (data.cost !== undefined) {
        setAmountCells('maintenance', recId, 'cost', 'costCurrency', data.cost)
      }
      if (data.nextDueMileage !== undefined) {
        setMileageCells(
          'maintenance',
          recId,
          'nextDueMileageRaw',
          'nextDueMileageMiles',
          data.nextDueMileage,
        )
      }
    })
  }

  const deleteMaintenance = (carId: string, recId: string): void => {
    deleteItemWithReparent('maintenance', carId, recId)
  }

  // ── Mileage check-ins (DEC-16) ─────────────────────────────
  /**
   * Log a dated odometer check-in. The reading freezes the CURRENT distanceUnit
   * at entry (the distance analogue of the per-amount *Currency tag); valueMiles
   * canonicalizes from THAT unit (via flattenCar). date defaults to today. The
   * write also dual-writes the latest reading into the legacy scalar so old
   * readers + the still-scalar snapshot stay correct (§15.8 Phase 3).
   */
  const logMileage = (carId: string, { value, date }: LogMileageInput): void => {
    if (!hasCar(carId)) return
    const checkIn: MileageCheckIn = {
      id: newId(),
      value,
      unit: settings().distanceUnit,
      date: date != null && date !== '' ? date : now().slice(0, 10),
      source: 'manual',
      createdAt: now(),
    }
    const flat = flattenOne(carId, { mileageLog: [checkIn] })
    store.transaction(() => {
      store.setRow('mileage', checkIn.id, flat.mileage[checkIn.id] as Row)
      mirrorLatestMileage(carId)
    })
  }

  /** Delete one check-in, then re-mirror the (new) latest into the scalar. */
  const deleteMileage = (carId: string, checkInId: string): void => {
    if (!childBelongs('mileage', checkInId, carId)) return
    store.transaction(() => {
      store.delRow('mileage', checkInId)
      mirrorLatestMileage(carId)
    })
  }

  const addTodo = (carId: string, text: string, priority: TodoPriority = 'medium'): void => {
    if (!hasCar(carId)) return
    const todo: Todo = { id: newId(), text, priority, done: false, createdAt: now() }
    const flat = flattenOne(carId, { todos: [todo] })
    store.setRow('todos', todo.id, flat.todos[todo.id] as Row)
  }

  const toggleTodo = (carId: string, todoId: string): void => {
    if (!childBelongs('todos', todoId, carId)) return
    store.setCell('todos', todoId, 'done', !(store.getCell('todos', todoId, 'done') === true))
  }

  const deleteTodo = (carId: string, todoId: string): void => {
    deleteItemWithReparent('todos', carId, todoId)
  }

  const updateTodo = (carId: string, todoId: string, data: Partial<Todo>): void => {
    if (!childBelongs('todos', todoId, carId)) return
    store.transaction(() => {
      for (const key of TODO_DIRECT) {
        const value = data[key]
        if (value !== undefined) store.setCell('todos', todoId, key, value)
      }
    })
  }

  const addIssue = (carId: string, data: IssueInput): void => {
    if (!hasCar(carId)) return
    const issue: Issue = { ...data, id: newId(), status: 'open', createdAt: now() }
    const flat = flattenOne(carId, { issues: [issue] })
    store.setRow('issues', issue.id, flat.issues[issue.id] as Row)
  }

  const updateIssue = (carId: string, issueId: string, data: Partial<Issue>): void => {
    if (!childBelongs('issues', issueId, carId)) return
    store.transaction(() => {
      for (const key of ISSUE_DIRECT) {
        const value = data[key]
        if (value !== undefined) store.setCell('issues', issueId, key, value)
      }
      if (data.resolvedAt !== undefined) {
        if (data.resolvedAt === null) store.delCell('issues', issueId, 'resolvedAt')
        else store.setCell('issues', issueId, 'resolvedAt', data.resolvedAt)
      }
    })
  }

  const deleteIssue = (carId: string, issueId: string): void => {
    deleteItemWithReparent('issues', carId, issueId)
  }

  const actions = {
    setTheme,
    setCustomAccent,
    setCurrency,
    setDistanceUnit,
    addCar,
    updateCar,
    deleteCar,
    getCar,
    addPhoto,
    deletePhoto,
    setCoverPhoto,
    setBannerPhoto,
    addWishlistItem,
    updateWishlistItem,
    deleteWishlistItem,
    addMod,
    updateMod,
    deleteMod,
    addMaintenance,
    updateMaintenance,
    deleteMaintenance,
    logMileage,
    deleteMileage,
    addTodo,
    toggleTodo,
    deleteTodo,
    updateTodo,
    addIssue,
    updateIssue,
    deleteIssue,
  }

  const getState = (): GarageState => {
    const carsDirty = dirtyCars === 'all' || dirtyCars.size > 0
    if (state && !carsDirty && !valuesDirty) return state
    if (carsDirty) rebuildCars()
    valuesDirty = false
    state = {
      cars: carsArray,
      themeId: (store.getValue('themeId') as string | undefined) ?? 'garage',
      customAccent: (store.getValue('customAccent') as string | undefined) ?? null,
      currency: settings().currency as CurrencyCode,
      distanceUnit: settings().distanceUnit,
      ...actions,
    }
    return state
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return { store, localStore, indexes, getState, subscribe }
}

// Row-shape types re-exported for the migration/backup modules.
export type {
  CarsRow,
  IssuesRow,
  MaintenanceRow,
  ModsRow,
  PhotosRow,
  TodosRow,
  WishlistRow,
}
