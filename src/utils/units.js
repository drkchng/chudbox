export const CURRENCIES = {
  USD: { symbol: '$',   name: 'US Dollar',          rate: 1      },
  CAD: { symbol: 'CA$', name: 'Canadian Dollar',     rate: 1.36   },
  EUR: { symbol: '€',   name: 'Euro',                rate: 0.92   },
  GBP: { symbol: '£',   name: 'British Pound',       rate: 0.79   },
  JPY: { symbol: '¥',   name: 'Japanese Yen',        rate: 149.5  },
  AUD: { symbol: 'A$',  name: 'Australian Dollar',   rate: 1.53   },
  CHF: { symbol: 'CHF', name: 'Swiss Franc',         rate: 0.90   },
  MXN: { symbol: 'MX$', name: 'Mexican Peso',        rate: 17.15  },
}

export const DISTANCE_UNITS = {
  mi: { label: 'Miles',       short: 'mi'  },
  km: { label: 'Kilometers',  short: 'km'  },
}

export function convertPrice(value, fromCode, toCode) {
  if (value == null || value === '') return value
  const n = parseFloat(value)
  if (isNaN(n) || fromCode === toCode) return value
  const fromRate = CURRENCIES[fromCode]?.rate ?? 1
  const toRate   = CURRENCIES[toCode]?.rate   ?? 1
  const result   = Math.round((n / fromRate) * toRate * 100) / 100
  return typeof value === 'number' ? result : String(result)
}

export function convertDistance(value, fromUnit, toUnit) {
  if (value == null || value === '') return value
  const n = parseFloat(value)
  if (isNaN(n) || fromUnit === toUnit) return value
  const result = toUnit === 'km'
    ? Math.round(n * 1.60934)
    : Math.round(n / 1.60934)
  return typeof value === 'number' ? result : String(result)
}
