// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SharedSessionWatcher } from "./shared-session-watcher"

const COOKIE = "pillar-shared-until"
const NOW = Date.parse("2026-11-16T10:00:00Z")
const MIN = 60_000

const fetchMock = vi.fn()
const reload = vi.fn()
const replace = vi.fn()

function setDeadline(ms: number | null) {
  document.cookie =
    ms === null
      ? `${COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
      : `${COOKIE}=${ms}; path=/`
}

// jsdom's isTrusted can't be forged on a real event, so the input listeners
// are captured as they are added and called with a stand-in event.
const inputHandlers = new Map<string, (event: Event) => void>()

function trustedInput(type: string, isTrusted = true) {
  act(() => {
    inputHandlers.get(type)?.({ isTrusted } as Event)
  })
}

beforeEach(() => {
  vi.useFakeTimers({
    now: NOW,
    toFake: [
      "Date",
      "setTimeout",
      "setInterval",
      "clearTimeout",
      "clearInterval",
    ],
  })
  fetchMock.mockResolvedValue({ status: 204 })
  vi.stubGlobal("fetch", fetchMock)
  vi.stubGlobal("location", { reload, replace })
  vi.spyOn(performance, "now").mockReturnValue(60_000)
  inputHandlers.clear()
  const add = window.addEventListener.bind(window)
  vi.spyOn(window, "addEventListener").mockImplementation(
    (type: string, listener: unknown, options?: unknown) => {
      if (["keydown", "pointerdown", "wheel", "touchstart"].includes(type)) {
        inputHandlers.set(type, listener as (event: Event) => void)
      }
      add(type, listener as EventListener, options as boolean)
    }
  )
  setDeadline(null)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe("SharedSessionWatcher", () => {
  it("does nothing without the deadline cookie", async () => {
    render(<SharedSessionWatcher />)
    await tick(40 * MIN)
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(inputHandlers.size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it("warns 2 minutes before the deadline, with Stay signed in", async () => {
    setDeadline(NOW + 30 * MIN)
    render(<SharedSessionWatcher />)

    await tick(27 * MIN)
    expect(screen.queryByRole("alertdialog")).toBeNull()

    await tick(1 * MIN + 5000)
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    expect(screen.getByText("Signing out soon")).toBeInTheDocument()
    expect(
      screen.getByText(
        "You'll be signed out in 2 minutes because this is a shared computer."
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Stay signed in" })
    ).toBeInTheDocument()
  })

  it("Stay signed in posts the activity, and the dialog closes once the cookie moves", async () => {
    setDeadline(NOW + 30 * MIN)
    render(<SharedSessionWatcher />)
    await tick(28 * MIN + 5000)

    fetchMock.mockImplementation(async () => {
      setDeadline(Date.now() + 30 * MIN)
      return { status: 204 }
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stay signed in" }))
    })

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/session/activity",
      expect.objectContaining({ method: "POST" })
    )
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("follows a renewal made in another tab through the cookie", async () => {
    setDeadline(NOW + 30 * MIN)
    render(<SharedSessionWatcher />)
    await tick(28 * MIN + 5000)
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()

    setDeadline(Date.now() + 30 * MIN)
    await tick(5000)

    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("posts trusted input at most once a minute, and ignores untrusted events", async () => {
    setDeadline(NOW + 30 * MIN)
    render(<SharedSessionWatcher />)
    await tick(1000)

    trustedInput("keydown", false)
    expect(fetchMock).not.toHaveBeenCalled()

    trustedInput("keydown")
    trustedInput("pointerdown")
    trustedInput("wheel")
    await tick(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await tick(MIN)
    trustedInput("touchstart")
    await tick(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("reloads 2 seconds past the deadline", async () => {
    setDeadline(NOW + 30 * MIN)
    render(<SharedSessionWatcher />)

    await tick(30 * MIN + 1000)
    expect(reload).not.toHaveBeenCalled()

    await tick(1500)
    expect(reload).toHaveBeenCalled()
  })

  it("doesn't reload a page that has only just loaded", async () => {
    vi.spyOn(performance, "now").mockReturnValue(2000)
    setDeadline(NOW - MIN)
    render(<SharedSessionWatcher />)
    await tick(6000)
    expect(reload).not.toHaveBeenCalled()
  })

  it("goes to /login with the idle line when the activity post is a 401", async () => {
    setDeadline(NOW + 30 * MIN)
    fetchMock.mockResolvedValue({ status: 401 })
    render(<SharedSessionWatcher />)
    await tick(1000)

    trustedInput("keydown")
    await tick(0)

    expect(replace).toHaveBeenCalledExactlyOnceWith("/login?signed_out=idle")
  })

  function restoreFromCache(persisted: boolean) {
    act(() => {
      const event = new Event("pageshow") as PageTransitionEvent
      Object.defineProperty(event, "persisted", { value: persisted })
      window.dispatchEvent(event)
    })
  }

  it("reloads a shared session's page restored from the back/forward cache, even after sign-out removed the cookie", async () => {
    setDeadline(NOW + 30 * MIN)
    render(<SharedSessionWatcher />)
    await tick(1000)

    setDeadline(null)
    restoreFromCache(false)
    expect(reload).not.toHaveBeenCalled()

    restoreFromCache(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it("leaves a personal session's restored page alone", async () => {
    render(<SharedSessionWatcher />)
    await tick(1000)
    restoreFromCache(true)
    expect(reload).not.toHaveBeenCalled()
  })
})
