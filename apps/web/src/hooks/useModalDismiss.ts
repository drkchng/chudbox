import { useCallback, useEffect } from 'react'
import type { MouseEvent } from 'react'

/**
 * Shared modal-dismiss behavior, consistent with SettingsPanel / ShareDialog:
 *   - clicking the backdrop/overlay OUTSIDE the modal content closes it
 *   - pressing Escape closes it
 *
 * Spread the returned handler onto the backdrop element:
 *   const onBackdropClick = useModalDismiss(onClose)
 *   <div className="modal-backdrop ..." onClick={onBackdropClick}> ...content... </div>
 *
 * The click only dismisses when the event target IS the backdrop itself
 * (e.target === e.currentTarget). Clicks that bubble up from the modal content
 * — inputs, buttons, selects, dropdowns — have a different target, so they
 * never trigger a close. This mirrors how SettingsPanel keeps its panel clicks
 * from reaching the backdrop, without needing stopPropagation on the content.
 */
export function useModalDismiss(onClose: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose],
  )
}
