// Task detail's "‹ <view>" link. Every view that links to a task passes its
// own URL as `from`; the page runs it through `safeReturnPath` first, then
// this names it. Pure and server-free: it trusts nothing beyond a same-origin
// path and only labels views it knows.

export type ReturnLink = { href: string; label: string }

export const DEFAULT_RETURN_LINK: ReturnLink = {
  href: "/dashboard",
  label: "What's mine",
}

/**
 * `path` is a `safeReturnPath` result (a same-origin path with search and
 * hash). Known views get their label and keep their href, query included
 * (the Board's chip, column and focus; the Planner's month and chip); a
 * missing or any other value is What's mine.
 */
export function returnLink(path: string): ReturnLink {
  let url: URL
  try {
    url = new URL(path, "http://return.invalid")
  } catch {
    return DEFAULT_RETURN_LINK
  }
  const href = url.pathname + url.search + url.hash
  const pathname = url.pathname.replace(/\/+$/, "")

  if (pathname === "/dashboard") {
    const view = url.searchParams.get("view")
    if (view === "board") return { href, label: "Board" }
    if (view === "planner") return { href, label: "Planner" }
    if (view === null || view === "whats-mine") {
      return { href, label: "What's mine" }
    }
    return DEFAULT_RETURN_LINK
  }
  if (pathname === "/admin/tasks") return { href, label: "Tasks" }
  if (pathname === "/admin") return { href, label: "Admin home" }
  return DEFAULT_RETURN_LINK
}

/** The `from` value a view puts on its links to Task detail. */
export function taskHref(taskId: string, from?: string): string {
  const base = `/dashboard/tasks/${taskId}`
  return from ? `${base}?from=${encodeURIComponent(from)}` : base
}

/**
 * The Board's URL for one card's `from`: its owner chip, and the card's
 * column and id, which the Board's restore effect scrolls to and focuses.
 */
export function boardHref({
  owner,
  column,
  id,
}: {
  owner: string
  column: string
  id: string
}): string {
  const params = new URLSearchParams({
    view: "board",
    owner,
    column,
    focus: id,
  })
  return `/dashboard?${params}`
}
