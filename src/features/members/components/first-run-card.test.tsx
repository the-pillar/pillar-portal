// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { FirstRunCard } from "./first-run-card"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

type Step = "first_run_shown" | "first_run_closed"

function renderCard(
  shown: boolean,
  record = vi
    .fn<(step: Step) => Promise<unknown>>()
    .mockResolvedValue(undefined)
) {
  const view = render(
    <main>
      <h1 id="top">What&apos;s mine</h1>
      <FirstRunCard shown={shown} record={record} fallbackHeadingId="top" />
      <h2 id="next">Waiting for you</h2>
    </main>
  )
  return { record, view }
}

describe("FirstRunCard", () => {
  it("shows the welcome and the three tips", () => {
    renderCard(true)

    expect(
      screen.getByRole("heading", { name: "Welcome to the portal." })
    ).toBeInTheDocument()
    const tips = screen.getAllByRole("listitem")
    expect(tips.map((tip) => tip.textContent)).toEqual([
      "When you're assigned, tap I'm on it or Can't take this.",
      "Board shows everyone's work; your cards say Yours.",
      "Add to Google Calendar keeps deadlines on your phone.",
    ])
    expect(
      screen.getByRole("button", { name: "Close welcome tips" })
    ).toBeInTheDocument()
  })

  it("records first_run_shown once when it renders unshown", () => {
    const { record, view } = renderCard(false)
    expect(record).toHaveBeenCalledExactlyOnceWith("first_run_shown")

    view.rerender(
      <main>
        <h1 id="top">What&apos;s mine</h1>
        <FirstRunCard shown={false} record={record} fallbackHeadingId="top" />
        <h2 id="next">Waiting for you</h2>
      </main>
    )
    expect(record).toHaveBeenCalledOnce()
  })

  it("records nothing on render when already shown", () => {
    const { record } = renderCard(true)
    expect(record).not.toHaveBeenCalled()
  })

  it("records first_run_closed on close, moves focus to the next heading and leaves", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { record } = renderCard(true)

    await user.click(screen.getByRole("button", { name: "Close welcome tips" }))

    expect(record).toHaveBeenCalledExactlyOnceWith("first_run_closed")
    expect(document.getElementById("next")).toHaveFocus()
    await act(() => vi.advanceTimersByTimeAsync(400))
    expect(screen.queryByText("Welcome to the portal.")).toBeNull()
  })

  it("comes back after Show tips again, recording first_run_shown again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { record, view } = renderCard(false)
    const tree = (shown: boolean) => (
      <main>
        <h1 id="top">What&apos;s mine</h1>
        <FirstRunCard shown={shown} record={record} fallbackHeadingId="top" />
        <h2 id="next">Waiting for you</h2>
      </main>
    )
    await user.click(screen.getByRole("button", { name: "Close welcome tips" }))
    await act(() => vi.advanceTimersByTimeAsync(400))
    expect(screen.queryByText("Welcome to the portal.")).toBeNull()
    record.mockClear()

    view.rerender(tree(true))
    expect(screen.queryByText("Welcome to the portal.")).toBeNull()
    view.rerender(tree(false))

    expect(screen.getByText("Welcome to the portal.")).toBeInTheDocument()
    expect(record).toHaveBeenCalledExactlyOnceWith("first_run_shown")
  })

  it("carries on when a write fails", async () => {
    const record = vi
      .fn<(step: Step) => Promise<unknown>>()
      .mockRejectedValue(new Error("down"))
    renderCard(false, record)
    const user = userEvent.setup()

    await user.click(screen.getByRole("button", { name: "Close welcome tips" }))

    expect(record).toHaveBeenCalledTimes(2)
  })

  it("has no axe violations", async () => {
    const { view } = renderCard(true)
    expect(await axeViolations(view.container)).toEqual([])
  })
})
