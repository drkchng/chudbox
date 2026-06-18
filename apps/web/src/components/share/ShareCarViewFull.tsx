import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Camera,
  Wrench,
  ClipboardList,
  ShoppingCart,
  CheckSquare,
  AlertTriangle,
  ExternalLink,
  Calendar,
  Eye,
  Tag,
} from 'lucide-react'
import { formatMileage, formatMoney, shareImgPath } from '@chudbox/shared'
import type {
  DistanceUnitCode,
  FullCarSnapshot,
  FullIssue,
  FullMaintenance,
  FullMod,
  FullTodo,
  FullWishlistItem,
} from '@chudbox/shared'
import { STATUS_CONFIG } from '../../utils/carStatus'
import CarHero from '../CarHero'
import MileageText from '../MileageText'
import { PhotoGrid } from './ShareCarView'

/**
 * Read-only FULL public viewer ('full' scope). Driven ENTIRELY by the
 * FullCarSnapshot the server built from the link's STORED scope — there is no
 * store, no auth, and NO add/edit/delete control anywhere (every section is a
 * pure render of the snapshot). It mirrors the owner page's tab idioms
 * (CarHero, the tab bar, the card layouts) but in a strictly read-only form,
 * showing the owner-only fields the curated viewer withholds: money, shops,
 * notes, the wishlist / to-do / issues lists, and salePrice / tradeFor.
 *
 * It reuses the curated viewer's PhotoGrid for the photo tab (identical
 * behavior) and never imports the auth client, so it works fully logged-out.
 */

interface ShareCarViewFullProps {
  car: FullCarSnapshot
  /** The share token from the route — turns a photoId into a token-scoped image URL. */
  token: string
}

type TabId = 'photos' | 'mods' | 'maintenance' | 'wishlist' | 'todos' | 'issues'

interface TabDef {
  id: TabId
  label: string
  icon: LucideIcon
  count: number
}

const fmtDay = (d: string): string => new Date(`${d}T12:00:00`).toLocaleDateString()

/** Format a numeric money amount with the owner's display currency (the same
 * currency the owner sees; it travels in the full snapshot's settings). */
function money(amount: number, currency: string): string {
  return formatMoney(amount, currency)
}

const WISHLIST_STATUS: Record<FullWishlistItem['status'], { label: string; class: string }> = {
  wanted: { label: 'Wanted', class: 'bg-blue-900/50 text-blue-300 border-blue-700/40' },
  ordered: { label: 'Ordered', class: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/40' },
  installed: { label: 'Installed', class: 'bg-green-900/50 text-green-300 border-green-700/40' },
}

const TODO_PRIORITY: Record<FullTodo['priority'], { label: string; class: string }> = {
  low: { label: 'Low', class: 'bg-gray-800 text-gray-400 border-gray-700' },
  medium: { label: 'Medium', class: 'bg-blue-900/50 text-blue-300 border-blue-700/40' },
  high: { label: 'High', class: 'bg-red-900/50 text-red-300 border-red-700/40' },
}

const ISSUE_SEVERITY: Record<FullIssue['severity'], { label: string; class: string }> = {
  minor: { label: 'Minor', class: 'bg-gray-800 text-gray-300 border-gray-700' },
  moderate: { label: 'Moderate', class: 'bg-yellow-900/50 text-yellow-300 border-yellow-700/40' },
  critical: { label: 'Critical', class: 'bg-red-900/50 text-red-300 border-red-700/40' },
}

function ModList({ mods, currency }: { mods: FullMod[]; currency: string }) {
  if (mods.length === 0) {
    return (
      <div className="text-center py-16 text-gray-600">
        <Wrench size={36} className="mx-auto mb-3 opacity-40" />
        <p>No modifications shared.</p>
      </div>
    )
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
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">{category}</h4>
          <div className="space-y-2">
            {group.map((mod, i) => (
              <div key={`${mod.name}-${i}`} className="card">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-white">{mod.name}</span>
                  {mod.cost != null && (
                    <span className="text-xs text-accent font-semibold">{money(mod.cost, currency)}</span>
                  )}
                </div>
                {mod.description && <p className="text-xs text-gray-400 mt-1">{mod.description}</p>}
                <div className="flex gap-3 mt-1.5 text-xs text-gray-600 flex-wrap items-center">
                  {mod.installedDate && <span>{fmtDay(mod.installedDate)}</span>}
                  {mod.shop && <span>at {mod.shop}</span>}
                  {mod.link && (
                    <a
                      href={mod.link}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      <ExternalLink size={11} /> View Link
                    </a>
                  )}
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
    return (
      <div className="text-center py-16 text-gray-600">
        <ClipboardList size={36} className="mx-auto mb-3 opacity-40" />
        <p>No maintenance records shared.</p>
      </div>
    )
  }
  const sorted = [...records].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return (
    <div className="space-y-3">
      {sorted.map((rec, i) => (
        <div key={`${rec.service}-${i}`} className="card">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-white">{rec.service}</span>
            {rec.cost != null && (
              <span className="text-xs text-accent font-semibold">{money(rec.cost, currency)}</span>
            )}
          </div>
          {rec.notes && <p className="text-xs text-gray-400 mt-1">{rec.notes}</p>}
          <div className="flex gap-3 mt-1.5 text-xs text-gray-500 flex-wrap">
            {rec.date && (
              <span className="flex items-center gap-1">
                <Calendar size={10} />
                {fmtDay(rec.date)}
              </span>
            )}
            <MileageText raw={rec.mileageRaw} miles={rec.mileageMiles} unit={unit} />
            {rec.shop && <span>at {rec.shop}</span>}
          </div>
          {(rec.nextDueDate || rec.nextDueMileageRaw) && (
            <p className="text-xs text-gray-600 mt-1">
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
    return (
      <div className="text-center py-16 text-gray-600">
        <ShoppingCart size={36} className="mx-auto mb-3 opacity-40" />
        <p>No wishlist items shared.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={`${item.name}-${i}`} className="card flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-white">{item.name}</span>
              {item.category && (
                <span className="text-xs text-gray-500 border border-border rounded px-1.5 py-0.5">{item.category}</span>
              )}
              <span className={`badge border ${WISHLIST_STATUS[item.status].class}`}>
                {WISHLIST_STATUS[item.status].label}
              </span>
            </div>
            {item.notes && <p className="text-xs text-gray-500 mt-1">{item.notes}</p>}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {item.price != null && (
                <span className="text-sm font-semibold text-accent">{money(item.price, currency)}</span>
              )}
              {item.link && (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                >
                  <ExternalLink size={11} /> View Link
                </a>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function TodoList({ todos }: { todos: FullTodo[] }) {
  if (todos.length === 0) {
    return (
      <div className="text-center py-16 text-gray-600">
        <CheckSquare size={36} className="mx-auto mb-3 opacity-40" />
        <p>No tasks shared.</p>
      </div>
    )
  }
  const order: Record<FullTodo['priority'], number> = { high: 0, medium: 1, low: 2 }
  const pending = todos.filter((t) => !t.done).sort((a, b) => order[a.priority] - order[b.priority])
  const done = todos.filter((t) => t.done)
  return (
    <div className="space-y-5">
      {pending.length > 0 && (
        <div className="space-y-2">
          {pending.map((todo, i) => (
            <div key={`p-${i}`} className="card flex items-center gap-3 py-3">
              <span className="w-4 h-4 rounded border border-border shrink-0" aria-hidden />
              <span className="flex-1 text-sm text-gray-200">{todo.text}</span>
              <span className={`badge border text-xs ${TODO_PRIORITY[todo.priority].class}`}>
                {TODO_PRIORITY[todo.priority].label}
              </span>
            </div>
          ))}
        </div>
      )}
      {done.length > 0 && (
        <div>
          <p className="text-xs text-gray-600 uppercase tracking-wide mb-2">Completed</p>
          <div className="space-y-2">
            {done.map((todo, i) => (
              <div key={`d-${i}`} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface/50 opacity-50">
                <CheckSquare size={16} className="text-accent shrink-0" aria-hidden />
                <span className="flex-1 text-sm text-gray-400 line-through">{todo.text}</span>
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
    return (
      <div className="text-center py-16 text-gray-600">
        <AlertTriangle size={36} className="mx-auto mb-3 opacity-40" />
        <p>No issues shared.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {issues.map((issue, i) => (
        <div key={`${issue.title}-${i}`} className="card flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-medium ${issue.status === 'resolved' ? 'text-gray-500 line-through' : 'text-white'}`}>
                {issue.title}
              </span>
              <span className={`badge border ${ISSUE_SEVERITY[issue.severity].class}`}>
                {ISSUE_SEVERITY[issue.severity].label}
              </span>
              <span className="text-xs text-gray-600 capitalize">{issue.status.replace('-', ' ')}</span>
            </div>
            {issue.description && <p className="text-xs text-gray-400 mt-1">{issue.description}</p>}
            <p className="text-xs text-gray-600 mt-1">
              {new Date(issue.createdAt).toLocaleDateString()}
              {issue.resolvedAt ? ` · Resolved ${new Date(issue.resolvedAt).toLocaleDateString()}` : ''}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ShareCarViewFull({ car, token }: ShareCarViewFullProps) {
  const unit = car.settings.distanceUnit
  const currency = car.settings.currency
  const statusCfg = STATUS_CONFIG[car.status] ?? STATUS_CONFIG.current
  const coverSrc = car.coverPhotoId ? shareImgPath(token, car.coverPhotoId) : ''
  const saleAmount = car.salePrice != null && Number.isFinite(Number(car.salePrice)) && car.salePrice !== ''
    ? money(Number(car.salePrice), currency)
    : car.salePrice

  const tabs: TabDef[] = [
    { id: 'photos', label: 'Photos', icon: Camera, count: car.photos.length },
    { id: 'mods', label: 'Mods', icon: Wrench, count: car.mods.length },
    { id: 'maintenance', label: 'Maintenance', icon: ClipboardList, count: car.maintenance.length },
    { id: 'wishlist', label: 'Wishlist', icon: ShoppingCart, count: car.wishlist.length },
    { id: 'todos', label: 'To-Do', icon: CheckSquare, count: car.todos.length },
    { id: 'issues', label: 'Issues', icon: AlertTriangle, count: car.issues.length },
  ]
  const firstWithContent = tabs.find((t) => t.count > 0)?.id ?? 'photos'
  const [tab, setTab] = useState<TabId>(firstWithContent)

  return (
    <div className="min-h-screen bg-dark">
      <CarHero
        coverSrc={coverSrc}
        topLeft={
          <span className="absolute top-4 left-4 badge bg-dark/90 border border-white/10 text-gray-300">
            <Eye size={11} className="mr-1" /> Read-only shared build (full)
          </span>
        }
        actions={
          <span className="absolute top-4 right-4 text-sm font-bold tracking-tight text-white/70">Chudbox</span>
        }
        meta={
          <>
            <span className={`badge border text-xs ${statusCfg.class}`}>{statusCfg.label}</span>
            {car.purchaseDate && <span className="text-xs text-gray-500">Owned since {fmtDay(car.purchaseDate)}</span>}
            {car.status === 'sold' && car.saleDate && (
              <span className="text-xs text-gray-500">Sold {fmtDay(car.saleDate)}</span>
            )}
            {saleAmount && (
              <span className="text-xs text-accent inline-flex items-center gap-1">
                <Tag size={11} /> {saleAmount}
              </span>
            )}
            {car.tradeFor && <span className="text-xs text-gray-400">Trade for {car.tradeFor}</span>}
          </>
        }
        title={
          <>
            {car.year} {car.make} {car.model}
          </>
        }
        subline={
          <>
            {car.trim && <span className="text-sm text-gray-300">{car.trim}</span>}
            {car.color && <span className="text-sm text-gray-400">· {car.color}</span>}
            {car.mileageRaw && (
              <span className="text-sm text-gray-400">
                · <MileageText raw={car.mileageRaw} miles={car.mileageMiles} unit={unit} />
              </span>
            )}
            {car.nickname && <span className="text-sm text-accent font-medium">· "{car.nickname}"</span>}
          </>
        }
      />

      {/* Tab bar */}
      <div className="border-b border-border bg-surface/30 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-1 py-2 overflow-x-auto no-scrollbar" style={{ scrollbarWidth: 'none' }}>
            {tabs.map(({ id: tid, label, icon: Icon }) => (
              <button
                key={tid}
                onClick={() => setTab(tid)}
                className={`tab-btn flex items-center gap-1.5 ${tab === tid ? 'tab-active' : 'tab-inactive'}`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {tab === 'photos' && <PhotoGrid photos={car.photos} token={token} />}
        {tab === 'mods' && <ModList mods={car.mods} currency={currency} />}
        {tab === 'maintenance' && <MaintenanceList records={car.maintenance} unit={unit} currency={currency} />}
        {tab === 'wishlist' && <WishList items={car.wishlist} currency={currency} />}
        {tab === 'todos' && <TodoList todos={car.todos} />}
        {tab === 'issues' && <IssueList issues={car.issues} />}
      </div>
    </div>
  )
}
