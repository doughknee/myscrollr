import { useEffect } from 'react'

/**
 * Keeps keyboard focus inside an open modal.
 *
 * `role="dialog" aria-modal="true"` tells assistive tech the rest of the
 * page is inert, but nothing enforces that for the keyboard — Tab walks
 * straight out of the dialog and into the page behind it, which is still
 * fully interactive and still focusable. This closes that gap:
 *
 *   - Tab / Shift+Tab cycle within `containerRef`
 *   - Escape calls `onClose`
 *   - focus moves in on open and returns to the opener on close
 *
 * The focusable set is re-read on every keypress rather than cached, so
 * dialogs whose contents change while open (a checkout that swaps steps,
 * a confirm that reveals an input) stay trapped correctly.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!isOpen) return

    const container = containerRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null

    // Prefer the first real control; fall back to the container, which
    // callers give tabIndex={-1} for exactly this case.
    const initial = container?.querySelector<HTMLElement>(FOCUSABLE)
    requestAnimationFrame(() => (initial ?? container)?.focus())

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !container) return

      const items = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null)
      if (items.length === 0) return

      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const inside = container.contains(active)

      // Wrap at both ends, and pull focus back in if it already escaped
      // (clicking the backdrop can leave it on <body>).
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [containerRef, isOpen, onClose])
}
