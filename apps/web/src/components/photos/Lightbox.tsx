/**
 * Lightbox (A15) — a keyboard-operable, focus-trapped full-size photo viewer
 * with prev/next + close. It is NOT the Modal primitive: a full-bleed image
 * doesn't fit the dialog card, so this is a hand-rolled overlay that nonetheless
 * matches Modal's a11y contract:
 *   - role="dialog" / aria-modal, labelled by the current caption
 *   - Escape closes; ArrowLeft/ArrowRight page (when >1 photo)
 *   - focus trap while open + focus RESTORE to the originating tile on close
 *   - reduced-motion-safe (transitions gated by motion-reduce)
 *
 * Owner actions (set cover / banner / delete) are injected per-photo via
 * `actions` so the same viewer serves the read-only case (no actions) too.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import { resolvePhotoSrc } from '../../utils/image'
import IconButton from '../ui/IconButton'
import type { StoredPhoto } from '../../utils/image'

export interface LightboxProps {
  /** The set the viewer pages through (already filtered to the active bucket). */
  photos: StoredPhoto[]
  /** Index of the currently-shown photo. */
  index: number
  /** Page to another photo (prev/next). */
  onIndexChange: (index: number) => void
  /** Close + restore focus to the originating tile. */
  onClose: () => void
  /** Optional owner actions rendered for the current photo (cover/banner/delete). */
  actions?: (photo: StoredPhoto) => ReactNode
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'

export default function Lightbox({ photos, index, onIndexChange, onClose, actions }: LightboxProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  // The element focused when the lightbox opened — focus returns here on close.
  const restoreRef = useRef<HTMLElement | null>(null)

  const count = photos.length
  const photo = photos[index]

  const goPrev = useCallback(() => {
    if (count > 1) onIndexChange((index - 1 + count) % count)
  }, [count, index, onIndexChange])
  const goNext = useCallback(() => {
    if (count > 1) onIndexChange((index + 1) % count)
  }, [count, index, onIndexChange])

  // Keyboard: Esc closes, arrows page, Tab is trapped within the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      } else if (e.key === 'Tab') {
        const root = overlayRef.current
        if (!root) return
        const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
        if (focusables.length === 0) {
          e.preventDefault()
          return
        }
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement as HTMLElement | null
        if (e.shiftKey && active === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goPrev, goNext, onClose])

  // Focus trap setup: remember the trigger, move focus into the overlay on open,
  // restore it on close (A15 / Modal parity).
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null
    const root = overlayRef.current
    const firstFocusable = root?.querySelector<HTMLElement>(FOCUSABLE)
    firstFocusable?.focus()
    return () => {
      restoreRef.current?.focus?.()
    }
  }, [])

  if (!photo) return null

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={photo.caption || `Photo ${index + 1} of ${count}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-dark/90 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <IconButton aria-label="Close photo viewer" onClick={onClose} className="absolute right-4 top-4 bg-dark/70">
        <X size={tokens.iconSize.lg} />
      </IconButton>

      {count > 1 && (
        <IconButton
          aria-label="Previous photo"
          onClick={goPrev}
          className="absolute left-2 top-1/2 -translate-y-1/2 bg-dark/70 sm:left-4"
        >
          <ChevronLeft size={tokens.iconSize.lg} />
        </IconButton>
      )}

      <figure className="flex max-h-full max-w-full flex-col items-center gap-4">
        <img
          src={resolvePhotoSrc(photo)}
          alt={photo.caption || `Photo ${index + 1}`}
          className="max-h-[78vh] max-w-full rounded-lg object-contain"
        />
        <figcaption className="flex flex-col items-center gap-3">
          {photo.caption && <p className="text-body text-text-primary">{photo.caption}</p>}
          {count > 1 && (
            <p className="text-meta text-text-secondary" aria-live="polite">
              {index + 1} / {count}
            </p>
          )}
          {actions && <div className="flex flex-wrap items-center justify-center gap-2">{actions(photo)}</div>}
        </figcaption>
      </figure>

      {count > 1 && (
        <IconButton
          aria-label="Next photo"
          onClick={goNext}
          className="absolute right-2 top-1/2 -translate-y-1/2 bg-dark/70 sm:right-4"
        >
          <ChevronRight size={tokens.iconSize.lg} />
        </IconButton>
      )}
    </div>
  )
}
