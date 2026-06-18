// Re-export the RN-safe domain model from @chudbox/shared, and keep the
// React/DOM-coupled form helper here so shared stays react-free. Existing
// component imports (`from '../types'`, `from '../../types'`) keep working.
import type { ChangeEvent } from 'react'
import type { Car, MaintenanceRecord } from '@chudbox/shared'

export * from '@chudbox/shared'

// ── Read-model enrichment (web-only) ────────────────────────
// joinCar reassembles only the verbatim mileage strings (mileage / nextDue),
// dropping the canonical miles values the same way it drops a photo's r2Key.
// The adapter's read model re-attaches them off the synced rows so the UI can
// convert to the ACTIVE display unit (raw alone can't be converted — its entry
// unit isn't recoverable). Present iff the matching raw parsed numerically;
// flattenCar still recomputes from the raw string, so these are display-only.
export interface StoredMaintenance extends MaintenanceRecord {
  mileageMiles?: number | null
  nextDueMileageMiles?: number | null
}
export interface StoredCar extends Car {
  mileageMiles?: number | null
  maintenance: StoredMaintenance[]
}

// ── Shared form helpers (web-only; depends on React) ────────
/** Change event for any of the text-like form controls used across the app. */
export type FieldChangeEvent = ChangeEvent<
  HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
>
