// ISO-4217-aware money helpers (BACKEND_PLAN.md, "Units cleanup").
//
// Model: store-as-entered. Every stored amount is tagged with the ISO-4217
// code of the currency it was entered in (see flatten.ts); conversion between
// currencies is display-only, needs live FX rates, and is intentionally NOT
// implemented here. These helpers only know per-currency *structure*: the
// minor-unit exponent (JPY=0, most=2, KWD/BHD=3, ...) and display formatting.
//
// RN-safe: no DOM/Node imports. Intl is an ECMAScript builtin (available in
// Workers, browsers, and Hermes); formatMoney falls back to a plain
// `CODE amount` string if the runtime rejects the code.

/**
 * ISO-4217 minor-unit exponents that differ from the default of 2.
 * Source: ISO 4217 current currency list.
 */
const EXPONENT_OVERRIDES: Readonly<Record<string, number>> = {
  // 0 minor units
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  // 3 minor units
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  // 4 minor units (fund codes)
  CLF: 4,
  UYW: 4,
}

export const DEFAULT_CURRENCY_EXPONENT = 2

/** Minor-unit exponent for an ISO-4217 code (JPY → 0, USD → 2, KWD → 3). Unknown codes default to 2. */
export function currencyExponent(code: string): number {
  return EXPONENT_OVERRIDES[code.toUpperCase()] ?? DEFAULT_CURRENCY_EXPONENT
}

/**
 * Convert a major-unit amount to integer minor units using the currency's
 * ISO-4217 exponent — never a blanket *100 (JPY has no minor unit; KWD has
 * 1000 fils to the dinar). Rounds to the nearest minor unit.
 */
export function toMinorUnits(amount: number, code: string): number {
  return Math.round(amount * 10 ** currencyExponent(code))
}

/** Convert integer minor units back to a major-unit amount. */
export function fromMinorUnits(minorUnits: number, code: string): number {
  return minorUnits / 10 ** currencyExponent(code)
}

/**
 * Display formatting only — never feeds back into storage. Uses
 * Intl.NumberFormat when the runtime accepts the code; otherwise falls back
 * to `CODE amount` with the currency's exponent as the fraction length.
 */
export function formatMoney(amount: number, code: string, locale = 'en-US'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
    }).format(amount)
  } catch {
    return `${code} ${amount.toFixed(currencyExponent(code))}`
  }
}
