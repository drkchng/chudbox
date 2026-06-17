import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  DEFAULT_CURRENCY_EXPONENT,
  currencyExponent,
  formatMoney,
  fromMinorUnits,
  toMinorUnits,
} from './money'

describe('currencyExponent', () => {
  it('knows the ISO-4217 exponents', () => {
    expect(currencyExponent('JPY')).toBe(0)
    expect(currencyExponent('KRW')).toBe(0)
    expect(currencyExponent('USD')).toBe(2)
    expect(currencyExponent('EUR')).toBe(2)
    expect(currencyExponent('KWD')).toBe(3)
    expect(currencyExponent('BHD')).toBe(3)
    expect(currencyExponent('CLF')).toBe(4)
  })

  it('is case-insensitive and defaults unknown codes to 2', () => {
    expect(currencyExponent('jpy')).toBe(0)
    expect(currencyExponent('ZZZ')).toBe(DEFAULT_CURRENCY_EXPONENT)
    expect(currencyExponent('')).toBe(2)
  })
})

describe('minor-unit conversion', () => {
  it('uses the per-currency exponent, never a blanket *100', () => {
    expect(toMinorUnits(12.34, 'USD')).toBe(1234)
    expect(toMinorUnits(1234, 'JPY')).toBe(1234) // yen has no minor unit
    expect(toMinorUnits(1.234, 'KWD')).toBe(1234) // 1000 fils to the dinar
    expect(toMinorUnits(19.99, 'USD')).toBe(1999) // float trap: 19.99*100 = 1998.99…
    expect(toMinorUnits(0, 'EUR')).toBe(0)
  })

  it('converts back', () => {
    expect(fromMinorUnits(1234, 'USD')).toBe(12.34)
    expect(fromMinorUnits(1234, 'JPY')).toBe(1234)
    expect(fromMinorUnits(1234, 'KWD')).toBe(1.234)
  })

  it('round-trips integer minor units exactly (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        fc.constantFrom('USD', 'JPY', 'KWD', 'CLF', 'ZZZ'),
        (minor, code) => {
          expect(toMinorUnits(fromMinorUnits(minor, code), code)).toBe(minor)
        },
      ),
    )
  })
})

describe('formatMoney (display only)', () => {
  it('formats with the currency style', () => {
    expect(formatMoney(1234.5, 'USD', 'en-US')).toBe('$1,234.50')
    expect(formatMoney(1234, 'JPY', 'en-US')).toBe('¥1,234')
  })

  it('falls back to CODE + exponent-width amount when Intl rejects the code', () => {
    // 'Z' is not a well-formed ISO-4217 code, so Intl throws a RangeError.
    expect(formatMoney(10, 'Z')).toBe('Z 10.00')
  })
})
