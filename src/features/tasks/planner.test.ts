import { describe, expect, it } from "vitest"

import type { FilterableCard, TaskOwnerOption } from "./board"
import {
  deadlineCount,
  parsePlannerFilter,
  plannerChipLabel,
  plannerChipStatus,
  plannerEmptyMessage,
  plannerFilterChips,
  plannerHref,
  tasksByDay,
} from "./planner"

const OWNERS: TaskOwnerOption[] = [
  { kind: "section", id: "news", name: "News" },
  { kind: "section", id: "feature", name: "Feature" },
  { kind: "desk", id: "layout", name: "Layout" },
]

const card = (overrides: Partial<FilterableCard> = {}): FilterableCard => ({
  ownerKind: "desk",
  ownerId: "layout",
  yours: false,
  ...overrides,
})

describe("plannerFilterChips", () => {
  const cards = [
    card({ yours: true }),
    card(),
    card({ ownerKind: "section", ownerId: "news" }),
    card({ ownerKind: "section", ownerId: "feature", yours: true }),
  ]
  const summary = (home: Parameters<typeof plannerFilterChips>[1]) =>
    plannerFilterChips(cards, home, OWNERS).map((chip) => [
      chip.value,
      chip.label,
      chip.count,
    ])

  it("gives a desk's staff All, Mine and the desk, counted within the month", () => {
    expect(summary({ kind: "desk", id: "layout" })).toEqual([
      ["all", "All", 4],
      ["mine", "Mine", 2],
      ["desk:layout", "Layout", 2],
    ])
  })

  it("names a section by its owner row", () => {
    expect(summary({ kind: "section", id: "feature" })).toEqual([
      ["all", "All", 4],
      ["mine", "Mine", 2],
      ["section:feature", "Feature", 1],
    ])
  })

  it("gives all articles' staff All articles", () => {
    expect(summary({ kind: "articles" })).toEqual([
      ["all", "All", 4],
      ["mine", "Mine", 2],
      ["articles", "All articles", 2],
    ])
  })

  it.each([
    ["top editors and management (all)", { kind: "all" } as const],
    ["a home the Board doesn't know", null],
  ])("gives %s All and Mine only", (_label, home) => {
    expect(summary(home).map(([value]) => value)).toEqual(["all", "mine"])
  })
})

describe("parsePlannerFilter", () => {
  const home = { kind: "desk", id: "layout" } as const

  it.each([
    ["mine", home, { kind: "mine" }],
    ["all", home, { kind: "all" }],
    ["desk:layout", home, home],
    ["articles", { kind: "articles" } as const, { kind: "articles" }],
  ])("reads %s", (value, scope, expected) => {
    expect(parsePlannerFilter(value, scope)).toEqual(expected)
  })

  it.each([
    ["missing", null, home],
    ["another desk", "desk:photo", home],
    ["the home scope when there is none", "desk:layout", null],
    ["articles when home is a desk", "articles", home],
    ["garbage", "nope", home],
    ["repeated", ["mine", "mine"], home],
  ])("means All for %s", (_label, value, scope) => {
    expect(parsePlannerFilter(value, scope)).toEqual({ kind: "all" })
  })
})

describe("plannerEmptyMessage", () => {
  it.each([
    [{ kind: "all" }, "No deadlines this month."],
    [{ kind: "mine" }, "None of your tasks are due this month."],
    [{ kind: "desk", id: "layout" }, "No Layout deadlines this month."],
    [{ kind: "section", id: "news" }, "No News deadlines this month."],
    [{ kind: "articles" }, "No deadlines in any desk this month."],
  ] as const)("says %j as %s", (filter, expected) => {
    expect(plannerEmptyMessage(filter, OWNERS)).toBe(expected)
  })
})

describe("plannerHref", () => {
  it.each([
    [{}, "/dashboard?view=planner"],
    [{ owner: "mine" }, "/dashboard?view=planner&owner=mine"],
    [{ month: "2025-12" }, "/dashboard?view=planner&month=2025-12"],
    [
      { month: "2027-01", owner: "desk:layout" },
      "/dashboard?view=planner&month=2027-01&owner=desk%3Alayout",
    ],
  ])("builds %j as %s", (input, expected) => {
    expect(plannerHref(input)).toBe(expected)
  })
})

describe("tasksByDay", () => {
  it("groups by the Manila due date, keeping the given order within a day", () => {
    const tasks = [
      { id: "a", dueAt: "2026-10-31T15:30:00Z" }, // 11:30 PM Oct 31 in Manila
      { id: "b", dueAt: "2026-10-31T16:30:00Z" }, // 12:30 AM Nov 1 in Manila
      { id: "c", dueAt: "2026-10-30T16:00:00Z" }, // midnight Oct 31 in Manila
    ]

    expect(
      [...tasksByDay(tasks)].map(([day, list]) => [
        day,
        list.map((task) => task.id),
      ])
    ).toEqual([
      ["2026-10-31", ["a", "c"]],
      ["2026-11-01", ["b"]],
    ])
  })
})

describe("deadlineCount", () => {
  it.each([
    [0, "No deadlines"],
    [1, "1 deadline"],
    [2, "2 deadlines"],
    [12, "12 deadlines"],
  ])("reads %i as %s", (count, expected) => {
    expect(deadlineCount(count)).toBe(expected)
  })
})

describe("plannerChipStatus", () => {
  it.each([
    ["to_do", { kind: "to_do", label: "To Do" }],
    ["doing", { kind: "doing", label: "Doing" }],
    ["for_review", { kind: "for_review", label: "For Review" }],
    ["done", { kind: "done", label: "Done" }],
  ] as const)("is the column label for %s", (column, expected) => {
    expect(
      plannerChipStatus({ column, overdue: false, sentBack: false })
    ).toEqual(expected)
  })

  it("is Overdue when the task is", () => {
    expect(
      plannerChipStatus({ column: "doing", overdue: true, sentBack: false })
    ).toEqual({ kind: "overdue", label: "Overdue" })
  })

  it("is Sent back when the task was sent back and isn't overdue", () => {
    expect(
      plannerChipStatus({ column: "doing", overdue: false, sentBack: true })
    ).toEqual({ kind: "sent_back", label: "Sent back" })
  })

  it("is Overdue, not Sent back, when the task is both", () => {
    expect(
      plannerChipStatus({ column: "doing", overdue: true, sentBack: true })
    ).toEqual({ kind: "overdue", label: "Overdue" })
  })
})

describe("plannerChipLabel", () => {
  // Sat, Oct 10 2026, 5:00 PM in Manila.
  const TASK = {
    ownerName: "Layout",
    title: "Masthead brief",
    dueAt: "2026-10-10T09:00:00Z",
    column: "to_do",
    overdue: false,
    sentBack: false,
  } as const

  it("names the title, the status and the PHT due time", () => {
    expect(plannerChipLabel(TASK)).toBe(
      "Layout: Masthead brief, To Do, due Sat, Oct 10, 5:00 PM"
    )
  })

  it("says Overdue for an overdue task", () => {
    expect(plannerChipLabel({ ...TASK, overdue: true })).toBe(
      "Layout: Masthead brief, Overdue, due Sat, Oct 10, 5:00 PM"
    )
  })

  it("leaves the prefix out when the owner has no name", () => {
    expect(plannerChipLabel({ ...TASK, ownerName: "" })).toBe(
      "Masthead brief, To Do, due Sat, Oct 10, 5:00 PM"
    )
  })

  it("says Sent back for a sent-back task", () => {
    expect(plannerChipLabel({ ...TASK, column: "doing", sentBack: true })).toBe(
      "Layout: Masthead brief, Sent back, due Sat, Oct 10, 5:00 PM"
    )
  })
})
