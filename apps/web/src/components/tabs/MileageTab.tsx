import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Plus, Trash2, Gauge, Calendar } from 'lucide-react'
import {
  buildOdometerTimeline,
  DISTANCE_UNITS,
  formatCurrentMileage,
  formatMileage,
  milesToUnit,
  parseMileageMiles,
  tokens,
} from '@chudbox/shared'
import type { DistanceUnitCode, MileageSource, OdometerPoint } from '@chudbox/shared'
import useGarageStore from '../../store/useGarageStore'
import DateInput from '../DateInput'
import Button from '../ui/Button'
import IconButton from '../ui/IconButton'
import type { StoredCar } from '../../types'

const fmtDate = (iso: string): string =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString() : ''

// Only non-default provenance is worth a chip — a manual reading is the norm.
const SOURCE_LABEL: Partial<Record<MileageSource, string>> = {
  initial: 'initial',
  import: 'imported',
  'legacy-edit': 'legacy',
}

interface MileageTabProps {
  car: StoredCar
  /** Opens + focuses the log form on mount (the toolbar "Log mileage" action). */
  autoLog?: boolean
}

/**
 * DEC-16 over-time view (§13.2/§13.4): the dense mileage timeline. The current
 * odometer (= latest check-in), a lightweight inline sparkline of the COMPUTED
 * odometer timeline (check-ins ∪ maintenance at-service readings — never copied
 * into the mileage table), and the deletable check-in list, newest first. A
 * quick "Log mileage" form adds a dated reading in the active unit.
 */
export default function MileageTab({ car, autoLog = false }: MileageTabProps) {
  const logMileage = useGarageStore((s) => s.logMileage)
  const deleteMileage = useGarageStore((s) => s.deleteMileage)
  const distanceUnit = useGarageStore((s) => s.distanceUnit)
  const distShort = DISTANCE_UNITS[distanceUnit]?.short ?? 'mi'

  const [showForm, setShowForm] = useState(autoLog)
  const [value, setValue] = useState('')
  const [date, setDate] = useState('')
  const valueRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showForm) valueRef.current?.focus()
  }, [showForm])

  const handleAdd = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (value.trim() === '') return
    logMileage(car.id, { value, date })
    setValue('')
    setDate('')
    setShowForm(false)
  }

  const log = car.mileageLog ?? []
  // Newest first for the list (date, then createdAt).
  const sorted = [...log].sort((a, b) =>
    a.date !== b.date
      ? a.date < b.date ? 1 : -1
      : a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  )
  const currentText = formatCurrentMileage(car, car.mileageMiles, distanceUnit)

  // §13.4 computed union — check-ins ∪ maintenance at-service readings — drives
  // the sparkline. The maintenance side feeds the timeline by COMPUTATION only.
  const timeline = buildOdometerTimeline(
    log,
    car.maintenance.map((rec) => ({
      id: rec.id,
      date: rec.date,
      createdAt: rec.createdAt,
      mileage: rec.mileage,
      mileageMiles: rec.mileageMiles ?? null,
    })),
  )

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-subhead font-semibold text-text-primary">Mileage</h3>
          <p className="mt-0.5 text-meta text-text-secondary">
            Current odometer:{' '}
            <span className="font-mono font-semibold text-text-primary">{currentText ?? '—'}</span>
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus size={tokens.iconSize.sm} /> Log mileage
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="card mb-5 space-y-3 border-accent/30">
          <h4 className="text-body font-semibold text-text-primary">New mileage check-in</h4>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="mileage-value" className="label">Odometer ({distShort})</label>
              <input
                id="mileage-value"
                ref={valueRef}
                className="input"
                type="number"
                placeholder="45000"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <div role="group" aria-labelledby="mileage-date-label">
              <span id="mileage-date-label" className="label">Date</span>
              <DateInput value={date} onChange={setDate} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button type="submit" size="sm">Save check-in</Button>
          </div>
        </form>
      )}

      {log.length === 0 ? (
        <div className="py-16 text-center">
          <Gauge size={tokens.iconSize.xl} className="mx-auto mb-3 text-text-disabled" />
          <p className="text-text-secondary">No mileage check-ins yet.</p>
          <p className="mt-1 text-meta text-text-tertiary">Log a reading to start the timeline.</p>
        </div>
      ) : (
        <>
          <Sparkline timeline={timeline} unit={distanceUnit} />
          <div className="space-y-2">
            {sorted.map((ck) => {
              const text = formatMileage(ck.value, parseMileageMiles(ck.value, ck.unit), distanceUnit)
              const srcLabel = SOURCE_LABEL[ck.source]
              return (
                <div key={ck.id} className="card-row flex items-center gap-4">
                  <span className="font-mono font-semibold text-text-primary">{text ?? ck.value}</span>
                  {srcLabel && (
                    <span className="rounded-sm border border-border px-1.5 py-0.5 text-meta text-text-tertiary">
                      {srcLabel}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-1 text-meta text-text-secondary">
                    <Calendar size={tokens.iconSize.xs} className="text-text-tertiary" />
                    {fmtDate(ck.date)}
                  </span>
                  <IconButton
                    aria-label={`Delete check-in ${text ?? ck.value}`}
                    title="Delete"
                    onClick={() => deleteMileage(car.id, ck.id)}
                  >
                    <Trash2 size={tokens.iconSize.sm} />
                  </IconButton>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

interface SparklineProps {
  timeline: OdometerPoint[]
  unit: DistanceUnitCode
}

/**
 * A dependency-free inline SVG sparkline of the odometer timeline (no chart lib —
 * the brand is dense/native). Renders nothing below 2 numeric points. The y-axis
 * is the canonical miles converted to the active unit; the x-axis is index-spaced
 * (dates are shown in the list, not on the axis — this is a trend glance).
 */
function Sparkline({ timeline, unit }: SparklineProps) {
  if (timeline.length < 2) return null
  const W = 100
  const H = 28
  const values = timeline.map((p) => milesToUnit(p.miles, unit))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = W / (values.length - 1)
  const points = values
    .map((v, i) => {
      const x = i * stepX
      // 2px padding top/bottom; higher value = higher on screen (smaller y).
      const y = 2 + (H - 4) * (1 - (v - min) / span)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <div className="card mb-4 p-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Mileage trend over time"
        className="h-12 w-full"
      >
        <polyline
          points={points}
          fill="none"
          stroke="rgb(var(--accent))"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}
