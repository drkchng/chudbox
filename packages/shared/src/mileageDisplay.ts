// Mileage DISPLAY + edit-PREFILL formatting, shared by the garage UI and the
// public share viewer (the ONE implementation both use). The canonical truth is
// `miles` (mileageMiles — computed at entry via the exact ×1.609344 factor,
// present iff the raw entry parsed numerically). Both helpers convert THAT to
// the active unit, so a value entered in one unit reads/edits correctly after
// the units toggle, and editing never re-canonicalizes the raw under the wrong
// unit. Pure + RN-safe (no DOM/React) — toLocaleString is plain ECMAScript.
import { DISTANCE_UNITS } from './units'
import type { DistanceUnitCode } from './units'
import { milesToUnit } from './flatten'

/**
 * Format a stored mileage for display in `unit`. Returns:
 * - null when there is no mileage (null / '' raw),
 * - the verbatim raw string when it was non-numeric (no canonical miles),
 * - otherwise the canonical miles converted to `unit`, grouped, with the label.
 */
export function formatMileage(
  raw: string | null | undefined,
  miles: number | null | undefined,
  unit: DistanceUnitCode,
): string | null {
  if (raw == null || raw === '') return null
  if (miles == null) return raw
  const value = Math.round(milesToUnit(miles, unit))
  return `${value.toLocaleString()} ${DISTANCE_UNITS[unit]?.short ?? unit}`
}

/**
 * The value to PREFILL a mileage <input> with when editing under `unit`. Edit
 * forms work in the active unit, so this converts the canonical miles to it
 * (rounded to a whole number). On save the adapter re-canonicalizes from the
 * active unit — so editing a km-entered car while the app shows mi no longer
 * 1.6×-corrupts the canonical value. Non-numeric raw is kept verbatim.
 */
export function mileagePrefill(
  raw: string | null | undefined,
  miles: number | null | undefined,
  unit: DistanceUnitCode,
): string {
  if (raw == null || raw === '') return ''
  if (miles == null) return raw
  return String(Math.round(milesToUnit(miles, unit)))
}
