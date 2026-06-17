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
  Mod,
  Photo,
  Todo,
  WishlistItem,
} from './types'
import type { DistanceUnitCode } from './units'
import type {
  CarsRow,
  IssuesRow,
  MaintenanceRow,
  ModsRow,
  PhotosRow,
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
  // Strict null rule (coverPhoto may also dangle — preserved verbatim).
  if (car.coverPhoto != null) carRow.coverPhoto = car.coverPhoto

  const photos: Record<string, PhotosRow> = {}
  const photoPayloads: Record<string, string> = {}
  for (const photo of car.photos) {
    // Metadata only — dataUrl goes in the side map, never in a cell.
    photos[photo.id] = {
      carId: car.id,
      caption: photo.caption,
      uploadedAt: photo.uploadedAt,
    }
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

  return { carId: car.id, car: carRow, photos, wishlist, mods, maintenance, todos, issues, photoPayloads }
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
  const photos: Photo[] = Object.entries(flat.photos).map(([id, row]) => ({
    id,
    dataUrl: flat.photoPayloads[id] ?? '',
    caption: row.caption,
    uploadedAt: row.uploadedAt,
  }))

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

  const row = flat.car
  return {
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
}
