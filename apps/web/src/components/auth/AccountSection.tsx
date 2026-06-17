import { useState } from 'react'
import { BadgeCheck, LogOut, MailCheck, UserRound } from 'lucide-react'
import { authClient, VERIFIED_CALLBACK_PATH } from '../../auth/client'
import { authErrorMessage, callAuth } from '../../auth/errors'
import { useSyncStatus, syncController } from '../../store/useGarageStore'
import type { SyncStatus } from '../../store/sync'
import SignInModal from './SignInModal'
import SignUpModal from './SignUpModal'
import ForgotPasswordModal from './ForgotPasswordModal'

type AuthModal = 'signin' | 'signup' | 'forgot' | null

const SYNC_INDICATOR: Record<SyncStatus, { label: string; dot: string }> = {
  idle:              { label: 'Sync off',                 dot: 'bg-gray-600' },
  connecting:        { label: 'Connecting…',              dot: 'bg-yellow-400' },
  'awaiting-choice': { label: 'Action needed — choose how to combine garages', dot: 'bg-yellow-400' },
  applying:          { label: 'Preparing first sync…',    dot: 'bg-yellow-400' },
  syncing:           { label: 'Synced',                   dot: 'bg-green-400' },
  disconnected:      { label: 'Sync offline — reload to reconnect', dot: 'bg-orange-400' },
  error:             { label: 'Sync error',               dot: 'bg-red-400' },
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

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <UserRound size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-white">Account</h3>
      </div>

      {user ? (
        <>
          <p className="text-xs text-gray-500 mb-3">Signed in — your garage syncs across devices.</p>
          <div className="rounded-xl border border-border bg-surface-2 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SYNC_INDICATOR[syncStatus].dot}`} />
              <span className="truncate">{SYNC_INDICATOR[syncStatus].label}</span>
            </div>
            {syncStatus === 'error' && syncController.getError() && (
              <p role="alert" className="text-xs text-red-300">{syncController.getError()}</p>
            )}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {user.name && <p className="text-sm font-medium text-gray-200 truncate">{user.name}</p>}
                <p className="text-sm text-gray-400 truncate">{user.email}</p>
              </div>
              {user.emailVerified ? (
                <span className="badge gap-1 bg-green-900/60 text-green-300 border border-green-700/40 shrink-0">
                  <BadgeCheck size={12} /> Verified
                </span>
              ) : (
                <span className="badge bg-orange-900/60 text-orange-300 border border-orange-700/40 shrink-0">
                  Unverified
                </span>
              )}
            </div>

            {!user.emailVerified && (
              resend === 'sent' ? (
                <p className="flex items-center gap-1.5 text-xs text-green-300">
                  <MailCheck size={13} className="shrink-0" /> Verification email sent — check your inbox.
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => resendVerification(user.email)}
                  disabled={resend === 'sending'}
                  className="text-xs font-medium text-gray-400 underline underline-offset-2 hover:text-accent transition-colors disabled:opacity-60"
                >
                  {resend === 'sending' ? 'Sending…' : 'Resend verification email'}
                </button>
              )
            )}

            <button onClick={signOut} disabled={busy} className="btn-outline w-full justify-center disabled:opacity-60">
              <LogOut size={14} /> {busy ? 'Signing out…' : 'Sign out'}
            </button>

            {actionError && <p role="alert" className="text-xs text-red-300">{actionError}</p>}
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">
            Optional — sign in to enable cross-device sync and cloud backup. The garage always works without an account.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setModal('signin')} className="btn-outline justify-center">Sign in</button>
            <button onClick={() => setModal('signup')} className="btn-outline justify-center">Create account</button>
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
