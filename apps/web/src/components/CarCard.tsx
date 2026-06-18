import { Link } from 'react-router-dom'
import { Car as CarIcon, CheckSquare, Wrench } from 'lucide-react'
import { getCarStatus, STATUS_CONFIG } from '../utils/carStatus'
import useGarageStore from '../store/useGarageStore'
import { resolvePhotoSrc } from '../utils/image'
import { CURRENCIES, formatCurrentMileage } from '../utils/units'
import { carDueMaintenance } from '../utils/maintenanceDue'
import Badge from './ui/Badge'
import DueBadge from './DueBadge'
import type { CarStatus, StatusRole, StoredCar } from '../types'

interface CarCardProps {
  car: StoredCar
}

// Car status → the design-system status role (V3/V4/V5). The five ad-hoc colour
// maps converge on the named status tokens: sale = success, trade = info,
// totaled = warning (status-orange), current/sold = neutral. Orange is reclaimed
// for action/alert only — the open-issues count is the lone alert here (danger).
const STATUS_ROLE: Record<CarStatus, StatusRole> = {
  current: 'neutral',
  'for-sale': 'success',
  'for-trade': 'info',
  sold: 'neutral',
  totaled: 'warning',
}

export default function CarCard({ car }: CarCardProps) {
  const currency     = useGarageStore((s) => s.currency)
  const distanceUnit = useGarageStore((s) => s.distanceUnit)
  const sym          = CURRENCIES[currency]?.symbol ?? '$'
  // DEC-16: current mileage = the latest check-in (falls back to the scalar mirror).
  const mileageText  = formatCurrentMileage(car, car.mileageMiles, distanceUnit)
  const coverPhoto   = car.photos.find((p) => p.id === car.coverPhoto) || car.photos[0]
  const coverSrc     = coverPhoto ? resolvePhotoSrc(coverPhoto) : ''
  const openIssues   = car.issues.filter((i) => i.status !== 'resolved').length
  const pendingTodos = car.todos.filter((t) => !t.done).length
  const due          = carDueMaintenance(car)
  const status       = getCarStatus(car)
  const statusCfg    = STATUS_CONFIG[status]
  const askingPrice  =
    status === 'for-sale' && car.salePrice ? `${sym}${Number(car.salePrice).toLocaleString()}` : ''

  return (
    // A2: a real focusable control (native <a> via react-router Link) with a
    // keyboard path — Enter activates, the visible focus-ring shows on
    // focus-visible. `.card` carries the density + elevation baseline.
    <Link
      to={`/car/${car.id}`}
      aria-label={`${car.year} ${car.make} ${car.model}${car.nickname ? ` — “${car.nickname}”` : ''}`}
      className="card group block p-0 overflow-hidden rounded-lg outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      {/* Image */}
      <div className="relative h-44 overflow-hidden bg-surface">
        {coverSrc ? (
          <div className="absolute inset-0">
            <img src={coverSrc} alt="" className="h-full w-full object-cover" />
            {/* Solid stop at 12px before the fade begins (gradient seam fix). */}
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0"
              style={{
                height: '80px',
                background: 'linear-gradient(to top, rgb(var(--surface)) 12px, rgb(var(--surface) / 0) 80px)',
              }}
            />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface to-surface-2">
            <CarIcon size={40} className="text-text-disabled" />
          </div>
        )}

        {/* Status (neutral/role-coloured) + the alerts: overdue maintenance
            (U2 — the product's reason to exist) beside open issues, both danger. */}
        <div className="absolute inset-x-2.5 top-2.5 flex items-center justify-between gap-2">
          <Badge status={STATUS_ROLE[status]}>{statusCfg.label}</Badge>
          <div className="flex items-center gap-1.5">
            <DueBadge due={due} />
            {openIssues > 0 && (
              <Badge status="danger" title={`${openIssues} open issue${openIssues > 1 ? 's' : ''}`}>
                {openIssues}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="mb-0.5 font-mono text-meta text-text-secondary">{car.year}</p>
            <h3 className="truncate font-semibold text-text-primary transition-colors group-hover:text-accent">
              {car.make} {car.model}
            </h3>
            {/* V5: nickname = identity, not action → italic text-secondary (not orange). */}
            {car.nickname && (
              <p className="mt-0.5 truncate text-meta italic text-text-secondary">“{car.nickname}”</p>
            )}
          </div>
          {car.color && (
            <span className="mt-0.5 shrink-0 rounded-sm border border-border px-2 py-0.5 text-meta text-text-secondary">
              {car.color}
            </span>
          )}
        </div>

        {/* V5: price = passive data → text-primary weight (not orange). */}
        {askingPrice && (
          <p className="mb-3 text-subhead font-semibold text-text-primary">{askingPrice}</p>
        )}

        {status === 'for-trade' && car.tradeFor && (
          <p className="mb-3 line-clamp-2 text-meta leading-relaxed text-text-secondary">
            Trade for: {car.tradeFor.split('\n').filter(Boolean).join(', ')}
          </p>
        )}

        {/* Passive counts stay neutral — orange is reserved for action/alert. */}
        <div className="flex items-center gap-3 border-t border-border pt-3 text-meta text-text-secondary">
          <span className="flex items-center gap-1.5">
            <Wrench size={12} className="text-text-tertiary" />
            {car.mods.length} mods
          </span>
          {pendingTodos > 0 && (
            <span className="flex items-center gap-1.5">
              <CheckSquare size={12} className="text-text-tertiary" />
              {pendingTodos} to-do
            </span>
          )}
          {mileageText && <span className="ml-auto font-mono text-text-secondary">{mileageText}</span>}
        </div>
      </div>
    </Link>
  )
}
