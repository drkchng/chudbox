// Thin presentational wrapper over the shared formatMileage helper, so the
// garage (MaintenanceTab) and the public share viewer (ShareCarView) render
// mileage through ONE implementation. The conversion/format logic itself lives
// in @chudbox/shared (mileageDisplay.ts); this only owns the <span>.
import { formatMileage } from '@chudbox/shared'
import type { DistanceUnitCode } from '@chudbox/shared'

export interface MileageTextProps {
  raw?: string | null
  miles?: number | null
  unit: DistanceUnitCode
}

/** Inline span of the formatted mileage; renders nothing when there is none. */
export default function MileageText({ raw, miles, unit }: MileageTextProps) {
  const text = formatMileage(raw, miles, unit)
  return text == null ? null : <span>{text}</span>
}
