import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, BadgeCheck } from 'lucide-react'
import { verifyErrorFromParams } from '../auth/landingParams'
import AuthPageShell from '../components/auth/AuthPageShell'

/**
 * Landing for the email-verification link. On success Better Auth redirects to
 * the clean callback path verbatim (no params); on failure it appends
 * `?error=<code>`. With BrowserRouter (M5) there is no hash in the way, so the
 * error arrives in the normal query string and useSearchParams reads it.
 */
export default function AuthVerified() {
  const [params] = useSearchParams()
  const error = verifyErrorFromParams(params)

  if (error) {
    return (
      <AuthPageShell>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-yellow-400 mt-0.5 shrink-0" />
            <div>
              <h1 className="font-semibold text-white">Verification link invalid</h1>
              <p className="text-sm text-gray-400 mt-1">
                This verification link is invalid or has expired. Sign in and use
                &ldquo;Resend verification email&rdquo; in Settings &rarr; Account to get a fresh one.
              </p>
            </div>
          </div>
          <Link to="/" className="btn-primary w-full justify-center">Back to the garage</Link>
        </div>
      </AuthPageShell>
    )
  }

  return (
    <AuthPageShell>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <BadgeCheck size={20} className="text-green-300 mt-0.5 shrink-0" />
          <div>
            <h1 className="font-semibold text-white">Email verified</h1>
            <p className="text-sm text-gray-400 mt-1">
              Your account is all set. Cross-device sync and cloud backup will switch on as they roll out —
              the garage itself never needed the account to begin with.
            </p>
          </div>
        </div>
        <Link to="/" className="btn-primary w-full justify-center">Back to the garage</Link>
      </div>
    </AuthPageShell>
  )
}
