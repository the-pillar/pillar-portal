// The Board's URL: `owner` (the filter), `column` (the column in view) and
// `focus` (the card to focus on return) live in the query, written with the
// native history API, which Next.js folds into useSearchParams. Client only.

function withParams(updates: Record<string, string | null>): string {
  const params = new URLSearchParams(window.location.search)
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) params.delete(key)
    else params.set(key, value)
  }
  const query = params.toString()
  return `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
}

/** A new history entry, so Back returns to the last filter. */
export function pushBoardParams(updates: Record<string, string | null>) {
  window.history.pushState(null, "", withParams(updates))
}

/** The same entry, for state that isn't a place to go back to. */
export function replaceBoardParams(updates: Record<string, string | null>) {
  window.history.replaceState(null, "", withParams(updates))
}
