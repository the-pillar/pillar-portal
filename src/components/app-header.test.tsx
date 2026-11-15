// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, within } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it } from "vitest"

import { AppHeader } from "./app-header"

afterEach(cleanup)

describe("AppHeader", () => {
  it("sets the wordmark as The Pillar in the serif fallback", () => {
    render(<AppHeader homeHref="/dashboard" />)

    const link = screen.getByRole("link", { name: "The Pillar" })
    const wordmark = within(link).getByText("The Pillar")
    expect(wordmark).toHaveClass("font-heading", "text-wordmark-fallback")
    expect(wordmark).not.toHaveClass("uppercase")
    expect(link.className).toContain("focus-visible:outline-ring-on-dark")
  })

  it("puts tabs in the header row from md, hidden below it", () => {
    render(<AppHeader tabs={<nav aria-label="Tabs">tabs</nav>} />)

    const row = screen.getByRole("banner").firstElementChild!
    const tabs = screen.getByRole("navigation", { name: "Tabs" })
    expect(row).toContainElement(tabs)
    expect(tabs.parentElement).toHaveClass("hidden", "md:block")
  })

  it("renders nothing for an empty action slot", () => {
    render(<AppHeader />)
    expect(document.querySelector("[data-slot=header-action]")).toBeNull()
  })

  it("floats the action 16px from the right below md, and sits before the avatar from md", () => {
    render(
      <AppHeader action={<button>New task</button>}>
        <button>Avatar</button>
      </AppHeader>
    )

    const slot = document.querySelector("[data-slot=header-action]")!
    expect(slot).toHaveClass("fixed", "right-4", "bottom-4", "md:static")
    expect(slot.nextElementSibling).toBe(
      screen.getByRole("button", { name: "Avatar" })
    )
  })

  it("lifts the floating action above the bottom tab bar when there is one", () => {
    render(<AppHeader hasBottomBar action={<button>New task</button>} />)

    expect(document.querySelector("[data-slot=header-action]")).toHaveClass(
      "bottom-4",
      "tabbar-fixed:bottom-[calc(var(--bottom-tab-bar-clear)+8px)]"
    )
  })

  it("has no axe violations", async () => {
    const { container } = render(
      <AppHeader homeHref="/dashboard" action={<button>New task</button>} />
    )
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(results.violations).toEqual([])
  })
})
