// Button — the primary action primitive (DEC-design-system, DEC-2). Hand-rolled
// (trivial visual primitive, no Base UI needed). Every color / radius / size is
// wired straight to the design tokens via Tailwind utilities — no ad-hoc colors,
// radii, or shadows live here.
//
// Variants: primary (dark label on the orange fill via the on-accent token —
// white-on-orange fails AA), secondary (outlined, neutral), ghost (text-only),
// danger (the danger status triple — AA-paired maroon fill + light-red label).
// Sizes sm/md both keep a >= 44px hit target (min-h-11/12). loading shows a
// spinner and blocks interaction; disabled dims and de-activates.
//
// Accessibility: native <button> (keyboard-operable by default), an explicit
// visible focus-visible ring (the tokenised .focus-ring treatment), aria-busy
// while loading, and AA-correct label contrast in every variant + state. Hover
// styling is gated behind `enabled:` so it never fires while disabled/loading.
import type { ComponentProps, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import { BUTTON_BASE, SIZE_CLASSES, VARIANT_CLASSES } from './buttonVariants'

// The token-wired style maps + the variant/size vocabulary live in the
// component-free `./buttonVariants` module (shared with IconButton) so this file
// only exports components/types and stays Fast-Refresh-clean. Types are
// re-exported here so existing `import type { ButtonVariant } from './Button'`
// call sites keep working.
import type { ButtonVariant, ButtonSize } from './buttonVariants'
export type { ButtonVariant, ButtonSize }

const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ')

export interface ButtonProps extends ComponentProps<'button'> {
  /** Visual intent → its token-wired styling. Defaults to `primary`. */
  variant?: ButtonVariant
  /** `sm` (44px target) or `md` (48px target). Defaults to `md`. */
  size?: ButtonSize
  /** Shows a spinner and disables the button (prevents double-submits). */
  loading?: boolean
  /** The label — a button always has a text label for accessibility. */
  children: ReactNode
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading
  const spinnerSize = size === 'sm' ? tokens.iconSize.sm : tokens.iconSize.md

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cx(BUTTON_BASE, SIZE_CLASSES[size], VARIANT_CLASSES[variant], className)}
      {...rest}
    >
      {loading && (
        <span className="absolute inset-0 inline-flex items-center justify-center" aria-hidden="true">
          <Loader2 size={spinnerSize} className="animate-spin" />
        </span>
      )}
      {/* Children stay mounted (so the accessible name is unchanged) but are
          visually hidden while loading; opacity-0 keeps the width stable. */}
      <span className={cx('inline-flex items-center', size === 'sm' ? 'gap-1.5' : 'gap-2', loading && 'opacity-0')}>
        {children}
      </span>
    </button>
  )
}
