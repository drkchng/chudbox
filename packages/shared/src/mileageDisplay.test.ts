// Display + edit-prefill conversion. Both derive from the canonical `miles`
// (mileageMiles), so a value entered in one unit is shown/edited correctly
// after the units toggle — the bug these fix.
import { describe, expect, it } from 'vitest'
import { KM_PER_MILE } from './flatten'
import { formatMileage, mileagePrefill } from './mileageDisplay'

// Canonical miles for a car ENTERED as 120000 km (≈ 74564.54).
const KM_ENTRY_MILES = 120_000 / KM_PER_MILE

describe('formatMileage (display = canonical miles → active unit)', () => {
  it('shows a km-entered value correctly in BOTH units (never the 1.6× mislabel)', () => {
    expect(formatMileage('120000', KM_ENTRY_MILES, 'km')).toBe('120,000 km')
    expect(formatMileage('120000', KM_ENTRY_MILES, 'mi')).toBe('74,565 mi')
  })

  it('shows an mi-entered value correctly in both units', () => {
    expect(formatMileage('50000', 50_000, 'mi')).toBe('50,000 mi')
    expect(formatMileage('50000', 50_000, 'km')).toBe('80,467 km') // 50000 × 1.609344
  })

  it('renders non-numeric raw verbatim, with no unit label', () => {
    expect(formatMileage('unknown', undefined, 'mi')).toBe('unknown')
    expect(formatMileage('~120k', null, 'km')).toBe('~120k')
  })

  it('returns null when there is no mileage', () => {
    expect(formatMileage('', undefined, 'mi')).toBeNull()
    expect(formatMileage(null, undefined, 'mi')).toBeNull()
    expect(formatMileage(undefined, undefined, 'km')).toBeNull()
  })
})

describe('mileagePrefill (edit input = canonical miles → active unit)', () => {
  it('prefills the converted whole number for the active unit', () => {
    expect(mileagePrefill('120000', KM_ENTRY_MILES, 'km')).toBe('120000')
    expect(mileagePrefill('120000', KM_ENTRY_MILES, 'mi')).toBe('74565')
  })

  it('keeps non-numeric raw verbatim and blanks empty/absent', () => {
    expect(mileagePrefill('unknown', undefined, 'mi')).toBe('unknown')
    expect(mileagePrefill('', undefined, 'mi')).toBe('')
    expect(mileagePrefill(null, undefined, 'km')).toBe('')
  })
})
