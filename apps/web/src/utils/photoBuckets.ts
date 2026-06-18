/**
 * DEC-6 unified-photos read helpers (§15.2 coherence rule + cover/banner
 * resolution). Pure functions, unit-tested, shared by the gallery, the inline
 * per-item strips, CarHero (banner) and CarCard (cover).
 *
 * THE coherence rule: the effective parent of a photo (its gallery bucket) is
 * derived PURELY from `sourceId` resolution — `source` is an advisory cached
 * hint that is NEVER consulted for filing (two independently-merged cells can
 * diverge under per-cell LWW). A `sourceId` that resolves to a live, same-car
 * loggable item → that item's kind; absent or dangling → 'car' (General).
 */
import type { Car, Photo, PhotoSource } from '@chudbox/shared'

/** The gallery source filters. 'car' = General; the rest map 1:1 to tables. */
export const PHOTO_SOURCES: readonly PhotoSource[] = ['car', 'mod', 'maintenance', 'issue', 'todo']

/** Plural filter label (the chip in the unified gallery). */
export const SOURCE_LABEL: Record<PhotoSource, string> = {
  car: 'General',
  mod: 'Mods',
  maintenance: 'Maintenance',
  issue: 'Issues',
  todo: 'Todos',
}

/** Singular badge label shown on an item-attached tile in the unified gallery. */
export const SOURCE_BADGE: Record<PhotoSource, string> = {
  car: 'General',
  mod: 'Mod',
  maintenance: 'Maintenance',
  issue: 'Issue',
  todo: 'To-do',
}

type ItemBearingCar = Pick<Car, 'mods' | 'maintenance' | 'issues' | 'todos'>

/**
 * Map every loggable item's rowId → its kind, so a photo's `sourceId` resolves
 * to a live, same-car parent in O(1). Ids are globally-unique UUIDs, so the kind
 * is unambiguous.
 */
export function buildItemKindMap(car: ItemBearingCar): Map<string, PhotoSource> {
  const m = new Map<string, PhotoSource>()
  for (const x of car.mods) m.set(x.id, 'mod')
  for (const x of car.maintenance) m.set(x.id, 'maintenance')
  for (const x of car.issues) m.set(x.id, 'issue')
  for (const x of car.todos) m.set(x.id, 'todo')
  return m
}

/**
 * Resolve a photo's effective parent (its gallery bucket) per §15.2: from
 * `sourceId` only. Absent/dangling/empty `sourceId` → 'car' (General). `source`
 * is intentionally ignored.
 */
export function resolvedSource(
  photo: Pick<Photo, 'sourceId'>,
  kindMap: Map<string, PhotoSource>,
): PhotoSource {
  if (photo.sourceId == null || photo.sourceId === '') return 'car'
  return kindMap.get(photo.sourceId) ?? 'car'
}

/** Photos attached to ONE item (sourceId is the source of truth, not `source`). */
export function photosForItem<T extends Pick<Photo, 'sourceId'>>(photos: T[], itemId: string): T[] {
  return photos.filter((p) => p.sourceId === itemId)
}

type CoverCar<P> = { photos: P[]; coverPhoto?: string | null }
type BannerCar<P> = CoverCar<P> & { bannerPhoto?: string | null }

/**
 * Cover resolution (CarCard): coverPhoto → first photo → none. The soft pointer
 * may dangle after a merge, so it is resolved-with-fallback, never assumed.
 */
export function resolveCoverPhoto<P extends { id: string }>(car: CoverCar<P>): P | undefined {
  return car.photos.find((p) => p.id === car.coverPhoto) ?? car.photos[0]
}

/**
 * Banner resolution (CarHero / DEC-8 hero): bannerPhoto → coverPhoto → first →
 * none. Both pointers are soft and may dangle, so each step falls through.
 */
export function resolveBannerPhoto<P extends { id: string }>(car: BannerCar<P>): P | undefined {
  return (
    car.photos.find((p) => p.id === car.bannerPhoto) ??
    car.photos.find((p) => p.id === car.coverPhoto) ??
    car.photos[0]
  )
}
