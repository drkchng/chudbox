// buttonVariants — the token-wired style vocabulary shared by the Button and
// IconButton primitives. Kept in its OWN module (no component export) so the
// component files stay clean under `react-refresh/only-export-components`:
// Fast Refresh requires a component file to export only components, so these
// shared style constants cannot live alongside the <Button> default export.
//
// Every value here maps straight to a design token via Tailwind utilities — no
// ad-hoc colors, radii, or shadows. See Button.tsx / IconButton.tsx for usage.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

/** Per-variant token-wired classes. Hover/active are `enabled:`-gated so they
 *  never apply while the button is disabled or loading. Shared by Button and
 *  IconButton. */
export const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-on-accent enabled:hover:bg-accent-dim',
  secondary:
    'border border-border text-text-primary enabled:hover:border-accent/50 enabled:hover:text-accent',
  ghost:
    'text-text-secondary enabled:hover:text-text-primary enabled:hover:bg-surface-2',
  danger:
    'bg-danger text-danger-fg border border-danger-border enabled:hover:bg-[rgb(var(--status-danger-border))]',
}

/** Button's shared base: shape, motion, disabled affordance, and the visible
 *  focus ring (same tokens as the global `.focus-ring`, gated to focus-visible
 *  so it shows on keyboard focus only). Size-specific spacing/typography live in
 *  SIZE_CLASSES so they never collide with the base in the cascade. */
export const BUTTON_BASE =
  'relative inline-flex items-center justify-center rounded-lg font-semibold whitespace-nowrap select-none ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out ' +
  'enabled:active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed ' +
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

/** Button's per-size spacing/typography. Both sizes keep a >= 44px hit target. */
export const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-11 gap-1.5 px-3.5 text-body',
  md: 'min-h-12 gap-2 px-5 text-body',
}
