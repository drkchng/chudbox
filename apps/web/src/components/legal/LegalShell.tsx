import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LEGAL_CONTACT_EMAIL } from '@chudbox/shared'

/**
 * Shared chrome + prose primitives for the public legal pages (/terms,
 * /privacy). Same public-page pattern as ShareShell: wordmark-as-home nav on
 * top, dark canvas, cross-links below. The prose helpers keep the two long
 * documents readable in JSX without a typography plugin.
 */

interface LegalShellProps {
  title: string
  effectiveDate: string
  /** Extra line under the title, e.g. the Terms version. */
  subtitle?: ReactNode
  children: ReactNode
}

export default function LegalShell({ title, effectiveDate, subtitle, children }: LegalShellProps) {
  // SPA navigation keeps the previous page's scroll position; a legal page
  // must always open at its top.
  useEffect(() => window.scrollTo(0, 0), [])

  return (
    <div className="flex min-h-screen flex-col bg-dark">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <Link
            to="/"
            className="text-body font-bold tracking-wide text-text-primary outline-hidden transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            CHUDBOX
          </Link>
          <nav className="flex items-center gap-4 text-meta text-text-secondary">
            <Link to="/terms" className="transition-colors hover:text-accent">Terms</Link>
            <Link to="/privacy" className="transition-colors hover:text-accent">Privacy</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <h1 className="text-title font-bold text-text-primary">{title}</h1>
        <p className="mt-2 text-meta text-text-secondary">
          Effective {effectiveDate}
          {subtitle && <> · {subtitle}</>}
        </p>
        <div className="mt-8 space-y-8">{children}</div>
      </main>

      <footer className="border-t border-border bg-surface/40">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-1 px-6 py-6 text-meta text-text-secondary">
          <span>Chudbox · a personal project</span>
          <Link to="/terms" className="transition-colors hover:text-accent">Terms of Service</Link>
          <Link to="/privacy" className="transition-colors hover:text-accent">Privacy Policy</Link>
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="transition-colors hover:text-accent">
            {LEGAL_CONTACT_EMAIL}
          </a>
        </div>
      </footer>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-subhead font-semibold text-text-primary">{title}</h2>
      {children}
    </section>
  )
}

export function Para({ children }: { children: ReactNode }) {
  return <p className="text-body leading-relaxed text-text-secondary">{children}</p>
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-body leading-relaxed text-text-secondary">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

/** Inline emphasis that stays readable on the dark canvas. */
export function Em({ children }: { children: ReactNode }) {
  return <span className="font-medium text-text-primary">{children}</span>
}

export function ContactEmail() {
  return (
    <a
      href={`mailto:${LEGAL_CONTACT_EMAIL}`}
      className="font-medium text-accent underline-offset-2 hover:underline"
    >
      {LEGAL_CONTACT_EMAIL}
    </a>
  )
}
