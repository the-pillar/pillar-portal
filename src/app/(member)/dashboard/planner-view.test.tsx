// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  getMyHomeScope,
  getBoardOwners,
  getPlanner,
  canCreateTask,
  TaskPlanner,
} = vi.hoisted(() => ({
  getMyHomeScope: vi.fn(),
  canCreateTask: vi.fn(),
  getBoardOwners: vi.fn(),
  getPlanner: vi.fn(),
  // The client Planner is tested on its own: stub it, and check its props.
  TaskPlanner: vi.fn((props: Record<string, unknown>) => (
    <p>planner {String(props.month)}</p>
  )),
}))

vi.mock("@/features/members", () => ({ getMyHomeScope }))
vi.mock("@/features/tasks", async () => {
  // vi.importActual isn't an import statement, so the slice-boundary lint
  // rule (which wants @/features/tasks through its index) doesn't see it.
  const board = await vi.importActual<typeof import("@/features/tasks/board")>(
    "@/features/tasks/board"
  )
  return {
    ownerFilterParam: board.ownerFilterParam,
    parseOwnerFilterParam: board.parseOwnerFilterParam,
    getBoardOwners,
    getPlanner,
    canCreateTask,
    TaskPlanner,
  }
})

import { PlannerView } from "./planner-view"

const OWNERS = [
  { kind: "section", id: "news", name: "News" },
  { kind: "desk", id: "layout", name: "Layout" },
]
const CARDS = [{ id: "t1" }]

beforeEach(() => {
  // Thu, Oct 8 2026, 10:00 AM in Manila.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-08T02:00:00Z"))
  getBoardOwners.mockResolvedValue(OWNERS)
  getMyHomeScope.mockResolvedValue({ kind: "desk", id: "layout" })
  getPlanner.mockResolvedValue(CARDS)
  canCreateTask.mockResolvedValue(true)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

async function renderView(month: unknown) {
  return render(await PlannerView({ month }))
}

const props = () => TaskPlanner.mock.calls[0][0]

describe("PlannerView", () => {
  it("has the h1 Planner, marks its root for the wide shell, and renders the Planner", async () => {
    const { container } = await renderView(undefined)

    expect(container.firstElementChild).toHaveAttribute("data-wide-view")
    expect(
      screen.getByRole("heading", { level: 1, name: "Planner" })
    ).toBeInTheDocument()
    expect(screen.getByText("planner 2026-10")).toBeInTheDocument()
  })

  it("reads the month once and hands the Planner everything it shows", async () => {
    await renderView("2026-11")

    expect(getPlanner).toHaveBeenCalledExactlyOnceWith("2026-11")
    expect(props()).toEqual({
      month: "2026-11",
      today: "2026-10-08",
      previous: "2026-10",
      next: "2026-12",
      home: { kind: "desk", id: "layout" },
      owners: OWNERS,
      cards: CARDS,
      canCreate: true,
    })
  })

  it("resolves the current Manila month when it is already the 1st there", async () => {
    // 12:30 AM on Sun, Nov 1 in Manila; still Oct 31 in UTC.
    vi.setSystemTime(new Date("2026-10-31T16:30:00Z"))

    await renderView(undefined)

    expect(props().month).toBe("2026-11")
    expect(props().today).toBe("2026-11-01")
  })

  it.each([
    ["month 13", "2026-13"],
    ["not a month", "abc"],
    ["a one-digit month", "2026-1"],
    ["a repeated month", ["2026-11", "2026-12"]],
  ])("shows the current month for %s", async (_label, month) => {
    await renderView(month)

    expect(props().month).toBe("2026-10")
    expect(getPlanner).toHaveBeenCalledWith("2026-10")
  })

  it.each([
    ["1000-01", null, "1000-02"],
    ["9999-12", "9999-11", null],
  ])(
    "leaves Previous or Next out at the edge: %s",
    async (month, previous, next) => {
      await renderView(month)

      expect(props().previous).toBe(previous)
      expect(props().next).toBe(next)
    }
  )

  it("hands null as the home scope when it names no owner the Board knows", async () => {
    getMyHomeScope.mockResolvedValue({ kind: "desk", id: "gone" })

    await renderView(undefined)

    expect(props().home).toBeNull()
  })

  it("lets a query failure throw", async () => {
    getPlanner.mockRejectedValue(new Error("planner boom"))
    await expect(PlannerView({ month: undefined })).rejects.toThrow(
      "planner boom"
    )

    getPlanner.mockResolvedValue(CARDS)
    getBoardOwners.mockRejectedValue(new Error("boom"))
    await expect(PlannerView({ month: undefined })).rejects.toThrow("boom")

    getBoardOwners.mockResolvedValue(OWNERS)
    getMyHomeScope.mockRejectedValue(new Error("scope boom"))
    await expect(PlannerView({ month: undefined })).rejects.toThrow(
      "scope boom"
    )
  })
})
