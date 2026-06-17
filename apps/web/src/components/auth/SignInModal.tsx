import { useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, MailCheck, X } from 'lucide-react'
import { authClient, VERIFIED_CALLBACK_PATH } from '../../auth/client'
import { authErrorMessage, callAuth, isUnverifiedEmailError } from '../../auth/errors'

interface SignInModalProps {
  onClose: () => void
  onForgotPassword: () => void
  onCreateAccount?: () => void
  /** Called after a successful sign-in, before the modal closes. */
  onSignedIn?: () => void
}

export default function SignInModal({ onClose, onForgotPassword, onCreateAccount, onSignedIn }: SignInModalProps) {
  const [email, setEmail]   = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState('')
  const [unverified, setUnverified] = useState(false)
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent'>('idle')

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return
    setError('')
    setUnverified(false)
    setBusy(true)
    const { error } = await callAuth(authClient.signIn.email({ email, password }))
    setBusy(false)
    if (!error) {
      onSignedIn?.()
      onClose()
      return
    }
    setError(authErrorMessage(error))
    setUnverified(isUnverifiedEmailError(error))
  }

  const resendVerification = async () => {
    setResend('sending')
    const { error } = await callAuth(
      authClient.sendVerificationEmail({ email, callbackURL: VERIFIED_CALLBACK_PATH }),
    )
    if (error) {
      setResend('idle')
      setError(authErrorMessage(error))
    } else {
      setResend('sent')
    }
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
      <div className="modal-content bg-surface border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">Sign in</h3>
          <button onClick={onClose} className="btn-ghost" aria-label="Close"><X size={16} /></button>
        </div>

        <p className="text-sm text-gray-400 -mt-1">
          Signing in turns on cross-device sync and cloud backup. The garage works without it.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="signin-email">Email</label>
            <input
              id="signin-email"
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="label mb-0" htmlFor="signin-password">Password</label>
              <button
                type="button"
                onClick={onForgotPassword}
                className="text-xs text-gray-400 hover:text-accent transition-colors"
              >
                Forgot password?
              </button>
            </div>
            <input
              id="signin-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-700/40 bg-red-900/30 px-3 py-2.5 text-sm text-red-300"
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div className="space-y-1.5">
                <p>{error}</p>
                {unverified && (
                  resend === 'sent' ? (
                    <p className="flex items-center gap-1.5 text-green-300">
                      <MailCheck size={13} className="shrink-0" /> Verification email sent — check your inbox.
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={resendVerification}
                      disabled={resend === 'sending'}
                      className="font-medium text-red-200 underline underline-offset-2 hover:text-white disabled:opacity-60"
                    >
                      {resend === 'sending' ? 'Sending…' : 'Resend verification email'}
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-outline flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary flex-1 justify-center disabled:opacity-60">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>

          {onCreateAccount && (
            <p className="text-xs text-gray-400 text-center">
              No account yet?{' '}
              <button type="button" onClick={onCreateAccount} className="font-medium text-accent hover:underline">
                Create one
              </button>
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
