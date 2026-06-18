import { useEffect, useState } from 'react'
import { AlertTriangle, BadgeCheck, IdCard } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import { authClient } from '../../auth/client'
import { getAccountDisplay, updateAccountDisplay } from '../../auth/accountClient'
import Button from '../ui/Button'

/**
 * DEC-10 — "Display name on shares". The account NAME (never the email) shown on
 * public shares, plus the per-user `show_owner_name` consent (opt-OUT default:
 * shown unless turned off). Both persist to the D1 `user` row via the authed
 * /api/account/display route; the share viewer renders the name only when the
 * server resolves consent on.
 *
 * Gated on a session: there is no display name without an account, so logged-out
 * this renders a soft hint. The current values come from the route GET (the
 * consent isn't in the Better Auth session object), seeded once when signed in.
 */
type LoadState = 'loading' | 'ready' | 'error'

export default function ShareIdentitySection() {
  const { data: session } = authClient.useSession()
  const signedIn = Boolean(session?.user)

  // Initial 'loading' is the resting state until the first fetch resolves; the
  // logged-out hint is derived from `signedIn` in render, so the effect never
  // calls setState synchronously (it only sets state in the async continuation —
  // the SharePage pattern, which keeps the strict set-state-in-effect rule happy).
  const [load, setLoad] = useState<LoadState>('loading')
  const [name, setName] = useState('')
  const [showOwnerName, setShowOwnerName] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Fetch the authoritative { name, showOwnerName } once the user is signed in.
  useEffect(() => {
    if (!signedIn) return
    let cancelled = false
    void getAccountDisplay()
      .then((d) => {
        if (cancelled) return
        setName(d.name)
        setShowOwnerName(d.showOwnerName)
        setLoad('ready')
      })
      .catch(() => {
        if (!cancelled) setLoad('error')
      })
    return () => {
      cancelled = true
    }
  }, [signedIn])

  const save = async (next: { name?: string; showOwnerName?: boolean }) => {
    setError('')
    setSaved(false)
    setSaving(true)
    try {
      const result = await updateAccountDisplay(next)
      setName(result.name)
      setShowOwnerName(result.showOwnerName)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const trimmedName = name.trim()

  return (
    <section>
      <div className="mb-1 flex items-center gap-2">
        <IdCard size={tokens.iconSize.sm} className="text-text-tertiary" aria-hidden />
        <h3 className="text-body font-semibold text-text-primary">Display name on shares</h3>
      </div>
      <p className="mb-3 text-meta text-text-secondary">
        The name shown on builds you share publicly. This is your account name — never your email.
      </p>

      {!signedIn ? (
        <p className="rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-meta text-text-secondary">
          Sign in to set a display name for your shared builds.
        </p>
      ) : load === 'loading' ? (
        <p className="text-meta text-text-secondary">Loading…</p>
      ) : load === 'error' ? (
        <p role="alert" className="flex items-center gap-1.5 text-meta text-danger-fg">
          <AlertTriangle size={tokens.iconSize.xs} aria-hidden /> Could not load your display settings.
        </p>
      ) : (
        <div className="space-y-3">
          <div>
            <label htmlFor="share-display-name" className="label">
              Display name
            </label>
            <div className="flex gap-2">
              <input
                id="share-display-name"
                className="input flex-1"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setSaved(false)
                }}
                placeholder="Your name"
                maxLength={120}
                autoComplete="name"
              />
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                loading={saving}
                disabled={saving || trimmedName === '' || trimmedName === session?.user.name}
                onClick={() => void save({ name: trimmedName })}
              >
                Save
              </Button>
            </div>
          </div>

          {/* Consent toggle — an accessible switch (role="switch" + aria-checked),
              never colour alone: it carries an explicit on/off label. */}
          <button
            type="button"
            role="switch"
            aria-checked={showOwnerName}
            disabled={saving}
            onClick={() => void save({ showOwnerName: !showOwnerName })}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-accent/40 disabled:opacity-60"
          >
            <span className="min-w-0">
              <span className="block text-body font-medium text-text-primary">
                Show my name on shared builds
              </span>
              <span className="block text-meta text-text-secondary">
                {showOwnerName
                  ? 'Your name appears on builds you share.'
                  : 'Your shared builds stay anonymous.'}
              </span>
            </span>
            <span
              aria-hidden
              className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
                showOwnerName ? 'bg-accent' : 'bg-border'
              }`}
            >
              <span
                className={`absolute top-0.5 size-5 rounded-full bg-surface transition-all ${
                  showOwnerName ? 'left-[1.125rem]' : 'left-0.5'
                }`}
              />
            </span>
          </button>

          {saved && (
            <p className="flex items-center gap-1.5 text-meta text-success-fg">
              <BadgeCheck size={tokens.iconSize.xs} aria-hidden /> Saved.
            </p>
          )}
          {error && (
            <p role="alert" className="flex items-center gap-1.5 text-meta text-danger-fg">
              <AlertTriangle size={tokens.iconSize.xs} aria-hidden /> {error}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
