import { useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, MailCheck } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import { authClient, VERIFIED_CALLBACK_PATH } from '../../auth/client'
import { authErrorMessage, callAuth, MIN_PASSWORD_LENGTH } from '../../auth/errors'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

// The footer's submit <Button> reaches the body form via this shared id
// (document-wide form association works across the Base UI portal).
const FORM_ID = 'sign-up-form'

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

  // Post-submit confirmation — same dialog, swapped title/body/footer so focus
  // and the open transition stay continuous.
  if (done) {
    return (
      <Modal
        open
        onOpenChange={(o) => { if (!o) onClose() }}
        title="Check your inbox"
        size="sm"
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <div className="flex items-start gap-3">
          <MailCheck size={tokens.iconSize.lg} className="mt-0.5 shrink-0 text-success-fg" aria-hidden />
          <p className="text-body text-text-secondary">
            We sent a verification link to <span className="font-medium text-text-primary">{email}</span>.
            Your garage keeps working in the meantime — verifying just finishes account setup.
          </p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Create account"
      description="Optional — an account adds cross-device sync and cloud backup. Everything else works without one."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={FORM_ID} loading={busy}>Create account</Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
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
          <p id="signup-password-hint" className="mt-1 text-meta text-text-secondary">
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
            <p id="signup-confirm-error" role="alert" className="mt-1 text-meta text-danger-fg">
              Passwords don&apos;t match.
            </p>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-danger-border bg-danger px-3 py-2.5 text-body text-danger-fg"
          >
            <AlertTriangle size={tokens.iconSize.sm} className="mt-0.5 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        )}
      </form>

      {onSignIn && (
        <p className="mt-4 text-center text-meta text-text-secondary">
          Already have an account?{' '}
          <button type="button" onClick={onSignIn} className="font-medium text-accent underline-offset-2 hover:underline">
            Sign in
          </button>
        </p>
      )}
    </Modal>
  )
}
