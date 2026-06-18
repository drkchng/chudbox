import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertOctagon, AlertTriangle, BadgeCheck, CheckCircle2, CloudOff, LogOut, MailCheck, RefreshCw, UserRound } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import type { StatusRole } from '@chudbox/shared'
import { authClient, VERIFIED_CALLBACK_PATH } from '../../auth/client'
import { authErrorMessage, callAuth } from '../../auth/errors'
import { useSyncStatus, syncController } from '../../store/useGarageStore'
import type { SyncStatus } from '../../store/sync'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import SignInModal from './SignInModal'
import SignUpModal from './SignUpModal'
import ForgotPasswordModal from './ForgotPasswordModal'

type AuthModal = 'signin' | 'signup' | 'forgot' | null

// Sync state → a semantic status role + a meaning-bearing icon (never colour
// alone: role-coloured icon + always-present label). Orange stays reclaimed for
// action/alert — the in-progress states read as info, not accent.
const SYNC_INDICATOR: Record<SyncStatus, { label: string; role: StatusRole; icon: LucideIcon }> = {
  idle:              { label: 'Sync off',                                       role: 'neutral', icon: CloudOff },
  connecting:        { label: 'Connecting…',                                    role: 'info',    icon: RefreshCw },
  'awaiting-choice': { label: 'Action needed — choose how to combine garages',  role: 'warning', icon: AlertTriangle },
  applying:          { label: 'Preparing first sync…',                          role: 'info',    icon: RefreshCw },
  syncing:           { label: 'Synced',                                         role: 'success', icon: CheckCircle2 },
  disconnected:      { label: 'Sync offline — reload to reconnect',             role: 'warning', icon: CloudOff },
  error:             { label: 'Sync error',                                     role: 'danger',  icon: AlertOctagon },
}

// Static role → foreground-token class map (Tailwind can't interpolate the role
// at runtime). Mirrors the AA-paired status-* fg tokens used by <Badge>.
const ROLE_FG: Record<StatusRole, string> = {
  danger:  'text-danger-fg',
  warning: 'text-warning-fg',
  success: 'text-success-fg',
  info:    'text-info-fg',
  neutral: 'text-neutral-fg',
}

/**
 * The Account section of the Settings panel. Accounts are optional: this is
 * the only place that probes the session, the probe starts when the panel
 * opens (never at app boot), and any probe failure — offline, no backend —
 * renders as the plain signed-out state. No spinner, no error.
 */
export default function AccountSection() {
  const { data: session } = authClient.useSession()
  const syncStatus = useSyncStatus()
  const [modal, setModal]   = useState<AuthModal>(null)
  const [busy, setBusy]     = useState(false)
  const [actionError, setActionError] = useState('')
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent'>('idle')

  const signOut = async () => {
    setActionError('')
    setBusy(true)
    const { error } = await callAuth(authClient.signOut())
    setBusy(false)
    if (error) setActionError(authErrorMessage(error))
  }

  const resendVerification = async (email: string) => {
    setActionError('')
    setResend('sending')
    const { error } = await callAuth(
      authClient.sendVerificationEmail({ email, callbackURL: VERIFIED_CALLBACK_PATH }),
    )
    if (error) {
      setResend('idle')
      setActionError(authErrorMessage(error))
    } else {
      setResend('sent')
    }
  }

  const user = session?.user
  const sync = SYNC_INDICATOR[syncStatus]
  const SyncIcon = sync.icon

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <UserRound size={tokens.iconSize.sm} className="text-text-tertiary" aria-hidden />
        <h3 className="text-body font-semibold text-text-primary">Account</h3>
      </div>

      {user ? (
        <>
          <p className="mb-3 text-meta text-text-secondary">Signed in — your garage syncs across devices.</p>
          <div className="space-y-3 rounded-lg border border-border bg-surface-2 p-4">
            <div className="flex items-start gap-2 text-meta text-text-secondary">
              <SyncIcon size={tokens.iconSize.sm} aria-hidden className={`mt-px shrink-0 ${ROLE_FG[sync.role]}`} />
              <span className="leading-snug">{sync.label}</span>
            </div>
            {syncStatus === 'error' && syncController.getError() && (
              <p role="alert" className="text-meta text-danger-fg">{syncController.getError()}</p>
            )}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {user.name && <p className="truncate text-body font-medium text-text-primary">{user.name}</p>}
                <p className="truncate text-body text-text-secondary">{user.email}</p>
              </div>
              {user.emailVerified ? (
                <Badge status="success" icon={BadgeCheck} className="shrink-0">Verified</Badge>
              ) : (
                <Badge status="warning" className="shrink-0">Unverified</Badge>
              )}
            </div>

            {!user.emailVerified && (
              resend === 'sent' ? (
                <p className="flex items-center gap-1.5 text-meta text-text-secondary">
                  <MailCheck size={tokens.iconSize.sm} className="shrink-0 text-success-fg" aria-hidden /> Verification email sent — check your inbox.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => resendVerification(user.email)}
                  disabled={resend === 'sending'}
                  className="text-meta font-medium text-text-secondary underline underline-offset-2 transition-colors enabled:hover:text-accent disabled:opacity-60"
                >
                  {resend === 'sending' ? 'Sending…' : 'Resend verification email'}
                </button>
              )
            )}

            <Button variant="secondary" onClick={signOut} loading={busy} className="w-full">
              <LogOut size={tokens.iconSize.sm} aria-hidden /> Sign out
            </Button>

            {actionError && <p role="alert" className="text-meta text-danger-fg">{actionError}</p>}
          </div>
        </>
      ) : (
        <>
          <p className="mb-3 text-meta text-text-secondary">
            Optional — sign in to enable cross-device sync and cloud backup. The garage always works without an account.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setModal('signin')} className="w-full">Sign in</Button>
            <Button variant="secondary" onClick={() => setModal('signup')} className="w-full">Create account</Button>
          </div>
        </>
      )}

      {modal === 'signin' && (
        <SignInModal
          onClose={() => setModal(null)}
          onForgotPassword={() => setModal('forgot')}
          onCreateAccount={() => setModal('signup')}
        />
      )}
      {modal === 'signup' && (
        <SignUpModal onClose={() => setModal(null)} onSignIn={() => setModal('signin')} />
      )}
      {modal === 'forgot' && (
        <ForgotPasswordModal onClose={() => setModal(null)} onBackToSignIn={() => setModal('signin')} />
      )}
    </div>
  )
}
