// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { BOARD_OWNERS, plannerCard } from "./board-fixtures"
import { TaskPlanner } from "./task-planner"

const { search } = vi.hoisted(() => ({ search: { current: "" } }))

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.current),
}))

beforeEach(() => {
  search.current = ""
})
afterEach(cleanup)

// Oct 8 (Thu), Oct 10 (Sat) and Oct 20 (Tue) 2026, in Manila.
const CARDS = [
  plannerCard({
    title: "Layout mine",
    dueAt: "2026-10-08T09:00:00Z",
    yours: true,
    column: "doing",
  }),
  plannerCard({
    title: "Layout done",
    dueAt: "2026-10-10T09:00:00Z",
    column: "done",
  }),
  plannerCard({
    title: "News story",
    dueAt: "2026-10-20T09:00:00Z",
    ownerId: "news",
    ownerKind: "section",
    ownerName: "News",
  }),
]

type Props = Partial<React.ComponentProps<typeof TaskPlanner>>
function renderPlanner(props: Props = {}) {
  return render(
    <TaskPlanner
      month="2026-10"
      today="2026-10-08"
      previous="2026-09"
      next="2026-11"
      home={{ kind: "desk", id: "layout" }}
      owners={BOARD_OWNERS}
      cards={CARDS}
      {...props}
    />
  )
}

// The grid and the day list are both in the DOM (CSS picks one), so a task's
// links are found in the grid's table.
const grid = () => screen.getByRole("table", { name: "October 2026" })
const gridTitles = () =>
  within(grid())
    .queryAllByRole("link")
    .map((link) => link.textContent)

describe("TaskPlanner", () => {
  it("shows every task, Done included, under All, with the home scope's chips and counts", () => {
    renderPlanner()

    expect(gridTitles()).toEqual(["Layout mine", "Layout done", "News story"])
    const chips = screen.getAllByRole("radio")
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "All3, 3 tasks",
      "Mine1, 1 task",
      "Layout2, 2 tasks",
    ])
    expect(screen.getByRole("radio", { name: /^All/ })).toBeChecked()
  })

  it("orders h1-owner chips, month heading and its controls, then the month", () => {
    renderPlanner()

    const order = [
      screen.getByRole("radiogroup"),
      screen.getByRole("heading", { level: 2, name: "October 2026" }),
      screen.getByRole("navigation", { name: "Months" }),
      grid(),
    ]
    for (let n = 1; n < order.length; n++) {
      expect(
        order[n - 1].compareDocumentPosition(order[n]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
  })

  it("filters Mine in the client, dropping Done tasks, with a history entry and no request", async () => {
    const user = userEvent.setup()
    const push = vi.spyOn(window.history, "pushState")
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    renderPlanner()

    await user.click(screen.getByRole("radio", { name: /^Mine/ }))

    expect(gridTitles()).toEqual(["Layout mine"])
    expect(push).toHaveBeenCalledWith(
      null,
      "",
      expect.stringContaining("owner=mine")
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    push.mockRestore()
    fetchSpy.mockRestore()
  })

  it("filters the home scope", async () => {
    const user = userEvent.setup()
    renderPlanner()

    await user.click(screen.getByRole("radio", { name: /^Layout/ }))

    expect(gridTitles()).toEqual(["Layout mine", "Layout done"])
  })

  it("gives top editors and management All and Mine only", () => {
    renderPlanner({ home: { kind: "all" } })

    expect(
      screen.getAllByRole("radio").map((chip) => chip.textContent?.slice(0, 4))
    ).toEqual(["All3", "Mine"])
  })

  it("reads owner from the URL and treats any other value as All", () => {
    search.current = "owner=mine"
    const { unmount } = renderPlanner()
    expect(screen.getByRole("radio", { name: /^Mine/ })).toBeChecked()
    expect(gridTitles()).toEqual(["Layout mine"])
    unmount()

    search.current = "owner=desk:photo"
    renderPlanner()
    expect(screen.getByRole("radio", { name: /^All/ })).toBeChecked()
    expect(gridTitles()).toHaveLength(3)
  })

  it("keeps owner in the month links only when a filter was chosen", () => {
    const { unmount } = renderPlanner()
    expect(screen.getByRole("link", { name: "Next month" })).toHaveAttribute(
      "href",
      "/dashboard?view=planner&month=2026-11"
    )
    unmount()

    search.current = "owner=mine"
    renderPlanner()
    expect(
      screen.getByRole("link", { name: "Previous month" })
    ).toHaveAttribute(
      "href",
      "/dashboard?view=planner&month=2026-09&owner=mine"
    )
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute(
      "href",
      "/dashboard?view=planner&owner=mine"
    )
    expect(screen.getByRole("link", { name: "Next month" })).toHaveAttribute(
      "href",
      "/dashboard?view=planner&month=2026-11&owner=mine"
    )
  })

  it("leaves Previous or Next out at the edge", () => {
    renderPlanner({ previous: null, next: null })

    expect(screen.queryByRole("link", { name: "Previous month" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Next month" })).toBeNull()
    expect(screen.getByRole("link", { name: "Today" })).toBeInTheDocument()
  })

  it("makes every month control a 44px link", () => {
    renderPlanner()

    for (const name of ["Previous month", "Today", "Next month"]) {
      expect(screen.getByRole("link", { name })).toHaveClass("h-11")
    }
  })

  it("announces the new month's count under the active chip, never on first render", () => {
    search.current = "owner=mine"
    const { rerender } = renderPlanner()
    // The Board's chips' own status is another region: this is the month's.
    const monthStatus = () =>
      screen
        .getAllByRole("status")
        .map((status) => status.textContent)
        .filter(Boolean)
    expect(monthStatus()).toEqual([])

    rerender(
      <TaskPlanner
        month="2026-11"
        today="2026-10-08"
        previous="2026-10"
        next="2026-12"
        home={{ kind: "desk", id: "layout" }}
        owners={BOARD_OWNERS}
        cards={[CARDS[0]]}
      />
    )

    expect(monthStatus()).toEqual(["November 2026, 1 deadline."])
  })

  it("keeps the chosen chip and the focused Next link across a month change", () => {
    search.current = "owner=mine"
    const { rerender } = renderPlanner()
    const nextLink = screen.getByRole("link", { name: "Next month" })
    nextLink.focus()

    rerender(
      <TaskPlanner
        month="2026-11"
        today="2026-10-08"
        previous="2026-10"
        next="2026-12"
        home={{ kind: "desk", id: "layout" }}
        owners={BOARD_OWNERS}
        cards={[CARDS[0]]}
      />
    )

    expect(document.activeElement).toBe(nextLink)
    expect(nextLink).toHaveAttribute(
      "href",
      "/dashboard?view=planner&month=2026-12&owner=mine"
    )
    expect(screen.getByRole("radio", { name: /^Mine/ })).toHaveAttribute(
      "aria-checked",
      "true"
    )
  })

  it("counts the new month under the new URL's chip when both change together", () => {
    const { rerender } = renderPlanner({ cards: [] })
    const monthStatus = () =>
      screen
        .getAllByRole("status")
        .map((status) => status.textContent)
        .filter(Boolean)

    search.current = "owner=mine"
    rerender(
      <TaskPlanner
        month="2026-11"
        today="2026-10-08"
        previous="2026-10"
        next="2026-12"
        home={{ kind: "desk", id: "layout" }}
        owners={BOARD_OWNERS}
        cards={CARDS}
      />
    )

    expect(monthStatus()).toEqual(["November 2026, 1 deadline."])
  })

  it.each([
    ["all", "No deadlines this month."],
    ["mine", "None of your tasks are due this month."],
    ["desk:layout", "No Layout deadlines this month."],
  ])("says %s has nothing when the month is empty", (owner, message) => {
    search.current = `owner=${owner}`
    renderPlanner({ cards: [] })

    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("says all articles has nothing in any desk", () => {
    search.current = "owner=articles"
    renderPlanner({ home: { kind: "articles" }, cards: [] })

    expect(
      screen.getByText("No deadlines in any desk this month.")
    ).toBeInTheDocument()
  })

  it("splits the grid and the day list by CSS, never user agent", () => {
    renderPlanner()

    const gridBox = grid().parentElement
    expect(gridBox).toHaveClass("hidden", "md:not-any-pointer-coarse:block")
    const dayList = gridBox?.nextElementSibling
    expect(dayList).toHaveClass("md:not-any-pointer-coarse:hidden")
    expect(
      within(dayList as HTMLElement).getAllByRole("button").length
    ).toBeGreaterThan(0)
  })

  it("has no axe violations", async () => {
    const { container } = renderPlanner()

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(results.violations).toEqual([])
  })
})
