// DEC-16 read-model derivations (§13.3/§13.4): current odometer, the computed
// timeline union, and due/overdue by date AND mileage (finding U2).
import { describe, expect, it } from 'vitest'
import {
  buildOdometerTimeline,
  currentCheckIn,
  getDueMaintenance,
  isValidDateString,
  KM_PER_MILE,
} from './index'
import type { MileageCheckIn } from './index'

const ck = (over: Partial<MileageCheckIn>): MileageCheckIn => ({
  id: 'c',
  value: '1000',
  unit: 'mi',
  date: '2026-01-01',
  source: 'manual',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

describe('currentCheckIn (current odometer = latest check-in)', () => {
  it('returns null for an empty / absent log', () => {
    expect(currentCheckIn(undefined)).toBeNull()
    expect(currentCheckIn(null)).toBeNull()
    expect(currentCheckIn([])).toBeNull()
  })

  it('picks the greatest date', () => {
    const log = [
      ck({ id: 'a', date: '2026-01-01' }),
      ck({ id: 'b', date: '2026-06-01' }),
      ck({ id: 'c', date: '2026-03-01' }),
    ]
    expect(currentCheckIn(log)?.id).toBe('b')
  })

  it('breaks a same-date tie by createdAt', () => {
    const log = [
      ck({ id: 'a', date: '2026-06-01', createdAt: '2026-06-01T08:00:00.000Z' }),
      ck({ id: 'b', date: '2026-06-01', createdAt: '2026-06-01T20:00:00.000Z' }),
    ]
    expect(currentCheckIn(log)?.id).toBe('b')
  })
})

describe('buildOdometerTimeline (computed union, never a copy)', () => {
  it('unions check-ins + maintenance, excludes non-numeric, sorts by (date, createdAt)', () => {
    const checkIns = [
      ck({ id: 'k2', value: '12000', unit: 'mi', date: '2026-05-01' }),
      ck({ id: 'k1', value: '10000', unit: 'mi', date: '2026-01-01' }),
      ck({ id: 'kx', value: 'unknown', date: '2026-02-01' }), // non-numeric → excluded
    ]
    const maintenance = [
      { id: 'm1', date: '2026-03-01', createdAt: '2026-03-01T00:00:00.000Z', mileage: '11000', mileageMiles: 11000 },
      { id: 'mx', date: '2026-04-01', createdAt: '2026-04-01T00:00:00.000Z', mileage: null, mileageMiles: null }, // no canonical → excluded
    ]
    const points = buildOdometerTimeline(checkIns, maintenance)
    expect(points.map((p) => p.refId)).toEqual(['k1', 'm1', 'k2'])
    expect(points.map((p) => p.source)).toEqual(['manual', 'maintenance', 'manual'])
    expect(points.every((p) => Number.isFinite(p.miles))).toBe(true)
  })

  it('canonicalizes a km reading via the exact factor', () => {
    const points = buildOdometerTimeline([ck({ value: '16093.44', unit: 'km', date: '2026-01-01' })])
    expect(points).toHaveLength(1)
    expect(points[0]!.miles).toBeCloseTo(16093.44 / KM_PER_MILE, 6)
  })

  it('tolerates an empty/absent timeline', () => {
    expect(buildOdometerTimeline(undefined)).toEqual([])
    expect(buildOdometerTimeline([], [])).toEqual([])
  })
})

describe('getDueMaintenance (date AND mileage)', () => {
  const now = new Date('2026-06-18T12:00:00')

  it('flags overdue and due-soon by DATE', () => {
    const res = getDueMaintenance(
      [
        { id: 'past', nextDueDate: '2026-06-01', nextDueMileageMiles: null },
        { id: 'soon', nextDueDate: '2026-06-30', nextDueMileageMiles: null },
        { id: 'far', nextDueDate: '2026-12-01', nextDueMileageMiles: null },
      ],
      { currentMiles: null, now },
    )
    expect(res.byId).toEqual({ past: 'overdue', soon: 'due-soon', far: 'ok' })
    expect(res.overdue).toBe(1)
    expect(res.dueSoon).toBe(1)
    expect(res.count).toBe(2)
  })

  it('flags overdue and due-soon by MILEAGE vs the current odometer', () => {
    const res = getDueMaintenance(
      [
        { id: 'over', nextDueDate: '', nextDueMileageMiles: 49_000 },
        { id: 'soon', nextDueDate: '', nextDueMileageMiles: 50_200 },
        { id: 'far', nextDueDate: '', nextDueMileageMiles: 60_000 },
      ],
      { currentMiles: 50_000, now },
    )
    expect(res.byId).toEqual({ over: 'overdue', soon: 'due-soon', far: 'ok' })
  })

  it('cannot evaluate a mileage target when the current odometer is unknown', () => {
    const res = getDueMaintenance(
      [{ id: 'm', nextDueDate: '', nextDueMileageMiles: 49_000 }],
      { currentMiles: null, now },
    )
    expect(res.byId.m).toBe('ok')
    expect(res.count).toBe(0)
  })

  it('takes the WORST of the date and mileage dimensions', () => {
    const res = getDueMaintenance(
      [{ id: 'both', nextDueDate: '2026-06-30', nextDueMileageMiles: 49_000 }], // date due-soon, miles overdue
      { currentMiles: 50_000, now },
    )
    expect(res.byId.both).toBe('overdue')
  })

  it('omits records with no due target at all', () => {
    const res = getDueMaintenance(
      [{ id: 'none', nextDueDate: '', nextDueMileageMiles: null }],
      { currentMiles: 50_000, now },
    )
    expect(res.byId).toEqual({})
    expect(res.count).toBe(0)
  })
})

describe('isValidDateString', () => {
  it('accepts parseable dates, rejects blank/garbage', () => {
    expect(isValidDateString('2020-01-01')).toBe(true)
    expect(isValidDateString('')).toBe(false)
    expect(isValidDateString(null)).toBe(false)
    expect(isValidDateString(undefined)).toBe(false)
    expect(isValidDateString('not-a-date')).toBe(false)
  })
})
