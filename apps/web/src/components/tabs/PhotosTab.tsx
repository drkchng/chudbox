/**
 * PhotosTab (DEC-6) — ONE unified gallery of all the car's photos, filterable by
 * source (General · Mods · Maintenance · Issues · Todos). Bucketing is by the
 * RESOLVED parent (§15.2 coherence rule: `sourceId` resolution, never the raw
 * `source` hint). Each tile is a real <button> with PERSISTENT cover/banner/
 * delete actions (A3) and opens a keyboard-operable Lightbox (A15). The
 * cover/banner pickers (DEC-6) let any photo become the CarCard cover or the
 * CarHero banner.
 */
import { useMemo, useState } from 'react'
import { Star, Image as ImageIcon, Trash2 } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import type { PhotoSource } from '@chudbox/shared'
import useGarageStore, { useSyncStatus } from '../../store/useGarageStore'
import { hasCloudCopy } from '../../utils/image'
import {
  SOURCE_BADGE,
  SOURCE_LABEL,
  buildItemKindMap,
  resolvedSource,
} from '../../utils/photoBuckets'
import ConfirmModal from '../ConfirmModal'
import Button from '../ui/Button'
import PhotoTile from '../photos/PhotoTile'
import PhotoUploader from '../photos/PhotoUploader'
import Lightbox from '../photos/Lightbox'
import type { Car } from '../../types'
import type { StoredPhoto } from '../../utils/image'

interface PhotosTabProps {
  car: Car
}

type Filter = 'all' | PhotoSource
// General always shown; the item buckets appear as chips only when non-empty.
const ITEM_FILTERS: PhotoSource[] = ['mod', 'maintenance', 'issue', 'todo']

export default function PhotosTab({ car }: PhotosTabProps) {
  const addPhoto = useGarageStore((s) => s.addPhoto)
  const deletePhoto = useGarageStore((s) => s.deletePhoto)
  const setCoverPhoto = useGarageStore((s) => s.setCoverPhoto)
  const setBannerPhoto = useGarageStore((s) => s.setBannerPhoto)
  // 'idle' ⇒ logged out; any other status ⇒ an account is active, so a photo
  // without an R2 copy yet is awaiting upload (vs. just being a local photo).
  const accountActive = useSyncStatus() !== 'idle'

  const [filter, setFilter] = useState<Filter>('all')
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [confirmPhoto, setConfirmPhoto] = useState<StoredPhoto | null>(null)

  const photos = car.photos as StoredPhoto[]

  // Resolve each photo's effective parent (§15.2) once, and tally per bucket.
  const { bucketOf, counts } = useMemo(() => {
    const kindMap = buildItemKindMap(car)
    const bucketOf = new Map<string, PhotoSource>()
    const counts: Record<PhotoSource, number> = { car: 0, mod: 0, maintenance: 0, issue: 0, todo: 0 }
    for (const p of photos) {
      const b = resolvedSource(p, kindMap)
      bucketOf.set(p.id, b)
      counts[b] += 1
    }
    return { bucketOf, counts }
  }, [car, photos])

  const filtered =
    filter === 'all' ? photos : photos.filter((p) => bucketOf.get(p.id) === filter)

  const selectFilter = (next: Filter) => {
    setLightbox(null) // a stale index across a different list would mis-point
    setFilter(next)
  }

  const requestDelete = (photo: StoredPhoto) => {
    setLightbox(null)
    setConfirmPhoto(photo)
  }

  // Chips: All + General always; item buckets only when they hold photos.
  const chips: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: photos.length },
    { id: 'car', label: SOURCE_LABEL.car, count: counts.car },
    ...ITEM_FILTERS.filter((s) => counts[s] > 0).map((s) => ({
      id: s as Filter,
      label: SOURCE_LABEL[s],
      count: counts[s],
    })),
  ]

  return (
    <div>
      {/* Add a General photo. */}
      <div className="card mb-6">
        <h3 className="mb-4 text-subhead font-semibold text-text-primary">Add photo</h3>
        <PhotoUploader idPrefix="general-photo" onSave={(dataUrl, caption) => addPhoto(car.id, { dataUrl, caption })} />
      </div>

      {photos.length === 0 ? (
        <p className="py-10 text-center text-text-secondary">No photos yet.</p>
      ) : (
        <>
          {/* Source filter (only shown when there is something to filter). */}
          {chips.length > 2 && (
            <div role="group" aria-label="Filter photos by source" className="mb-4 flex flex-wrap gap-2">
              {chips.map(({ id, label, count }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectFilter(id)}
                  aria-pressed={filter === id}
                  className={`tab-btn ${filter === id ? 'tab-active' : 'tab-inactive'}`}
                >
                  {label} ({count})
                </button>
              ))}
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="py-10 text-center text-text-secondary">No photos in this category.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {filtered.map((photo, i) => {
                const bucket = bucketOf.get(photo.id) ?? 'car'
                return (
                  <PhotoTile
                    key={photo.id}
                    photo={photo}
                    fallbackLabel={`Photo ${i + 1}`}
                    onOpen={() => setLightbox(i)}
                    isCover={car.coverPhoto === photo.id}
                    isBanner={car.bannerPhoto === photo.id}
                    isLocal={accountActive && !hasCloudCopy(photo)}
                    attachBadge={bucket !== 'car' ? SOURCE_BADGE[bucket] : undefined}
                    onSetCover={() => setCoverPhoto(car.id, photo.id)}
                    onSetBanner={() => setBannerPhoto(car.id, photo.id)}
                    onDelete={() => requestDelete(photo)}
                  />
                )
              })}
            </div>
          )}
        </>
      )}

      {lightbox != null && filtered[lightbox] && (
        <Lightbox
          photos={filtered}
          index={lightbox}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(null)}
          actions={(photo) => (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={car.coverPhoto === photo.id}
                onClick={() => setCoverPhoto(car.id, photo.id)}
              >
                <Star size={tokens.iconSize.sm} /> {car.coverPhoto === photo.id ? 'Cover' : 'Set as cover'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={car.bannerPhoto === photo.id}
                onClick={() => setBannerPhoto(car.id, photo.id)}
              >
                <ImageIcon size={tokens.iconSize.sm} /> {car.bannerPhoto === photo.id ? 'Banner' : 'Set as banner'}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => requestDelete(photo)}>
                <Trash2 size={tokens.iconSize.sm} /> Delete
              </Button>
            </>
          )}
        />
      )}

      {confirmPhoto && (
        <ConfirmModal
          title="Delete photo?"
          message={
            confirmPhoto.caption
              ? `"${confirmPhoto.caption}" will be permanently deleted.`
              : 'This photo will be permanently deleted.'
          }
          onConfirm={() => deletePhoto(car.id, confirmPhoto.id)}
          onClose={() => setConfirmPhoto(null)}
        />
      )}
    </div>
  )
}
