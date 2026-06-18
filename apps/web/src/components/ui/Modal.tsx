import { X } from 'lucide-react'
import { Dialog } from '@base-ui/react/dialog'
import type { ReactNode } from 'react'
import IconButton from './IconButton'

/**
 * Modal — the app's single dialog primitive (Chudbox design system).
 *
 * Behavior is delegated to Base UI's headless Dialog (@base-ui/react), which
 * gives us, for free and accessibly:
 *   - focus trap while open + focus restore to the trigger on close
 *   - role="dialog" / aria-modal, aria-labelledby (Title) / aria-describedby
 *     (Description) wiring
 *   - Escape-to-close and outside-pointer-to-close (modal scrim)
 *   - page-scroll lock + a screen-reader-reachable close affordance
 *
 * Everything VISUAL is ours, expressed only through design tokens / utility
 * classes (surface / border / text ramp / radius-xl / shadow-elevation) and the
 * shared IconButton primitive for the close affordance — no ad-hoc colors,
 * radii, or shadows. The
 * enter/exit is an opacity (+ subtle scale) fade driven by Base UI's
 * data-[starting|ending]-style hooks, and is reduced-motion-safe (both via the
 * global prefers-reduced-motion reset in index.css and an explicit
 * `motion-reduce:transition-none` here, so the primitive is self-contained).
 *
 * Controlled only: pass `open` + `onOpenChange` (Base UI calls it for every
 * close reason — Esc, outside press, the close button).
 */

export type ModalSize = 'sm' | 'md' | 'lg'

export interface ModalProps {
  /** Whether the modal is open (controlled). */
  open: boolean
  /**
   * Called whenever Base UI wants to change the open state — fired with `false`
   * on Escape, outside press, or the close button, and `true` if opened via a
   * Base UI trigger. Wire this to your own open state.
   */
  onOpenChange: (open: boolean) => void
  /** Accessible heading. Renders the dialog's `<h2>` and wires aria-labelledby. */
  title: ReactNode
  /**
   * Optional supporting line under the title. Renders Base UI's Description, so
   * it also wires aria-describedby for assistive tech.
   */
  description?: ReactNode
  /** Body content. Scrolls internally when it exceeds the viewport. */
  children?: ReactNode
  /** Optional footer (e.g. action buttons). Right-aligned, divided from the body. */
  footer?: ReactNode
  /** Max width preset. @default 'md' */
  size?: ModalSize
  /** Hide the top-right close (X) button. Esc / outside-press still close. */
  hideCloseButton?: boolean
}

const SIZE_MAX_WIDTH: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
}

export default function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  hideCloseButton = false,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* Scrim. Token-driven near-black at 80%; fades with the dialog. */}
        <Dialog.Backdrop
          className="fixed inset-0 z-50 bg-dark/80 transition-opacity duration-200 ease-out [&[data-starting-style]]:opacity-0 [&[data-ending-style]]:opacity-0 motion-reduce:transition-none"
        />

        {/* Centering layer. A plain div (not a Base UI part) so the Popup's own
            transform is free for the scale fade — outside clicks on this padding
            still register as an outside-press and close the dialog. */}
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Popup
            className={`flex w-full ${SIZE_MAX_WIDTH[size]} max-h-[90vh] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-elevation transition-[opacity,transform] duration-200 ease-out [&[data-ending-style]]:scale-95 [&[data-ending-style]]:opacity-0 [&[data-starting-style]]:scale-95 [&[data-starting-style]]:opacity-0 motion-reduce:transition-none`}
          >
            {/* Header */}
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <Dialog.Title className="text-title font-semibold text-text-primary">
                  {title}
                </Dialog.Title>
                {description != null && (
                  <Dialog.Description className="mt-1 text-body text-text-secondary">
                    {description}
                  </Dialog.Description>
                )}
              </div>
              {!hideCloseButton && (
                // Base UI merges its close behavior (onClick/type/data-state/ref)
                // into our IconButton primitive via `render`; the element keeps
                // its own children (the X) and required aria-label, so it stays
                // type-safe and gets the guaranteed 44x44 target + focus ring.
                <Dialog.Close
                  render={
                    <IconButton aria-label="Close" variant="ghost" className="-mr-1">
                      <X size={18} />
                    </IconButton>
                  }
                />
              )}
            </div>

            {/* Body — scrolls when content overflows. */}
            {children != null && (
              <div className="overflow-y-auto px-5 py-4">{children}</div>
            )}

            {/* Footer */}
            {footer != null && (
              <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border px-5 py-4">
                {footer}
              </div>
            )}
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
