// Fixtures the Board's tests share (not a test file itself).
import type { BoardCard } from "../queries/board"

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
