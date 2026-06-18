// Single source of truth for the synced TinyBase schema (BACKEND_PLAN.md, "Data
// model"). The nested Car aggregate normalizes into one parent table + child
// tables keyed by carId; ownership is implicit (the whole store lives in the
// user's Durable Object), so there is no userId column.
//
// STRICT NULL RULE (MAJOR — see flatten.ts): a cell is omitted iff the value is
// strictly null/undefined. Nullable cells therefore declare a type but NO
// TinyBase `default` — a default would resurrect a value where the user meant
// blank. The join adapter maps absent → null. Non-nullable cells also carry no
// default: flattenCar always writes them explicitly (0, false and '' are real
// values), so a default could only ever fabricate data on a partially-synced
// row.
import type { TablesSchema, ValuesSchema } from 'tinybase'
import type {
  CarStoredStatus,
  IssueSeverity,
  IssueStatus,
  MileageSource,
  PhotoSource,
  TodoPriority,
  WishlistStatus,
} from './types'
import type { DistanceUnitCode } from './units'

// ── Values (synced app settings) ────────────────────────────
// Migration sentinels (idbMigrated, unitsSchemaVersion) intentionally do NOT
// live here — they are per-device state and belong in a local-only store.
export const GARAGE_VALUES_SCHEMA = {
  themeId: { type: 'string', default: 'garage' },
  /** Hex accent when themeId === 'custom'. Nullable: absent ⇔ null, NO default. */
  customAccent: { type: 'string' },
  /** ISO-4217 code amounts are tagged with at entry time. */
  currency: { type: 'string', default: 'USD' },
  /** 'mi' | 'km' — the unit the user enters distances in. */
  distanceUnit: { type: 'string', default: 'mi' },
} as const satisfies ValuesSchema

/** Typed view of the synced Values. Absent customAccent ⇔ null. */
export type GarageValues = {
  themeId: string
  customAccent?: string
  currency: string
  distanceUnit: DistanceUnitCode
}

// ── Tables ──────────────────────────────────────────────────
export const GARAGE_TABLES_SCHEMA = {
  // rowId = carId
  cars: {
    year: { type: 'string' },
    make: { type: 'string' },
    model: { type: 'string' },
    trim: { type: 'string' },
    color: { type: 'string' },
    /** Raw mileage exactly as entered — authoritative display value. */
    mileageRaw: { type: 'string' },
    /** Canonical miles (×1.609344 exact when entered as km); present iff mileageRaw parses numerically. */
    mileageMiles: { type: 'number' },
    nickname: { type: 'string' },
    purchaseDate: { type: 'string' },
    saleDate: { type: 'string' },
    status: { type: 'string' },
    /** Stays a string as today; '' when blank (a real, round-trippable cell). */
    salePrice: { type: 'string' },
    /** ISO-4217 tag; present iff salePrice is non-empty. */
    salePriceCurrency: { type: 'string' },
    tradeFor: { type: 'string' },
    /** Soft pointer to a photoId — can dangle after a merge; resolve with fallback. */
    coverPhoto: { type: 'string' },
    /** DEC-6 hero banner soft pointer (resolve bannerPhoto → coverPhoto → first → none). Nullable, NO default. */
    bannerPhoto: { type: 'string' },
    /** DEC-13 VIN — private free text; omit iff ''. Nullable, NO default (absent ⇔ ''). */
    vin: { type: 'string' },
    /** DEC-19 license plate — private free text; omit iff ''. Nullable, NO default (absent ⇔ ''). */
    plate: { type: 'string' },
    /** DEC-19 owner opt-in to expose the plate on shares. Omit iff false. Nullable, NO default (absent ⇔ false). */
    showPlate: { type: 'boolean' },
    createdAt: { type: 'string' },
  },
  // rowId = photoId. METADATA ONLY: the base64 dataUrl must NEVER land in a
  // cell — it stays in a local-only side store until R2 lands in M3.
  photos: {
    carId: { type: 'string' },
    /** R2 object key; absent until the photo is uploaded (M3). */
    r2Key: { type: 'string' },
    caption: { type: 'string' },
    uploadedAt: { type: 'string' },
    width: { type: 'number' },
    height: { type: 'number' },
    /** DEC-6 attach KIND (advisory hint). Nullable, NO default — absent ⇔ 'car' (General). */
    source: { type: 'string' },
    /** DEC-6 soft FK to the parent loggable's rowId. Nullable, NO default — absent ⇔ attached to the car. */
    sourceId: { type: 'string' },
  },
  // rowId = itemId
  wishlist: {
    carId: { type: 'string' },
    name: { type: 'string' },
    link: { type: 'string' },
    price: { type: 'number' },
    priceCurrency: { type: 'string' },
    category: { type: 'string' },
    notes: { type: 'string' },
    status: { type: 'string' },
    addedAt: { type: 'string' },
  },
  // rowId = modId
  mods: {
    carId: { type: 'string' },
    name: { type: 'string' },
    category: { type: 'string' },
    description: { type: 'string' },
    cost: { type: 'number' },
    costCurrency: { type: 'string' },
    installedDate: { type: 'string' },
    shop: { type: 'string' },
    link: { type: 'string' },
    addedAt: { type: 'string' },
  },
  // rowId = recId
  maintenance: {
    carId: { type: 'string' },
    service: { type: 'string' },
    date: { type: 'string' },
    /** NULLABLE (source MaintenanceRecord.mileage is string | null): absent ⇔ null, '' is a real cell. */
    mileageRaw: { type: 'string' },
    mileageMiles: { type: 'number' },
    cost: { type: 'number' },
    costCurrency: { type: 'string' },
    shop: { type: 'string' },
    notes: { type: 'string' },
    nextDueDate: { type: 'string' },
    nextDueMileageRaw: { type: 'string' },
    nextDueMileageMiles: { type: 'number' },
    createdAt: { type: 'string' },
  },
  // rowId = todoId
  todos: {
    carId: { type: 'string' },
    text: { type: 'string' },
    priority: { type: 'string' },
    /** false is a real value — always written explicitly. */
    done: { type: 'boolean' },
    createdAt: { type: 'string' },
  },
  // rowId = issueId
  issues: {
    carId: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    severity: { type: 'string' },
    status: { type: 'string' },
    createdAt: { type: 'string' },
    /** Nullable: absent ⇔ null. */
    resolvedAt: { type: 'string' },
  },
  // rowId = checkInId (DEC-16). 7th child table (carId cell). A check-in = one
  // dated odometer reading; display order = (date, createdAt).
  mileage: {
    carId: { type: 'string' },
    /** Odometer reading exactly as entered. */
    valueRaw: { type: 'string' },
    /** Canonical miles; present iff valueRaw parses under `unit`. Nullable, NO default. */
    valueMiles: { type: 'number' },
    /** 'mi' | 'km' — frozen at entry (distance analogue of the *Currency tag). */
    unit: { type: 'string' },
    /** ISO-8601 date the odometer was at this value. */
    date: { type: 'string' },
    /** 'manual' | 'initial' | 'import' | 'legacy-edit' (TS union, store-unconstrained). */
    source: { type: 'string' },
    createdAt: { type: 'string' },
  },
  // rowId = sha256(rawToken) hex (DEC-11). TOP-LEVEL (NOT a child of cars: no
  // carId cell, no carId index). One row per followed build; the Watching list
  // IS this whole bounded table. Nullable cached* cells declare a type but NO
  // default (a default would resurrect a value the user/cache meant absent).
  savedBuilds: {
    /** RAW bearer token — refetch + token-scoped image URLs + view ping. */
    token: { type: 'string' },
    savedAt: { type: 'string' },
    /** Follower's personal label. Nullable: absent ⇔ never set, '' ⇔ cleared. */
    nickname: { type: 'string' },
    sortOrder: { type: 'number' },
    cachedYear: { type: 'string' },
    cachedMake: { type: 'string' },
    cachedModel: { type: 'string' },
    cachedNickname: { type: 'string' },
    cachedOwnerName: { type: 'string' },
    cachedStatus: { type: 'string' },
    cachedMileageRaw: { type: 'string' },
    cachedModsCount: { type: 'number' },
    cachedCoverPhotoId: { type: 'string' },
    cachedScope: { type: 'string' },
    lastRefreshedAt: { type: 'string' },
    unavailableSince: { type: 'string' },
  },
} as const satisfies TablesSchema

export const GARAGE_TABLE_IDS = [
  'cars',
  'photos',
  'wishlist',
  'mods',
  'maintenance',
  'todos',
  'issues',
  'mileage',
  'savedBuilds',
] as const
export type GarageTableId = (typeof GARAGE_TABLE_IDS)[number]

/** Child tables keyed by carId — each gets a carId Index (see store.ts).
 * `savedBuilds` is deliberately NOT here (it has no carId; the Watching list is
 * the whole table). */
export const CHILD_TABLE_IDS = [
  'photos',
  'wishlist',
  'mods',
  'maintenance',
  'todos',
  'issues',
  'mileage',
] as const
export type ChildTableId = (typeof CHILD_TABLE_IDS)[number]

// ── Row shapes ──────────────────────────────────────────────
// Optional properties are exactly the nullable inventory: the cell is written
// iff the value is non-null, and absent ⇔ null on join. These are type aliases
// (not interfaces) so they stay assignable to TinyBase's Row.

export type CarsRow = {
  year: string
  make: string
  model: string
  trim: string
  color: string
  mileageRaw: string
  mileageMiles?: number
  nickname: string
  purchaseDate: string
  saleDate: string
  status: CarStoredStatus
  salePrice: string
  salePriceCurrency?: string
  tradeFor: string
  coverPhoto?: string
  bannerPhoto?: string
  vin?: string
  plate?: string
  showPlate?: boolean
  createdAt: string
}

export type PhotosRow = {
  carId: string
  r2Key?: string
  caption: string
  uploadedAt: string
  width?: number
  height?: number
  source?: PhotoSource
  sourceId?: string
}

export type WishlistRow = {
  carId: string
  name: string
  link: string
  price?: number
  priceCurrency?: string
  category: string
  notes: string
  status: WishlistStatus
  addedAt: string
}

export type ModsRow = {
  carId: string
  name: string
  category: string
  description: string
  cost?: number
  costCurrency?: string
  installedDate: string
  shop: string
  link: string
  addedAt: string
}

export type MaintenanceRow = {
  carId: string
  service: string
  date: string
  mileageRaw?: string
  mileageMiles?: number
  cost?: number
  costCurrency?: string
  shop: string
  notes: string
  nextDueDate: string
  nextDueMileageRaw: string
  nextDueMileageMiles?: number
  createdAt: string
}

export type TodosRow = {
  carId: string
  text: string
  priority: TodoPriority
  done: boolean
  createdAt: string
}

export type IssuesRow = {
  carId: string
  title: string
  description: string
  severity: IssueSeverity
  status: IssueStatus
  createdAt: string
  resolvedAt?: string
}

export type MileageRow = {
  carId: string
  valueRaw: string
  valueMiles?: number
  unit: DistanceUnitCode
  date: string
  source: MileageSource
  createdAt: string
}

export type SavedBuildRow = {
  token: string
  savedAt: string
  nickname?: string
  sortOrder?: number
  cachedYear?: string
  cachedMake?: string
  cachedModel?: string
  cachedNickname?: string
  cachedOwnerName?: string
  cachedStatus?: string
  cachedMileageRaw?: string
  cachedModsCount?: number
  cachedCoverPhotoId?: string
  cachedScope?: string
  lastRefreshedAt?: string
  unavailableSince?: string
}

export type GarageTableRow = {
  cars: CarsRow
  photos: PhotosRow
  wishlist: WishlistRow
  mods: ModsRow
  maintenance: MaintenanceRow
  todos: TodosRow
  issues: IssuesRow
  mileage: MileageRow
  savedBuilds: SavedBuildRow
}
