import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  Calendar,
  Camera,
  ClipboardList,
  ExternalLink,
  Eye,
  ImageOff,
  Wrench,
  X,
} from 'lucide-react'
import { formatMileage, shareImgPath, tokens } from '@chudbox/shared'
import type {
  CarStatus,
  DistanceUnitCode,
  PublicCarSnapshot,
  PublicMaintenance,
  PublicMod,
  PublicPhoto,
  StatusRole,
} from '@chudbox/shared'
import { STATUS_CONFIG } from '../../utils/carStatus'
import CarHero from '../CarHero'
import MileageText from '../MileageText'
import Badge from '../ui/Badge'
import IconButton from '../ui/IconButton'

/**
 * Read-only public build viewer. Driven ENTIRELY by the allowlisted
 * PublicCarSnapshot (which structurally omits every excluded field — see
 * publicSnapshot.ts) plus the share token used to build token-scoped image URLs.
 * No store, no auth, no edit controls.
 *
 * Redesigned on the design system (DEC-8 / DEC-9): a public chrome (logo-as-home
 * nav + soft "make your own garage" CTA) wraps a PHOTO-LED layout — the gallery
 * is the showcase that leads, then the curated details (mods / maintenance) sit
 * under a sticky tab bar. Everything is tokenised (no ad-hoc colors / radii /
 * shadows), AA, keyboard-navigable with a visible focus ring, and orange is
 * reclaimed for action/alert only.
 *
 * Shared building blocks (ShareShell, DetailTabBar, EmptyState, ExternalLinkA,
 * PhotoGrid) are exported and reused verbatim by the full-scope variant.
 */

interface ShareCarViewProps {
  car: PublicCarSnapshot
  /** The share token from the route — turns a photoId into a token-scoped image URL. */
  token: string
}

type TabId = 'mods' | 'maintenance'

const fmtDay = (d: string): string => new Date(`${d}T12:00:00`).toLocaleDateString()

/**
 * Car status → design-system status role (canonical map, matches CarCard). Sale
 * = success, trade = info, totaled = warning (status-orange), current/sold =
 * neutral. Orange stays reserved for action/alert.
 */
const STATUS_ROLE: Record<CarStatus, StatusRole> = {
  current: 'neutral',
  'for-sale': 'success',
  'for-trade': 'info',
  sold: 'neutral',
  totaled: 'warning',
}

// ── Public chrome (DEC-9) ─────────────────────────────────────────────────────

/** Sticky public header: the Chudbox logo doubles as a home link, plus a soft
 *  "make your own garage" CTA — the discovery hook for logged-out visitors. */
function ShareNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-6">
        <Link
          to="/"
          aria-label="Chudbox — home"
          className="rounded-md font-mono text-subhead font-bold tracking-tight text-text-primary outline-hidden transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Chudbox
        </Link>
        <Link
          to="/"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-3 text-meta font-medium text-text-primary outline-hidden transition-colors hover:border-accent/50 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Make your own garage
          <ArrowRight size={tokens.iconSize.sm} aria-hidden />
        </Link>
      </div>
    </header>
  )
}

/** Soft conversion footer — the one place orange is spent as a real CTA action. */
function ShareFooter() {
  return (
    <footer className="border-t border-border bg-surface/40">
      <div className="mx-auto max-w-2xl px-6 py-12 text-center">
        <h2 className="text-title font-bold text-text-primary">Track your own build on Chudbox</h2>
        <p className="mx-auto mt-2 max-w-md text-body text-text-secondary">
          A dense, private garage for your cars — log mods, maintenance, and photos, then share a
          read-only build like this one.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex h-12 items-center gap-2 rounded-lg bg-accent px-5 font-semibold text-on-accent outline-hidden transition-colors hover:bg-accent-dim focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Make your own garage on Chudbox
          <ArrowRight size={tokens.iconSize.md} aria-hidden />
        </Link>
      </div>
    </footer>
  )
}

/** Page shell shared by both share variants and the SharePage error states:
 *  public nav on top, the build content in the middle, the soft CTA footer
 *  below. Owns the full-height dark canvas. */
export function ShareShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-dark">
      <ShareNav />
      <div className="flex flex-1 flex-col">{children}</div>
      <ShareFooter />
    </div>
  )
}

// ── Shared section primitives ─────────────────────────────────────────────────

export interface ShareTab<T extends string> {
  id: T
  label: string
  icon: LucideIcon
}

interface DetailTabBarProps<T extends string> {
  tabs: ShareTab<T>[]
  current: T
  onSelect: (id: T) => void
  /** Extra layout classes (e.g. top margin under the gallery). */
  className?: string
}

/**
 * Sticky section nav for the details below the gallery. Plain <button> tabs (NOT
 * role="tab") on purpose: the share e2e selects them via getByRole('button') and
 * the label is text-only so the accessible name stays exactly "Mods" etc. Sticks
 * just under the public nav (top-14 == the h-14 header).
 */
export function DetailTabBar<T extends string>({
  tabs,
  current,
  onSelect,
  className,
}: DetailTabBarProps<T>) {
  return (
    <div
      className={`sticky top-14 z-20 border-b border-border bg-surface/95 ${className ?? ''}`}
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex gap-1 overflow-x-auto py-2 no-scrollbar">
          {tabs.map(({ id, label, icon: Icon }) => {
            const active = id === current
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelect(id)}
                aria-current={active ? 'true' : undefined}
                className={`tab-btn inline-flex items-center gap-1.5 ${active ? 'tab-active' : 'tab-inactive'}`}
              >
                <Icon size={tokens.iconSize.sm} aria-hidden />
                {label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** One empty-state treatment for every list (decorative icon + muted line). */
export function EmptyState({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="py-16 text-center text-text-secondary">
      <Icon size={tokens.iconSize.xl} className="mx-auto mb-3 text-text-tertiary" aria-hidden />
      <p className="text-body">{children}</p>
    </div>
  )
}

/** External "view link" affordance — a genuine action, so it carries accent. */
export function ExternalLinkA({ href, label = 'View link' }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-sm text-accent outline-hidden transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      <ExternalLink size={tokens.iconSize.xs} aria-hidden /> {label}
    </a>
  )
}

// ── Photo showcase (DEC-8 lead) ───────────────────────────────────────────────

/**
 * The build's photo gallery — real <button> tiles (keyboard + visible focus)
 * opening a keyboard-dismissable lightbox (Escape + a focusable close + backdrop
 * press). Reused unchanged by the full-scope viewer.
 */
export function PhotoGrid({ photos, token }: { photos: PublicPhoto[]; token: string }) {
  const [lightbox, setLightbox] = useState<PublicPhoto | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Open behaviour: move focus into the viewer and wire Escape-to-close.
  useEffect(() => {
    if (!lightbox) return
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lightbox])

  if (photos.length === 0) {
    return <EmptyState icon={ImageOff}>No photos shared.</EmptyState>
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((photo) => (
          <button
            key={photo.photoId}
            type="button"
            onClick={() => setLightbox(photo)}
            aria-label={photo.caption ? `View photo: ${photo.caption}` : 'View photo'}
            className="card group relative block aspect-square overflow-hidden p-0 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <img
              src={shareImgPath(token, photo.photoId)}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            {photo.caption && (
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-dark/90 to-transparent px-2.5 py-2 text-meta text-text-primary">
                <span className="block truncate">{photo.caption}</span>
              </span>
            )}
          </button>
        ))}
      </div>

      {lightbox && (
        <div
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.caption || 'Photo viewer'}
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-dark/95 p-4 outline-hidden sm:p-8"
        >
          <IconButton
            aria-label="Close photo viewer"
            onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 z-10"
          >
            <X size={tokens.iconSize.lg} />
          </IconButton>
          <img
            src={shareImgPath(token, lightbox.photoId)}
            alt={lightbox.caption || ''}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
          {lightbox.caption && (
            <p className="absolute inset-x-0 bottom-4 mx-auto max-w-2xl px-4 text-center text-body text-text-primary">
              {lightbox.caption}
            </p>
          )}
        </div>
      )}
    </>
  )
}

// ── Curated detail lists ──────────────────────────────────────────────────────

export function ModList({ mods }: { mods: PublicMod[] }) {
  if (mods.length === 0) {
    return <EmptyState icon={Wrench}>No modifications shared.</EmptyState>
  }
  const grouped = mods.reduce<Record<string, PublicMod[]>>((acc, mod) => {
    const key = mod.category || 'Other'
    if (!acc[key]) acc[key] = []
    acc[key].push(mod)
    return acc
  }, {})
  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([category, group]) => (
        <div key={category}>
          <p className="mb-2 text-meta font-semibold uppercase tracking-widest text-text-secondary">
            {category}
          </p>
          <div className="space-y-2">
            {group.map((mod, i) => (
              <div key={`${mod.name}-${i}`} className="card">
                <p className="font-semibold text-text-primary">{mod.name}</p>
                {mod.description && (
                  <p className="mt-1 text-meta text-text-secondary">{mod.description}</p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-meta text-text-secondary">
                  {mod.installedDate && <span>{fmtDay(mod.installedDate)}</span>}
                  {mod.link && <ExternalLinkA href={mod.link} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function MaintenanceList({ records, unit }: { records: PublicMaintenance[]; unit: DistanceUnitCode }) {
  if (records.length === 0) {
    return <EmptyState icon={ClipboardList}>No maintenance records shared.</EmptyState>
  }
  const sorted = [...records].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return (
    <div className="space-y-3">
      {sorted.map((rec, i) => (
        <div key={`${rec.service}-${i}`} className="card">
          <p className="font-semibold text-text-primary">{rec.service}</p>
          <div className="mt-1.5 flex flex-wrap gap-3 text-meta text-text-secondary">
            {rec.date && (
              <span className="inline-flex items-center gap-1">
                <Calendar size={tokens.iconSize.xs} className="text-text-tertiary" aria-hidden />
                {fmtDay(rec.date)}
              </span>
            )}
            <MileageText raw={rec.mileageRaw} miles={rec.mileageMiles} unit={unit} />
          </div>
          {(rec.nextDueDate || rec.nextDueMileageRaw) && (
            <p className="mt-1 text-meta text-text-secondary">
              Next:{' '}
              {rec.nextDueDate ? fmtDay(rec.nextDueDate) : ''}
              {rec.nextDueDate && rec.nextDueMileageRaw ? ' / ' : ''}
              {formatMileage(rec.nextDueMileageRaw, rec.nextDueMileageMiles, unit) ?? ''}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ShareCarView({ car, token }: ShareCarViewProps) {
  const unit = car.settings.distanceUnit
  const coverSrc = car.coverPhotoId ? shareImgPath(token, car.coverPhotoId) : ''

  const tabs: ShareTab<TabId>[] = [
    { id: 'mods', label: 'Mods', icon: Wrench },
    { id: 'maintenance', label: 'Maintenance', icon: ClipboardList },
  ]
  // Default to the first tab that actually has content (Mods first), matching the
  // pre-redesign behaviour now that Photos leads as the gallery instead of a tab.
  const [tab, setTab] = useState<TabId>(
    car.mods.length === 0 && car.maintenance.length > 0 ? 'maintenance' : 'mods',
  )

  return (
    <ShareShell>
      <CarHero
        coverSrc={coverSrc}
        topLeft={
          <div className="absolute left-4 top-4">
            <Badge status="neutral" icon={Eye}>
              Read-only shared build
            </Badge>
          </div>
        }
        meta={
          <>
            <Badge status={STATUS_ROLE[car.status] ?? 'neutral'}>
              {(STATUS_CONFIG[car.status] ?? STATUS_CONFIG.current).label}
            </Badge>
            {/* DEC-10: owner display name — present ONLY when the server resolved
                consent on (the snapshot is the gate; render iff it carries it). */}
            {car.ownerName && (
              <span className="text-meta text-text-secondary">by {car.ownerName}</span>
            )}
            {car.purchaseDate && (
              <span className="text-meta text-text-secondary">Owned since {fmtDay(car.purchaseDate)}</span>
            )}
            {car.status === 'sold' && car.saleDate && (
              <span className="text-meta text-text-secondary">Sold {fmtDay(car.saleDate)}</span>
            )}
          </>
        }
        title={
          <>
            {car.year} {car.make} {car.model}
          </>
        }
        subline={
          <>
            {car.trim && <span className="text-body text-text-secondary">{car.trim}</span>}
            {car.color && <span className="text-body text-text-secondary">· {car.color}</span>}
            {car.mileageRaw && (
              <span className="text-body text-text-secondary">
                · <MileageText raw={car.mileageRaw} miles={car.mileageMiles} unit={unit} />
              </span>
            )}
            {car.nickname && (
              <span className="text-body italic text-text-secondary">· “{car.nickname}”</span>
            )}
          </>
        }
        belowTitle={
          /* DEC-19: the plate appears ONLY when the owner opted in (the snapshot
             carries it iff showPlate was on) — flaunt-the-vanity-plate case. */
          car.plate ? (
            <p className="mt-1.5 text-meta text-text-tertiary">
              Plate <span className="font-mono text-text-secondary">{car.plate}</span>
            </p>
          ) : undefined
        }
      />

      {/* DEC-8: lead with photos — the gallery is the showcase. */}
      {car.photos.length > 0 && (
        <section aria-labelledby="gallery-heading" className="mx-auto w-full max-w-7xl px-6 pt-8">
          <div className="mb-4 flex items-center gap-2">
            <Camera size={tokens.iconSize.md} className="text-text-tertiary" aria-hidden />
            <h2 id="gallery-heading" className="text-subhead font-semibold text-text-primary">
              Gallery
            </h2>
            <span className="text-meta text-text-secondary">
              {car.photos.length} photo{car.photos.length === 1 ? '' : 's'}
            </span>
          </div>
          <PhotoGrid photos={car.photos} token={token} />
        </section>
      )}

      <DetailTabBar tabs={tabs} current={tab} onSelect={setTab} className="mt-8" />
      <div className="mx-auto w-full max-w-7xl px-6 py-8">
        {tab === 'mods' && <ModList mods={car.mods} />}
        {tab === 'maintenance' && <MaintenanceList records={car.maintenance} unit={unit} />}
      </div>
    </ShareShell>
  )
}
