import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Car } from 'lucide-react'

/** Centered card layout for the auth landing routes (#/auth/reset, #/auth/verified). */
export default function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-dark flex flex-col items-center justify-center p-4">
      <Link to="/" className="flex items-center gap-2.5 mb-6 group">
        <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center">
          <Car size={16} className="text-accent" />
        </div>
        <span className="font-bold text-white text-lg tracking-tight group-hover:text-accent transition-colors">
          Chudbox
        </span>
      </Link>
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl shadow-2xl p-6">
        {children}
      </div>
    </div>
  )
}
