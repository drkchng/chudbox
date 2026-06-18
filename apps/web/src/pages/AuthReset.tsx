import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Check, KeyRound } from 'lucide-react'
import { authClient } from '../auth/client'
import { authErrorMessage, callAuth, MIN_PASSWORD_LENGTH } from '../auth/errors'
import { resetTokenFromParams } from '../auth/landingParams'
import AuthPageShell from '../components/auth/AuthPageShell'
import SignInModal from '../components/auth/SignInModal'
import ForgotPasswordModal from '../components/auth/ForgotPasswordModal'

/**
 * Clean URLs (BrowserRouter — M5): Better Auth redirects the email link to
 * `/auth/reset?token=…` (or `?error=INVALID_TOKEN`), so the token/error now
 * arrive in the normal query string and `useSearchParams()` reads them
 * directly — no hash-internal parsing needed.
 *
 * Strip `?token=…` from the address bar after a SUCCESSFUL reset so the
 * consumed token doesn't linger in history. Before that the token stays in the
 * URL so a page refresh doesn't strand the user.
 */
function scrubRealQueryString() {
  if (window.location.search) {
    window.history.replaceState(null, '', window.location.pathname)
  }
}

export default function AuthReset() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [token] = useState(() => resetTokenFromParams(params))

  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState('')
  const [mismatch, setMismatch] = useState(false)
  const [done, setDone]         = useState(false)
  const [modal, setModal]       = useState<'signin' | 'forgot' | null>(null)

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
    const { error } = await callAuth(authClient.resetPassword({ newPassword: password, token }))
    setBusy(false)
    if (error) {
      setError(authErrorMessage(error))
      return
    }
    scrubRealQueryString()
    setDone(true)
  }

  const modals = (
    <>
      {modal === 'signin' && (
        <SignInModal
          onClose={() => setModal(null)}
          onForgotPassword={() => setModal('forgot')}
          onSignedIn={() => navigate('/')}
        />
      )}
      {modal === 'forgot' && (
        <ForgotPasswordModal onClose={() => setModal(null)} onBackToSignIn={() => setModal('signin')} />
      )}
    </>
  )

  if (!token) {
    return (
      <AuthPageShell>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-yellow-400 mt-0.5 shrink-0" />
            <div>
              <h1 className="font-semibold text-white">Reset link invalid</h1>
              <p className="text-sm text-gray-400 mt-1">
                This password-reset link is invalid or has expired. Request a fresh one and try again.
              </p>
            </div>
          </div>
          <button onClick={() => setModal('forgot')} className="btn-primary w-full justify-center">
            Request a new link
          </button>
          <p className="text-xs text-gray-400 text-center">
            <Link to="/" className="hover:text-accent transition-colors">Back to the garage</Link>
          </p>
        </div>
        {modals}
      </AuthPageShell>
    )
  }

  if (done) {
    return (
      <AuthPageShell>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Check size={20} className="text-green-300 mt-0.5 shrink-0" />
            <div>
              <h1 className="font-semibold text-white">Password updated</h1>
              <p className="text-sm text-gray-400 mt-1">You can sign in with your new password now.</p>
            </div>
          </div>
          <button onClick={() => setModal('signin')} className="btn-primary w-full justify-center" autoFocus>
            Sign in
          </button>
          <p className="text-xs text-gray-400 text-center">
            <Link to="/" className="hover:text-accent transition-colors">Back to the garage</Link>
          </p>
        </div>
        {modals}
      </AuthPageShell>
    )
  }

  return (
    <AuthPageShell>
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-accent" />
          <h1 className="font-semibold text-white">Choose a new password</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="reset-password">New password</label>
            <input
              id="reset-password"
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              aria-describedby="reset-password-hint"
            />
            <p id="reset-password-hint" className="text-xs text-gray-400 mt-1">
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="reset-confirm">Confirm new password</label>
            <input
              id="reset-confirm"
              className="input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setMismatch(false) }}
              required
              aria-invalid={mismatch || undefined}
              aria-describedby={mismatch ? 'reset-confirm-error' : undefined}
            />
            {mismatch && (
              <p id="reset-confirm-error" role="alert" className="text-xs text-red-300 mt-1">
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

          <button type="submit" disabled={busy} className="btn-primary w-full justify-center disabled:opacity-60">
            {busy ? 'Updating…' : 'Set new password'}
          </button>

          <p className="text-xs text-gray-400 text-center">
            <Link to="/" className="hover:text-accent transition-colors">Back to the garage</Link>
          </p>
        </form>
      </div>
      {modals}
    </AuthPageShell>
  )
}
