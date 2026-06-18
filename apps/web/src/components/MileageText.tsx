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
  /**
   * Override the default numeric treatment. Defaults to `font-mono` (the
   * design-system figure treatment, matching CarCard). Deliberately carries NO
   * color so the value inherits the surrounding text run's token color — this
   * span is used both standalone and mid-sentence, where a hardcoded color would
   * clash with the parent run.
   */
  className?: string
}

/** Inline span of the formatted mileage; renders nothing when there is none. */
export default function MileageText({ raw, miles, unit, className = 'font-mono' }: MileageTextProps) {
  const text = formatMileage(raw, miles, unit)
  return text == null ? null : <span className={className}>{text}</span>
}
