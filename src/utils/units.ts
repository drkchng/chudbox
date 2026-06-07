export type CurrencyCode = 'USD' | 'CAD' | 'EUR' | 'GBP' | 'JPY' | 'AUD' | 'CHF' | 'MXN'
export type DistanceUnitCode = 'mi' | 'km'

export interface Currency {
  symbol: string
  name: string
  rate: number
}

export interface DistanceUnit {
  label: string
  short: string
}

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  USD: { symbol: '$',   name: 'US Dollar',          rate: 1      },
  CAD: { symbol: 'CA$', name: 'Canadian Dollar',     rate: 1.36   },
  EUR: { symbol: '€',   name: 'Euro',                rate: 0.92   },
  GBP: { symbol: '£',   name: 'British Pound',       rate: 0.79   },
  JPY: { symbol: '¥',   name: 'Japanese Yen',        rate: 149.5  },
  AUD: { symbol: 'A$',  name: 'Australian Dollar',   rate: 1.53   },
  CHF: { symbol: 'CHF', name: 'Swiss Franc',         rate: 0.90   },
  MXN: { symbol: 'MX$', name: 'Mexican Peso',        rate: 17.15  },
}

export const DISTANCE_UNITS: Record<DistanceUnitCode, DistanceUnit> = {
  mi: { label: 'Miles',       short: 'mi'  },
  km: { label: 'Kilometers',  short: 'km'  },
}

// Conversions preserve the shape of their input: a number stays a number, a raw
// string stays a string, and null/'' pass through untouched.
export function convertPrice(value: number, fromCode: CurrencyCode, toCode: CurrencyCode): number
export function convertPrice(value: string, fromCode: CurrencyCode, toCode: CurrencyCode): string
export function convertPrice(value: number | null, fromCode: CurrencyCode, toCode: CurrencyCode): number | null
export function convertPrice(value: string | null, fromCode: CurrencyCode, toCode: CurrencyCode): string | null
export function convertPrice(value: number | string | null, fromCode: CurrencyCode, toCode: CurrencyCode): number | string | null {
  if (value == null || value === '') return value
  const n = parseFloat(String(value))
  if (isNaN(n) || fromCode === toCode) return value
  const fromRate = CURRENCIES[fromCode]?.rate ?? 1
  const toRate   = CURRENCIES[toCode]?.rate   ?? 1
  const result   = Math.round((n / fromRate) * toRate * 100) / 100
  return typeof value === 'number' ? result : String(result)
}

export function convertDistance(value: number, fromUnit: DistanceUnitCode, toUnit: DistanceUnitCode): number
export function convertDistance(value: string, fromUnit: DistanceUnitCode, toUnit: DistanceUnitCode): string
export function convertDistance(value: number | null, fromUnit: DistanceUnitCode, toUnit: DistanceUnitCode): number | null
export function convertDistance(value: string | null, fromUnit: DistanceUnitCode, toUnit: DistanceUnitCode): string | null
export function convertDistance(value: number | string | null, fromUnit: DistanceUnitCode, toUnit: DistanceUnitCode): number | string | null {
  if (value == null || value === '') return value
  const n = parseFloat(String(value))
  if (isNaN(n) || fromUnit === toUnit) return value
  const result = toUnit === 'km'
    ? Math.round(n * 1.60934)
    : Math.round(n / 1.60934)
  return typeof value === 'number' ? result : String(result)
}
