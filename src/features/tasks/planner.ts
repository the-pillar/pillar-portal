// The Planner's URL and copy. Client-safe: no `server-only`, and no values
// from @/features/members (the filter is the Board's OwnerFilter).

import { formatInPht, phtDayKey } from "@/lib/time"

import {
  matchesFilter,
  ownerFilterParam,
  type FilterableCard,
  type FilterChip,
  type OwnerFilter,
  type TaskOwnerOption,
} from "./board"
import { SENT_BACK_LABEL, TASK_COLUMN_LABELS, type TaskColumn } from "./status"

/**
 * The Planner's URL: `month` when one is given (Today leaves it out, so the
 * page resolves the current Manila month) and `owner` when the viewer chose a
 * filter, both kept across the month links.
 */
export function plannerHref({
  month,
  owner,
}: {
  month?: string
  owner?: string
} = {}): string {
  const params = new URLSearchParams({ view: "planner" })
  if (month) params.set("month", month)
  if (owner) params.set("owner", owner)
  return `/dashboard?${params}`
}

/**
 * The Planner's filter chips: All, Mine, then the viewer's home scope when it
 * names a section, a desk or all articles. Top editors and management (home
 * scope all) get All and Mine. Counts are within the month's cards.
 */
export function plannerFilterChips(
  cards: readonly FilterableCard[],
  home: OwnerFilter | null,
  owners: readonly TaskOwnerOption[]
): FilterChip[] {
  const chip = (filter: OwnerFilter, label: string): FilterChip => ({
    value: ownerFilterParam(filter),
    filter,
    label,
    count: cards.filter((card) => matchesFilter(card, filter)).length,
  })
  const chips = [chip({ kind: "all" }, "All"), chip({ kind: "mine" }, "Mine")]
  if (home && home.kind !== "all" && home.kind !== "mine") {
    chips.push(
      chip(
        home,
        home.kind === "articles" ? "All articles" : ownerName(home, owners)
      )
    )
  }
  return chips
}

function ownerName(
  filter: { kind: "section" | "desk"; id: string },
  owners: readonly TaskOwnerOption[]
): string {
  return (
    owners.find(
      (option) => option.kind === filter.kind && option.id === filter.id
    )?.name ?? filter.id
  )
}

/**
 * The filter an `owner` parameter names for the Planner: Mine, All, or the
 * viewer's home scope; anything else (another desk, a bad value, a missing
 * one) means All.
 */
export function parsePlannerFilter(
  value: unknown,
  home: OwnerFilter | null
): OwnerFilter {
  if (value === "mine") return { kind: "mine" }
  if (
    home &&
    home.kind !== "all" &&
    home.kind !== "mine" &&
    value === ownerFilterParam(home)
  ) {
    return home
  }
  return { kind: "all" }
}

/** The line shown when the month has nothing under the active filter. */
export function plannerEmptyMessage(
  filter: OwnerFilter,
  owners: readonly TaskOwnerOption[]
): string {
  switch (filter.kind) {
    case "all":
      return "No deadlines this month."
    case "mine":
      return "None of your tasks are due this month."
    case "articles":
      return "No deadlines in any desk this month."
    case "section":
    case "desk":
      return `No ${ownerName(filter, owners)} deadlines this month.`
  }
}

/**
 * Tasks grouped by their Manila due date (`YYYY-MM-DD`), each day's tasks in
 * the order given.
 */
export function tasksByDay<T extends { dueAt: string }>(
  tasks: T[]
): Map<string, T[]> {
  const byDay = new Map<string, T[]>()
  for (const task of tasks) {
    const day = phtDayKey(task.dueAt)
    const list = byDay.get(day) ?? []
    list.push(task)
    byDay.set(day, list)
  }
  return byDay
}

/** "No deadlines", "1 deadline", "<n> deadlines": a day row's count. */
export function deadlineCount(count: number): string {
  if (count === 0) return "No deadlines"
  return count === 1 ? "1 deadline" : `${count} deadlines`
}

export type PlannerChipStatusKind = TaskColumn | "overdue" | "sent_back"

type ChipTask = {
  ownerName: string
  title: string
  dueAt: string
  column: TaskColumn
  overdue: boolean
  sentBack: boolean
}

/**
 * A chip's status: Overdue when the task is, else Sent back while its
 * revision note stands, otherwise its column.
 */
export function plannerChipStatus(
  task: Pick<ChipTask, "column" | "overdue" | "sentBack">
): {
  kind: PlannerChipStatusKind
  label: string
} {
  if (task.overdue) return { kind: "overdue", label: "Overdue" }
  if (task.sentBack) return { kind: "sent_back", label: SENT_BACK_LABEL }
  return { kind: task.column, label: TASK_COLUMN_LABELS[task.column] }
}

const DUE_FORMAT = "EEE, MMM d, h:mm a"

/** "Layout: <title>, <status>, due Sat, Oct 10, 5:00 PM" (PHT): the chip's name. */
export function plannerChipLabel(task: ChipTask): string {
  const { label } = plannerChipStatus(task)
  const owner = task.ownerName ? `${task.ownerName}: ` : ""
  return `${owner}${task.title}, ${label}, due ${formatInPht(task.dueAt, DUE_FORMAT)}`
}
