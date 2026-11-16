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

import { MemberShell } from "./member-shell"

// The shell renders no data. Stub the modules that would read the session or
// the environment when the members slice loads. vi.mock factories run before
// this file's imports, so the action mock the tests inspect is vi.hoisted.
const { signOutAction } = vi.hoisted(() => ({ signOutAction: vi.fn() }))

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))
vi.mock("@/features/members/actions", () => ({
  signInAsPersonaAction: vi.fn(),
  signOutAction,
  showTipsAgainAction: vi.fn(),
}))

// color-contrast can't be computed in jsdom (it is always "incomplete").
async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

function renderShell(role: "staff" | "editorial_admin" = "staff") {
  return render(
    <MemberShell member={{ name: "Head Layout Artist", role }}>
      <h1>What&apos;s mine</h1>
    </MemberShell>
  )
}

// jsdom applies no CSS, so both "Views" navs are in its tree. At any width one
// is `display: none` (the header's below `md`, the bar's from it); hide the
// one the stylesheet would, so a check sees the page a visitor's browser does.
function atWidth(width: "phone" | "desktop") {
  const banner = screen.getByRole("banner")
  for (const nav of screen.getAllByRole("navigation", { name: "Views" })) {
    const inHeader = banner.contains(nav)
    nav.hidden = width === "phone" ? inHeader : !inHeader
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("MemberShell", () => {
  it.each(["phone", "desktop"] as const)(
    "has no axe violations with the menu closed, at a %s width",
    async (width) => {
      const { container } = renderShell()
      atWidth(width)
      expect(await axeViolations(container)).toEqual([])
    }
  )

  it("has a banner with the logo, the wordmark and the account menu, then main", () => {
    renderShell()
    const banner = screen.getByRole("banner")

    expect(
      within(banner).getByRole("link", { name: "The Pillar" })
    ).toHaveAttribute("href", "/dashboard")
    expect(banner).toHaveClass("bg-navy", "border-b-3", "border-brand-gold")
    expect(banner.querySelector("img")).toHaveAttribute("alt", "")
    expect(
      within(banner).getByRole("button", {
        name: "Head Layout Artist, account",
      })
    ).toHaveClass("size-11")
    expect(screen.getByRole("main")).toHaveTextContent("What's mine")
  })

  it("caps main at 640px, widening it to 1440px only when a view asks, and never widens the header", () => {
    render(
      <MemberShell member={{ name: "Head Layout Artist", role: "staff" }}>
        <div data-wide-view />
      </MemberShell>
    )

    const main = screen.getByRole("main")
    expect(main).toHaveClass(
      "max-w-160",
      "has-[[data-wide-view]]:max-w-[1440px]"
    )
    // The header's one row (logo, tabs, avatar) stays 640px on every view, so
    // switching tabs never moves them.
    const banner = screen.getByRole("banner")
    const rows = [...banner.children].filter((el) => el.tagName === "DIV")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveClass("max-w-160")
    expect(rows[0].className).not.toMatch(/1440/)
  })

  it("shows the Views tabs in the banner from md, and as the bottom tab bar after main below it, What's mine current in both", () => {
    renderShell()
    const banner = screen.getByRole("banner")

    const [inHeader, bar] = screen.getAllByRole("navigation", { name: "Views" })
    expect(banner).toContainElement(inHeader)
    expect(banner).not.toContainElement(bar)
    expect(bar).toHaveAttribute("data-bottom-tab-bar")
    expect(screen.getByRole("main").nextElementSibling).toBe(bar)
    for (const nav of [inHeader, bar]) {
      expect(
        within(nav).getByRole("link", { name: "What's mine" })
      ).toHaveAttribute("aria-current", "page")
    }
  })

  it("keeps main clear of the fixed bar by its height and 8px", () => {
    renderShell()

    expect(screen.getByRole("main")).toHaveClass(
      "tabbar-fixed:pb-(--bottom-tab-bar-clear)"
    )
  })

  it("opens the menu with Enter, offers Sign out, and returns focus on Escape", async () => {
    const user = userEvent.setup()
    renderShell()
    const trigger = screen.getByRole("button", {
      name: "Head Layout Artist, account",
    })

    trigger.focus()
    await user.keyboard("{Enter}")

    const menu = await screen.findByRole("menu")
    expect(within(menu).getByText("Head Layout Artist")).toBeInTheDocument()
    const signOut = within(menu).getByRole("menuitem", { name: "Sign out" })
    expect(signOut).toHaveAttribute("type", "submit")
    expect(signOut.closest("form")).not.toBeNull()
    // A whole-page run would flag the portal outside the landmarks, so the
    // open state is checked on the menu itself.
    expect(await axeViolations(menu)).toEqual([])

    await user.keyboard("{Escape}")

    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("offers Admin to an editorial_admin member, above Sign out", async () => {
    const user = userEvent.setup()
    renderShell("editorial_admin")

    await user.click(
      screen.getByRole("button", { name: "Head Layout Artist, account" })
    )
    const menu = await screen.findByRole("menu")
    const items = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent)

    expect(items).toEqual(["Admin", "Sign out"])
    expect(
      within(menu).getByRole("menuitem", { name: "Admin" })
    ).toHaveAttribute("href", "/admin")
  })

  it("offers no Admin link to a staff member", async () => {
    const user = userEvent.setup()
    renderShell("staff")

    await user.click(
      screen.getByRole("button", { name: "Head Layout Artist, account" })
    )
    const menu = await screen.findByRole("menu")

    expect(within(menu).queryByRole("menuitem", { name: "Admin" })).toBeNull()
  })

  it("submits the sign-out form when Sign out is clicked", async () => {
    const user = userEvent.setup()
    renderShell()

    await user.click(
      screen.getByRole("button", { name: "Head Layout Artist, account" })
    )
    await user.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "Sign out",
      })
    )

    await waitFor(() => expect(signOutAction).toHaveBeenCalledOnce())
  })
})

describe("MemberShell's New task slot", () => {
  it("shows the button it is given in the header action slot, and nothing without one", () => {
    const { container, rerender } = render(
      <MemberShell
        member={{ name: "Head Layout Artist", role: "editorial_admin" }}
        newTask={<button type="button">New task</button>}
      >
        <h1>Page</h1>
      </MemberShell>
    )
    expect(
      container.querySelector("[data-slot='header-action']")
    ).toContainElement(screen.getByRole("button", { name: "New task" }))

    rerender(
      <MemberShell
        member={{ name: "Head Layout Artist", role: "editorial_admin" }}
      >
        <h1>Page</h1>
      </MemberShell>
    )
    expect(container.querySelector("[data-slot='header-action']")).toBeNull()
    expect(screen.queryByRole("button", { name: "New task" })).toBeNull()
  })

  it("adds Show tips again to the avatar menu from the onboarding prop", async () => {
    const user = userEvent.setup()
    render(
      <MemberShell
        member={{ name: "Staff Layout Artist", role: "staff" }}
        onboarding="tips"
      >
        <h1>What&apos;s mine</h1>
      </MemberShell>
    )

    await user.click(
      screen.getByRole("button", { name: "Staff Layout Artist, account" })
    )

    expect(
      await screen.findByRole("menuitem", { name: "Show tips again" })
    ).toBeInTheDocument()
  })
})
