/**
 * ItemPhotos (DEC-6 inline-on-item) — the "add photo" affordance + a small
 * thumbnail strip of the photos attached to ONE loggable item (mod / maintenance
 * / issue / todo). Adding attaches `source=<kind>`, `sourceId=<rowId>`, so the
 * photo ALSO surfaces in the unified gallery tagged by its source. Photos stay
 * normalized in the single `car.photos` array — an item's photos are DERIVED by
 * filtering on `sourceId` (the source of truth), never duplicated.
 *
 * Reuses the gallery PhotoTile + Lightbox so the inline surface matches the
 * unified gallery exactly. Delete here goes through the same destructive-confirm
 * path; the §15.10 cascade means deleting the parent item re-parents these
 * photos to General rather than destroying their bytes.
 */
import { useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import type { Photo, PhotoSource } from '@chudbox/shared'
import useGarageStore from '../../store/useGarageStore'
import { photosForItem } from '../../utils/photoBuckets'
import ConfirmModal from '../ConfirmModal'
import Modal from '../ui/Modal'
import PhotoTile from './PhotoTile'
import Lightbox from './Lightbox'
import PhotoUploader from './PhotoUploader'
import type { StoredPhoto } from '../../utils/image'

export interface ItemPhotosProps {
  carId: string
  source: Exclude<PhotoSource, 'car'>
  itemId: string
  /** The whole car's joined photos (we derive this item's slice from it). The
   * joined rows are enriched with r2Key at runtime → StoredPhoto. */
  photos: Photo[]
  /** Short item name for accessible labels (e.g. the mod/service/issue title). */
  itemLabel: string
}

export default function ItemPhotos({ carId, source, itemId, photos, itemLabel }: ItemPhotosProps) {
  const addPhoto = useGarageStore((s) => s.addPhoto)
  const deletePhoto = useGarageStore((s) => s.deletePhoto)
  const [adding, setAdding] = useState(false)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [confirmPhoto, setConfirmPhoto] = useState<StoredPhoto | null>(null)

  const attached = photosForItem(photos as StoredPhoto[], itemId)

  const requestDelete = (photo: StoredPhoto) => {
    setLightbox(null)
    setConfirmPhoto(photo)
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {attached.map((photo, i) => (
        <div key={photo.id} className="w-16 shrink-0">
          <PhotoTile
            photo={photo}
            fallbackLabel={`${itemLabel} photo ${i + 1}`}
            onOpen={() => setLightbox(i)}
            onDelete={() => requestDelete(photo)}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={() => setAdding(true)}
        aria-label={`Add a photo to ${itemLabel}`}
        className="flex size-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-text-secondary transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <ImagePlus size={tokens.iconSize.sm} aria-hidden />
        <span className="text-[10px] leading-none">Photo</span>
      </button>

      {adding && (
        <Modal
          open
          onOpenChange={(o) => {
            if (!o) setAdding(false)
          }}
          title={`Add photo to ${itemLabel}`}
          description="It will also appear in the car's Photos gallery, tagged by source."
          size="sm"
        >
          <PhotoUploader
            idPrefix={`item-photo-${itemId}`}
            compact
            ctaLabel="Click to upload"
            onCancel={() => setAdding(false)}
            onSave={(dataUrl, caption) => {
              addPhoto(carId, { dataUrl, caption, source, sourceId: itemId })
              setAdding(false)
            }}
          />
        </Modal>
      )}

      {lightbox != null && attached[lightbox] && (
        <Lightbox
          photos={attached}
          index={lightbox}
          onIndexChange={setLightbox}
          onClose={() => setLightbox(null)}
          actions={(photo) => (
            <button
              type="button"
              onClick={() => requestDelete(photo)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-meta font-semibold text-text-secondary transition-colors hover:border-danger-border hover:text-danger-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Delete photo
            </button>
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
          onConfirm={() => deletePhoto(carId, confirmPhoto.id)}
          onClose={() => setConfirmPhoto(null)}
        />
      )}
    </div>
  )
}
