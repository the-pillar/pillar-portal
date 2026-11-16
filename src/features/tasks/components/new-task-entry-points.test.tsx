// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { emitCreatedTask } from "../created-task-signal"
import { BOARD_OWNERS, VIEWER, boardCard, plannerCard } from "./board-fixtures"
import { NewTaskButton } from "./new-task-button"
import { PlannerDayList } from "./planner-day-list"
import { PlannerGrid } from "./planner-grid"
import { TaskBoard } from "./task-board"
import { TaskPlanner } from "./task-planner"

const { search, pathname } = vi.hoisted(() => ({
  search: { current: "" },
  pathname: { current: "/dashboard" },
}))

vi.mock("../actions", () => ({
  moveTaskAction: vi.fn(),
  markDoneAction: vi.fn(),
  reopenTaskAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search.current),
  usePathname: () => pathname.current,
}))
vi.mock("@/components/ui/toast", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    undo: vi.fn(),
  }),
}))

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
  search.current = ""
  pathname.current = "/dashboard"
  window.history.replaceState(null, "", "/dashboard")
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

const board = (props: Partial<React.ComponentProps<typeof TaskBoard>> = {}) => (
  <TaskBoard
    cards={[boardCard(1, { title: "Spread" })]}
    owners={BOARD_OWNERS}
    viewerId={VIEWER}
    homeFilter={{ kind: "all" }}
    {...props}
  />
)

describe("the New task button", () => {
  it("sets new=task and nothing else", async () => {
    render(<NewTaskButton />)

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "New task" }))

    expect(window.location.search).toBe("?new=task")
  })

  it("hides below md on Task detail", () => {
    pathname.current = "/dashboard/tasks/abc"
    const { rerender } = render(<NewTaskButton />)
    expect(screen.getByRole("button", { name: "New task" })).toHaveClass(
      "max-md:hidden"
    )

    pathname.current = "/dashboard"
    rerender(<NewTaskButton />)
    expect(screen.getByRole("button", { name: "New task" })).not.toHaveClass(
      "max-md:hidden"
    )
  })

  it("hides below md while a text field has focus", () => {
    render(
      <>
        <NewTaskButton />
        <input aria-label="Notes" />
      </>
    )
    const button = screen.getByRole("button", { name: "New task" })

    act(() => screen.getByLabelText("Notes").focus())
    expect(button).toHaveClass("max-md:hidden")
    act(() => screen.getByLabelText("Notes").blur())
    expect(button).not.toHaveClass("max-md:hidden")

    // The shell's clearance rules key on this attribute.
    expect(button).toHaveAttribute("data-new-task-button")
    expect(button).not.toHaveAttribute("data-hidden")
    act(() => screen.getByLabelText("Notes").focus())
    expect(button).toHaveAttribute("data-hidden")
  })
})

describe("the Board's entry points", () => {
  it("offers nothing without canCreate", () => {
    render(board())
    expect(screen.queryByRole("button", { name: /Add a task/ })).toBeNull()

    cleanup()
    render(board({ cards: [] }))
    expect(screen.queryByRole("button", { name: "Create a task" })).toBeNull()
  })

  it("puts + Add a task at the foot of To Do only, carrying the active chip's owner", async () => {
    search.current = "owner=desk:layout"
    render(board({ canCreate: true }))

    const adds = screen.getAllByRole("button", { name: "+ Add a task" })
    expect(adds).toHaveLength(1)
    expect(adds[0]).toHaveClass("min-h-11")
    await userEvent.setup().click(adds[0]!)
    expect(new URLSearchParams(window.location.search).get("new")).toBe("task")
    expect(new URLSearchParams(window.location.search).get("new_owner")).toBe(
      "desk:layout"
    )
  })

  it("leaves the owner to the sheet when the chip is All", async () => {
    render(board({ canCreate: true }))

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "+ Add a task" }))

    expect(window.location.search).toBe("?new=task")
  })

  it("offers Create a task on the first-run Board", async () => {
    render(board({ cards: [], canCreate: true }))

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Create a task" }))

    expect(window.location.search).toBe("?new=task")
  })

  it("highlights the card just created once it is among the cards", () => {
    const { rerender } = render(board({ canCreate: true }))
    const created = boardCard(2, { title: "Brand new", createdBy: VIEWER })

    act(() => emitCreatedTask(created.id))
    rerender(
      board({
        canCreate: true,
        cards: [boardCard(1, { title: "Spread" }), created],
      })
    )

    expect(
      screen.getByText("Brand new").closest("li[data-card-id]")
    ).toHaveAttribute("data-highlight")
    expect(
      screen.getByText("Spread").closest("li[data-card-id]")
    ).not.toHaveAttribute("data-highlight")
  })

  it("has no axe violations with the entry points showing", async () => {
    const { container } = render(board({ canCreate: true }))
    expect(await axeViolations(container)).toEqual([])
  })
})

const DAY_TASKS = [
  plannerCard({ title: "Spread", dueAt: "2026-10-08T09:00:00Z" }),
]

describe("the Planner's entry points", () => {
  it("offers nothing without canCreate", () => {
    render(
      <>
        <h2 id="h">October 2026</h2>
        <PlannerGrid
          month="2026-10"
          today="2026-10-08"
          tasks={DAY_TASKS}
          labelledBy="h"
        />
        <PlannerDayList month="2026-10" today="2026-10-08" tasks={DAY_TASKS} />
      </>
    )
    expect(screen.queryByRole("button", { name: /Add a task/ })).toBeNull()
  })

  it("puts a + on each grid day, named for the day, opening the sheet due that day", async () => {
    render(
      <>
        <h2 id="h">October 2026</h2>
        <PlannerGrid
          month="2026-10"
          today="2026-10-08"
          tasks={DAY_TASKS}
          labelledBy="h"
          canCreate
        />
      </>
    )

    expect(
      screen.getAllByRole("button", { name: /^Add a task due/ })
    ).toHaveLength(31)
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Add a task due Fri, Oct 9" }))

    expect(window.location.search).toBe("?new=task&new_due=2026-10-09")
  })

  it("puts + Add a task at the foot of an open day and on an empty day's line", async () => {
    render(
      <PlannerDayList
        month="2026-10"
        today="2026-10-08"
        tasks={DAY_TASKS}
        canCreate
      />
    )

    const open = screen.getByRole("button", {
      name: "Add a task due Thu, Oct 8",
    })
    expect(open).toHaveTextContent("+ Add a task")
    expect(open).toHaveClass("min-h-11")
    expect(
      screen.getByRole("button", { name: "Add a task due Fri, Oct 9" })
    ).toBeInTheDocument()

    await userEvent.setup().click(open)
    expect(window.location.search).toBe("?new=task&new_due=2026-10-08")
  })

  it("highlights the created task's chip once it appears", () => {
    const created = plannerCard({
      title: "Brand new",
      dueAt: "2026-10-12T09:00:00Z",
    })
    const props = {
      month: "2026-10",
      today: "2026-10-08",
      previous: null,
      next: null,
      home: null,
      owners: BOARD_OWNERS,
      canCreate: true,
    }
    const { rerender } = render(<TaskPlanner {...props} cards={DAY_TASKS} />)

    act(() => emitCreatedTask(created.id))
    rerender(<TaskPlanner {...props} cards={[...DAY_TASKS, created]} />)

    const chips = screen.getAllByRole("link", { name: /Brand new/ })
    expect(chips.length).toBeGreaterThan(0)
    for (const chip of chips) {
      expect(chip.closest("li")).toHaveAttribute("data-highlight")
    }
  })
})
