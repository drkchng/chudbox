import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  Calendar,
  Camera,
  CheckSquare,
  ClipboardList,
  Eye,
  ShoppingCart,
  Tag,
  Wrench,
} from 'lucide-react'
import { formatMileage, formatMoney, shareImgPath, tokens, ISSUE_SEVERITY_META } from '@chudbox/shared'
import type {
  CarStatus,
  DistanceUnitCode,
  FullCarSnapshot,
  FullIssue,
  FullMaintenance,
  FullMod,
  FullTodo,
  FullWishlistItem,
  StatusRole,
  TodoPriority,
  WishlistStatus,
} from '@chudbox/shared'
import { STATUS_CONFIG } from '../../utils/carStatus'
import CarHero from '../CarHero'
import MileageText from '../MileageText'
import Badge from '../ui/Badge'
import { DetailTabBar, EmptyState, ExternalLinkA, PhotoGrid, ShareShell } from './ShareCarView'
import type { ShareTab } from './ShareCarView'
import SaveBuildButton from './SaveBuildButton'

/**
 * Car status → design-system status role (canonical map, matches CarCard /
 * ShareCarView). Kept local rather than exported from ShareCarView so that file
 * exports components only (react-refresh stays clean).
 */
const STATUS_ROLE: Record<CarStatus, StatusRole> = {
  current: 'neutral',
  'for-sale': 'success',
  'for-trade': 'info',
  sold: 'neutral',
  totaled: 'warning',
}

/**
 * Read-only FULL public viewer ('full' scope). Driven ENTIRELY by the
 * FullCarSnapshot the server built from the link's STORED scope — no store, no
 * auth, no add/edit/delete control anywhere. Same redesigned chrome + photo-led
 * layout as the curated viewer (DEC-8 / DEC-9), but it surfaces the owner-only
 * fields the curated view withholds: money, shops, notes, and the wishlist /
 * to-do / issues lists. Shared building blocks come from ShareCarView so the two
 * variants stay pixel-identical where they overlap.
 *
 * V5 token rules: money is passive data → text-primary + weight (NOT orange);
 * status/priority/severity → the <Badge> primitive (color + icon + text).
 */

interface ShareCarViewFullProps {
  car: FullCarSnapshot
  /** The share token from the route — turns a photoId into a token-scoped image URL. */
  token: string
}

type TabId = 'mods' | 'maintenance' | 'wishlist' | 'todos' | 'issues'

const fmtDay = (d: string): string => new Date(`${d}T12:00:00`).toLocaleDateString()

/** Numeric money in the owner's display currency (travels in the full snapshot). */
function money(amount: number, currency: string): string {
  return formatMoney(amount, currency)
}

const WISHLIST_ROLE: Record<WishlistStatus, StatusRole> = {
  wanted: 'info',
  ordered: 'warning',
  installed: 'success',
}
const WISHLIST_LABEL: Record<WishlistStatus, string> = {
  wanted: 'Wanted',
  ordered: 'Ordered',
  installed: 'Installed',
}

const TODO_ROLE: Record<TodoPriority, StatusRole> = { low: 'neutral', medium: 'info', high: 'danger' }
const TODO_LABEL: Record<TodoPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' }


/** Price tokens (V5): weight, not orange. */
function Price({ children }: { children: ReactNode }) {
  return <span className="text-meta font-semibold text-text-primary">{children}</span>
}

// ── Detail lists (full scope) ─────────────────────────────────────────────────

function ModList({ mods, currency }: { mods: FullMod[]; currency: string }) {
  if (mods.length === 0) {
    return <EmptyState icon={Wrench}>No modifications shared.</EmptyState>
  }
  const grouped = mods.reduce<Record<string, FullMod[]>>((acc, mod) => {
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
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-text-primary">{mod.name}</span>
                  {mod.cost != null && <Price>{money(mod.cost, currency)}</Price>}
                </div>
                {mod.description && (
                  <p className="mt-1 text-meta text-text-secondary">{mod.description}</p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-meta text-text-secondary">
                  {mod.installedDate && <span>{fmtDay(mod.installedDate)}</span>}
                  {mod.shop && <span>at {mod.shop}</span>}
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

function MaintenanceList({
  records,
  unit,
  currency,
}: {
  records: FullMaintenance[]
  unit: DistanceUnitCode
  currency: string
}) {
  if (records.length === 0) {
    return <EmptyState icon={ClipboardList}>No maintenance records shared.</EmptyState>
  }
  const sorted = [...records].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return (
    <div className="space-y-3">
      {sorted.map((rec, i) => (
        <div key={`${rec.service}-${i}`} className="card">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-text-primary">{rec.service}</span>
            {rec.cost != null && <Price>{money(rec.cost, currency)}</Price>}
          </div>
          {rec.notes && <p className="mt-1 text-meta text-text-secondary">{rec.notes}</p>}
          <div className="mt-1.5 flex flex-wrap gap-3 text-meta text-text-secondary">
            {rec.date && (
              <span className="inline-flex items-center gap-1">
                <Calendar size={tokens.iconSize.xs} className="text-text-tertiary" aria-hidden />
                {fmtDay(rec.date)}
              </span>
            )}
            <MileageText raw={rec.mileageRaw} miles={rec.mileageMiles} unit={unit} />
            {rec.shop && <span>at {rec.shop}</span>}
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

function WishList({ items, currency }: { items: FullWishlistItem[]; currency: string }) {
  if (items.length === 0) {
    return <EmptyState icon={ShoppingCart}>No wishlist items shared.</EmptyState>
  }
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={`${item.name}-${i}`} className="card">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-text-primary">{item.name}</span>
            {item.category && (
              <span className="rounded-sm border border-border px-1.5 py-0.5 text-meta text-text-secondary">
                {item.category}
              </span>
            )}
            <Badge status={WISHLIST_ROLE[item.status]}>{WISHLIST_LABEL[item.status]}</Badge>
          </div>
          {item.notes && <p className="mt-1 text-meta text-text-secondary">{item.notes}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {item.price != null && <Price>{money(item.price, currency)}</Price>}
            {item.link && <ExternalLinkA href={item.link} />}
          </div>
        </div>
      ))}
    </div>
  )
}

function TodoList({ todos }: { todos: FullTodo[] }) {
  if (todos.length === 0) {
    return <EmptyState icon={CheckSquare}>No tasks shared.</EmptyState>
  }
  const order: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2 }
  const pending = todos.filter((t) => !t.done).sort((a, b) => order[a.priority] - order[b.priority])
  const done = todos.filter((t) => t.done)
  return (
    <div className="space-y-5">
      {pending.length > 0 && (
        <div className="space-y-2">
          {pending.map((todo, i) => (
            <div key={`p-${i}`} className="card flex items-center gap-3 py-3">
              <span className="h-4 w-4 shrink-0 rounded-sm border border-border" aria-hidden />
              <span className="flex-1 text-body text-text-primary">{todo.text}</span>
              <Badge status={TODO_ROLE[todo.priority]}>{TODO_LABEL[todo.priority]}</Badge>
            </div>
          ))}
        </div>
      )}
      {done.length > 0 && (
        <div>
          <p className="mb-2 text-meta uppercase tracking-wide text-text-secondary">Completed</p>
          <div className="space-y-2">
            {done.map((todo, i) => (
              <div
                key={`d-${i}`}
                className="card-row flex items-center gap-3 opacity-60"
              >
                <CheckSquare
                  size={tokens.iconSize.sm}
                  className="shrink-0 text-text-tertiary"
                  aria-hidden
                />
                <span className="flex-1 text-body text-text-secondary line-through">{todo.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function IssueList({ issues }: { issues: FullIssue[] }) {
  if (issues.length === 0) {
    return <EmptyState icon={AlertTriangle}>No issues shared.</EmptyState>
  }
  return (
    <div className="space-y-3">
      {issues.map((issue, i) => (
        <div key={`${issue.title}-${i}`} className="card">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={
                issue.status === 'resolved'
                  ? 'font-semibold text-text-secondary line-through'
                  : 'font-semibold text-text-primary'
              }
            >
              {issue.title}
            </span>
            <Badge status={ISSUE_SEVERITY_META[issue.severity].role}>{ISSUE_SEVERITY_META[issue.severity].label}</Badge>
            <span className="text-meta capitalize text-text-secondary">
              {issue.status.replace('-', ' ')}
            </span>
          </div>
          {issue.description && (
            <p className="mt-1 text-meta text-text-secondary">{issue.description}</p>
          )}
          <p className="mt-1 text-meta text-text-secondary">
            {new Date(issue.createdAt).toLocaleDateString()}
            {issue.resolvedAt ? ` · Resolved ${new Date(issue.resolvedAt).toLocaleDateString()}` : ''}
          </p>
        </div>
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ShareCarViewFull({ car, token }: ShareCarViewFullProps) {
  const unit = car.settings.distanceUnit
  const currency = car.settings.currency
  const coverSrc = car.coverPhotoId ? shareImgPath(token, car.coverPhotoId) : ''
  const status = car.status as CarStatus
  const saleAmount =
    car.salePrice != null && Number.isFinite(Number(car.salePrice)) && car.salePrice !== ''
      ? money(Number(car.salePrice), currency)
      : car.salePrice

  const tabs: ShareTab<TabId>[] = [
    { id: 'mods', label: 'Mods', icon: Wrench },
    { id: 'maintenance', label: 'Maintenance', icon: ClipboardList },
    { id: 'wishlist', label: 'Wishlist', icon: ShoppingCart },
    { id: 'todos', label: 'To-Do', icon: CheckSquare },
    { id: 'issues', label: 'Issues', icon: AlertTriangle },
  ]
  // Default to the first tab that has content (Photos lead as the gallery, not a
  // tab), preserving the pre-redesign "first non-empty section" behaviour.
  const counts: Record<TabId, number> = {
    mods: car.mods.length,
    maintenance: car.maintenance.length,
    wishlist: car.wishlist.length,
    todos: car.todos.length,
    issues: car.issues.length,
  }
  const [tab, setTab] = useState<TabId>(tabs.find((t) => counts[t.id] > 0)?.id ?? 'mods')

  return (
    <ShareShell>
      <CarHero
        coverSrc={coverSrc}
        topLeft={
          <div className="absolute left-4 top-4">
            <Badge status="neutral" icon={Eye}>
              Read-only shared build (full)
            </Badge>
          </div>
        }
        actions={
          <div className="absolute right-4 top-4">
            <SaveBuildButton token={token} car={car} scope="full" />
          </div>
        }
        meta={
          <>
            <Badge status={STATUS_ROLE[status] ?? 'neutral'}>
              {(STATUS_CONFIG[status] ?? STATUS_CONFIG.current).label}
            </Badge>
            {/* DEC-10: owner display name — present iff the server resolved consent. */}
            {car.ownerName && (
              <span className="text-meta text-text-secondary">by {car.ownerName}</span>
            )}
            {car.purchaseDate && (
              <span className="text-meta text-text-secondary">Owned since {fmtDay(car.purchaseDate)}</span>
            )}
            {car.status === 'sold' && car.saleDate && (
              <span className="text-meta text-text-secondary">Sold {fmtDay(car.saleDate)}</span>
            )}
            {saleAmount && (
              <span className="inline-flex items-center gap-1 text-meta font-semibold text-text-primary">
                <Tag size={tokens.iconSize.xs} className="text-text-tertiary" aria-hidden />
                {saleAmount}
              </span>
            )}
            {car.tradeFor && (
              <span className="text-meta text-text-secondary">Trade for {car.tradeFor}</span>
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
          /* DEC-19: plate present iff the owner opted in (showPlate). */
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
        {tab === 'mods' && <ModList mods={car.mods} currency={currency} />}
        {tab === 'maintenance' && (
          <MaintenanceList records={car.maintenance} unit={unit} currency={currency} />
        )}
        {tab === 'wishlist' && <WishList items={car.wishlist} currency={currency} />}
        {tab === 'todos' && <TodoList todos={car.todos} />}
        {tab === 'issues' && <IssueList issues={car.issues} />}
      </div>
    </ShareShell>
  )
}
