import { useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, MailCheck } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import { authClient, VERIFIED_CALLBACK_PATH } from '../../auth/client'
import { authErrorMessage, callAuth, isUnverifiedEmailError } from '../../auth/errors'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

// The footer's submit <Button> reaches the body form via this shared id
// (document-wide form association works across the Base UI portal).
const FORM_ID = 'sign-in-form'

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
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Sign in"
      description="Signing in turns on cross-device sync and cloud backup. The garage works without it."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={FORM_ID} loading={busy}>Sign in</Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="signin-email">Email</label>
          <input
            id="signin-email"
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
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="label mb-0" htmlFor="signin-password">Password</label>
            <button
              type="button"
              onClick={onForgotPassword}
              className="text-meta text-text-secondary transition-colors hover:text-accent"
            >
              Forgot password?
            </button>
          </div>
          <input
            id="signin-password"
            name="password"
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
            className="flex items-start gap-2 rounded-md border border-danger-border bg-danger px-3 py-2.5 text-body text-danger-fg"
          >
            <AlertTriangle size={tokens.iconSize.sm} className="mt-0.5 shrink-0" aria-hidden />
            <div className="space-y-1.5">
              <p>{error}</p>
              {unverified && (
                resend === 'sent' ? (
                  <p className="flex items-center gap-1.5">
                    <MailCheck size={tokens.iconSize.sm} className="shrink-0" aria-hidden /> Verification email sent — check your inbox.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={resendVerification}
                    disabled={resend === 'sending'}
                    className="font-medium underline underline-offset-2 enabled:hover:text-text-primary disabled:opacity-60"
                  >
                    {resend === 'sending' ? 'Sending…' : 'Resend verification email'}
                  </button>
                )
              )}
            </div>
          </div>
        )}
      </form>

      {onCreateAccount && (
        <p className="mt-4 text-center text-meta text-text-secondary">
          No account yet?{' '}
          <button type="button" onClick={onCreateAccount} className="font-medium text-accent underline-offset-2 hover:underline">
            Create one
          </button>
        </p>
      )}
    </Modal>
  )
}
