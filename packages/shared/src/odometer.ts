// DEC-16 mileage read-model (§13.3/§13.4) — the pure, RN-safe derivations over
// the dated check-in timeline. NOTHING here writes: the `mileage` table is the
// source of truth for readings, `maintenance` is the source of truth for its own
// at-service / next-due mileage, and these helpers only COMPUTE views.
//
//  - currentCheckIn       → the car's current odometer = the latest check-in.
//  - buildOdometerTimeline → the union view (§13.4): check-ins ∪ maintenance
//                            at-service readings, by COMPUTATION, never a copy.
//  - getDueMaintenance    → due/overdue by date AND by mileage (finding U2).
//
// Canonical comparison is always in miles (`valueMiles` / `mileageMiles`,
// derived via the exact ×1.609344 factor at entry); a non-numeric reading has no
// canonical and is excluded from timeline/usage math but kept for display.
import { parseMileageMiles } from './flatten'
import type { DistanceUnitCode } from './units'
import type { MileageCheckIn, MileageSource } from './types'

/**
 * The check-in that represents the car's CURRENT odometer (§13.3): the greatest
 * `(date, createdAt)` — most-recent reading wins, `createdAt` breaks ties. Both
 * are ISO-8601 so lexical compare is chronological. null ⇔ empty/absent log.
 */
export function currentCheckIn(
  log: readonly MileageCheckIn[] | null | undefined,
): MileageCheckIn | null {
  if (log == null || log.length === 0) return null
  let best = log[0]!
  for (let i = 1; i < log.length; i += 1) {
    const c = log[i]!
    if (c.date > best.date || (c.date === best.date && c.createdAt > best.createdAt)) best = c
  }
  return best
}

/** One dated point on the odometer timeline; `miles` is the canonical value. */
export interface OdometerPoint {
  /** Canonical miles (the y-axis); always present (non-numeric readings are excluded). */
  miles: number
  /** ISO-8601 date the odometer was at this value (the x-axis). */
  date: string
  /** Row-creation timestamp (the ordering tiebreak). */
  createdAt: string
  /** The reading exactly as entered (for display/tooltip). */
  valueRaw: string
  /** The unit the reading was entered in (frozen). Maintenance points are canonical → 'mi'. */
  unit: DistanceUnitCode
  /** Provenance — a check-in's own source, or 'maintenance' for an at-service reading. */
  source: MileageSource | 'maintenance'
  /** The originating rowId (checkInId or recId) — never surfaced publicly. */
  refId: string
}

/** A maintenance record as the timeline consumes it (canonical miles re-attached). */
export interface TimelineMaintenanceInput {
  id: string
  date: string
  createdAt: string
  /** At-service mileage, raw as entered (string | null). */
  mileage: string | null
  /** Canonical at-service miles; null ⇔ non-numeric/blank → excluded from the timeline. */
  mileageMiles: number | null
}

/**
 * The odometer timeline (§13.4): a COMPUTED union — never a copy — of
 *  1. each `mileage` check-in whose reading parses numerically, and
 *  2. each `maintenance` at-service reading with a canonical mileage,
 * sorted by `(date asc, createdAt asc)`. The two tables meet ONLY here; deleting
 * a maintenance row can never orphan a derived reading (nothing was materialized).
 */
export function buildOdometerTimeline(
  checkIns: readonly MileageCheckIn[] | null | undefined,
  maintenance?: readonly TimelineMaintenanceInput[] | null,
): OdometerPoint[] {
  const points: OdometerPoint[] = []
  for (const c of checkIns ?? []) {
    const miles = parseMileageMiles(c.value, c.unit)
    if (miles == null) continue
    points.push({
      miles,
      date: c.date,
      createdAt: c.createdAt,
      valueRaw: c.value,
      unit: c.unit,
      source: c.source,
      refId: c.id,
    })
  }
  for (const m of maintenance ?? []) {
    if (m.mileageMiles == null) continue
    points.push({
      miles: m.mileageMiles,
      date: m.date,
      createdAt: m.createdAt,
      valueRaw: m.mileage ?? '',
      unit: 'mi',
      source: 'maintenance',
      refId: m.id,
    })
  }
  points.sort((a, b) =>
    a.date !== b.date
      ? a.date < b.date ? -1 : 1
      : a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0,
  )
  return points
}

// ── Maintenance due / overdue (finding U2 / audit #7) ───────
export type DueStatus = 'overdue' | 'due-soon' | 'ok'

/** A maintenance record as the due-check consumes it (canonical next-due miles). */
export interface DueMaintenanceRecordInput {
  id: string
  /** ISO-8601 date the service is next due; '' ⇔ no date target. */
  nextDueDate: string
  /** Canonical next-due miles; null ⇔ no mileage target. */
  nextDueMileageMiles: number | null
}

export interface GetDueMaintenanceOptions {
  /** Current odometer in canonical miles (latest check-in); null ⇔ unknown → mileage dimension unevaluable. */
  currentMiles: number | null
  /** "now" (testability). Default new Date(). */
  now?: Date
  /** Days-ahead window that counts as due-soon (default 30). */
  dueSoonDays?: number
  /** Miles-ahead window that counts as due-soon (default 500). */
  dueSoonMiles?: number
}

export interface DueMaintenanceResult {
  /** Records past their date or mileage target. */
  overdue: number
  /** Records inside the due-soon window (and not overdue). */
  dueSoon: number
  /** overdue + dueSoon. */
  count: number
  /** Per-record status — ONLY records that carry a date or mileage target. */
  byId: Record<string, DueStatus>
}

const DAY_MS = 86_400_000
const worse = (a: DueStatus, b: DueStatus): DueStatus =>
  a === 'overdue' || b === 'overdue' ? 'overdue' : a === 'due-soon' || b === 'due-soon' ? 'due-soon' : 'ok'

/**
 * Compute due/overdue for a car's maintenance, by date AND by mileage (§13.4,
 * finding U2). Mileage comparison uses the current odometer (latest check-in)
 * vs each record's canonical `nextDueMileageMiles` — maintenance "feeds the
 * timeline by COMPUTATION", so nothing is copied into the `mileage` table. A
 * record with neither target is omitted from `byId`.
 */
export function getDueMaintenance(
  records: readonly DueMaintenanceRecordInput[],
  options: GetDueMaintenanceOptions,
): DueMaintenanceResult {
  const { currentMiles, dueSoonDays = 30, dueSoonMiles = 500 } = options
  const nowMs = (options.now ?? new Date()).getTime()
  const byId: Record<string, DueStatus> = {}
  let overdue = 0
  let dueSoon = 0

  for (const rec of records) {
    const hasDate = rec.nextDueDate !== ''
    const hasMiles = rec.nextDueMileageMiles != null
    if (!hasDate && !hasMiles) continue

    let status: DueStatus = 'ok'

    if (hasDate) {
      const dueMs = new Date(`${rec.nextDueDate}T00:00:00`).getTime()
      if (Number.isFinite(dueMs)) {
        if (dueMs < nowMs) status = worse(status, 'overdue')
        else if (dueMs - nowMs <= dueSoonDays * DAY_MS) status = worse(status, 'due-soon')
      }
    }

    if (hasMiles && currentMiles != null) {
      const target = rec.nextDueMileageMiles as number
      if (currentMiles >= target) status = worse(status, 'overdue')
      else if (target - currentMiles <= dueSoonMiles) status = worse(status, 'due-soon')
    }

    byId[rec.id] = status
    if (status === 'overdue') overdue += 1
    else if (status === 'due-soon') dueSoon += 1
  }

  return { overdue, dueSoon, count: overdue + dueSoon, byId }
}

/**
 * True iff `value` is a non-empty, parseable date string (e.g. 'YYYY-MM-DD').
 * Used to pick the seeded `initial` check-in's date: purchaseDate if valid,
 * else the car's createdAt (§13.5 step 2).
 */
export function isValidDateString(value: string | null | undefined): value is string {
  return value != null && value !== '' && !Number.isNaN(new Date(value).getTime())
}
