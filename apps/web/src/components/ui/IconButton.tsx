// IconButton — the icon-only action primitive (DEC-design-system). Hand-rolled
// (trivial visual primitive, no Base UI needed). Shares Button's token-wired
// variant styling and visible focus ring; renders a fixed 44x44 (size-11) square
// so the touch target is always >= 44px even though the glyph is small.
//
// Accessibility: because there is no visible text, `aria-label` is a REQUIRED
// prop — an icon button with no accessible name is unusable to screen readers
// and keyboard users. Native <button>, focus-visible ring, aria-busy + spinner
// while loading, `enabled:`-gated hover so it never fires while disabled.
import type { ComponentProps, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { tokens } from '@chudbox/shared'
import { VARIANT_CLASSES } from './buttonVariants'
import type { ButtonVariant } from './buttonVariants'

const BASE =
  'relative inline-flex size-11 shrink-0 items-center justify-center rounded-lg ' +
  'transition-[background-color,border-color,color,transform] duration-150 ease-out ' +
  'enabled:active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ' +
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ')

export interface IconButtonProps extends ComponentProps<'button'> {
  /** REQUIRED — the accessible name (there is no visible text). e.g. "Close". */
  'aria-label': string
  /** Visual intent → its token-wired styling. Defaults to `ghost`. */
  variant?: ButtonVariant
  /** Shows a spinner and disables the button. */
  loading?: boolean
  /** The icon (e.g. a lucide glyph). Sized by the caller. */
  children: ReactNode
}

export default function IconButton({
  variant = 'ghost',
  loading = false,
  disabled,
  type = 'button',
  className,
  children,
  ...rest
}: IconButtonProps) {
  const isDisabled = disabled || loading

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cx(BASE, VARIANT_CLASSES[variant], className)}
      {...rest}
    >
      {loading ? (
        <Loader2 size={tokens.iconSize.md} className="animate-spin" aria-hidden="true" />
      ) : (
        children
      )}
    </button>
  )
}
