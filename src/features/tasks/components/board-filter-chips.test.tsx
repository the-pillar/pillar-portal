// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BoardFilterChips } from "./board-filter-chips"

afterEach(cleanup)

const CHIPS = [
  { value: "all", label: "All", count: 5 },
  { value: "mine", label: "Mine", count: 1 },
  { value: "desk:layout", label: "Layout", count: 4 },
]

describe("BoardFilterChips", () => {
  it("is a radio group named Filter tasks, each chip named with its count", () => {
    render(<BoardFilterChips chips={CHIPS} value="all" onChange={() => {}} />)

    const group = screen.getByRole("radiogroup", { name: "Filter tasks" })
    expect(group).toBeInTheDocument()
    expect(
      screen.getByRole("radio", { name: "Layout, 4 tasks" })
    ).not.toBeChecked()
    expect(screen.getByRole("radio", { name: "All, 5 tasks" })).toBeChecked()
    expect(
      screen.getByRole("radio", { name: "Mine, 1 task" })
    ).toBeInTheDocument()
  })

  it("keeps one tab stop, on the active chip", () => {
    render(<BoardFilterChips chips={CHIPS} value="mine" onChange={() => {}} />)

    const stops = screen
      .getAllByRole("radio")
      .filter((radio) => radio.tabIndex === 0)
    expect(stops.map((radio) => radio.textContent)).toEqual(["Mine1, 1 task"])
  })

  it("calls onChange on a tap and reads the count in a polite status", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BoardFilterChips chips={CHIPS} value="all" onChange={onChange} />)

    await user.click(screen.getByRole("radio", { name: "Layout, 4 tasks" }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith("desk:layout")
    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing 4 tasks in Layout."
    )
  })

  it("moves focus with the arrow keys, Home and End, choosing nothing", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BoardFilterChips chips={CHIPS} value="all" onChange={onChange} />)

    screen.getByRole("radio", { name: "All, 5 tasks" }).focus()
    await user.keyboard("{ArrowRight}{ArrowRight}")
    expect(screen.getByRole("radio", { name: "Layout, 4 tasks" })).toHaveFocus()
    await user.keyboard("{Home}")
    expect(screen.getByRole("radio", { name: "All, 5 tasks" })).toHaveFocus()
    await user.keyboard("{End}")
    expect(screen.getByRole("radio", { name: "Layout, 4 tasks" })).toHaveFocus()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("has no axe violations", async () => {
    const { container } = render(
      <BoardFilterChips chips={CHIPS} value="all" onChange={() => {}} />
    )
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(results.violations).toEqual([])
  })
})
