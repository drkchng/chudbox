// DEC-16 / finding U2 (audit #7) — the one shared surfacing of overdue / due-soon
// maintenance, so the CarCard, the CarHero cluster, and anywhere else render the
// SAME computed signal identically. Overdue is the brand's red alert role
// (danger); due-soon is amber (warning, distinct from the orange accent). Nothing
// renders when nothing is due.
import Badge from './ui/Badge'
import type { DueMaintenanceResult } from '@chudbox/shared'

export interface DueBadgeProps {
  due: DueMaintenanceResult
  /** Extra classes for positioning (e.g. absolute placement on a card). */
  className?: string
}

export default function DueBadge({ due, className }: DueBadgeProps) {
  if (due.overdue > 0) {
    return (
      <Badge status="danger" className={className} title={`${due.overdue} maintenance item${due.overdue > 1 ? 's' : ''} overdue`}>
        {due.overdue} overdue
      </Badge>
    )
  }
  if (due.dueSoon > 0) {
    return (
      <Badge status="warning" className={className} title={`${due.dueSoon} maintenance item${due.dueSoon > 1 ? 's' : ''} due soon`}>
        {due.dueSoon} due
      </Badge>
    )
  }
  return null
}
