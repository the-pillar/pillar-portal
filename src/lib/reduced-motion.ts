// Script-driven motion (programmatic scrolling, stepped countdowns) asks
// here. CSS motion never asks: globals.css's one reduced-motion rule covers
// it, and components hold no reduced-motion queries of their own.

const QUERY = "(prefers-reduced-motion: reduce)"

/** Whether the visitor asked for reduced motion. False where `matchMedia` is
 * missing (the server, some test runners). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return false
  return window.matchMedia(QUERY).matches
}

/** The `behavior` for `scrollTo` and `scrollIntoView`: smooth, or an instant
 * jump under reduced motion (DESIGN.md › Motion). */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth"
}
