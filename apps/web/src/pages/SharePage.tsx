import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, LinkIcon, Ban, WifiOff } from 'lucide-react'
import { fetchShareSnapshot, recordShareView } from '../share/shareClient'
import type { SnapshotResult } from '../share/shareClient'
import { applyThemeFromSettings, captureThemeVars, restoreThemeVars } from '../utils/themes'
import ShareCarView from '../components/share/ShareCarView'
import ShareCarViewFull from '../components/share/ShareCarViewFull'

/**
 * Public route for `#/share/:token`. Fetches the curated snapshot and renders a
 * read-only build page. Deliberately makes NO auth-client calls — it works
 * fully logged-out; everything it needs comes from the token in the URL. Maps
 * the server's 404 (invalid) / 410 (revoked or expired) into distinct, friendly
 * messages, and handles loading + network errors.
 */

type State = { phase: 'loading' } | { phase: 'done'; result: SnapshotResult }

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-dark flex items-center justify-center p-6">
      <div className="text-center max-w-sm">{children}</div>
    </div>
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
      <Centered>
        <LinkIcon size={32} className="mx-auto mb-3 text-gray-600" />
        <h1 className="text-lg font-semibold text-white mb-1.5">Link not found</h1>
        <p className="text-sm text-gray-400">This share link is invalid or has been removed.</p>
      </Centered>
    )
  }

  if (state.phase === 'loading') {
    return (
      <Centered>
        <Loader2 size={28} className="mx-auto mb-3 text-accent animate-spin" />
        <p className="text-gray-400 text-sm">Loading shared build…</p>
      </Centered>
    )
  }

  const { result } = state

  if (result.kind === 'ok') {
    // The server tells us, via the validated body's discriminant, which view
    // this link grants — it is read SERVER-SIDE from the stored link, never
    // chosen by this client. 'full' renders the owner-equivalent read-only
    // page; everything else stays the curated showcase.
    return result.data.scope === 'full' ? (
      <ShareCarViewFull car={result.data.car} token={token} />
    ) : (
      <ShareCarView car={result.data.car} token={token} />
    )
  }

  if (result.kind === 'not-found') {
    return (
      <Centered>
        <LinkIcon size={32} className="mx-auto mb-3 text-gray-600" />
        <h1 className="text-lg font-semibold text-white mb-1.5">Link not found</h1>
        <p className="text-sm text-gray-400">
          This share link is invalid or has been removed. Double-check the URL.
        </p>
      </Centered>
    )
  }

  if (result.kind === 'gone') {
    return (
      <Centered>
        <Ban size={32} className="mx-auto mb-3 text-gray-600" />
        <h1 className="text-lg font-semibold text-white mb-1.5">Link unavailable</h1>
        <p className="text-sm text-gray-400">
          This shared build has been revoked or has expired and is no longer viewable.
        </p>
      </Centered>
    )
  }

  // result.kind === 'error'
  return (
    <Centered>
      <WifiOff size={32} className="mx-auto mb-3 text-gray-600" />
      <h1 className="text-lg font-semibold text-white mb-1.5">Couldn't load this build</h1>
      <p className="text-sm text-gray-400 mb-4">{result.message}</p>
      <button onClick={() => window.location.reload()} className="btn-outline">Try again</button>
    </Centered>
  )
}
