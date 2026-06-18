import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, LinkIcon, Ban, WifiOff } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { buildShareCard, toCuratedSnapshot, tokens } from '@chudbox/shared'
import { fetchShareSnapshot, recordShareView } from '../share/shareClient'
import type { SnapshotResult } from '../share/shareClient'
import { savedBuildsController } from '../store/useGarageStore'
import { applyThemeFromSettings, captureThemeVars, restoreThemeVars } from '../utils/themes'
import ShareCarView, { ShareShell } from '../components/share/ShareCarView'
import ShareCarViewFull from '../components/share/ShareCarViewFull'
import ShareCarViewListing from '../components/share/ShareCarViewListing'
import Button from '../components/ui/Button'

/**
 * Public route for `/share/:token` (clean URL). Fetches the curated snapshot and renders a
 * read-only build page. Deliberately makes NO auth-client calls — it works
 * fully logged-out; everything it needs comes from the token in the URL. Maps
 * the server's 404 (invalid) / 410 (revoked or expired) into distinct, friendly
 * messages, and handles loading + network errors.
 *
 * Terminal states reuse the share <ShareShell> chrome (logo-as-home nav + soft
 * "make your own garage" CTA, DEC-9) so even a dead link still offers a way home
 * and doubles as a discovery hook.
 */

type State = { phase: 'loading' } | { phase: 'done'; result: SnapshotResult }

/** A centered message inside the public share chrome (nav + soft CTA footer). */
function StatusScreen({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <ShareShell>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <Icon size={tokens.iconSize.xl} className="mx-auto mb-3 text-text-tertiary" aria-hidden />
          <h1 className="mb-1.5 text-subhead font-semibold text-text-primary">{title}</h1>
          <p className="text-body text-text-secondary">{children}</p>
          {action && <div className="mt-5 flex justify-center">{action}</div>}
        </div>
      </div>
    </ShareShell>
  )
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    if (!token) return
    let cancelled = false
    // setState happens only in the async continuation (never synchronously in
    // the effect body), so this is a pure "subscribe to an external fetch".
    // App.tsx keys this route by :token, so a share→share navigation remounts
    // (fresh loading state + theme) rather than reusing this element.
    void fetchShareSnapshot(token).then((result) => {
      if (cancelled) return
      setState({ phase: 'done', result })
      // On a successful load, record ONE view. recordShareView is fire-and-
      // forget (never throws) and sessionStorage-guarded per token, so a refresh
      // or remount won't re-count and a failed ping never blocks the render.
      if (result.kind === 'ok') void recordShareView(token)
    })
    return () => {
      cancelled = true
    }
  }, [token])

  // DEC-11: if this build is already being WATCHED, a real page open refreshes
  // its cached header + offline snapshot (this is a genuine human open — the view
  // ping above already counted it). It NEVER creates a follow (guarded on
  // getByToken), and toCuratedSnapshot strips any listing/full private fields
  // before caching, so the follow row stays curated (§12.7).
  useEffect(() => {
    if (state.phase !== 'done' || state.result.kind !== 'ok' || !token) return
    if (savedBuildsController.getByToken(token) == null) return
    const { scope, car } = state.result.data
    const curated = toCuratedSnapshot(car)
    void savedBuildsController.saveBuild(token, { card: buildShareCard(curated, scope), snapshot: curated })
  }, [state, token])

  // Honor the curated display theme while on the share page, but RESTORE the
  // prior theme on unmount / navigation so a shared car's theme never persists
  // into the rest of the app (the share route is public and theme-less of its
  // own; the owner's app-level theme must survive a visit here).
  useEffect(() => {
    if (state.phase !== 'done' || state.result.kind !== 'ok') return
    const prior = captureThemeVars()
    const { settings } = state.result.data.car
    applyThemeFromSettings(settings.themeId, settings.customAccent)
    return () => {
      restoreThemeVars(prior)
    }
  }, [state])

  // A missing token can't be fetched — derive the not-found view in render
  // rather than via a synchronous setState in the effect.
  if (!token) {
    return (
      <StatusScreen icon={LinkIcon} title="Link not found">
        This share link is invalid or has been removed.
      </StatusScreen>
    )
  }

  if (state.phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-dark p-6">
        <div className="text-center">
          <Loader2 size={tokens.iconSize.lg} className="mx-auto mb-3 animate-spin text-accent" aria-hidden />
          <p className="text-body text-text-secondary">Loading shared build…</p>
        </div>
      </div>
    )
  }

  const { result } = state

  if (result.kind === 'ok') {
    // The server tells us, via the validated body's discriminant, which view
    // this link grants — it is read SERVER-SIDE from the stored link, never
    // chosen by this client. 'full' renders the owner-equivalent read-only page,
    // 'listing' the For-Sale view (DEC-14), everything else the curated showcase.
    return result.data.scope === 'full' ? (
      <ShareCarViewFull car={result.data.car} token={token} />
    ) : result.data.scope === 'listing' ? (
      <ShareCarViewListing car={result.data.car} token={token} />
    ) : (
      <ShareCarView car={result.data.car} token={token} />
    )
  }

  if (result.kind === 'not-found') {
    return (
      <StatusScreen icon={LinkIcon} title="Link not found">
        This share link is invalid or has been removed. Double-check the URL.
      </StatusScreen>
    )
  }

  if (result.kind === 'gone') {
    return (
      <StatusScreen icon={Ban} title="Link unavailable">
        This shared build has been revoked or has expired and is no longer viewable.
      </StatusScreen>
    )
  }

  // result.kind === 'error'
  return (
    <StatusScreen
      icon={WifiOff}
      title="Couldn't load this build"
      action={
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Try again
        </Button>
      }
    >
      {result.message}
    </StatusScreen>
  )
}
