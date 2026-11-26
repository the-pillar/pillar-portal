// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it } from "vitest"

import { PlannerSkeleton } from "./planner-skeleton"

afterEach(cleanup)

describe("PlannerSkeleton", () => {
  it("marks itself for the wide shell, so the width doesn't jump on load", () => {
    const { container } = render(<PlannerSkeleton />)

    expect(container.firstElementChild).toHaveAttribute("data-wide-view")
  })

  it("is a busy status that says it is loading the planner", () => {
    render(<PlannerSkeleton />)

    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(status).toHaveTextContent("Loading the planner")
  })

  it("has no axe violations", async () => {
    const { container } = render(<PlannerSkeleton />)

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(results.violations).toEqual([])
  })
})

describe("PlannerSkeleton layout", () => {
  it("outlines the chip row, the month row, and the grid or the day list by pointer", () => {
    const { container } = render(<PlannerSkeleton />)

    // h1, three chips, month heading, controls, then the month's two forms.
    expect(
      container.querySelector(".md\\:not-any-pointer-coarse\\:grid")?.children
    ).toHaveLength(35)
    expect(
      container.querySelector(".md\\:not-any-pointer-coarse\\:hidden")
    ).not.toBeNull()
  })
})
