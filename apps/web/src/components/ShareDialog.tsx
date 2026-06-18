import { useCallback, useEffect, useState } from 'react'
import { X, Share2, Copy, Check, Link2, Trash2, Plus, AlertTriangle, Clock } from 'lucide-react'
import DateInput from './DateInput'
import ConfirmModal from './ConfirmModal'
import {
  copyToClipboard,
  createShareLink,
  expiryInputToEpochSeconds,
  listShareLinks,
  revokeShareLink,
} from '../share/shareClient'
import type { CreateShareResponse, ShareLinkMeta } from '@chudbox/shared'

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
      const res = await createShareLink({ carId, expiresAt: expiry.value })
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
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        className="modal-content bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Share2 size={18} className="text-accent" />
            <h2 id="share-dialog-title" className="text-lg font-semibold text-white">Share build</h2>
          </div>
          <button onClick={onClose} className="btn-ghost" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-5">
          <p className="text-sm text-gray-400">
            Create a public, read-only page for <span className="text-gray-200">{carLabel}</span>. Anyone with the
            link can view the build (photos, mods, maintenance) — never prices, shops, notes, or your private lists.
          </p>

          {/* Create */}
          <div className="card space-y-3 border-accent/30">
            <div>
              <label className="label" htmlFor="share-expiry">Expiry date <span className="text-gray-600">(optional — default never)</span></label>
              <DateInput value={expiryDate} onChange={setExpiryDate} />
            </div>
            {createError && (
              <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {createError}</p>
            )}
            <button onClick={() => void handleCreate()} disabled={creating} className="btn-primary w-full justify-center">
              <Plus size={14} /> {creating ? 'Creating…' : 'Create link'}
            </button>
          </div>

          {/* Freshly-created link — shown ONCE. */}
          {created && (
            <div className="card space-y-2 border-green-700/40 bg-green-900/10">
              <p className="text-xs font-semibold text-green-300 flex items-center gap-1.5">
                <Check size={13} /> Link created
              </p>
              <p className="text-xs text-gray-400">
                Copy it now — for security this full link <span className="text-gray-200">won't be shown again</span>.
              </p>
              <div className="flex gap-2">
                <input
                  className="input flex-1 font-mono text-xs"
                  value={created.url}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Share link URL"
                />
                <button onClick={() => void handleCopy()} className="btn-outline shrink-0" aria-label="Copy link">
                  {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              {created.expiresAt != null && (
                <p className="text-xs text-gray-500 flex items-center gap-1.5">
                  <Clock size={11} /> Expires {fmtDate(created.expiresAt)}
                </p>
              )}
            </div>
          )}

          {/* Existing links */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Existing links</h3>
            {loadError && (
              <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {loadError}</p>
            )}
            {loading ? (
              <p className="text-sm text-gray-600 py-2">Loading…</p>
            ) : links.length === 0 ? (
              <p className="text-sm text-gray-600 py-2">No share links yet.</p>
            ) : (
              <ul className="space-y-2">
                {links.map((link) => {
                  const state = linkState(link, nowSeconds)
                  return (
                    <li key={link.id} className="card flex items-center gap-3 py-2.5">
                      <Link2 size={14} className="text-gray-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs text-gray-300 truncate">{link.id}</span>
                          {state === 'revoked' && <span className="badge bg-red-900/40 text-red-400 border border-red-800/50">Revoked</span>}
                          {state === 'expired' && <span className="badge bg-gray-800 text-gray-400 border border-gray-700">Expired</span>}
                          {state === 'active' && <span className="badge bg-green-900/50 text-green-300 border border-green-700/50">Active</span>}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Created {fmtDate(link.createdAt)}
                          {link.expiresAt != null ? ` · expires ${fmtDate(link.expiresAt)}` : ' · no expiry'}
                        </p>
                      </div>
                      {state !== 'revoked' && (
                        <button
                          onClick={() => setRevokeTarget(link)}
                          className="btn-ghost text-red-500 hover:text-red-400 shrink-0"
                          aria-label={`Revoke link ${link.id}`}
                          title="Revoke"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="btn-outline flex-1 justify-center">Done</button>
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
