import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  BookmarkX,
  Car,
  Check,
  Eye,
  Pencil,
  Tag,
  Wrench,
  X,
} from 'lucide-react'
import { shareImgPath, tokens } from '@chudbox/shared'
import type { CarStatus, SavedBuild, StatusRole } from '@chudbox/shared'
import { savedBuildsController, useSavedBuilds } from '../store/useGarageStore'
import { fetchShareCard } from '../share/shareClient'
import { useQuery } from '@tanstack/react-query'
import { STATUS_CONFIG } from '../utils/carStatus'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import IconButton from '../components/ui/IconButton'

/**
 * DEC-11 "Watching" surface — the follower's saved-builds list. Local-first: the
 * list reads the synced `savedBuilds` TinyBase table (works logged out, paints
 * instantly from the cached header), while TanStack Query owns ONLY the
 * background live-refetch of each card via `?view=card` (never the garage state,
 * never a `/view` POST). A dangled token (404/410) sets `unavailableSince` and the
 * card flips to a "no longer available" state with a Remove affordance — it is
 * never auto-deleted (§12.2).
 */

const STATUS_ROLE: Record<CarStatus, StatusRole> = {
  current: 'neutral',
  'for-sale': 'success',
  'for-trade': 'info',
  sold: 'neutral',
  totaled: 'warning',
}

/** Informational scope badge (§12.2 review fix #4 — must handle 'listing'). */
const SCOPE_BADGE: Record<string, { label: string; role: StatusRole }> = {
  curated: { label: 'Showcase', role: 'neutral' },
  listing: { label: 'For sale', role: 'success' },
  full: { label: 'Full', role: 'info' },
}

/** The displayed title: the follower's personal nickname → the build's own
 * nickname → year/make/model → a generic fallback. */
function buildTitle(b: SavedBuild): string {
  const personal = b.nickname && b.nickname.trim() !== '' ? b.nickname.trim() : null
  const own = b.cachedNickname && b.cachedNickname.trim() !== '' ? b.cachedNickname.trim() : null
  const vehicle = [b.cachedYear, b.cachedMake, b.cachedModel].filter(Boolean).join(' ').trim()
  return personal ?? own ?? (vehicle !== '' ? vehicle : 'Saved build')
}

/** Inline nickname editor (the follower's PERSONAL label; '' clears it). */
function NicknameEditor({ build, onDone }: { build: SavedBuild; onDone: () => void }) {
  const [value, setValue] = useState(build.nickname ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        void savedBuildsController.setNickname(build.token, value.trim())
        onDone()
      }}
    >
      <input
        ref={inputRef}
        aria-label="Your nickname for this build"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Your nickname"
        className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2.5 text-meta text-text-primary outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
      />
      <IconButton type="submit" aria-label="Save nickname" variant="ghost">
        <Check size={tokens.iconSize.sm} />
      </IconButton>
      <IconButton type="button" aria-label="Cancel" variant="ghost" onClick={onDone}>
        <X size={tokens.iconSize.sm} />
      </IconButton>
    </form>
  )
}

function WatchingCard({ build }: { build: SavedBuild }) {
  const [editing, setEditing] = useState(false)
  const unavailable = build.unavailableSince != null

  // Background live-refetch of the curated card (DEC-11). TanStack Query owns the
  // staleness/refetch lifecycle; the success/dangle outcomes are written back to
  // the TinyBase follow row. fetchShareCard hits `?view=card` ONLY — it NEVER
  // POSTs `/view`, so a background refresh can't inflate the owner's view count.
  const { data } = useQuery({
    queryKey: ['shareCard', build.id],
    queryFn: () => fetchShareCard(build.token),
  })
  useEffect(() => {
    if (!data) return
    if (data.kind === 'ok') {
      void savedBuildsController.applyCardRefresh(build.token, data.card)
    } else if (data.kind === 'unavailable') {
      void savedBuildsController.markUnavailable(build.token)
    }
    // 'error' (offline / 5xx): keep the last-good header and retry later.
  }, [data, build.token])

  const cover = build.cachedCoverPhotoId
    ? shareImgPath(build.token, build.cachedCoverPhotoId)
    : ''
  const status = (build.cachedStatus ?? 'current') as CarStatus
  const scope = build.cachedScope ?? 'curated'
  const scopeBadge = SCOPE_BADGE[scope] ?? SCOPE_BADGE.curated
  const title = buildTitle(build)

  return (
    <div className="card flex flex-col overflow-hidden p-0">
      {/* Cover — links through to the live shared build (unless it has dangled). */}
      {unavailable ? (
        <div className="relative flex aspect-video items-center justify-center bg-surface-2">
          <Car size={40} className="text-text-disabled" aria-hidden />
        </div>
      ) : (
        <Link
          to={`/share/${build.token}`}
          aria-label={`Open ${title}`}
          className="relative block aspect-video overflow-hidden bg-surface-2 outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
        >
          {cover ? (
            <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Car size={40} className="text-text-disabled" aria-hidden />
            </div>
          )}
        </Link>
      )}

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          {editing ? (
            <NicknameEditor build={build} onDone={() => setEditing(false)} />
          ) : (
            <>
              <h2 className="min-w-0 truncate text-body font-semibold text-text-primary">{title}</h2>
              <IconButton
                aria-label="Rename this build"
                variant="ghost"
                onClick={() => setEditing(true)}
              >
                <Pencil size={tokens.iconSize.sm} />
              </IconButton>
            </>
          )}
        </div>

        {unavailable ? (
          <p className="text-meta text-text-tertiary">
            This shared build is no longer available — it was revoked, expired, or removed.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge status={STATUS_ROLE[status] ?? 'neutral'}>
              {(STATUS_CONFIG[status] ?? STATUS_CONFIG.current).label}
            </Badge>
            <Badge status={scopeBadge.role} icon={scope === 'listing' ? Tag : Eye}>
              {scopeBadge.label}
            </Badge>
            {build.cachedModsCount != null && build.cachedModsCount > 0 && (
              <span className="inline-flex items-center gap-1 text-meta text-text-secondary">
                <Wrench size={tokens.iconSize.xs} className="text-text-tertiary" aria-hidden />
                {build.cachedModsCount} mod{build.cachedModsCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}

        {/* Footer actions: open the live build + remove from the watch list. */}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          {unavailable ? (
            <span className="text-meta text-text-tertiary">Unavailable</span>
          ) : (
            <Link
              to={`/share/${build.token}`}
              className="inline-flex items-center gap-1 rounded-sm text-meta font-medium text-accent outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-accent"
            >
              View build
            </Link>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void savedBuildsController.unsaveBuild(build.token)}
          >
            <BookmarkX size={tokens.iconSize.sm} aria-hidden /> Remove
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function Watching() {
  const builds = useSavedBuilds()

  return (
    <div className="min-h-screen bg-dark">
      <header className="sticky top-0 z-10 border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              aria-label="Back to garage"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-text-secondary outline-hidden transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <ArrowLeft size={18} />
            </Link>
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg border border-accent/30 bg-accent/15">
                <Eye size={16} className="text-accent" />
              </div>
              <span className="text-subhead font-bold tracking-tight text-text-primary">Watching</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10">
        {builds.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="mb-6 flex size-24 items-center justify-center rounded-xl border border-border bg-surface-2">
              <Eye size={40} className="text-text-disabled" />
            </div>
            <h1 className="mb-2 text-title font-bold text-text-primary">Not watching anything yet</h1>
            <p className="mb-8 max-w-sm text-body leading-relaxed text-text-secondary">
              Open a shared build and tap <span className="font-medium text-text-primary">Save / Watch
              this build</span> to follow it here — it stays in this browser and live-updates from the
              owner's curated showcase.
            </p>
            <Link
              to="/"
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-4 font-medium text-text-primary outline-hidden transition-colors hover:border-accent/50 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ArrowLeft size={tokens.iconSize.sm} aria-hidden /> Back to garage
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <h1 className="text-title font-bold text-text-primary">
                Watching {builds.length} {builds.length === 1 ? 'build' : 'builds'}
              </h1>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {builds.map((build) => (
                <WatchingCard key={build.id} build={build} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
