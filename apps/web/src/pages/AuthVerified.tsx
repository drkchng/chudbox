import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, BadgeCheck } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import { verifyErrorFromParams } from '../auth/landingParams'
import AuthPageShell from '../components/auth/AuthPageShell'
import Button from '../components/ui/Button'

/**
 * Landing for the email-verification link. On success Better Auth redirects to
 * the clean callback path verbatim (no params); on failure it appends
 * `?error=<code>`. With BrowserRouter (M5) there is no hash in the way, so the
 * error arrives in the normal query string and useSearchParams reads it.
 */
export default function AuthVerified() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const error = verifyErrorFromParams(params)

  if (error) {
    return (
      <AuthPageShell>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={tokens.iconSize.lg} className="mt-0.5 shrink-0 text-warning-fg" aria-hidden />
            <div>
              <h1 className="text-subhead font-semibold text-text-primary">Verification link invalid</h1>
              <p className="mt-1 text-body text-text-secondary">
                This verification link is invalid or has expired. Sign in and use
                &ldquo;Resend verification email&rdquo; in Settings &rarr; Account to get a fresh one.
              </p>
            </div>
          </div>
          <Button onClick={() => navigate('/')} className="w-full">Back to the garage</Button>
        </div>
      </AuthPageShell>
    )
  }

  return (
    <AuthPageShell>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <BadgeCheck size={tokens.iconSize.lg} className="mt-0.5 shrink-0 text-success-fg" aria-hidden />
          <div>
            <h1 className="text-subhead font-semibold text-text-primary">Email verified</h1>
            <p className="mt-1 text-body text-text-secondary">
              Your account is all set. Cross-device sync and cloud backup will switch on as they roll out —
              the garage itself never needed the account to begin with.
            </p>
          </div>
        </div>
        <Button onClick={() => navigate('/')} className="w-full">Back to the garage</Button>
      </div>
    </AuthPageShell>
  )
}
