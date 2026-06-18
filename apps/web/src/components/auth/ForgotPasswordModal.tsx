import { useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, MailCheck, X } from 'lucide-react'
import { authClient, RESET_CALLBACK_PATH } from '../../auth/client'
import { authErrorMessage, callAuth } from '../../auth/errors'

interface ForgotPasswordModalProps {
  onClose: () => void
  onBackToSignIn?: () => void
}

export default function ForgotPasswordModal({ onClose, onBackToSignIn }: ForgotPasswordModalProps) {
  const [email, setEmail] = useState('')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent]   = useState(false)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    const { error } = await callAuth(
      authClient.requestPasswordReset({ email, redirectTo: RESET_CALLBACK_PATH }),
    )
    setBusy(false)
    if (error) {
      setError(authErrorMessage(error))
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
        <div className="modal-content bg-surface border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <MailCheck size={20} className="text-accent mt-0.5 shrink-0" />
            <div>
              <h3 className="font-semibold text-white">Check your inbox</h3>
              <p className="text-sm text-gray-400 mt-1">
                If an account exists for <span className="text-gray-200">{email}</span>,
                a password-reset link is on its way.
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
          <h3 className="font-semibold text-white">Reset password</h3>
          <button onClick={onClose} className="btn-ghost" aria-label="Close"><X size={16} /></button>
        </div>

        <p className="text-sm text-gray-400 -mt-1">
          Enter your account email and we&apos;ll send you a reset link.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email"
              name="email"
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
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </div>

          {onBackToSignIn && (
            <p className="text-xs text-gray-400 text-center">
              Remembered it?{' '}
              <button type="button" onClick={onBackToSignIn} className="font-medium text-accent hover:underline">
                Back to sign in
              </button>
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
