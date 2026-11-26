// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MemberMenu } from "./member-menu"

const { signOutAction, showTipsAgainAction } = vi.hoisted(() => ({
  signOutAction: vi.fn(),
  showTipsAgainAction: vi.fn(),
}))

vi.mock("../actions", () => ({ signOutAction, showTipsAgainAction }))

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("MemberMenu", () => {
  it("has no axe violations with extraLinks, open", async () => {
    const user = userEvent.setup()
    render(
      <MemberMenu
        name="Editor-in-Chief"
        extraLinks={[{ label: "Admin", href: "/admin" }]}
      />
    )

    await user.click(
      screen.getByRole("button", { name: "Editor-in-Chief, account" })
    )
    const menu = await screen.findByRole("menu")

    expect(await axeViolations(menu)).toEqual([])
  })

  it("renders no extra items when extraLinks is omitted", async () => {
    const user = userEvent.setup()
    render(<MemberMenu name="Staff Writer" />)

    await user.click(
      screen.getByRole("button", { name: "Staff Writer, account" })
    )
    const menu = await screen.findByRole("menu")

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual(["Sign out"])
  })

  it("renders each extraLink as a menuitem link, above Sign out, presentation-only", async () => {
    const user = userEvent.setup()
    render(
      <MemberMenu
        name="Editor-in-Chief"
        extraLinks={[
          { label: "Admin", href: "/admin" },
          { label: "My dashboard", href: "/dashboard" },
        ]}
      />
    )

    await user.click(
      screen.getByRole("button", { name: "Editor-in-Chief, account" })
    )
    const menu = await screen.findByRole("menu")
    const items = within(menu).getAllByRole("menuitem")

    expect(items.map((item) => item.textContent)).toEqual([
      "Admin",
      "My dashboard",
      "Sign out",
    ])
    expect(
      within(menu).getByRole("menuitem", { name: "Admin" })
    ).toHaveAttribute("href", "/admin")
    expect(
      within(menu).getByRole("menuitem", { name: "My dashboard" })
    ).toHaveAttribute("href", "/dashboard")
  })

  it("still submits the sign-out form when Sign out is clicked, with extraLinks present", async () => {
    const user = userEvent.setup()
    render(
      <MemberMenu
        name="Editor-in-Chief"
        extraLinks={[{ label: "Admin", href: "/admin" }]}
      />
    )

    await user.click(
      screen.getByRole("button", { name: "Editor-in-Chief, account" })
    )
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "Sign out",
      })
    )

    await waitFor(() => expect(signOutAction).toHaveBeenCalledOnce())
  })

  it("offers Show the tour again as a link to the replay, after the extra links and before Sign out", async () => {
    const user = userEvent.setup()
    render(
      <MemberMenu
        name="Editor-in-Chief"
        extraLinks={[{ label: "My dashboard", href: "/dashboard" }]}
        onboarding="tour"
      />
    )

    await user.click(
      screen.getByRole("button", { name: "Editor-in-Chief, account" })
    )
    const menu = await screen.findByRole("menu")

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual(["My dashboard", "Show the tour again", "Sign out"])
    expect(
      within(menu).getByRole("menuitem", { name: "Show the tour again" })
    ).toHaveAttribute("href", "/admin?tour=again")
    expect(await axeViolations(menu)).toEqual([])
  })

  it("offers Show tips again as a button that calls the action and closes the menu, before Sign out", async () => {
    const user = userEvent.setup()
    render(<MemberMenu name="Staff Writer" onboarding="tips" />)

    await user.click(
      screen.getByRole("button", { name: "Staff Writer, account" })
    )
    const menu = await screen.findByRole("menu")

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual(["Show tips again", "Sign out"])
    await user.click(
      within(menu).getByRole("menuitem", { name: "Show tips again" })
    )
    await waitFor(() => expect(showTipsAgainAction).toHaveBeenCalledOnce())
    expect(signOutAction).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
  })

  it("offers no onboarding item without the prop, and marks the trigger as the tour's My dashboard target", async () => {
    const user = userEvent.setup()
    render(<MemberMenu name="Staff Writer" />)

    const trigger = screen.getByRole("button", {
      name: "Staff Writer, account",
    })
    expect(trigger).toHaveAttribute("data-tour", "my-dashboard")
    await user.click(trigger)
    expect(screen.queryByRole("menuitem", { name: /again/ })).toBeNull()
  })
})
