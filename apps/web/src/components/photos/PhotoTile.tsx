/**
 * PhotoTile (A3) — one gallery tile, shared by the unified Photos gallery and
 * the inline per-item strips. The tile itself is a real <button> (keyboard-
 * openable lightbox) and every owner action is a PERSISTENT sibling IconButton
 * (never a hover-only overlay, never nested in the button) so touch + keyboard
 * users can always set cover/banner and delete. alt="" — the button's
 * aria-label names the photo.
 */
import { Star, Image as ImageIcon, Trash2, CloudOff } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import { resolvePhotoSrc } from '../../utils/image'
import IconButton from '../ui/IconButton'
import type { StoredPhoto } from '../../utils/image'

export interface PhotoTileProps {
  photo: StoredPhoto
  /** Accessible fallback name when the photo has no caption (e.g. "Photo 3"). */
  fallbackLabel: string
  onOpen: () => void
  isCover?: boolean
  isBanner?: boolean
  /** Signed-in but not yet uploaded → show the "stored locally" hint. */
  isLocal?: boolean
  /** Small attach badge in the unified gallery (e.g. "Mod"); omit for General. */
  attachBadge?: string
  onSetCover?: () => void
  onSetBanner?: () => void
  onDelete?: () => void
}

export default function PhotoTile({
  photo,
  fallbackLabel,
  onOpen,
  isCover = false,
  isBanner = false,
  isLocal = false,
  attachBadge,
  onSetCover,
  onSetBanner,
  onDelete,
}: PhotoTileProps) {
  const name = photo.caption || fallbackLabel
  return (
    <div className="group relative aspect-square">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${name}`}
        className="absolute inset-0 overflow-hidden rounded-xl bg-surface-2 outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <img
          src={resolvePhotoSrc(photo)}
          alt=""
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
        {photo.caption && (
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-dark/80 to-transparent px-2 py-1.5 text-left">
            <span className="block truncate text-meta text-text-primary">{photo.caption}</span>
          </span>
        )}
      </button>

      {/* Persistent status indicators (top-left). */}
      <div className="pointer-events-none absolute left-1.5 top-1.5 z-10 flex flex-col items-start gap-1">
        {isCover && (
          <span className="badge bg-accent text-on-accent">
            <Star size={tokens.iconSize.xs} fill="currentColor" aria-hidden className="mr-1" />
            Cover
          </span>
        )}
        {isBanner && (
          <span className="badge bg-surface-2 text-text-primary border border-border">
            <ImageIcon size={tokens.iconSize.xs} aria-hidden className="mr-1" />
            Banner
          </span>
        )}
        {attachBadge && (
          <span className="badge bg-dark/70 text-text-secondary border border-border">{attachBadge}</span>
        )}
        {isLocal && (
          <span
            className="badge bg-dark/70 text-text-secondary border border-border"
            title="Uploading… stored locally until it reaches the cloud"
          >
            <CloudOff size={tokens.iconSize.xs} aria-hidden className="mr-1" />
            Local
          </span>
        )}
      </div>

      {/* Persistent actions (top-right) — always visible for touch + keyboard. */}
      {(onSetCover || onSetBanner || onDelete) && (
        <div className="absolute right-1.5 top-1.5 z-10 flex gap-0.5 rounded-lg bg-dark/70 p-0.5">
          {onSetCover && (
            <IconButton
              aria-label={isCover ? `${name} is the cover photo` : `Set ${name} as cover`}
              disabled={isCover}
              onClick={onSetCover}
            >
              <Star
                size={tokens.iconSize.sm}
                fill={isCover ? 'currentColor' : 'none'}
                className={isCover ? 'text-accent' : undefined}
              />
            </IconButton>
          )}
          {onSetBanner && (
            <IconButton
              aria-label={isBanner ? `${name} is the banner photo` : `Set ${name} as banner`}
              disabled={isBanner}
              onClick={onSetBanner}
            >
              <ImageIcon
                size={tokens.iconSize.sm}
                className={isBanner ? 'text-accent' : undefined}
              />
            </IconButton>
          )}
          {onDelete && (
            <IconButton aria-label={`Delete ${name}`} onClick={onDelete}>
              <Trash2 size={tokens.iconSize.sm} />
            </IconButton>
          )}
        </div>
      )}
    </div>
  )
}
