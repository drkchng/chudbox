import { useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, MailCheck, X } from 'lucide-react'
import { authClient, VERIFIED_CALLBACK_PATH } from '../../auth/client'
import { authErrorMessage, callAuth, MIN_PASSWORD_LENGTH } from '../../auth/errors'

interface SignUpModalProps {
  onClose: () => void
  onSignIn?: () => void
}

export default function SignUpModal({ onClose, onSignIn }: SignUpModalProps) {
  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')
  const [mismatch, setMismatch] = useState(false)
  const [done, setDone]         = useState(false)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return
    setError('')
    if (password !== confirm) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    setBusy(true)
    const { error } = await callAuth(
      authClient.signUp.email({ name, email, password, callbackURL: VERIFIED_CALLBACK_PATH }),
    )
    setBusy(false)
    if (error) {
      setError(authErrorMessage(error))
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
        <div className="modal-content bg-surface border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <MailCheck size={20} className="text-accent mt-0.5 shrink-0" />
            <div>
              <h3 className="font-semibold text-white">Check your inbox</h3>
              <p className="text-sm text-gray-400 mt-1">
                We sent a verification link to <span className="text-gray-200">{email}</span>.
                Your garage keeps working in the meantime — verifying just finishes account setup.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-primary w-full justify-center" autoFocus>Done</button>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
      <div className="modal-content bg-surface border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">Create account</h3>
          <button onClick={onClose} className="btn-ghost" aria-label="Close"><X size={16} /></button>
        </div>

        <p className="text-sm text-gray-400 -mt-1">
          Optional — an account adds cross-device sync and cloud backup. Everything else works without one.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="signup-name">Name</label>
            <input
              id="signup-name"
              name="name"
              className="input"
              type="text"
              autoComplete="name"
              placeholder="Alex"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div>
            <label className="label" htmlFor="signup-email">Email</label>
            <input
              id="signup-email"
              name="email"
              className="input"
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="signup-password">Password</label>
            <input
              id="signup-password"
              name="password"
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              aria-describedby="signup-password-hint"
            />
            <p id="signup-password-hint" className="text-xs text-gray-400 mt-1">
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="signup-confirm">Confirm password</label>
            <input
              id="signup-confirm"
              name="confirm-password"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setMismatch(false) }}
              required
              aria-invalid={mismatch || undefined}
              aria-describedby={mismatch ? 'signup-confirm-error' : undefined}
            />
            {mismatch && (
              <p id="signup-confirm-error" role="alert" className="text-xs text-red-300 mt-1">
                Passwords don&apos;t match.
              </p>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-700/40 bg-red-900/30 px-3 py-2.5 text-sm text-red-300"
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-outline flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary flex-1 justify-center disabled:opacity-60">
              {busy ? 'Creating…' : 'Create account'}
            </button>
          </div>

          {onSignIn && (
            <p className="text-xs text-gray-400 text-center">
              Already have an account?{' '}
              <button type="button" onClick={onSignIn} className="font-medium text-accent hover:underline">
                Sign in
              </button>
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
