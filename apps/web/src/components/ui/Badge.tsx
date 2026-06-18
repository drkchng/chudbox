// Badge — the status-chip primitive (DEC-design-system). Hand-rolled (trivial
// visual primitive, no Base UI needed). Renders one of the five semantic status
// roles, each wired straight to the status-* token triples via the global
// `.badge-<role>` classes (AA-paired bg/text + decorative border) — no ad-hoc
// colors, radii, or shadows live here.
//
// Accessibility contract: a status is NEVER signalled by color alone. Every
// badge is colour + icon + text — `children` (the label) is required and a
// role-appropriate icon is always rendered (a sensible default per role, or the
// caller's override). The optional dismiss affordance is a real <button>:
// keyboard-operable by default with an explicit visible focus ring.
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, Circle, X } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import type { StatusRole } from '@chudbox/shared'

/** Per-role styling + the default icon that guarantees "never colour alone". */
const STATUS: Record<StatusRole, { className: string; icon: LucideIcon }> = {
  danger:  { className: 'badge-danger',  icon: AlertOctagon },
  warning: { className: 'badge-warning', icon: AlertTriangle },
  success: { className: 'badge-success', icon: CheckCircle2 },
  info:    { className: 'badge-info',    icon: Info },
  neutral: { className: 'badge-neutral', icon: Circle },
}

export interface BadgeProps {
  /** Semantic status role → its status-* token triple. Defaults to `neutral`. */
  status?: StatusRole
  /** The label. Required — a badge is always colour + icon + TEXT. */
  children: ReactNode
  /** Override the default per-role icon (still always rendered). */
  icon?: LucideIcon
  /** When provided, renders a keyboard-operable dismiss button. */
  onRemove?: () => void
  /** Accessible label for the dismiss button (e.g. `Remove "Active" filter`). */
  removeLabel?: string
  /** Extra classes for positioning/layout (e.g. absolute placement on a card). */
  className?: string
  /** Native title tooltip (mirrors existing badge usages). */
  title?: string
}

export default function Badge({
  status = 'neutral',
  children,
  icon,
  onRemove,
  removeLabel = 'Remove',
  className,
  title,
}: BadgeProps) {
  const cfg = STATUS[status]
  const Icon = icon ?? cfg.icon
  const classes = className ? `${cfg.className} ${className}` : cfg.className

  return (
    <span className={classes} title={title}>
      <Icon size={tokens.iconSize.xs} aria-hidden className="shrink-0" />
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="-mr-0.5 ml-0.5 inline-flex shrink-0 items-center justify-center rounded-sm outline-hidden transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <X size={tokens.iconSize.xs} aria-hidden className="shrink-0" />
        </button>
      )}
    </span>
  )
}
