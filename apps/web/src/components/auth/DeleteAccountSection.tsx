import { useState } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import { authClient } from '../../auth/client'
import { deleteAccount } from '../../auth/accountClient'
import Button from '../ui/Button'
import Modal from '../ui/Modal'

/**
 * Danger zone — irreversible account deletion (gap G4 / Law-25 right-to-erasure).
 *
 * Only rendered when SIGNED IN: with no account there is nothing server-side to
 * erase, and the local-first garage keeps working logged-out and is left
 * untouched. The button opens a confirm Modal that requires typing an explicit
 * phrase before the destructive action enables — a deliberate friction gate, not
 * colour alone.
 *
 * On success the server has already purged the Durable Object garage + every R2
 * image and deleted the D1 user row (cascading session/account/share_links), so
 * we sign out (best-effort — the session is already gone) which tears down sync
 * via SyncGate and returns the app to its normal logged-out, local-only state.
 *
 * The userId is NEVER sent from here — the server takes it only from the
 * validated session, so this UI cannot target anyone else's account.
 */
const CONFIRM_PHRASE = 'DELETE'

export default function DeleteAccountSection() {
  const { data: session } = authClient.useSession()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // No account ⇒ no server-side data to erase. (Returns before any hook-free
  // render branches; all hooks above run unconditionally.)
  if (!session?.user) return null

  const reset = (): void => {
    setConfirm('')
    setError('')
  }
  const close = (): void => {
    // Never abandon an in-flight delete by closing the dialog.
    if (busy) return
    setOpen(false)
    reset()
  }

  const confirmed = confirm.trim().toUpperCase() === CONFIRM_PHRASE

  const onDelete = async (): Promise<void> => {
    if (!confirmed || busy) return
    setBusy(true)
    setError('')
    try {
      await deleteAccount()
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Could not delete your account. Try again.')
      return
    }
    // Best-effort: the session is already invalidated server-side (its rows were
    // cascade-deleted), so this just clears the client cookie/cache. SyncGate
    // then sees the null session and stops sync. Ignore any error.
    try {
      await authClient.signOut()
    } catch {
      /* already signed out server-side — nothing to do */
    }
    // This component unmounts once the session clears (returns null above); reset
    // anyway so a future re-mount starts clean.
    setBusy(false)
    setOpen(false)
    reset()
  }

  return (
    <section>
      <div className="mb-1 flex items-center gap-2">
        <Trash2 size={tokens.iconSize.sm} className="text-danger-fg" aria-hidden />
        <h3 className="text-body font-semibold text-text-primary">Danger zone</h3>
      </div>
      <p className="mb-3 text-meta text-text-secondary">
        Permanently delete your account and everything stored in the cloud — your
        synced garage, uploaded photos, and share links. This cannot be undone.
      </p>
      <div className="rounded-lg border border-danger-border bg-surface-2 p-4">
        <Button
          variant="danger"
          size="sm"
          className="w-full justify-center"
          onClick={() => setOpen(true)}
        >
          <Trash2 size={tokens.iconSize.sm} aria-hidden /> Delete account
        </Button>
      </div>

      <Modal
        open={open}
        onOpenChange={(o) => {
          if (!o) close()
        }}
        title="Delete your account?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void onDelete()}
              loading={busy}
              disabled={!confirmed || busy}
            >
              Delete account
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-danger-fg" aria-hidden />
            <p className="text-body text-text-secondary">
              This permanently erases your synced garage, all uploaded photos, your
              share links, and your sign-in — across every device.{' '}
              <span className="font-medium text-text-primary">This cannot be undone.</span>
            </p>
          </div>
          <div>
            <label htmlFor="delete-confirm" className="label">
              Type{' '}
              <span className="font-mono font-semibold text-text-primary">{CONFIRM_PHRASE}</span>{' '}
              to confirm
            </label>
            <input
              id="delete-confirm"
              className="input w-full"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
              aria-describedby={error ? 'delete-account-error' : undefined}
            />
          </div>
          {error && (
            <p
              id="delete-account-error"
              role="alert"
              className="flex items-center gap-1.5 text-meta text-danger-fg"
            >
              <AlertTriangle size={tokens.iconSize.xs} aria-hidden /> {error}
            </p>
          )}
        </div>
      </Modal>
    </section>
  )
}
