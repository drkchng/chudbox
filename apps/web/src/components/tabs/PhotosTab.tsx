import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Upload, Star, Trash2, X, CloudOff } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import useGarageStore, { useSyncStatus } from '../../store/useGarageStore'
import { hasCloudCopy, resolvePhotoSrc } from '../../utils/image'
import ConfirmModal from '../ConfirmModal'
import Button from '../ui/Button'
import IconButton from '../ui/IconButton'
import type { Car, Photo } from '../../types'

interface PhotosTabProps {
  car: Car
}

export default function PhotosTab({ car }: PhotosTabProps) {
  const addPhoto = useGarageStore((s) => s.addPhoto)
  const deletePhoto = useGarageStore((s) => s.deletePhoto)
  const setCoverPhoto = useGarageStore((s) => s.setCoverPhoto)
  // 'idle' ⇒ logged out; any other status ⇒ an account is active, so a photo
  // without an R2 copy yet is awaiting upload (vs. just being a local photo).
  const accountActive = useSyncStatus() !== 'idle'
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [caption, setCaption] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<Photo | null>(null)
  const [confirmPhoto, setConfirmPhoto] = useState<Photo | null>(null)

  // A3: the lightbox is a custom overlay (not the Modal primitive — a full-bleed
  // image doesn't fit the dialog card). Give keyboard users an Escape path.
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const result = ev.target?.result
      if (typeof result === 'string') setPreview(result)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleAdd = () => {
    if (!preview) return
    addPhoto(car.id, { dataUrl: preview, caption })
    setPreview(null)
    setCaption('')
  }

  return (
    <div>
      {/* Upload area */}
      <div className="card mb-6">
        <h3 className="text-subhead font-semibold text-text-primary mb-4">Upload photo</h3>
        {preview ? (
          <div className="space-y-3">
            <div className="relative rounded-lg overflow-hidden h-48 bg-surface-2">
              <img src={preview} alt="" className="w-full h-full object-contain" />
              <IconButton
                aria-label="Discard photo"
                onClick={() => setPreview(null)}
                className="absolute top-2 right-2 bg-dark/70"
              >
                <X size={tokens.iconSize.sm} />
              </IconButton>
            </div>
            <div>
              <label htmlFor="photo-caption" className="label">Caption <span className="text-text-disabled">(optional)</span></label>
              <input id="photo-caption" className="input" placeholder="Front three-quarter, fresh wrap…" value={caption} onChange={(e) => setCaption(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPreview(null)}>Cancel</Button>
              <Button size="sm" onClick={handleAdd}>Save photo</Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full h-32 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-2 text-text-secondary hover:border-accent/50 hover:text-accent transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <Upload size={tokens.iconSize.lg} aria-hidden />
            <span className="text-body">Click to upload a photo</span>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>

      {/* Photo grid */}
      {car.photos.length === 0 ? (
        <p className="text-center text-text-secondary py-10">No photos yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {car.photos.map((photo) => {
            const isCover = car.coverPhoto === photo.id
            const isLocal = accountActive && !hasCloudCopy(photo)
            return (
              // A3: the tile is a real <button> (keyboard-openable lightbox) and
              // the cover/delete actions are PERSISTENT siblings (no hover-gate),
              // never nested in the button. alt="" — the button's aria-label names it.
              <div key={photo.id} className="group relative aspect-square">
                <button
                  type="button"
                  onClick={() => setLightbox(photo)}
                  aria-label={photo.caption || 'Open photo'}
                  className="absolute inset-0 overflow-hidden rounded-xl bg-surface-2 outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  <img src={resolvePhotoSrc(photo)} alt="" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                  {photo.caption && (
                    <span className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-dark/80 to-transparent px-2 py-1.5 text-left">
                      <span className="block truncate text-meta text-text-primary">{photo.caption}</span>
                    </span>
                  )}
                </button>

                {/* Persistent status indicators (top-left) */}
                <div className="pointer-events-none absolute top-1.5 left-1.5 z-10 flex flex-col items-start gap-1">
                  {isCover && (
                    <span className="badge bg-accent text-on-accent">
                      <Star size={tokens.iconSize.xs} fill="currentColor" aria-hidden className="mr-1" />Cover
                    </span>
                  )}
                  {isLocal && (
                    <span className="badge bg-dark/70 text-text-secondary border border-border" title="Uploading… stored locally until it reaches the cloud">
                      <CloudOff size={tokens.iconSize.xs} aria-hidden className="mr-1" />Local
                    </span>
                  )}
                </div>

                {/* Persistent actions (top-right) — always visible for touch + keyboard */}
                <div className="absolute top-1.5 right-1.5 z-10 flex gap-0.5 rounded-lg bg-dark/70 p-0.5">
                  <IconButton
                    aria-label={isCover ? 'Current cover photo' : `Set ${photo.caption || 'photo'} as cover`}
                    disabled={isCover}
                    onClick={() => setCoverPhoto(car.id, photo.id)}
                  >
                    <Star size={tokens.iconSize.sm} fill={isCover ? 'currentColor' : 'none'} className={isCover ? 'text-accent' : undefined} />
                  </IconButton>
                  <IconButton
                    aria-label={`Delete ${photo.caption || 'photo'}`}
                    onClick={() => setConfirmPhoto(photo)}
                  >
                    <Trash2 size={tokens.iconSize.sm} />
                  </IconButton>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {confirmPhoto && (
        <ConfirmModal
          title="Delete photo?"
          message={confirmPhoto.caption ? `"${confirmPhoto.caption}" will be permanently deleted.` : 'This photo will be permanently deleted.'}
          onConfirm={() => deletePhoto(car.id, confirmPhoto.id)}
          onClose={() => setConfirmPhoto(null)}
        />
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.caption || 'Photo'}
          className="fixed inset-0 z-50 bg-dark/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <IconButton
            aria-label="Close photo"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 bg-dark/70"
          >
            <X size={tokens.iconSize.lg} />
          </IconButton>
          <img src={resolvePhotoSrc(lightbox)} alt={lightbox.caption || ''} className="max-w-full max-h-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {car.coverPhoto !== lightbox.id && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCoverPhoto(car.id, lightbox.id)}
              >
                <Star size={tokens.iconSize.sm} /> Set as cover
              </Button>
            )}
            {lightbox.caption && <p className="text-body text-text-primary">{lightbox.caption}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
