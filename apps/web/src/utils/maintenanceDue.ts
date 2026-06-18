// DEC-16 / finding U2 — the web adapter over the shared, pure getDueMaintenance.
// It supplies the two canonical-miles inputs the shared helper needs but the
// nested Car drops: the CURRENT odometer (the latest check-in's canonical miles,
// recomputed from its frozen entry unit) and each record's nextDueMileageMiles
// (re-attached onto StoredMaintenance by the adapter read model). Maintenance is
// joined to mileage ONLY here, by computation — never a copy (§13.4).
import {
  currentCheckIn,
  getDueMaintenance,
  parseMileageMiles,
} from '@chudbox/shared'
import type { DueMaintenanceResult } from '@chudbox/shared'
import type { StoredCar } from '../types'

/** Current odometer in canonical miles: latest check-in, else the scalar mirror. */
export function currentMiles(car: StoredCar): number | null {
  const cur = currentCheckIn(car.mileageLog)
  if (cur) return parseMileageMiles(cur.value, cur.unit)
  return car.mileageMiles ?? null
}

/** Due/overdue summary for a car (by date AND by current-mileage vs next-due). */
export function carDueMaintenance(car: StoredCar): DueMaintenanceResult {
  return getDueMaintenance(
    car.maintenance.map((rec) => ({
      id: rec.id,
      nextDueDate: rec.nextDueDate,
      nextDueMileageMiles: rec.nextDueMileageMiles ?? null,
    })),
    { currentMiles: currentMiles(car) },
  )
}
