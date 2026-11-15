// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { usePathname, useSearchParams } = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(),
}))
vi.mock("next/navigation", () => ({ usePathname, useSearchParams }))

import { DashboardTabs } from "./dashboard-tabs"

beforeEach(() => {
  useSearchParams.mockReturnValue(new URLSearchParams())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

describe.each(["header", "bar"] as const)("DashboardTabs (%s)", (variant) => {
  const renderTabs = () => render(<DashboardTabs variant={variant} />)

  it("is a Views nav with What's mine linking to /dashboard", () => {
    usePathname.mockReturnValue("/dashboard")
    renderTabs()

    expect(
      screen.getByRole("navigation", { name: "Views" })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "What's mine" })).toHaveAttribute(
      "href",
      "/dashboard"
    )
  })

  it("reads What's mine · Board · Planner, in that order, linking to their views", () => {
    usePathname.mockReturnValue("/dashboard")
    renderTabs()

    const links = [
      ...screen
        .getByRole("navigation", { name: "Views" })
        .querySelectorAll("a"),
    ]
    expect(links.map((link) => link.textContent)).toEqual([
      "What's mine",
      "Board",
      "Planner",
    ])
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/dashboard",
      "/dashboard?view=board",
      "/dashboard?view=planner",
    ])
  })

  it("marks What's mine current on /dashboard, and only it", () => {
    usePathname.mockReturnValue("/dashboard")
    renderTabs()

    expect(screen.getByRole("link", { name: "What's mine" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    for (const name of ["Board", "Planner"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute(
        "aria-current"
      )
    }
  })

  it("marks Board current, and not What's mine, on /dashboard?view=board", () => {
    usePathname.mockReturnValue("/dashboard")
    useSearchParams.mockReturnValue(new URLSearchParams("view=board&owner=all"))
    renderTabs()

    expect(screen.getByRole("link", { name: "Board" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(
      screen.getByRole("link", { name: "What's mine" })
    ).not.toHaveAttribute("aria-current")
  })

  it("marks Planner current, and no other tab, on /dashboard?view=planner", () => {
    usePathname.mockReturnValue("/dashboard")
    useSearchParams.mockReturnValue(
      new URLSearchParams("view=planner&month=2026-11&scope=home")
    )
    renderTabs()

    expect(screen.getByRole("link", { name: "Planner" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    for (const name of ["What's mine", "Board"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute(
        "aria-current"
      )
    }
  })

  // Read as the page reads it: a repeated view renders What's mine.
  it.each([
    ["an unknown view", "view=nope"],
    ["a repeated view", "view=board&view=board"],
    ["a repeated planner view", "view=planner&view=planner"],
  ])("keeps What's mine current for %s", (_label, search) => {
    usePathname.mockReturnValue("/dashboard")
    useSearchParams.mockReturnValue(new URLSearchParams(search))
    renderTabs()

    expect(screen.getByRole("link", { name: "What's mine" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    for (const name of ["Board", "Planner"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute(
        "aria-current"
      )
    }
  })

  it("is present but not current on a task's page", () => {
    usePathname.mockReturnValue("/dashboard/tasks/abc")
    useSearchParams.mockReturnValue(new URLSearchParams("view=planner"))
    renderTabs()

    for (const name of ["What's mine", "Board", "Planner"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute(
        "aria-current"
      )
    }
  })

  it("has no axe violations", async () => {
    usePathname.mockReturnValue("/dashboard")
    const { container } = renderTabs()

    expect(await axeViolations(container)).toEqual([])
  })
})

describe("DashboardTabs header variant", () => {
  it("shows idle tabs in tab-idle-on-navy and the current one as a white pill with navy text", () => {
    usePathname.mockReturnValue("/dashboard")
    useSearchParams.mockReturnValue(new URLSearchParams("view=board"))
    render(<DashboardTabs variant="header" />)

    const board = screen.getByRole("link", { name: "Board" })
    expect(board).toHaveClass("bg-white", "text-navy", "rounded-md")
    const mine = screen.getByRole("link", { name: "What's mine" })
    expect(mine).toHaveClass("text-tab-idle-on-navy", "min-h-11")
    expect(mine).not.toHaveClass("bg-white")
    expect(mine.className).toContain("focus-visible:outline-ring-on-dark")
    expect(
      screen.getByRole("navigation", { name: "Views" })
    ).not.toHaveAttribute("data-bottom-tab-bar")
  })
})

describe("DashboardTabs bar variant", () => {
  it("is the bottom tab bar: below md only, fixed with the safe-area inset, flowing when short", () => {
    usePathname.mockReturnValue("/dashboard")
    render(<DashboardTabs variant="bar" />)

    const nav = screen.getByRole("navigation", { name: "Views" })
    expect(nav).toHaveAttribute("data-bottom-tab-bar")
    expect(nav).toHaveClass(
      "md:hidden",
      "bg-white",
      "border-t",
      "grid-cols-3",
      "tabbar-fixed:fixed",
      "tabbar-fixed:bottom-0"
    )
    expect(nav.className).toContain("pb-[env(safe-area-inset-bottom)]")
  })

  it("puts each icon over its label, the current one white on a navy 56×32 pill", () => {
    usePathname.mockReturnValue("/dashboard")
    useSearchParams.mockReturnValue(new URLSearchParams("view=planner"))
    render(<DashboardTabs variant="bar" />)

    const planner = screen.getByRole("link", { name: "Planner" })
    expect(planner).toHaveClass("h-18", "font-bold", "text-navy")
    const pill = planner.querySelector("span")
    expect(pill).toHaveClass("h-8", "w-14", "bg-navy", "text-white")
    expect(planner.querySelector("svg")).toHaveAttribute("aria-hidden", "true")

    const mine = screen.getByRole("link", { name: "What's mine" })
    expect(mine).toHaveClass("text-muted-foreground")
    expect(mine.querySelector("span")).not.toHaveClass("bg-navy")
    for (const link of screen.getAllByRole("link")) {
      expect(link.querySelector("svg")).not.toBeNull()
    }
  })
})
