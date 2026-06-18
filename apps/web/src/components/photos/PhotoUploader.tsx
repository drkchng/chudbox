/**
 * PhotoUploader — the pick → preview → caption → save affordance, shared by the
 * unified Photos gallery (add a General photo) and the inline per-item add flow
 * (attach a photo to a mod/maintenance/issue/todo). It owns only the local
 * preview state; the parent decides what `onSave` does (which `source`/
 * `sourceId` to attach). The actual encode/downscale (FREE ImagePolicy) + R2
 * upload happen later in the store's addPhoto → photoSync pipeline.
 */
import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Upload, X } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import Button from '../ui/Button'
import IconButton from '../ui/IconButton'

export interface PhotoUploaderProps {
  /** Called with the picked data URL + caption when the user saves. */
  onSave: (dataUrl: string, caption: string) => void
  /** Unique field-id prefix so the caption label/input never collide (A4). */
  idPrefix: string
  /** Dropzone call-to-action text. */
  ctaLabel?: string
  /** Compact dropzone (inline/modal use). */
  compact?: boolean
  /** Optional cancel affordance shown beside Save (e.g. to close a modal). */
  onCancel?: () => void
}

export default function PhotoUploader({
  onSave,
  idPrefix,
  ctaLabel = 'Click to upload a photo',
  compact = false,
  onCancel,
}: PhotoUploaderProps) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [caption, setCaption] = useState('')
  const [preview, setPreview] = useState<string | null>(null)

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

  const handleSave = () => {
    if (!preview) return
    onSave(preview, caption)
    setPreview(null)
    setCaption('')
  }

  const captionId = `${idPrefix}-caption`

  return (
    <div className="space-y-3">
      {preview ? (
        <>
          <div className={`relative overflow-hidden rounded-lg bg-surface-2 ${compact ? 'h-40' : 'h-48'}`}>
            <img src={preview} alt="" className="h-full w-full object-contain" />
            <IconButton
              aria-label="Discard photo"
              onClick={() => setPreview(null)}
              className="absolute right-2 top-2 bg-dark/70"
            >
              <X size={tokens.iconSize.sm} />
            </IconButton>
          </div>
          <div>
            <label htmlFor={captionId} className="label">
              Caption <span className="text-text-disabled">(optional)</span>
            </label>
            <input
              id={captionId}
              className="input"
              placeholder="Front three-quarter, fresh wrap…"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPreview(null)
                onCancel?.()
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave}>
              Save photo
            </Button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className={`flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-text-secondary transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${compact ? 'h-24' : 'h-32'}`}
        >
          <Upload size={compact ? tokens.iconSize.md : tokens.iconSize.lg} aria-hidden />
          <span className="text-body">{ctaLabel}</span>
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  )
}
