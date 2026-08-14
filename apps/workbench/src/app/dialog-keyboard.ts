import type { KeyboardEvent } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(dialog: HTMLElement): readonly HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) =>
      element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true',
  )
}

export function handleDialogKeyDown(
  event: KeyboardEvent<HTMLElement>,
  onDismiss?: () => void,
): void {
  if (event.defaultPrevented) return
  if (event.key === 'Escape' && onDismiss !== undefined) {
    event.preventDefault()
    event.stopPropagation()
    onDismiss()
    return
  }
  if (event.key !== 'Tab') return

  const focusable = focusableElements(event.currentTarget)
  const first = focusable[0]
  const last = focusable.at(-1)
  if (first === undefined || last === undefined) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
