// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, within } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it } from "vitest"

import type { PlannerCard } from "../queries/planner"
import { plannerCard } from "./board-fixtures"
import { PlannerGrid } from "./planner-grid"

afterEach(cleanup)

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

function task(title: string, dueAt: string, yours = false): PlannerCard {
  return plannerCard({ title, dueAt, yours })
}

function renderGrid(tasks: PlannerCard[], today = "2026-10-08") {
  return render(
    <>
      <h2 id="month-heading">October 2026</h2>
      <PlannerGrid
        month="2026-10"
        today={today}
        tasks={tasks}
        labelledBy="month-heading"
      />
    </>
  )
}

// The cell for a day of October 2026, found by its date.
function cellOf(day: number) {
  const time = document.querySelector(
    `time[datetime="2026-10-${String(day).padStart(2, "0")}"]`
  )
  const cell = time?.closest("td")
  if (!cell) throw new Error(`no cell for Oct ${day}`)
  return cell
}

describe("PlannerGrid", () => {
  it("is a table labelled by the month heading, Sunday first", () => {
    renderGrid([])

    const table = screen.getByRole("table", { name: "October 2026" })
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent)
    ).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])
    expect(within(table).getAllByRole("columnheader")[0]).toHaveAttribute(
      "abbr",
      "Sunday"
    )
  })

  it("lays out five weeks, with blank cells outside the month (Oct 1 is a Thursday)", () => {
    renderGrid([])

    const rows = screen.getAllByRole("row").slice(1)
    expect(rows).toHaveLength(5)
    const firstWeek = within(rows[0]).getAllByRole("cell")
    expect(firstWeek.map((cell) => cell.textContent)).toEqual([
      "",
      "",
      "",
      "",
      "1",
      "2",
      "3",
    ])
    const lastWeek = within(rows[4]).getAllByRole("cell")
    expect(lastWeek.map((cell) => cell.textContent)).toEqual([
      "25",
      "26",
      "27",
      "28",
      "29",
      "30",
      "31",
    ])
  })

  it("marks today's cell with aria-current and its number on a filled navy circle, and no other", () => {
    renderGrid([])

    const today = cellOf(8)
    expect(today).toHaveAttribute("aria-current", "date")
    const number = today.querySelector("time")
    expect(number).toHaveClass("rounded-full", "bg-navy", "text-white")
    expect(document.querySelectorAll('[aria-current="date"]')).toHaveLength(1)
    expect(cellOf(9)).not.toHaveAttribute("aria-current")
    expect(cellOf(9).querySelector("time")).not.toHaveClass("bg-navy")
    expect(cellOf(9).querySelector("time")).toHaveClass("text-muted-foreground")
  })

  it("is a white cell at least 112px tall, with outside-month cells in the page color", () => {
    renderGrid([])

    expect(cellOf(9)).toHaveClass("bg-card", "h-28")
    const blank = screen.getAllByRole("cell")[0]
    expect(blank).toHaveClass("bg-background")
  })

  it("marks no cell when today is in another month", () => {
    renderGrid([], "2026-11-01")

    expect(document.querySelector("[aria-current]")).toBeNull()
  })

  it("puts each task on its Manila due date", () => {
    renderGrid([
      // Sat, Oct 10, 5:00 PM in Manila.
      task("Masthead brief", "2026-10-10T09:00:00Z"),
      // 11:30 PM on Oct 31 in Manila, 3:30 PM UTC the same day.
      task("Last call", "2026-10-31T15:30:00Z"),
      // Manila midnight on Oct 2 is still Oct 1 in UTC.
      task("Early bird", "2026-10-01T16:00:00Z"),
    ])

    expect(
      within(cellOf(10)).getByRole("link", { name: /^Layout: Masthead brief,/ })
    ).toBeInTheDocument()
    expect(
      within(cellOf(31)).getByRole("link", { name: /^Layout: Last call,/ })
    ).toBeInTheDocument()
    expect(
      within(cellOf(2)).getByRole("link", { name: /^Layout: Early bird,/ })
    ).toBeInTheDocument()
    expect(within(cellOf(1)).queryByRole("link")).toBeNull()
  })

  it("shows every chip on a busy day, in the order given, with no '+n more'", () => {
    const titles = ["One", "Two", "Three", "Four", "Five", "Six"]
    renderGrid(titles.map((title, n) => task(title, `2026-10-15T0${n}:00:00Z`)))

    const links = within(cellOf(15)).getAllByRole("link")
    expect(links.map((link) => link.textContent)).toEqual(titles)
    expect(links.every((link) => link.dataset.owner === "layout")).toBe(true)
    expect(screen.queryByText(/more/)).toBeNull()
  })

  it("fills the chips I hold an open slot on", () => {
    renderGrid([task("Mine", "2026-10-15T01:00:00Z", true)])

    expect(
      within(cellOf(15)).getByRole("link", { name: /^Layout: Mine,/ })
    ).toHaveClass("bg-navy-tint")
  })

  it("has no axe violations", async () => {
    const { container } = renderGrid([
      task("Masthead brief", "2026-10-10T09:00:00Z"),
      task("Today's spread", "2026-10-08T03:00:00Z"),
    ])

    expect(await axeViolations(container)).toEqual([])
  })
})
