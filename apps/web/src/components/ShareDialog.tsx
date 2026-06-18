import { useCallback, useEffect, useState } from 'react'
import { X, Share2, Copy, Check, Link2, Trash2, Plus, AlertTriangle, Clock, Eye, Images, Layers } from 'lucide-react'
import DateInput from './DateInput'
import ConfirmModal from './ConfirmModal'
import Button from './ui/Button'
import IconButton from './ui/IconButton'
import Badge from './ui/Badge'
import {
  copyToClipboard,
  createShareLink,
  expiryInputToEpochSeconds,
  formatViewCount,
  listShareLinks,
  revokeShareLink,
} from '../share/shareClient'
import type { CreateShareResponse, ShareLinkMeta, ShareScope } from '@chudbox/shared'

interface ShareDialogProps {
  carId: string
  carLabel: string
  onClose: () => void
}

const fmtDate = (epochSeconds: number): string =>
  new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

type LinkState = 'revoked' | 'expired' | 'active'

function linkState(link: ShareLinkMeta, nowSeconds: number): LinkState {
  if (link.revokedAt != null) return 'revoked'
  if (link.expiresAt != null && link.expiresAt <= nowSeconds) return 'expired'
  return 'active'
}

export default function ShareDialog({ carId, carLabel, onClose }: ShareDialogProps) {
  const [links, setLinks] = useState<ShareLinkMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  // The owner's per-link visibility choice. Defaults to the curated showcase;
  // 'full' shares the owner-equivalent read-only view (wishlist/to-dos/issues,
  // costs/shops/notes). Sent to the server, which validates + stores it.
  const [scope, setScope] = useState<ShareScope>('curated')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [created, setCreated] = useState<CreateShareResponse | null>(null)
  const [copied, setCopied] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<ShareLinkMeta | null>(null)
  // "Now" is captured when links load (in the async callback, never during
  // render) so link-state classification stays a pure function of state.
  const [nowSeconds, setNowSeconds] = useState(0)

  // No synchronous setState here — every update lands in an async continuation,
  // so this is a pure subscription to the list fetch.
  const loadLinks = useCallback((): void => {
    void listShareLinks({ carId })
      .then((result) => {
        setNowSeconds(Math.floor(Date.now() / 1000))
        setLinks([...result].sort((a, b) => b.createdAt - a.createdAt)) // newest first
        setLoadError('')
      })
      .catch(() => setLoadError('Could not load your share links.'))
      .finally(() => setLoading(false))
  }, [carId])

  useEffect(() => {
    loadLinks()
  }, [loadLinks])

  // Keyboard accessibility: Escape closes the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleCreate = async (): Promise<void> => {
    setCreateError('')
    const expiry = expiryInputToEpochSeconds(expiryDate)
    if (!expiry.ok) {
      setCreateError(expiry.error)
      return
    }
    setCreating(true)
    try {
      const res = await createShareLink({ carId, expiresAt: expiry.value, scope })
      setCreated(res)
      setCopied(false)
      setExpiryDate('')
      loadLinks()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create the link.')
    } finally {
      setCreating(false)
    }
  }

  const handleCopy = async (): Promise<void> => {
    if (!created) return
    const ok = await copyToClipboard(created.url)
    setCopied(ok)
  }

  const handleRevoke = async (link: ShareLinkMeta): Promise<void> => {
    try {
      await revokeShareLink({ carId, id: link.id })
      loadLinks()
    } catch {
      setLoadError('Could not revoke that link. Try again.')
    }
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-dark/80">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        className="modal-content bg-surface border border-border rounded-xl w-full max-w-lg shadow-elevation flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Share2 size={18} className="text-text-tertiary" aria-hidden />
            <h2 id="share-dialog-title" className="text-title font-semibold text-text-primary">Share build</h2>
          </div>
          <IconButton aria-label="Close" variant="ghost" onClick={onClose} className="-mr-1"><X size={18} /></IconButton>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-5">
          <p className="text-body text-text-secondary">
            Create a public, read-only page for <span className="text-text-primary">{carLabel}</span>. Choose what it
            shows — the curated build showcase, or everything you see (read-only).
          </p>

          {/* Create */}
          <div className="card space-y-3 border-accent/30">
            <div>
              <span className="label">What can viewers see?</span>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Share visibility">
                <button
                  type="button"
                  role="radio"
                  aria-checked={scope === 'curated'}
                  onClick={() => setScope('curated')}
                  className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    scope === 'curated'
                      ? 'border-accent bg-accent/10'
                      : 'border-border hover:border-accent/40'
                  }`}
                >
                  <Images size={16} aria-hidden className={`mt-0.5 ${scope === 'curated' ? 'text-accent' : 'text-text-tertiary'}`} />
                  <span>
                    <span className="block text-body font-medium text-text-primary">Build showcase</span>
                    <span className="block text-meta text-text-secondary">Photos, mods, maintenance. No prices, shops, notes, or lists.</span>
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={scope === 'full'}
                  onClick={() => setScope('full')}
                  className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    scope === 'full'
                      ? 'border-accent bg-accent/10'
                      : 'border-border hover:border-accent/40'
                  }`}
                >
                  <Layers size={16} aria-hidden className={`mt-0.5 ${scope === 'full' ? 'text-accent' : 'text-text-tertiary'}`} />
                  <span>
                    <span className="block text-body font-medium text-text-primary">Everything (read-only)</span>
                    <span className="block text-meta text-text-secondary">Adds your wishlist, to-dos, issues, costs, shops &amp; notes.</span>
                  </span>
                </button>
              </div>
            </div>
            {scope === 'full' && (
              <p className="text-meta text-warning-fg flex items-center gap-1.5">
                <AlertTriangle size={12} aria-hidden /> Anyone with this link sees your prices, shops, notes and private lists for this car.
              </p>
            )}
            <div role="group" aria-labelledby="share-expiry-label">
              <span id="share-expiry-label" className="label">Expiry date <span className="font-normal text-text-disabled">(optional — default never)</span></span>
              <DateInput value={expiryDate} onChange={setExpiryDate} />
            </div>
            {createError && (
              <p className="text-meta text-danger-fg flex items-center gap-1.5"><AlertTriangle size={12} aria-hidden /> {createError}</p>
            )}
            <Button variant="primary" onClick={() => void handleCreate()} loading={creating} className="w-full">
              <Plus size={14} /> Create link
            </Button>
          </div>

          {/* Freshly-created link — shown ONCE. */}
          {created && (
            <div className="card space-y-2 border-success-border bg-success/30">
              <Badge status="success">Link created</Badge>
              <p className="text-meta text-text-secondary">
                Copy it now — for security this full link <span className="text-text-primary font-medium">won't be shown again</span>.
              </p>
              <div className="flex gap-2">
                <input
                  className="input flex-1 font-mono text-meta"
                  value={created.url}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Share link URL"
                />
                <Button variant="secondary" size="sm" onClick={() => void handleCopy()} className="shrink-0" aria-label="Copy link">
                  {copied ? <Check size={14} className="text-success-fg" /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              {created.expiresAt != null && (
                <p className="text-meta text-text-secondary flex items-center gap-1.5">
                  <Clock size={11} aria-hidden /> Expires {fmtDate(created.expiresAt)}
                </p>
              )}
            </div>
          )}

          {/* Existing links */}
          <div className="space-y-2">
            <h3 className="text-meta font-semibold text-text-tertiary uppercase tracking-widest">Existing links</h3>
            {loadError && (
              <p className="text-meta text-danger-fg flex items-center gap-1.5"><AlertTriangle size={12} aria-hidden /> {loadError}</p>
            )}
            {loading ? (
              <p className="text-body text-text-secondary py-2">Loading…</p>
            ) : links.length === 0 ? (
              <p className="text-body text-text-secondary py-2">No share links yet.</p>
            ) : (
              <ul className="space-y-2">
                {links.map((link) => {
                  const state = linkState(link, nowSeconds)
                  return (
                    <li key={link.id} className="card flex items-center gap-3 py-2.5">
                      <Link2 size={14} aria-hidden className="text-text-tertiary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-meta text-text-secondary truncate">{link.id}</span>
                          {state === 'revoked' && <Badge status="danger">Revoked</Badge>}
                          {state === 'expired' && <Badge status="neutral">Expired</Badge>}
                          {state === 'active' && <Badge status="success">Active</Badge>}
                          {link.scope === 'full' ? (
                            <Badge status="warning" icon={Layers} title="Shares everything (read-only)">Everything</Badge>
                          ) : (
                            <Badge status="neutral" icon={Images} title="Curated build showcase">Showcase</Badge>
                          )}
                        </div>
                        <p className="text-meta text-text-secondary mt-0.5">
                          Created {fmtDate(link.createdAt)}
                          {link.expiresAt != null ? ` · expires ${fmtDate(link.expiresAt)}` : ' · no expiry'}
                          {' · '}
                          <span
                            className="inline-flex items-center gap-1 align-middle"
                            title="Views (counted once per browser session)"
                          >
                            <Eye size={11} aria-hidden /> {formatViewCount(link.viewCount)}
                          </span>
                        </p>
                      </div>
                      {state !== 'revoked' && (
                        <IconButton
                          onClick={() => setRevokeTarget(link)}
                          variant="ghost"
                          className="shrink-0"
                          aria-label={`Revoke link ${link.id}`}
                          title="Revoke"
                        >
                          <Trash2 size={14} className="text-danger-fg" />
                        </IconButton>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-border shrink-0">
          <Button variant="secondary" onClick={onClose} className="flex-1">Done</Button>
        </div>
      </div>

      {revokeTarget && (
        <ConfirmModal
          title="Revoke this link?"
          message="Anyone holding this link will immediately lose access. This cannot be undone."
          confirmLabel="Revoke"
          onConfirm={() => void handleRevoke(revokeTarget)}
          onClose={() => setRevokeTarget(null)}
        />
      )}
    </div>
  )
}
