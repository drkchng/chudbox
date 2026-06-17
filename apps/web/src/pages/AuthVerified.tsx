import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, BadgeCheck } from 'lucide-react'
import AuthPageShell from '../components/auth/AuthPageShell'

/**
 * Landing for the email-verification link. On success Better Auth redirects
 * to the callback URL verbatim (no params); on failure it string-appends
 * `?error=<code>`, which lands INSIDE the hash — read it via the
 * hash-internal search params (and the real query string, just in case).
 */
export default function AuthVerified() {
  const [hashSearch] = useSearchParams()
  const error =
    hashSearch.get('error') ?? new URLSearchParams(window.location.search).get('error') ?? ''

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
