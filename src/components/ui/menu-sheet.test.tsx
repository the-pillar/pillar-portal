// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import Link from "next/link"
import axe from "axe-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MENU_SHEET_QUERY, MenuSheet, MenuSheetItem } from "./menu-sheet"

function stubMatchMedia(sheet: boolean) {
  const matchMedia = vi.fn(
    (query: string) =>
      ({
        matches: sheet && query === MENU_SHEET_QUERY,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList
  )
  vi.stubGlobal("matchMedia", matchMedia)
  return matchMedia
}

const onDelete = vi.fn()

function renderMenu() {
  return render(
    <MenuSheet
      title="Task: Layout the front page"
      trigger={<button type="button">Actions</button>}
    >
      <MenuSheetItem asChild>
        <Link href="/dashboard/tasks/1">Open</Link>
      </MenuSheetItem>
      <form action="/sign-out">
        <MenuSheetItem asChild keepOpen>
          <button type="submit">Keep open</button>
        </MenuSheetItem>
      </form>
      <MenuSheetItem variant="destructive" onSelect={onDelete}>
        Delete
      </MenuSheetItem>
    </MenuSheet>
  )
}

beforeEach(() => {
  // Radix's pointer events need these in jsdom.
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("MenuSheet as a bottom sheet", () => {
  beforeEach(() => stubMatchMedia(true))

  it("opens a dialog titled for what it acts on, with 48px rows and the destructive one last", async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole("button", { name: "Actions" }))

    const dialog = await screen.findByRole("dialog", {
      name: "Task: Layout the front page",
    })
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(dialog).toHaveClass("rounded-t-xl")
    const rows = [
      ...within(dialog).getAllByRole("link"),
      ...within(dialog).getAllByRole("button"),
    ]
    for (const row of rows) expect(row).toHaveClass("min-h-12")
    const labels = within(dialog)
      .getAllByRole("button")
      .map((button) => button.textContent)
    expect(labels.at(-1)).toBe("Delete")
    expect(within(dialog).getByRole("button", { name: "Delete" })).toHaveClass(
      "data-[variant=destructive]:text-destructive"
    )
  })

  it("has no axe violations open", async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole("button", { name: "Actions" }))
    const dialog = await screen.findByRole("dialog")

    const results = await axe.run(dialog, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(results.violations).toEqual([])
  })

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup()
    renderMenu()
    const trigger = screen.getByRole("button", { name: "Actions" })
    await user.click(trigger)
    await screen.findByRole("dialog")

    await user.keyboard("{Escape}")

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("closes on a tap outside and returns focus to the trigger", async () => {
    const user = userEvent.setup()
    renderMenu()
    const trigger = screen.getByRole("button", { name: "Actions" })
    await user.click(trigger)
    await screen.findByRole("dialog")

    await user.click(document.querySelector("[data-slot=sheet-overlay]")!)

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("closes after a row is selected, runs its handler, but keeps a keepOpen row open", async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole("button", { name: "Actions" }))

    await user.click(screen.getByRole("button", { name: "Keep open" }))
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Delete" }))
    expect(onDelete).toHaveBeenCalledOnce()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("keeps the sheet open when onSelect prevents default, without cancelling the click", async () => {
    const user = userEvent.setup()
    const keep = vi.fn((event: Event) => event.preventDefault())
    const onClick = vi.fn((event: React.MouseEvent) => event.defaultPrevented)
    render(
      <MenuSheet title="T" trigger={<button type="button">Actions</button>}>
        <MenuSheetItem onSelect={keep} onClick={onClick}>
          Stay
        </MenuSheetItem>
      </MenuSheet>
    )
    await user.click(screen.getByRole("button", { name: "Actions" }))
    await user.click(screen.getByRole("button", { name: "Stay" }))

    expect(keep).toHaveBeenCalledOnce()
    expect(onClick).toHaveReturnedWith(false)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("names its popup and tracks expanded on the trigger", async () => {
    const user = userEvent.setup()
    renderMenu()
    const trigger = screen.getByRole("button", { name: "Actions" })
    expect(trigger).toHaveAttribute("aria-haspopup", "menu")
    expect(trigger).toHaveAttribute("aria-expanded", "false")

    await user.click(trigger)
    await screen.findByRole("dialog")

    expect(trigger).toHaveAttribute("aria-haspopup", "dialog")
    expect(trigger).toHaveAttribute("aria-expanded", "true")
  })

  it("opens from the keyboard too", async () => {
    const user = userEvent.setup()
    renderMenu()
    screen.getByRole("button", { name: "Actions" }).focus()

    await user.keyboard("{Enter}")

    expect(await screen.findByRole("dialog")).toBeInTheDocument()
  })
})

describe("MenuSheet as a dropdown", () => {
  beforeEach(() => stubMatchMedia(false))

  it("opens a menu led by the title, and Escape returns focus to the trigger", async () => {
    const user = userEvent.setup()
    renderMenu()
    const trigger = screen.getByRole("button", { name: "Actions" })

    await user.click(trigger)

    const menu = await screen.findByRole("menu")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(
      within(menu).getByText("Task: Layout the front page")
    ).toBeInTheDocument()
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual(["Open", "Keep open", "Delete"])

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("keeps the menu open on a keepOpen row and closes on the others", async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole("button", { name: "Actions" }))

    await user.click(screen.getByRole("menuitem", { name: "Keep open" }))
    expect(screen.getByRole("menu")).toBeInTheDocument()

    await user.click(screen.getByRole("menuitem", { name: "Delete" }))
    expect(onDelete).toHaveBeenCalledOnce()
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })

  it("decides the form at each open, not once", async () => {
    const user = userEvent.setup()
    const matchMedia = stubMatchMedia(false)
    renderMenu()
    const trigger = screen.getByRole("button", { name: "Actions" })
    await user.click(trigger)
    expect(await screen.findByRole("menu")).toBeInTheDocument()
    await user.keyboard("{Escape}")

    matchMedia.mockImplementation(
      (query: string) =>
        ({
          matches: query === MENU_SHEET_QUERY,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList
    )
    await user.click(trigger)

    expect(await screen.findByRole("dialog")).toBeInTheDocument()
  })
})
