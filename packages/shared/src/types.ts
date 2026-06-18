import type { DistanceUnitCode } from './units'

// ── Status unions ───────────────────────────────────────────
/**
 * Status a car can be assigned through the UI. `sold` can be set explicitly
 * (the "Sold (Archive)" option / Mark-as-Sold flow) and is also derived from a
 * past sale date by getCarStatus().
 */
export type CarStoredStatus = 'current' | 'for-sale' | 'for-trade' | 'totaled' | 'sold'
/** Effective status as resolved by getCarStatus(). */
export type CarStatus = CarStoredStatus

export type WishlistStatus = 'wanted' | 'ordered' | 'installed'
export type TodoPriority = 'low' | 'medium' | 'high'
export type IssueSeverity = 'minor' | 'moderate' | 'critical'
export type IssueStatus = 'open' | 'in-progress' | 'resolved'

/**
 * DEC-6 (unified photos): the KIND of entity a photo attaches to — a CLOSED
 * union = {'car'} ∪ {the photo-bearing child tables}. `'car'` is the gallery's
 * "General" filter; the others map 1:1 to their tables. Read convention:
 * absent `source` ⇔ 'car'. The effective parent is resolved from `sourceId`
 * (the source of truth); `source` is an advisory cached hint (§15.2).
 */
export type PhotoSource = 'car' | 'mod' | 'maintenance' | 'issue' | 'todo'

/** DEC-16: provenance of an odometer check-in (TS-only, store-unconstrained). */
export type MileageSource = 'manual' | 'initial' | 'import' | 'legacy-edit'

// ── Entities ────────────────────────────────────────────────
export interface Photo {
  id: string
  dataUrl: string
  caption: string
  uploadedAt: string
  /**
   * DEC-6: parent KIND. Absent ⇔ 'car' (the General gallery). Advisory cached
   * hint — the effective parent is resolved from `sourceId`, not this cell.
   */
  source?: PhotoSource
  /**
   * DEC-6: soft FK to the parent loggable item's rowId. Absent ⇔ attached to
   * the car (General). May dangle after a merge / parent-delete → coalesces to
   * General on read.
   */
  sourceId?: string
}

/**
 * DEC-16: one dated odometer reading. The car's current odometer = the latest
 * check-in. `unit` is frozen at entry (the distance analogue of the per-amount
 * *Currency tag). The canonical miles value (`valueMiles`) is a derived cell on
 * the flat row, dropped by joinCar (recomputed from `value`+`unit`).
 */
export interface MileageCheckIn {
  id: string
  /** Odometer reading exactly as entered (store-as-entered) → valueRaw cell. */
  value: string
  /** 'mi' | 'km' — frozen at entry. */
  unit: DistanceUnitCode
  /** ISO-8601 date the odometer was at this value (the timeline x-axis). */
  date: string
  source: MileageSource
  createdAt: string
}

/**
 * DEC-11 (follow / saved builds): a durable follow record of another owner's
 * shared build, keyed by the share token's hash. Lives in the follower's own
 * synced garage store (NOT the Car aggregate). `id` = sha256(rawToken) hex.
 * The nullable cached* header fields follow the strict-null rule (absent ⇔
 * null; '' / 0 are real, distinct values — e.g. a cleared `nickname`).
 */
export interface SavedBuild {
  /** rowId = sha256(rawToken) hex (content-addressed; merge-idempotent). */
  id: string
  /** RAW bearer token — refetch + token-scoped image URLs + view ping. */
  token: string
  /** ISO-8601 first-saved time. */
  savedAt: string
  /** Follower's personal label. null ⇔ never set; '' ⇔ explicitly cleared. */
  nickname: string | null
  sortOrder: number | null
  cachedYear: string | null
  cachedMake: string | null
  cachedModel: string | null
  cachedNickname: string | null
  cachedOwnerName: string | null
  cachedStatus: string | null
  cachedMileageRaw: string | null
  cachedModsCount: number | null
  cachedCoverPhotoId: string | null
  /** 'curated' | 'listing' | 'full' — informational badge only. */
  cachedScope: string | null
  lastRefreshedAt: string | null
  unavailableSince: string | null
}

export interface WishlistItem {
  id: string
  name: string
  link: string
  /** Parsed price in dollars, or null when left blank. */
  price: number | null
  category: string
  notes: string
  status: WishlistStatus
  addedAt: string
}

export interface Mod {
  id: string
  name: string
  category: string
  description: string
  /** Parsed cost in dollars, or null when left blank. */
  cost: number | null
  installedDate: string
  shop: string
  link: string
  addedAt: string
}

export interface MaintenanceRecord {
  id: string
  service: string
  date: string
  /** Mileage is kept as a raw string (or null) as entered. */
  mileage: string | null
  /** Parsed cost in dollars, or null when left blank. */
  cost: number | null
  shop: string
  notes: string
  nextDueDate: string
  nextDueMileage: string
  createdAt: string
}

export interface Todo {
  id: string
  text: string
  priority: TodoPriority
  done: boolean
  createdAt: string
}

export interface Issue {
  id: string
  title: string
  description: string
  severity: IssueSeverity
  status: IssueStatus
  createdAt: string
  resolvedAt?: string | null
}

/** The editable, free-text fields of a car (everything captured by the add/edit forms). */
export interface CarDetails {
  year: string
  make: string
  model: string
  trim: string
  color: string
  mileage: string
  nickname: string
  purchaseDate: string
  saleDate: string
  status: CarStoredStatus
  salePrice: string
  tradeFor: string
  /**
   * DEC-13 VIN — store-as-entered free text; '' / absent ⇔ no VIN. Private by
   * default; surfaced publicly only under scope='listing'.
   */
  vin?: string
  /**
   * DEC-19 license plate — store-as-entered free text; '' / absent ⇔ no plate.
   * PRIVATE by default; surfaced publicly only when `showPlate` is the owner's
   * explicit opt-in (the INVERSE of VIN: sellers hide plates, enthusiasts flaunt
   * vanity plates on a showcase). Exposure is owner-CHOICE, not purpose-gated.
   */
  plate?: string
  /**
   * DEC-19 owner opt-in to expose the plate on shares. Absent/false ⇔ hidden
   * (the default — plate stays private). When true, the plate appears on ALL
   * scopes (curated/listing/full) via the same key-by-key allowlist as VIN.
   */
  showPlate?: boolean
}

export interface Car extends CarDetails {
  id: string
  coverPhoto?: string | null
  /**
   * DEC-6 hero banner — soft pointer to a photoId. Resolution chain:
   * bannerPhoto → coverPhoto → first photo → none. Absent ⇔ null.
   */
  bannerPhoto?: string | null
  createdAt: string
  photos: Photo[]
  wishlist: WishlistItem[]
  mods: Mod[]
  maintenance: MaintenanceRecord[]
  todos: Todo[]
  issues: Issue[]
  /** DEC-16 dated odometer check-ins (the mileage timeline). Absent ⇔ none. */
  mileageLog?: MileageCheckIn[]
}
