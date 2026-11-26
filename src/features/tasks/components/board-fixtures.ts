// Fixtures the Board's tests share (not a test file itself).
import type { BoardCard } from "../queries/board"
import type { PlannerCard } from "../queries/planner"

export const BOARD_OWNERS = [
  { kind: "section" as const, id: "news", name: "News" },
  { kind: "desk" as const, id: "layout", name: "Layout" },
  { kind: "desk" as const, id: "photo", name: "Photo" },
]

export const VIEWER = "00000000-0000-4000-8000-0000000000a1"
export const OTHER_MEMBER = "00000000-0000-4000-8000-0000000000a2"

export function boardCard(
  n: number,
  overrides: Partial<BoardCard> & { title: string }
): BoardCard {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    ownerName: "Layout",
    ownerId: "layout",
    ownerKind: "desk",
    dueAt: "2099-01-01T00:00:00+00:00",
    column: "to_do",
    overdue: false,
    sentBack: false,
    hasAwaitingResponse: false,
    hasNeedsReassignment: false,
    assignees: [],
    moves: [],
    yours: false,
    movedAt: `2026-11-15T00:00:0${n}.123456+00:00`,
    movedBy: null,
    movedByName: null,
    createdBy: null,
    doneAt: null,
    ...overrides,
  }
}

let plannerCount = 0

/** A Planner card: Layout's, due Oct 10 2026 5:00 PM in Manila, not yours. */
export function plannerCard(
  overrides: Partial<PlannerCard> & { title: string }
): PlannerCard {
  plannerCount += 1
  return {
    id: `00000000-0000-4000-8000-${String(plannerCount).padStart(12, "0")}`,
    ownerName: "Layout",
    ownerId: "layout",
    ownerKind: "desk",
    dueAt: "2026-10-10T09:00:00+00:00",
    column: "to_do",
    overdue: false,
    sentBack: false,
    hasAwaitingResponse: false,
    hasNeedsReassignment: false,
    assignees: [],
    yours: false,
    ...overrides,
  }
}
