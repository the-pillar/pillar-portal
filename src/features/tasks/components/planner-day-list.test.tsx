// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it } from "vitest"

import { plannerCard } from "./board-fixtures"
import { PlannerDayList } from "./planner-day-list"

afterEach(cleanup)

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

function task(title: string, dueAt: string) {
  return plannerCard({ title, dueAt, column: "doing" })
}

// Sat, Oct 3 and Tue, Oct 20 2026, in Manila.
const TASKS = [
  task("Masthead brief", "2026-10-03T09:00:00Z"),
  task("Spread proof", "2026-10-20T01:00:00Z"),
  task("Cover art", "2026-10-20T09:00:00Z"),
]

const triggers = () => screen.getAllByRole("button")
const names = () =>
  triggers().map((trigger) => trigger.getAttribute("aria-label"))

describe("PlannerDayList", () => {
  it("makes accordion items of the days with deadlines, with only today open", () => {
    render(<PlannerDayList month="2026-10" today="2026-10-20" tasks={TASKS} />)

    expect(names()).toEqual([
      "Sat, Oct 3, 1 deadline",
      "Tue, Oct 20 · Today, 2 deadlines",
    ])
    expect(
      triggers().map((trigger) => trigger.getAttribute("aria-expanded"))
    ).toEqual(["false", "true"])
  })

  it("lists every other day of the month as one plain line, in date order", () => {
    const { container } = render(
      <PlannerDayList month="2026-10" today="2026-10-08" tasks={TASKS} />
    )

    const lines = [...container.querySelectorAll("p")].map(
      (line) => line.textContent
    )
    expect(lines).toHaveLength(29)
    expect(lines[0]).toBe("Thu, Oct 1 · No deadlines")
    expect(lines[1]).toBe("Fri, Oct 2 · No deadlines")
    expect(lines).toContain("Thu, Oct 8 · Today · No deadlines")
    expect(lines.at(-1)).toBe("Sat, Oct 31 · No deadlines")
    // Today has nothing, so nothing starts open.
    for (const trigger of triggers()) {
      expect(trigger).toHaveAttribute("aria-expanded", "false")
    }
  })

  it("names each 44px trigger by its day and count, with a serif header and a count pill", () => {
    render(<PlannerDayList month="2026-10" today="2026-10-20" tasks={TASKS} />)

    const today = screen.getByRole("button", {
      name: "Tue, Oct 20 · Today, 2 deadlines",
    })
    expect(today).toHaveClass("min-h-11")
    const [day, pill] = [...today.querySelectorAll("span span")]
    expect(day).toHaveTextContent("Tue, Oct 20 · Today")
    expect(day).toHaveClass("font-heading", "text-heading-sm")
    expect(pill).toHaveTextContent("2")
    expect(pill).toHaveClass("rounded-full")
  })

  it("lists a day's tasks as 44px chip rows with owner prefixes, each linking to Task detail", () => {
    render(<PlannerDayList month="2026-10" today="2026-10-20" tasks={TASKS} />)

    const region = screen.getByRole("region", {
      name: "Tue, Oct 20 · Today, 2 deadlines",
    })
    const links = within(region).getAllByRole("link")
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Layout: Spread proof, Doing, due Tue, Oct 20, 9:00 AM",
      "Layout: Cover art, Doing, due Tue, Oct 20, 5:00 PM",
    ])
    expect(links[1]).toHaveAttribute("href", `/dashboard/tasks/${TASKS[2].id}`)
    for (const link of links) expect(link).toHaveClass("min-h-11", "w-full")
    expect(within(region).getAllByText("Layout ·")).toHaveLength(2)
    expect(region.firstElementChild).toHaveClass("h-auto")
  })

  it("expands none in another month", () => {
    render(<PlannerDayList month="2026-10" today="2026-11-05" tasks={TASKS} />)

    expect(names()).toEqual([
      "Sat, Oct 3, 1 deadline",
      "Tue, Oct 20, 2 deadlines",
    ])
    for (const trigger of triggers()) {
      expect(trigger).toHaveAttribute("aria-expanded", "false")
    }
  })

  it("lets several days stay open", async () => {
    const user = userEvent.setup()
    render(<PlannerDayList month="2026-10" today="2026-10-20" tasks={TASKS} />)

    await user.click(
      screen.getByRole("button", { name: "Sat, Oct 3, 1 deadline" })
    )

    expect(
      screen.getByRole("button", { name: "Sat, Oct 3, 1 deadline" })
    ).toHaveAttribute("aria-expanded", "true")
    expect(
      screen.getByRole("button", { name: "Tue, Oct 20 · Today, 2 deadlines" })
    ).toHaveAttribute("aria-expanded", "true")
  })

  it("opens today when the month changes to the one that holds it", () => {
    const { rerender } = render(
      <PlannerDayList month="2026-11" today="2026-10-20" tasks={[]} />
    )
    expect(screen.queryAllByRole("button")).toEqual([])

    rerender(
      <PlannerDayList month="2026-10" today="2026-10-20" tasks={TASKS} />
    )

    expect(
      screen.getByRole("button", { name: "Tue, Oct 20 · Today, 2 deadlines" })
    ).toHaveAttribute("aria-expanded", "true")
  })

  it("has no axe violations", async () => {
    const { container } = render(
      <PlannerDayList month="2026-10" today="2026-10-20" tasks={TASKS} />
    )

    expect(await axeViolations(container)).toEqual([])
  })
})
