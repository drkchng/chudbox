// Re-export the RN-safe domain model from @chudbox/shared, and keep the
// React/DOM-coupled form helper here so shared stays react-free. Existing
// component imports (`from '../types'`, `from '../../types'`) keep working.
import type { ChangeEvent } from 'react'

export * from '@chudbox/shared'

// ── Shared form helpers (web-only; depends on React) ────────
/** Change event for any of the text-like form controls used across the app. */
export type FieldChangeEvent = ChangeEvent<
  HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
>
