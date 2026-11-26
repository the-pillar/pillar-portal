// The dashboard's three views, chosen by the `view` search parameter. No
// @/features imports: the header's tabs (a client component) use this too.

export type DashboardView = "whats-mine" | "board" | "planner"

/**
 * `board` selects the Board and `planner` the Planner; anything else,
 * including a repeated parameter, is What's mine.
 */
export function parseDashboardView(value: unknown): DashboardView {
  return value === "board" || value === "planner" ? value : "whats-mine"
}

// Bare names: the root layout's title template adds " · The Pillar".
export const DASHBOARD_VIEW_TITLES: Record<DashboardView, string> = {
  "whats-mine": "What's mine",
  board: "Board",
  planner: "Planner",
}
