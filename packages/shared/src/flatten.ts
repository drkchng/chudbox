// Car ↔ tables mapping — THE round-trip correctness seam (BACKEND_PLAN.md,
// "Round-trip correctness"). flattenCar(car, settings) produces the table rows
// for one car plus a photo-payload side map; joinCar reassembles the original
// nested Car.
//
// STRICT NULL RULE: a cell is omitted IFF the value is strictly
// null/undefined — never merely falsy. 0 (free part), false (todos.done) and
// '' (e.g. mileageRaw) are real values and are written explicitly, or they
// corrupt on round-trip. joinCar maps absent → null.
//
// Money: store-as-entered. Every non-null amount is tagged with the device
// currency at flatten time (ISO-4217, from settings); joinCar drops the tag
// (the nested Car has no currency field), so re-flattening under a different
// device currency would re-tag — the M2 adapter must write cells directly
// rather than round-tripping through Car when only the setting changes.
//
// Distance: mileageRaw mirrors the source string and is the authoritative
// display value; mileageMiles is derived for comparison/aggregation only and
// is present IFF the raw string parses numerically.
import type {
  Car,
  Issue,
  MaintenanceRecord,
  MileageCheckIn,
  Mod,
  Photo,
  SavedBuild,
  Todo,
  WishlistItem,
} from './types'
import type { DistanceUnitCode } from './units'
import type {
  CarsRow,
  IssuesRow,
  MaintenanceRow,
  MileageRow,
  ModsRow,
  PhotosRow,
  SavedBuildRow,
  TodosRow,
  WishlistRow,
} from './schema'

/** Exact by definition: 1 mile = 1.609344 km. */
export const KM_PER_MILE = 1.609344

export interface FlattenSettings {
  /** ISO-4217 code to tag non-null amounts with (the device currency). */
  currency: string
  /** Unit the user enters distances in; mileageMiles canonicalizes from this. */
  distanceUnit: DistanceUnitCode
}

/** One car's worth of table rows, keyed by rowId, plus the local-only photo payloads. */
export interface FlattenedCar {
  carId: string
  car: CarsRow
  photos: Record<string, PhotosRow>
  wishlist: Record<string, WishlistRow>
  mods: Record<string, ModsRow>
  maintenance: Record<string, MaintenanceRow>
  todos: Record<string, TodosRow>
  issues: Record<string, IssuesRow>
  /** DEC-16 dated odometer check-ins, keyed by checkInId. */
  mileage: Record<string, MileageRow>
  /**
   * photoId → base64 dataUrl. NEVER lands in a table cell — it lives in a
   * local-only, non-mergeable store until photos move to R2 in M3.
   */
  photoPayloads: Record<string, string>
}

// Locale digit-group separators stripped before numeric parsing: comma, plain
// space, NBSP, narrow NBSP, thin space, apostrophe / right single quote
// (Swiss). NOT '.', which stays a decimal point.
const GROUP_SEPARATORS = /[, \u00a0\u202f\u2009'\u2019]/g
// Whole string must be a plain non-negative decimal AFTER stripping — rejects
// parseFloat prefix-parsing traps like '120k' (→ 120) or '~120k'.
const PLAIN_NUMBER = /^\d+(\.\d+)?$/

/**
 * Parse a raw mileage string to canonical miles, or null when it does not
 * parse numerically ('unknown', '~120k', 'TMU', '' → null). Strips locale
 * group separators first — '12,000' must parse as 12000, never 12. Applies
 * the exact ×1.609344 factor when the entry unit is km.
 */
export function parseMileageMiles(
  raw: string | null | undefined,
  distanceUnit: DistanceUnitCode,
): number | null {
  if (raw == null) return null
  const stripped = raw.trim().replace(GROUP_SEPARATORS, '')
  if (!PLAIN_NUMBER.test(stripped)) return null
  const value = Number.parseFloat(stripped)
  if (!Number.isFinite(value)) return null
  return distanceUnit === 'km' ? value / KM_PER_MILE : value
}

/**
 * Inverse of parseMileageMiles' scaling: convert a canonical miles value to the
 * given display unit using the EXACT ×1.609344 factor. Display-only — the
 * stored canonical (mileageMiles) is the source of truth, so callers convert
 * from it rather than round-tripping a raw string through a lossy factor.
 */
export function milesToUnit(miles: number, distanceUnit: DistanceUnitCode): number {
  return distanceUnit === 'km' ? miles * KM_PER_MILE : miles
}

export function flattenCar(car: Car, settings: FlattenSettings): FlattenedCar {
  const carRow: CarsRow = {
    year: car.year,
    make: car.make,
    model: car.model,
    trim: car.trim,
    color: car.color,
    mileageRaw: car.mileage,
    nickname: car.nickname,
    purchaseDate: car.purchaseDate,
    saleDate: car.saleDate,
    status: car.status,
    salePrice: car.salePrice,
    tradeFor: car.tradeFor,
    createdAt: car.createdAt,
  }
  const carMiles = parseMileageMiles(car.mileage, settings.distanceUnit)
  if (carMiles != null) carRow.mileageMiles = carMiles
  // salePrice stays a string ('' when blank); the currency tag appears only
  // when it is non-empty.
  if (car.salePrice !== '') carRow.salePriceCurrency = settings.currency
  // Strict null rule (coverPhoto / bannerPhoto may dangle — preserved verbatim).
  if (car.coverPhoto != null) carRow.coverPhoto = car.coverPhoto
  if (car.bannerPhoto != null) carRow.bannerPhoto = car.bannerPhoto
  // DEC-13 VIN: omit iff blank/absent (absent ⇔ ''), so VIN-less cars cost 0 cells.
  if (car.vin != null && car.vin !== '') carRow.vin = car.vin
  // DEC-19 plate: omit iff blank/absent (absent ⇔ ''), exactly like VIN — a
  // plate-less car costs 0 cells.
  if (car.plate != null && car.plate !== '') carRow.plate = car.plate
  // DEC-19 showPlate: owner opt-in; write ONLY when explicitly true so the
  // hidden default (absent ⇔ false) materializes no cell.
  if (car.showPlate === true) carRow.showPlate = true

  const photos: Record<string, PhotosRow> = {}
  const photoPayloads: Record<string, string> = {}
  for (const photo of car.photos) {
    // Metadata only — dataUrl goes in the side map, never in a cell.
    const photoRow: PhotosRow = {
      carId: car.id,
      caption: photo.caption,
      uploadedAt: photo.uploadedAt,
    }
    // DEC-6: omit `source` for General (absent ⇔ 'car') to save the common-case
    // cell; `sourceId` is the source of truth, written iff the photo is attached.
    if (photo.source != null && photo.source !== 'car') photoRow.source = photo.source
    if (photo.sourceId != null) photoRow.sourceId = photo.sourceId
    photos[photo.id] = photoRow
    photoPayloads[photo.id] = photo.dataUrl
  }

  const wishlist: Record<string, WishlistRow> = {}
  for (const item of car.wishlist) {
    const row: WishlistRow = {
      carId: car.id,
      name: item.name,
      link: item.link,
      category: item.category,
      notes: item.notes,
      status: item.status,
      addedAt: item.addedAt,
    }
    if (item.price != null) {
      row.price = item.price // 0 is a real price — written explicitly
      row.priceCurrency = settings.currency
    }
    wishlist[item.id] = row
  }

  const mods: Record<string, ModsRow> = {}
  for (const mod of car.mods) {
    const row: ModsRow = {
      carId: car.id,
      name: mod.name,
      category: mod.category,
      description: mod.description,
      installedDate: mod.installedDate,
      shop: mod.shop,
      link: mod.link,
      addedAt: mod.addedAt,
    }
    if (mod.cost != null) {
      row.cost = mod.cost
      row.costCurrency = settings.currency
    }
    mods[mod.id] = row
  }

  const maintenance: Record<string, MaintenanceRow> = {}
  for (const rec of car.maintenance) {
    const row: MaintenanceRow = {
      carId: car.id,
      service: rec.service,
      date: rec.date,
      shop: rec.shop,
      notes: rec.notes,
      nextDueDate: rec.nextDueDate,
      nextDueMileageRaw: rec.nextDueMileage,
      createdAt: rec.createdAt,
    }
    // maintenance.mileage is string | null — null and '' are distinct
    // round-trippable states: omit the cell iff null, write '' explicitly.
    if (rec.mileage != null) {
      row.mileageRaw = rec.mileage
      const miles = parseMileageMiles(rec.mileage, settings.distanceUnit)
      if (miles != null) row.mileageMiles = miles
    }
    if (rec.cost != null) {
      row.cost = rec.cost
      row.costCurrency = settings.currency
    }
    const nextDueMiles = parseMileageMiles(rec.nextDueMileage, settings.distanceUnit)
    if (nextDueMiles != null) row.nextDueMileageMiles = nextDueMiles
    maintenance[rec.id] = row
  }

  const todos: Record<string, TodosRow> = {}
  for (const todo of car.todos) {
    todos[todo.id] = {
      carId: car.id,
      text: todo.text,
      priority: todo.priority,
      done: todo.done, // false is a real value — written explicitly
      createdAt: todo.createdAt,
    }
  }

  const issues: Record<string, IssuesRow> = {}
  for (const issue of car.issues) {
    const row: IssuesRow = {
      carId: car.id,
      title: issue.title,
      description: issue.description,
      severity: issue.severity,
      status: issue.status,
      createdAt: issue.createdAt,
    }
    if (issue.resolvedAt != null) row.resolvedAt = issue.resolvedAt
    issues[issue.id] = row
  }

  // DEC-16: each check-in freezes its OWN entry unit, so valueMiles canonicalizes
  // from (valueRaw, checkIn.unit) — NOT the device distanceUnit. Present iff the
  // raw parses numerically (parity with cars/maintenance mileageMiles).
  const mileage: Record<string, MileageRow> = {}
  for (const checkIn of car.mileageLog ?? []) {
    const row: MileageRow = {
      carId: car.id,
      valueRaw: checkIn.value,
      unit: checkIn.unit,
      date: checkIn.date,
      source: checkIn.source,
      createdAt: checkIn.createdAt,
    }
    const miles = parseMileageMiles(checkIn.value, checkIn.unit)
    if (miles != null) row.valueMiles = miles
    mileage[checkIn.id] = row
  }

  return {
    carId: car.id,
    car: carRow,
    photos,
    wishlist,
    mods,
    maintenance,
    todos,
    issues,
    mileage,
    photoPayloads,
  }
}

/**
 * Reassemble the nested Car from one car's table rows. Absent cells map to
 * null per the strict null rule. Child arrays come back in Record insertion
 * order (which preserves the original order for a flattenCar round trip; rows
 * read from a synced store should be ordered by their timestamp cells before
 * display). A photo whose payload is missing from the side map (e.g. an
 * R2-backed photo after M3) gets dataUrl '' — callers resolve display from
 * r2Key in that case.
 */
export function joinCar(flat: FlattenedCar): Car {
  const photos: Photo[] = Object.entries(flat.photos).map(([id, row]) => {
    const photo: Photo = {
      id,
      dataUrl: flat.photoPayloads[id] ?? '',
      caption: row.caption,
      uploadedAt: row.uploadedAt,
    }
    // DEC-6: reattach the attach metadata when present (absent ⇔ General).
    if (row.source != null) photo.source = row.source
    if (row.sourceId != null) photo.sourceId = row.sourceId
    return photo
  })

  const wishlist: WishlistItem[] = Object.entries(flat.wishlist).map(([id, row]) => ({
    id,
    name: row.name,
    link: row.link,
    price: row.price ?? null,
    category: row.category,
    notes: row.notes,
    status: row.status,
    addedAt: row.addedAt,
  }))

  const mods: Mod[] = Object.entries(flat.mods).map(([id, row]) => ({
    id,
    name: row.name,
    category: row.category,
    description: row.description,
    cost: row.cost ?? null,
    installedDate: row.installedDate,
    shop: row.shop,
    link: row.link,
    addedAt: row.addedAt,
  }))

  const maintenance: MaintenanceRecord[] = Object.entries(flat.maintenance).map(
    ([id, row]) => ({
      id,
      service: row.service,
      date: row.date,
      mileage: row.mileageRaw ?? null,
      cost: row.cost ?? null,
      shop: row.shop,
      notes: row.notes,
      nextDueDate: row.nextDueDate,
      nextDueMileage: row.nextDueMileageRaw,
      createdAt: row.createdAt,
    }),
  )

  const todos: Todo[] = Object.entries(flat.todos).map(([id, row]) => ({
    id,
    text: row.text,
    priority: row.priority,
    done: row.done,
    createdAt: row.createdAt,
  }))

  const issues: Issue[] = Object.entries(flat.issues).map(([id, row]) => ({
    id,
    title: row.title,
    description: row.description,
    severity: row.severity,
    status: row.status,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? null,
  }))

  // DEC-16: rebuild the timeline. valueMiles is a derived cell (recomputed on
  // flatten), so joinCar drops it — the same lossy treatment as cars.mileageMiles.
  const mileageLog: MileageCheckIn[] = Object.entries(flat.mileage).map(([id, row]) => ({
    id,
    value: row.valueRaw,
    unit: row.unit,
    date: row.date,
    source: row.source,
    createdAt: row.createdAt,
  }))

  const row = flat.car
  const car: Car = {
    id: flat.carId,
    year: row.year,
    make: row.make,
    model: row.model,
    trim: row.trim,
    color: row.color,
    mileage: row.mileageRaw,
    nickname: row.nickname,
    purchaseDate: row.purchaseDate,
    saleDate: row.saleDate,
    status: row.status,
    salePrice: row.salePrice,
    tradeFor: row.tradeFor,
    coverPhoto: row.coverPhoto ?? null,
    createdAt: row.createdAt,
    photos,
    wishlist,
    mods,
    maintenance,
    todos,
    issues,
  }
  // New cells are reattached only when present, so legacy rows (and the existing
  // round-trip fixtures) that lack them join back to an identical nested Car.
  if (row.bannerPhoto != null) car.bannerPhoto = row.bannerPhoto
  if (row.vin != null) car.vin = row.vin
  // DEC-19: reattach plate/showPlate only when present, so legacy rows (and the
  // round-trip fixtures) that lack them join back to an identical nested Car
  // (absent ⇔ '' for plate, absent ⇔ false for showPlate).
  if (row.plate != null) car.plate = row.plate
  if (row.showPlate != null) car.showPlate = row.showPlate
  if (mileageLog.length > 0) car.mileageLog = mileageLog
  return car
}

// ── savedBuilds (DEC-11) — OUTSIDE the Car aggregate ────────
// A SavedBuild is already flat (no children), so it does NOT pass through
// flattenCar/joinCar. This is the trivial identity pair, applying the SAME
// strict null rule: a nullable cell is omitted IFF strictly null/undefined;
// '' / 0 are real, distinct values. The rowId (= sha256(token)) is supplied by
// the (async) save action, not derived here.

export function flattenSavedBuild(build: SavedBuild): SavedBuildRow {
  const row: SavedBuildRow = { token: build.token, savedAt: build.savedAt }
  if (build.nickname != null) row.nickname = build.nickname
  if (build.sortOrder != null) row.sortOrder = build.sortOrder
  if (build.cachedYear != null) row.cachedYear = build.cachedYear
  if (build.cachedMake != null) row.cachedMake = build.cachedMake
  if (build.cachedModel != null) row.cachedModel = build.cachedModel
  if (build.cachedNickname != null) row.cachedNickname = build.cachedNickname
  if (build.cachedOwnerName != null) row.cachedOwnerName = build.cachedOwnerName
  if (build.cachedStatus != null) row.cachedStatus = build.cachedStatus
  if (build.cachedMileageRaw != null) row.cachedMileageRaw = build.cachedMileageRaw
  if (build.cachedModsCount != null) row.cachedModsCount = build.cachedModsCount
  if (build.cachedCoverPhotoId != null) row.cachedCoverPhotoId = build.cachedCoverPhotoId
  if (build.cachedScope != null) row.cachedScope = build.cachedScope
  if (build.lastRefreshedAt != null) row.lastRefreshedAt = build.lastRefreshedAt
  if (build.unavailableSince != null) row.unavailableSince = build.unavailableSince
  return row
}

export function joinSavedBuild(rowId: string, row: SavedBuildRow): SavedBuild {
  return {
    id: rowId,
    token: row.token,
    savedAt: row.savedAt,
    nickname: row.nickname ?? null,
    sortOrder: row.sortOrder ?? null,
    cachedYear: row.cachedYear ?? null,
    cachedMake: row.cachedMake ?? null,
    cachedModel: row.cachedModel ?? null,
    cachedNickname: row.cachedNickname ?? null,
    cachedOwnerName: row.cachedOwnerName ?? null,
    cachedStatus: row.cachedStatus ?? null,
    cachedMileageRaw: row.cachedMileageRaw ?? null,
    cachedModsCount: row.cachedModsCount ?? null,
    cachedCoverPhotoId: row.cachedCoverPhotoId ?? null,
    cachedScope: row.cachedScope ?? null,
    lastRefreshedAt: row.lastRefreshedAt ?? null,
    unavailableSince: row.unavailableSince ?? null,
  }
}
