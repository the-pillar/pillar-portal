// Focus helpers for the onboarding surfaces (Story 8.9).

/** Focuses `element`, giving it `tabindex="-1"` first when it has none. */
export function focusHeading(element: HTMLElement | null): boolean {
  if (!element) return false
  if (!element.hasAttribute("tabindex")) element.tabIndex = -1
  element.focus()
  return document.activeElement === element
}

/**
 * Where focus goes when a card leaves while it held focus: the next heading
 * after `from` in the page, else the heading with `fallbackId`. A heading is
 * `h1`–`h3`; one inside `from` doesn't count.
 */
export function focusNextHeading(from: Element, fallbackId?: string): boolean {
  const headings = Array.from(
    document.querySelectorAll<HTMLElement>("h1, h2, h3")
  )
  const next = headings.find(
    (heading) =>
      !from.contains(heading) &&
      Boolean(
        from.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING
      )
  )
  if (focusHeading(next ?? null)) return true
  return fallbackId ? focusHeading(document.getElementById(fallbackId)) : false
}
