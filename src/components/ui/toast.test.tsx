// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { toast, Toaster } from "./toast"

function stubMatchMedia(matching: (query: string) => boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: matching(query),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
}

beforeEach(() => {
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "Date",
    ],
  })
  stubMatchMedia(() => false)
  // Sonner captures the pointer on press; jsdom has no pointer capture.
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

afterEach(() => {
  act(() => toast.dismiss())
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// Sonner publishes a toast in a setTimeout(0), so show lets that tick pass.
async function show(fn: () => void) {
  render(<Toaster />)
  await act(async () => {
    fn()
    await vi.advanceTimersByTimeAsync(1)
  })
}

// In 50ms steps, each its own act: Sonner starts its unmount timer from an
// effect that only runs once the step's updates have flushed.
async function advance(ms: number) {
  for (let left = ms; left > 0; left -= 50) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(50, left))
    })
  }
}

// Sonner keeps a dismissed toast mounted for its exit, 200ms.
const EXIT = 300

describe("toast", () => {
  it("shows an information toast for 4 seconds, politely", async () => {
    await show(() => toast("Calendar file downloaded."))

    expect(screen.getByRole("status")).toHaveTextContent(
      "Calendar file downloaded."
    )
    await advance(3900)
    expect(screen.queryByText("Calendar file downloaded.")).toBeInTheDocument()
    await advance(200 + EXIT)

    expect(
      screen.queryByText("Calendar file downloaded.")
    ).not.toBeInTheDocument()
  })

  it("keeps a success toast for 4 seconds and a toast with an action for 8", async () => {
    await show(() => {
      toast.success("Marked done.")
      toast.success("Task created", {
        action: { label: "Copy for Messenger", onClick: vi.fn() },
      })
    })

    await advance(4100 + EXIT)
    expect(screen.queryByText("Marked done.")).not.toBeInTheDocument()
    expect(screen.getByText("Task created")).toBeInTheDocument()
    await advance(4000)
    expect(screen.queryByText("Task created")).not.toBeInTheDocument()
  })

  it("keeps an undo toast for 5 seconds with a countdown bar", async () => {
    await show(() =>
      toast.undo("Moved to Doing.", {
        action: { label: "Undo", onClick: vi.fn() },
      })
    )

    expect(document.querySelector("[data-countdown]")).toHaveClass(
      "toast-countdown",
      "bg-tan"
    )
    await advance(4900)
    expect(screen.getByText("Moved to Doing.")).toBeInTheDocument()
    await advance(200 + EXIT)
    expect(screen.queryByText("Moved to Doing.")).not.toBeInTheDocument()
  })

  it("keeps errors, announced as alerts, and notices until closed", async () => {
    await show(() => {
      toast.error("Couldn't save — try again.")
      toast.notice("That area is for the Editorial Board.")
    })

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save")
    await advance(60_000)
    expect(screen.getByText("Couldn't save — try again.")).toBeInTheDocument()
    expect(
      screen.getByText("That area is for the Editorial Board.")
    ).toBeInTheDocument()

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const closers = screen.getAllByRole("button", {
      name: "Dismiss notification",
    })
    await user.click(closers[0])
    await advance(EXIT)
    expect(
      screen.getAllByRole("button", { name: "Dismiss notification" })
    ).toHaveLength(1)
  })

  it("runs the action and dismisses the toast", async () => {
    const onClick = vi.fn()
    await show(() =>
      toast("Task saved.", { action: { label: "Undo", onClick } })
    )

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByRole("button", { name: "Undo" }))

    expect(onClick).toHaveBeenCalledOnce()
    await advance(EXIT)
    expect(screen.queryByText("Task saved.")).not.toBeInTheDocument()
  })

  it("shows a description under the message", async () => {
    await show(() =>
      toast.notice("Copy it by hand.", { description: "Hello team" })
    )
    expect(screen.getByText("Hello team")).toBeInTheDocument()
  })

  it("pauses its timer while hovered, then finishes the rest", async () => {
    await show(() => toast("Hover me"))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await advance(3000)
    await user.hover(screen.getByRole("status"))
    await advance(10_000)
    expect(screen.getByText("Hover me")).toBeInTheDocument()

    await user.unhover(screen.getByRole("status"))
    await advance(1100 + EXIT)
    expect(screen.queryByText("Hover me")).not.toBeInTheDocument()
  })

  it("pauses while focus is inside it", async () => {
    await show(() => toast("Focus me"))

    act(() =>
      screen.getByRole("button", { name: "Dismiss notification" }).focus()
    )
    await advance(10_000)
    expect(screen.getByText("Focus me")).toBeInTheDocument()
  })

  it("pauses while focus sits on Sonner's own list item", async () => {
    await show(() => toast("Li focus"))
    const li = document.querySelector<HTMLElement>("[data-sonner-toast]")!
    act(() => li.focus())
    await advance(10_000)
    expect(screen.getByText("Li focus")).toBeInTheDocument()

    act(() => li.blur())
    await advance(4100 + EXIT)
    expect(screen.queryByText("Li focus")).not.toBeInTheDocument()
  })

  it("shows an error icon before an error's message only", async () => {
    await show(() => {
      toast.error("Bad")
      toast("Fine")
    })
    expect(screen.getByRole("alert").querySelector("svg")).not.toBeNull()
    expect(
      screen.getByRole("status").querySelector("svg:not(button svg)")
    ).toBeNull()
  })

  it("pauses while the page is hidden", async () => {
    await show(() => toast("Hidden page"))
    const state = vi.spyOn(document, "visibilityState", "get")
    state.mockReturnValue("hidden")
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await advance(10_000)
    expect(screen.getByText("Hidden page")).toBeInTheDocument()

    state.mockReturnValue("visible")
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await advance(4100 + EXIT)
    expect(screen.queryByText("Hidden page")).not.toBeInTheDocument()
    state.mockRestore()
  })

  it("dismisses the newest toast on Escape, one at a time", async () => {
    await show(() => {
      toast.error("First")
      toast.error("Second")
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.keyboard("{Escape}")
    await advance(EXIT)
    expect(screen.queryByText("Second")).not.toBeInTheDocument()
    expect(screen.getByText("First")).toBeInTheDocument()
  })

  it("leaves Escape to an open dialog", async () => {
    await show(() => toast.error("Stays"))
    const dialog = document.createElement("div")
    dialog.setAttribute("role", "dialog")
    dialog.setAttribute("data-state", "open")
    document.body.append(dialog)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    await user.keyboard("{Escape}")
    expect(screen.getByText("Stays")).toBeInTheDocument()
    dialog.remove()
  })

  it("shows at most three toasts", async () => {
    await show(() => {
      for (const n of [1, 2, 3, 4, 5]) toast.error(`Toast ${n}`)
    })
    const visible = document.querySelectorAll(
      '[data-sonner-toast][data-visible="true"]'
    )
    expect(visible).toHaveLength(3)
  })

  it("replaces the toast showing under the same id", async () => {
    await show(() => {
      toast("Same", { id: "once" })
      toast("Same", { id: "once" })
    })
    expect(screen.getAllByText("Same")).toHaveLength(1)
  })

  it("sits at the top below md, under the app header, and bottom-right from md", async () => {
    await show(() => toast.error("Where"))
    const top = document.querySelector<HTMLElement>("[data-sonner-toaster]")
    expect(top).toHaveAttribute("data-y-position", "top")
    for (const v of ["--offset-top", "--mobile-offset-top"]) {
      expect(top?.style.getPropertyValue(v)).toBe(
        "calc(var(--app-header-height) + 8px)"
      )
    }
    cleanup()

    stubMatchMedia((query) => query === "(min-width: 768px)")
    await show(() => toast.error("Where"))
    const toaster = document.querySelector("[data-sonner-toaster]")
    expect(toaster).toHaveAttribute("data-y-position", "bottom")
    expect(toaster).toHaveAttribute("data-x-position", "right")
  })

  it("steps the undo countdown once a second under reduced motion", async () => {
    stubMatchMedia((query) => query.includes("prefers-reduced-motion"))
    await show(() =>
      toast.undo("Moved to Doing.", {
        action: { label: "Undo", onClick: vi.fn() },
      })
    )
    const bar = () => document.querySelector<HTMLElement>("[data-countdown]")!

    expect(bar()).toHaveAttribute("data-countdown", "stepped")
    expect(bar()).not.toHaveClass("toast-countdown")
    expect(bar().style.transform).toBe("scaleX(1)")
    await advance(1000)
    expect(bar().style.transform).toBe("scaleX(0.8)")
    await advance(2000)
    expect(bar().style.transform).toBe("scaleX(0.4)")
    await advance(2100 + EXIT)
    expect(screen.queryByText("Moved to Doing.")).not.toBeInTheDocument()
  })

  it("has no axe violations and names its close button", async () => {
    await show(() =>
      toast.success("Task created", {
        action: { label: "Copy for Messenger", onClick: vi.fn() },
      })
    )
    const region = document.querySelector("[data-sonner-toaster]")!
    const results = await axe.run(region, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(results.violations).toEqual([])
    expect(
      screen.getByRole("button", { name: "Dismiss notification" })
    ).toBeInTheDocument()
  })
})
