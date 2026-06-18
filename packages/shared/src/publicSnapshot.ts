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
import type { Car, CarStatus, Photo } from './types'
import type { GarageValues } from './schema'
import { parseMileageMiles } from './flatten'

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

/** Curator input: a nested Car whose photos may carry downscaled dimensions. */
export interface SnapshotCarInput extends Omit<Car, 'photos'> {
  photos: SnapshotPhotoInput[]
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
  return snapshot
}
