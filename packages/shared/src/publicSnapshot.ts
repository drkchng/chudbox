// Public share-link curation (BACKEND_PLAN.md "Share-links"; milestone M4).
//
// SECURITY CRUX — this is a strict, EXPLICIT ALLOWLIST (deny-by-default). A
// field reaches the public snapshot IFF it is named below; anything added to
// the domain model later stays private automatically. We NEVER spread the whole
// car/row and then delete the secrets — that pattern leaks every field someone
// forgets to delete. Every output object here is built key-by-key.
//
// The public snapshot is the owner's curated "build showcase". It MUST NOT
// contain any of: a money amount or *Currency tag, a shop, a notes field, any
// wishlist / issues / todos data, tradeFor, salePrice, a raw r2Key, or a base64
// dataUrl. (Exhaustively asserted in publicSnapshot.test.ts.)
//
// Photos carry only photoId + caption (+ optional downscaled width/height). The
// token-scoped image URL is NOT baked in here (this module is pure and has no
// token): the public viewer derives it from the photoId via
// `shareImgPath(token, photoId)` (contracts.ts) using the token already in its
// own route. So a raw r2Key / owner-only /img path never leaves the server.
//
// RN-safe: pure data mapping, no DOM/Node imports. Reuses parseMileageMiles
// (flatten.ts) rather than reimplementing the distance parse.
import type {
  Car,
  CarStatus,
  IssueSeverity,
  IssueStatus,
  Photo,
  TodoPriority,
  WishlistStatus,
} from './types'
import type { GarageValues } from './schema'
import { parseMileageMiles } from './flatten'

/**
 * Which view a share link grants, chosen by the AUTHENTICATED owner at create
 * time and STORED on the share_links row. The public route builds the snapshot
 * strictly from the stored scope — never from any client-supplied value.
 *
 *  • 'curated' — the default build showcase (this module's strict allowlist:
 *    no money/shop/notes, no wishlist/todos/issues, no salePrice/tradeFor, no VIN).
 *  • 'listing' — For-Sale preset (DEC-14): the curated showcase PLUS
 *    salePrice/salePriceCurrency/tradeFor and the listing-only VIN (DEC-13).
 *    Still NO wishlist/todos/issues, NO per-item cost/shop/notes.
 *  • 'full'    — everything the owner sees for THAT ONE car, READ-ONLY: the
 *    extra tables (wishlist/todos/issues) and the previously-withheld
 *    cost/shop/notes/salePrice/tradeFor. NO VIN (listing-only, §14.2). Still NO
 *    raw r2Key (photos use token-scoped urls), NO userId/email, NO other cars,
 *    NO internal row ids beyond the photoIds curated already exposes.
 *
 * The scopes are CROSS-CUTTING, not a chain: `vin` is listing-only (not in
 * full); wishlist/todos/issues + per-item cost/shop/notes are full-only (not in
 * listing). So curated ⊂ listing and curated ⊂ full, but listing ⊄ full and
 * full ⊄ listing (§15.7).
 */
export type ShareScope = 'curated' | 'listing' | 'full'

// ── Builder input ───────────────────────────────────────────
// The nested `Car` aggregate (flatten.ts: joinCar) drops the per-photo
// downscaled dimensions — they live on the synced `photos` row (PhotosRow),
// not on the lossy nested `Photo`. The DO snapshot RPC has the row, so the
// builder accepts an input photo that MAY carry width/height. A plain `Car`
// (no dims) is still accepted, because width/height are optional here.

/** Per-photo curator input: the nested Photo, optionally with row dimensions. */
export interface SnapshotPhotoInput extends Photo {
  width?: number | null
  height?: number | null
}

/** Curator input: a nested Car whose photos may carry downscaled dimensions.
 * `salePriceCurrency` is re-attached from the flat `cars` row by the DO (joinCar
 * drops the per-row tag, exactly like the photo dims) so listing AND full render
 * the price in its ENTERED currency, not the viewer's settings.currency (DEC-1). */
export interface SnapshotCarInput extends Omit<Car, 'photos'> {
  photos: SnapshotPhotoInput[]
  salePriceCurrency?: string | null
}

// ── Public (allowlisted) snapshot shape ─────────────────────

/** A curated photo: NO r2Key, NO dataUrl, NO token URL (viewer derives it). */
export interface PublicPhoto {
  photoId: string
  caption: string
  width?: number
  height?: number
}

/** A curated mod: build-relevant fields only — NO cost/costCurrency/shop/notes. */
export interface PublicMod {
  name: string
  category: string
  description: string
  installedDate: string
  link: string
  addedAt: string
}

/** A curated maintenance record — NO cost/costCurrency/shop/notes. */
export interface PublicMaintenance {
  service: string
  date: string
  /** Present iff the source mileage was non-null (free text; '' is a real value). */
  mileageRaw?: string
  /** Present iff mileageRaw parses numerically. */
  mileageMiles?: number
  nextDueDate?: string
  nextDueMileageRaw?: string
  nextDueMileageMiles?: number
  createdAt: string
}

/** Display-only settings: theme + distance unit. Currency is EXCLUDED (no money shown). */
export interface PublicSettings {
  themeId: string
  customAccent?: string
  distanceUnit: GarageValues['distanceUnit']
}

/** The read-only build showcase served by the public share route. */
export interface PublicCarSnapshot {
  year: string
  make: string
  model: string
  trim: string
  color: string
  nickname: string
  /**
   * DEC-10 owner display name (= user.name). Injected by the share ROUTE (not
   * the DO builders — the name + consent live in D1, unreachable from the DO),
   * iff user.show_owner_name && name !== ''. Inherited by Listing/Full. Absent
   * ⇒ no name.
   */
  ownerName?: string
  /**
   * DEC-19 license plate — OWNER-OPT-IN, exposed on ALL scopes (curated/listing/
   * full) IFF car.showPlate is true (inverse of VIN's purpose-gating). Present
   * here on the BASE snapshot so Listing/Full inherit it. Absent ⇒ no plate (the
   * owner did not opt in, or the plate is blank). DELIBERATELY NOT in the OG
   * projection (kept minimal/clean).
   */
  plate?: string
  mileageRaw: string
  /** Present iff mileageRaw parses numerically. */
  mileageMiles?: number
  status: CarStatus
  purchaseDate?: string
  saleDate?: string
  createdAt: string
  /**
   * photoId of the cover (resolved with fallback: cover → first photo → none).
   * The viewer builds the image via shareImgPath(token, coverPhotoId). Omitted
   * when the car has no photos.
   */
  coverPhotoId?: string
  photos: PublicPhoto[]
  mods: PublicMod[]
  maintenance: PublicMaintenance[]
  settings: PublicSettings
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Curate one car into its public showcase snapshot — strict allowlist,
 * deny-by-default. `settings` is the synced GarageValues; only themeId,
 * customAccent and distanceUnit are exposed (currency is never shown).
 */
export function buildPublicSnapshot(
  car: SnapshotCarInput,
  settings: GarageValues,
): PublicCarSnapshot {
  // Photos: photoId + caption (+ optional dims). dataUrl / r2Key never copied.
  const photos: PublicPhoto[] = car.photos.map((photo) => {
    const out: PublicPhoto = { photoId: photo.id, caption: photo.caption }
    if (isFiniteNumber(photo.width)) out.width = photo.width
    if (isFiniteNumber(photo.height)) out.height = photo.height
    return out
  })

  // Cover photo resolve-with-fallback (the soft pointer can dangle after a
  // merge): use it iff it resolves to a real photo, else the first photo, else
  // none (viewer shows a placeholder).
  let coverPhotoId: string | undefined
  if (car.coverPhoto != null && car.photos.some((p) => p.id === car.coverPhoto)) {
    coverPhotoId = car.coverPhoto
  } else if (car.photos.length > 0) {
    coverPhotoId = car.photos[0].id
  }

  const mods: PublicMod[] = car.mods.map((mod) => ({
    name: mod.name,
    category: mod.category,
    description: mod.description,
    installedDate: mod.installedDate,
    link: mod.link,
    addedAt: mod.addedAt,
  }))

  const maintenance: PublicMaintenance[] = car.maintenance.map((rec) => {
    const out: PublicMaintenance = {
      service: rec.service,
      date: rec.date,
      createdAt: rec.createdAt,
    }
    // source mileage is string | null — omit iff null, '' is a real value.
    if (rec.mileage != null) {
      out.mileageRaw = rec.mileage
      const miles = parseMileageMiles(rec.mileage, settings.distanceUnit)
      if (miles != null) out.mileageMiles = miles
    }
    if (rec.nextDueDate !== '') out.nextDueDate = rec.nextDueDate
    if (rec.nextDueMileage !== '') {
      out.nextDueMileageRaw = rec.nextDueMileage
      const nextMiles = parseMileageMiles(rec.nextDueMileage, settings.distanceUnit)
      if (nextMiles != null) out.nextDueMileageMiles = nextMiles
    }
    return out
  })

  const publicSettings: PublicSettings = {
    themeId: settings.themeId,
    distanceUnit: settings.distanceUnit,
  }
  if (settings.customAccent != null && settings.customAccent !== '') {
    publicSettings.customAccent = settings.customAccent
  }

  const snapshot: PublicCarSnapshot = {
    year: car.year,
    make: car.make,
    model: car.model,
    trim: car.trim,
    color: car.color,
    nickname: car.nickname,
    mileageRaw: car.mileage,
    status: car.status,
    createdAt: car.createdAt,
    photos,
    mods,
    maintenance,
    settings: publicSettings,
  }
  const carMiles = parseMileageMiles(car.mileage, settings.distanceUnit)
  if (carMiles != null) snapshot.mileageMiles = carMiles
  if (car.purchaseDate !== '') snapshot.purchaseDate = car.purchaseDate
  if (car.saleDate !== '') snapshot.saleDate = car.saleDate
  if (coverPhotoId !== undefined) snapshot.coverPhotoId = coverPhotoId
  // DEC-19 plate — OWNER-OPT-IN exposure, on EVERY scope (this curated base is
  // reused byte-for-byte by buildListingSnapshot/buildFullSnapshot). Same strict,
  // key-by-key allowlist as VIN: the plate cell is read ONLY when the owner
  // toggled `showPlate` on AND the plate is non-empty. showPlate false/absent ⇒
  // the field is never named ⇒ deny-by-default keeps it private. (Never reaches
  // the OG projection, which reads its own fixed eight-field allowlist.)
  if (car.showPlate === true && car.plate != null && car.plate !== '') {
    snapshot.plate = car.plate
  }
  return snapshot
}

// ── Full (owner-equivalent, READ-ONLY) snapshot shape ───────
// The 'full' scope is STILL a strict, key-by-key allowlist — it just allows
// MORE than curated. The deny-by-default discipline is unchanged: every output
// object below is built field-by-field, never spread-and-delete, so a field
// added to the domain model later stays private until it is named here. What
// 'full' adds over curated: the previously-withheld money/shop/notes on
// mods+maintenance, the wishlist/todos/issues tables, salePrice/tradeFor, and
// the display currency. What it STILL withholds (same as curated): raw r2Key /
// dataUrl on photos, userId/email, and every internal row id beyond photoId.

/** A full mod — curated fields PLUS the owner-only cost/shop (omitted when blank). */
export interface FullMod extends PublicMod {
  /** Present iff the source cost was a finite number. */
  cost?: number
  /** Present iff non-empty. */
  shop?: string
}

/** A full maintenance record — curated fields PLUS cost/shop/notes (omitted when blank). */
export interface FullMaintenance extends PublicMaintenance {
  cost?: number
  shop?: string
  notes?: string
}

/** A full wishlist item — NO internal id; price omitted when null. */
export interface FullWishlistItem {
  name: string
  link: string
  /** Present iff the source price was a finite number. */
  price?: number
  category: string
  notes: string
  status: WishlistStatus
  addedAt: string
}

/** A full todo — NO internal id. */
export interface FullTodo {
  text: string
  priority: TodoPriority
  done: boolean
  createdAt: string
}

/** A full issue — NO internal id; resolvedAt omitted when absent/blank. */
export interface FullIssue {
  title: string
  description: string
  severity: IssueSeverity
  status: IssueStatus
  createdAt: string
  resolvedAt?: string
}

/** Full display settings: curated settings PLUS the display currency (money IS shown here). */
export interface FullSettings extends PublicSettings {
  /** ISO-4217 code the owner enters amounts in (used to format the now-visible money). */
  currency: string
}

/**
 * The read-only FULL view of one car: everything the owner sees for THAT car.
 * Extends the curated showcase (same car header / photos / cover / mileage) and
 * widens mods/maintenance/settings, adding the extra tables + salePrice/tradeFor.
 */
export interface FullCarSnapshot
  extends Omit<PublicCarSnapshot, 'mods' | 'maintenance' | 'settings'> {
  /** Present iff non-empty. */
  salePrice?: string
  /** ISO-4217 tag (DEC-1 fidelity in full too, review fix #5): present iff salePrice is. */
  salePriceCurrency?: string
  /** Present iff non-empty. */
  tradeFor?: string
  mods: FullMod[]
  maintenance: FullMaintenance[]
  wishlist: FullWishlistItem[]
  todos: FullTodo[]
  issues: FullIssue[]
  settings: FullSettings
}

/**
 * Build the FULL read-only snapshot of one car (the 'full' scope). Reuses
 * buildPublicSnapshot for everything curated already emits (car header, photos,
 * cover/mileage derivation, the curated mod/maintenance fields) so the shared
 * fields stay byte-identical to the curated path, then layers the owner-only
 * fields on top — each added key-by-key under the same strict allowlist.
 *
 * The curated base's mods/maintenance arrays are built by mapping car.mods /
 * car.maintenance in order, so base.mods[i] / base.maintenance[i] line up with
 * car.mods[i] / car.maintenance[i] — we reuse that derived shape and only
 * append the extra cells, never re-deriving (and never regressing) the curated
 * fields. Raw r2Key / dataUrl / userId / row ids are never read here.
 */
export function buildFullSnapshot(
  car: SnapshotCarInput,
  settings: GarageValues,
): FullCarSnapshot {
  const base = buildPublicSnapshot(car, settings)

  const mods: FullMod[] = base.mods.map((mod, i) => {
    const out: FullMod = { ...mod }
    const source = car.mods[i]
    if (isFiniteNumber(source.cost)) out.cost = source.cost
    if (source.shop !== '') out.shop = source.shop
    return out
  })

  const maintenance: FullMaintenance[] = base.maintenance.map((rec, i) => {
    const out: FullMaintenance = { ...rec }
    const source = car.maintenance[i]
    if (isFiniteNumber(source.cost)) out.cost = source.cost
    if (source.shop !== '') out.shop = source.shop
    if (source.notes !== '') out.notes = source.notes
    return out
  })

  const wishlist: FullWishlistItem[] = car.wishlist.map((item) => {
    const out: FullWishlistItem = {
      name: item.name,
      link: item.link,
      category: item.category,
      notes: item.notes,
      status: item.status,
      addedAt: item.addedAt,
    }
    if (isFiniteNumber(item.price)) out.price = item.price
    return out
  })

  const todos: FullTodo[] = car.todos.map((todo) => ({
    text: todo.text,
    priority: todo.priority,
    done: todo.done,
    createdAt: todo.createdAt,
  }))

  const issues: FullIssue[] = car.issues.map((issue) => {
    const out: FullIssue = {
      title: issue.title,
      description: issue.description,
      severity: issue.severity,
      status: issue.status,
      createdAt: issue.createdAt,
    }
    if (issue.resolvedAt != null && issue.resolvedAt !== '') out.resolvedAt = issue.resolvedAt
    return out
  })

  const fullSettings: FullSettings = { ...base.settings, currency: settings.currency }

  const snapshot: FullCarSnapshot = {
    ...base,
    mods,
    maintenance,
    wishlist,
    todos,
    issues,
    settings: fullSettings,
  }
  if (car.salePrice !== '') {
    snapshot.salePrice = car.salePrice
    // DEC-1 fidelity: tag with the ENTERED currency (re-attached by the DO from
    // the flat row) so the viewer formats it correctly, not against its own setting.
    if (car.salePriceCurrency != null && car.salePriceCurrency !== '') {
      snapshot.salePriceCurrency = car.salePriceCurrency
    }
  }
  if (car.tradeFor !== '') snapshot.tradeFor = car.tradeFor
  return snapshot
}

// ── Listing (For-Sale) snapshot shape — the THIRD scope (DEC-14) ─────────────
// Still a strict, key-by-key allowlist: the curated showcase PLUS the four
// listing fields (salePrice + its currency tag, tradeFor, and the listing-only
// VIN). Withholds EVERYTHING full adds beyond curated (wishlist/todos/issues,
// per-item cost/shop/notes, the currency setting) — listing ⊄ full and full ⊄
// listing. NO photo source/sourceId, NO r2Key/dataUrl/userId/internal ids.

/**
 * The For-Sale read-only view of one car: the curated showcase + the buyer-facing
 * listing fields. `vin` appears HERE and ONLY here (never in full — a forwarded
 * "show-a-friend" full link must not carry a fraud-enabling identifier, §14.2).
 */
export interface ListingCarSnapshot extends PublicCarSnapshot {
  /** Present iff non-empty. */
  salePrice?: string
  /** ISO-4217 tag: present iff salePrice is. */
  salePriceCurrency?: string
  /** Present iff non-empty. */
  tradeFor?: string
  /** DEC-13 VIN — listing-only; present iff non-empty. */
  vin?: string
}

/**
 * Build the For-Sale listing snapshot (the 'listing' scope). Reuses
 * buildPublicSnapshot for the byte-identical curated base (like buildFullSnapshot),
 * then appends salePrice/salePriceCurrency/tradeFor/vin key-by-key under the same
 * strict allowlist. The full owner-only tables/fields are deliberately NOT added.
 */
export function buildListingSnapshot(
  car: SnapshotCarInput,
  settings: GarageValues,
): ListingCarSnapshot {
  const base = buildPublicSnapshot(car, settings)
  const snapshot: ListingCarSnapshot = { ...base }
  if (car.salePrice !== '') {
    snapshot.salePrice = car.salePrice
    if (car.salePriceCurrency != null && car.salePriceCurrency !== '') {
      snapshot.salePriceCurrency = car.salePriceCurrency
    }
  }
  if (car.tradeFor !== '') snapshot.tradeFor = car.tradeFor
  if (car.vin != null && car.vin !== '') snapshot.vin = car.vin
  return snapshot
}

// ── OG / link-preview projection (review fix #1 — SECURITY-SENSITIVE) ────────
// The Open Graph crawler path is the highest-exposure surface (crawler-cached,
// fetched with NO session). It must NEVER receive a vin-/notes-/wishlist-bearing
// snapshot object. This is the DEDICATED minimal projection: a CLOSED shape that
// by construction holds ONLY these eight fields — no `vin`, no per-item data, no
// photos array, no settings. Built key-by-key from a CURATED snapshot (which is
// itself vin-/price-free), so the structural guarantee is preserved, not
// downgraded to renderer discipline.

export interface ShareOgProjection {
  year: string
  make: string
  model: string
  nickname: string
  /** For-Sale preview price (Phase 3 supplies it; never read from a vin-bearing object). */
  salePrice?: string
  salePriceCurrency?: string
  /** Resolved cover photoId (already cover → first → none in the curated base). */
  coverPhotoId?: string
  /** DEC-10 owner name, consent-gated, route-injected. */
  ownerName?: string
}

/**
 * Down-project a CURATED snapshot to the minimal OG projection. Reads ONLY the
 * eight allowlisted fields — `vin` and every full/listing-only field are absent
 * by construction (the function never reads them). Optional `salePrice`/
 * `salePriceCurrency`/`ownerName` are supplied by the caller (route), not lifted
 * from a private-bearing object.
 */
export function buildShareOgProjection(
  snapshot: PublicCarSnapshot,
  extra: { salePrice?: string; salePriceCurrency?: string; ownerName?: string } = {},
): ShareOgProjection {
  const out: ShareOgProjection = {
    year: snapshot.year,
    make: snapshot.make,
    model: snapshot.model,
    nickname: snapshot.nickname,
  }
  if (snapshot.coverPhotoId !== undefined) out.coverPhotoId = snapshot.coverPhotoId
  if (extra.salePrice !== undefined && extra.salePrice !== '') out.salePrice = extra.salePrice
  if (extra.salePriceCurrency !== undefined && extra.salePriceCurrency !== '') {
    out.salePriceCurrency = extra.salePriceCurrency
  }
  const ownerName = extra.ownerName ?? snapshot.ownerName
  if (ownerName !== undefined && ownerName !== '') out.ownerName = ownerName
  return out
}
