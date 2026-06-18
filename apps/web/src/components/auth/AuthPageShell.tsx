import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Car } from 'lucide-react'
import { tokens } from '@chudbox/shared'

/** Centered card layout for the auth landing routes (/auth/reset, /auth/verified). */
export default function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-dark p-4">
      <Link to="/" className="group mb-6 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/30 bg-accent/15">
          <Car size={tokens.iconSize.md} className="text-accent" aria-hidden />
        </span>
        <span className="text-subhead font-bold tracking-tight text-text-primary transition-colors group-hover:text-accent">
          Chudbox
        </span>
      </Link>
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-elevation">
        {children}
      </div>
    </div>
  )
}
