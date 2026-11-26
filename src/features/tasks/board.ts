// The Board's owner filter as URL text and as copy. Client-safe: no
// `server-only`, and no values from @/features/members (the filter's shape is
// the same union as its HomeScope, restated here so the two slices stay
// independent of each other at the type level).

export type TaskOwnerOption = {
  kind: "section" | "desk"
  id: string
  name: string
}

export type OwnerFilter =
  | { kind: "all" }
  /** Cards where the viewer holds an open slot (the Board's Mine chip). */
  | { kind: "mine" }
  | { kind: "articles" }
  | { kind: "section"; id: string }
  | { kind: "desk"; id: string }

/** The `owner` search parameter's value for a filter (the task form's composite form). */
export function ownerFilterParam(filter: OwnerFilter): string {
  switch (filter.kind) {
    case "all":
      return "all"
    case "mine":
      return "mine"
    case "articles":
      return "articles"
    case "section":
      return `section:${filter.id}`
    case "desk":
      return `desk:${filter.id}`
  }
}

/**
 * The filter an `owner` parameter names, or null for anything else: a
 * missing value, a repeated parameter (an array), an unknown id, and the
 * Writers desk, which owns no task and so isn't in `owners`.
 */
export function parseOwnerFilterParam(
  value: unknown,
  owners: TaskOwnerOption[]
): OwnerFilter | null {
  if (typeof value !== "string") return null
  if (value === "all") return { kind: "all" }
  if (value === "mine") return { kind: "mine" }
  if (value === "articles") return { kind: "articles" }

  const separator = value.indexOf(":")
  if (separator === -1) return null
  const kind = value.slice(0, separator)
  const id = value.slice(separator + 1)
  if (kind !== "section" && kind !== "desk") return null

  const owner = owners.find(
    (option) => option.kind === kind && option.id === id
  )
  return owner ? { kind: owner.kind, id: owner.id } : null
}

/**
 * The h2 shown when a filter has no tasks, or null for All (which shows its
 * four empty columns instead).
 */
export function boardEmptyMessage(
  filter: OwnerFilter,
  owners: TaskOwnerOption[]
): string | null {
  switch (filter.kind) {
    case "all":
      return null
    case "mine":
      return "Nothing's assigned to you right now."
    case "articles":
      return "No tasks in any desk right now."
    case "section":
    case "desk": {
      const name =
        owners.find(
          (option) => option.kind === filter.kind && option.id === filter.id
        )?.name ?? filter.id
      return `No tasks in ${name} right now.`
    }
  }
}

const DONE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/**
 * The oldest `done_at` the Board's Done column shows, as ISO: `now` minus 30
 * × 24 hours, an instant, so no time zone is involved. The edge is inclusive
 * (`done_at >= cutoff`). Only the Board reads through it: Task detail and
 * every other read still find an older Done task.
 */
export function boardDoneCutoff(now: Date): string {
  return new Date(now.getTime() - DONE_WINDOW_MS).toISOString()
}

/**
 * What a filter needs to know about a card: whose it is and whether the
 * viewer holds an open slot on it.
 */
export type FilterableCard = {
  ownerKind: "section" | "desk"
  ownerId: string
  yours: boolean
}

/** Whether a card shows under a filter. Pure, so the client filters with it. */
export function matchesFilter(
  card: FilterableCard,
  filter: OwnerFilter
): boolean {
  switch (filter.kind) {
    case "all":
      return true
    case "mine":
      return card.yours
    case "articles":
      return card.ownerKind === "section"
    case "section":
    case "desk":
      return card.ownerKind === filter.kind && card.ownerId === filter.id
  }
}

export type FilterChip = {
  /** The `owner` parameter value; also the chip's key. */
  value: string
  filter: OwnerFilter
  label: string
  count: number
}

/**
 * The Board's filter chips: All, Mine, All articles only when it is the
 * viewer's home scope (`showArticles`) or the URL's choice, then each owner
 * that has cards in the window. The URL's own owner is always listed, even at
 * zero, so the active chip never disappears. Counts come from the whole
 * window, never from the filtered cards.
 */
export function boardFilterChips(
  cards: readonly FilterableCard[],
  owners: readonly TaskOwnerOption[],
  active: OwnerFilter,
  showArticles: boolean
): FilterChip[] {
  const chip = (filter: OwnerFilter, label: string): FilterChip => ({
    value: ownerFilterParam(filter),
    filter,
    label,
    count: cards.filter((card) => matchesFilter(card, filter)).length,
  })
  const activeValue = ownerFilterParam(active)

  const chips: FilterChip[] = [
    chip({ kind: "all" }, "All"),
    chip({ kind: "mine" }, "Mine"),
  ]
  if (showArticles || active.kind === "articles") {
    chips.push(chip({ kind: "articles" }, "All articles"))
  }
  for (const owner of owners) {
    const filter: OwnerFilter = { kind: owner.kind, id: owner.id }
    const next = chip(filter, owner.name)
    if (next.count > 0 || next.value === activeValue) chips.push(next)
  }
  return chips
}

/**
 * The Board row's height, shared by the Board and its skeleton so the swap
 * between them doesn't jump: it fills the rest of the viewport under the
 * header, h1, filter chips and (below lg) the column switcher, never under
 * DESIGN.md's row-min-height, max(320px, 60svh). Below 560px of viewport
 * height the columns grow to their content and the page scrolls instead.
 */
export const BOARD_ROW_HEIGHT =
  "h-[calc(100dvh-22rem)] min-h-[max(320px,60svh)] lg:h-[calc(100dvh-18rem)] [@media(max-height:559px)]:h-auto [@media(max-height:559px)]:min-h-0"
