// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it } from "vitest"

import type { PlannerCard } from "../queries/planner"
import { plannerCard } from "./board-fixtures"
import { PlannerChip } from "./planner-chip"

afterEach(cleanup)

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

// Sat, Oct 10 2026, 5:00 PM in Manila.
const TASK: PlannerCard = plannerCard({ title: "Masthead brief" })

const glyphOf = (link: HTMLElement) => link.querySelector("svg")

describe("PlannerChip", () => {
  it("carries the Planner's month and chip as from", () => {
    render(
      <PlannerChip
        task={TASK}
        from="/dashboard?view=planner&month=2026-10&owner=mine"
      />
    )

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/dashboard/tasks/${TASK.id}?from=${encodeURIComponent("/dashboard?view=planner&month=2026-10&owner=mine")}`
    )
  })

  it("links to Task detail, named by the title, the status and the PHT due time", () => {
    render(<PlannerChip task={TASK} />)

    const link = screen.getByRole("link", {
      name: "Layout: Masthead brief, To Do, due Sat, Oct 10, 5:00 PM",
    })
    expect(link).toHaveAttribute("href", `/dashboard/tasks/${TASK.id}`)
    expect(link.tagName).toBe("A")
    // A white card with the card shadow, at least 24px tall, in the owner's
    // color on a 3px left stripe.
    expect(link).toHaveClass(
      "bg-card",
      "shadow-card",
      "rounded-xs",
      "min-h-6",
      "border-l-[3px]",
      "border-l-(--owner)"
    )
    expect(link).toHaveAttribute("data-owner", "layout")
  })

  it("shows the title truncated to one line after the glyph", () => {
    render(<PlannerChip task={TASK} />)

    const link = screen.getByRole("link")
    const title = screen.getByText("Masthead brief")
    expect(title).toHaveClass("truncate")
    expect(link.firstElementChild?.tagName.toLowerCase()).toBe("svg")
  })

  it.each([
    ["to_do", false, false, "lucide-circle", "text-muted-foreground", "To Do"],
    [
      "doing",
      false,
      false,
      "lucide-circle-dot",
      "text-status-progress",
      "Doing",
    ],
    [
      "for_review",
      false,
      false,
      "lucide-circle-dot",
      "text-status-progress",
      "For Review",
    ],
    [
      "done",
      false,
      false,
      "lucide-circle-check",
      "text-status-positive",
      "Done",
    ],
    [
      "doing",
      true,
      false,
      "lucide-circle-alert",
      "text-status-attention",
      "Overdue",
    ],
    [
      "doing",
      false,
      true,
      "lucide-circle-alert",
      "text-status-attention",
      "Sent back",
    ],
    [
      "doing",
      true,
      true,
      "lucide-circle-alert",
      "text-status-attention",
      "Overdue",
    ],
  ] as const)(
    "shows %s (overdue: %s, sent back: %s) as a 12px hidden %s glyph in %s",
    (column, overdue, sentBack, glyph, color, status) => {
      render(<PlannerChip task={{ ...TASK, column, overdue, sentBack }} />)

      const link = screen.getByRole("link", {
        name: `Layout: Masthead brief, ${status}, due Sat, Oct 10, 5:00 PM`,
      })
      const svg = glyphOf(link)
      expect(svg).toHaveClass(glyph, color, "size-3")
      expect(svg).toHaveAttribute("aria-hidden", "true")
    }
  )

  it("fills a chip where I hold an open slot with navy-tint and a semibold title", () => {
    const { rerender } = render(<PlannerChip task={TASK} />)
    expect(screen.getByRole("link")).toHaveClass("bg-card")
    expect(screen.getByRole("link")).not.toHaveClass("bg-navy-tint")
    expect(screen.getByText("Masthead brief")).not.toHaveClass("font-semibold")

    rerender(<PlannerChip task={{ ...TASK, yours: true }} />)

    expect(screen.getByRole("link")).toHaveClass("bg-navy-tint")
    expect(screen.getByText("Masthead brief")).toHaveClass("font-semibold")
  })

  it("is a full-width 44px row with a muted owner prefix in the row variant", () => {
    render(<PlannerChip task={TASK} variant="row" />)

    const link = screen.getByRole("link", {
      name: "Layout: Masthead brief, To Do, due Sat, Oct 10, 5:00 PM",
    })
    expect(link).toHaveClass("min-h-11", "w-full")
    expect(screen.getByText("Layout ·")).toHaveClass("text-muted-foreground")
  })

  it("has no axe violations", async () => {
    const { container } = render(
      <ul>
        <li>
          <PlannerChip task={TASK} />
        </li>
        <li>
          <PlannerChip task={{ ...TASK, id: "z", yours: true }} variant="row" />
        </li>
        <li>
          <PlannerChip task={{ ...TASK, id: "x", overdue: true }} />
        </li>
        <li>
          <PlannerChip task={{ ...TASK, id: "y", sentBack: true }} />
        </li>
      </ul>
    )

    expect(await axeViolations(container)).toEqual([])
  })
})
