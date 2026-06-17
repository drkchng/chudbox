import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  convertPrice,
  convertDistance,
  CURRENCIES,
  DISTANCE_UNITS,
} from './units'

// M0 smoke tests: pin the CURRENT behavior of the unit helpers (these helpers
// are intentionally lossy and get replaced by money.ts/display-time conversion
// in M2 — here we only lock in what they do today).

describe('convertPrice', () => {
  it('passes null and empty string through untouched (shape-preserving)', () => {
    expect(convertPrice(null, 'USD', 'EUR')).toBe(null)
    expect(convertPrice('', 'USD', 'EUR')).toBe('')
  })

  it('returns the value unchanged when from === to, for any finite number', () => {
    fc.assert(
      fc.property(fc.float({ noNaN: true }), (n) => {
        expect(convertPrice(n, 'USD', 'USD')).toBe(n)
      }),
    )
  })

  it('preserves input type: number in -> number out, string in -> string out', () => {
    expect(typeof convertPrice(100, 'USD', 'EUR')).toBe('number')
    expect(typeof convertPrice('100', 'USD', 'EUR')).toBe('string')
  })

  it('converts via the static rate table and rounds to 2 decimals', () => {
    // 100 USD -> EUR at rate 0.92, USD rate 1 => round(100 / 1 * 0.92) = 92
    expect(convertPrice(100, 'USD', 'EUR')).toBe(CURRENCIES.EUR.rate * 100)
    expect(convertPrice(100, 'USD', 'EUR')).toBe(92)
  })
})

describe('convertDistance', () => {
  it('passes null and empty string through untouched', () => {
    expect(convertDistance(null, 'mi', 'km')).toBe(null)
    expect(convertDistance('', 'mi', 'km')).toBe('')
  })

  it('returns the value unchanged when units match', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        expect(convertDistance(n, 'mi', 'mi')).toBe(n)
      }),
    )
  })

  it('converts miles to kilometers using the rounded factor', () => {
    expect(convertDistance(100, 'mi', 'km')).toBe(Math.round(100 * 1.60934))
  })

  it('exposes the expected unit metadata', () => {
    expect(DISTANCE_UNITS.mi.short).toBe('mi')
    expect(DISTANCE_UNITS.km.short).toBe('km')
  })
})
