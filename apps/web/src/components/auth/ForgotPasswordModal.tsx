import { useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, MailCheck } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import { authClient, RESET_CALLBACK_PATH } from '../../auth/client'
import { authErrorMessage, callAuth } from '../../auth/errors'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

// The footer's submit <Button> reaches the body form via this shared id
// (document-wide form association works across the Base UI portal).
const FORM_ID = 'forgot-password-form'

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

  // Post-submit confirmation — same dialog, swapped title/body/footer so focus
  // and the open transition stay continuous.
  if (sent) {
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
            If an account exists for <span className="font-medium text-text-primary">{email}</span>,
            a password-reset link is on its way.
          </p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Reset password"
      description="Enter your account email and we'll send you a reset link."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={FORM_ID} loading={busy}>Send reset link</Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
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
          />
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

      {onBackToSignIn && (
        <p className="mt-4 text-center text-meta text-text-secondary">
          Remembered it?{' '}
          <button type="button" onClick={onBackToSignIn} className="font-medium text-accent underline-offset-2 hover:underline">
            Back to sign in
          </button>
        </p>
      )}
    </Modal>
  )
}
