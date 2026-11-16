// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderToString } from "react-dom/server"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi, type Mock } from "vitest"

import {
  OnboardingChecklist,
  type ChecklistItems,
} from "./onboarding-checklist"

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("./two-factor-setup", () => ({
  TwoFactorSetup: ({ onVerified }: { onVerified: () => void }) => (
    <button type="button" onClick={onVerified}>
      Verify code
    </button>
  ),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

const NONE: ChecklistItems = {
  twoFactor: false,
  createdTask: false,
  copiedTask: false,
  approvedMember: false,
}

function ui(
  items: ChecklistItems,
  extra: {
    pending?: number
    record?: Mock<(step: "checklist_done") => Promise<unknown>>
  } = {}
) {
  return (
    <main>
      <h1 id="top">Admin home</h1>
      <OnboardingChecklist
        items={items}
        pending={extra.pending ?? 1}
        createTask={<button type="button">Create a task</button>}
        record={
          extra.record ??
          vi
            .fn<(step: "checklist_done") => Promise<unknown>>()
            .mockResolvedValue(undefined)
        }
        fallbackHeadingId="top"
      />
      <h2 id="next">Other</h2>
    </main>
  )
}

describe("OnboardingChecklist", () => {
  it("shows Get started, 0 of 4, and each item as to do", () => {
    render(ui(NONE))

    expect(
      screen.getByRole("heading", { name: "Get started" })
    ).toBeInTheDocument()
    expect(screen.getByText("0 of 4")).toBeInTheDocument()
    const items = screen.getAllByRole("listitem")
    expect(items).toHaveLength(4)
    for (const item of items) {
      expect(within(item).getByText("to do")).toBeInTheDocument()
    }
    expect(items[0]).toHaveTextContent(
      "Set up two-factor — needed for releases, resets and member changes."
    )
    expect(
      within(items[1]).getByRole("button", { name: "Create a task" })
    ).toBeInTheDocument()
    expect(items[2]).toHaveTextContent("Copy a task to your section chat")
    expect(
      within(items[3]).getByRole("link", { name: /Approve a member/ })
    ).toHaveAttribute("href", "/admin/members")
    expect(items[3]).toHaveTextContent("1 waiting")
  })

  it("reads Nobody's waiting when nothing is pending", () => {
    render(ui({ ...NONE, approvedMember: true }, { pending: 0 }))

    const item = screen.getAllByRole("listitem")[3]
    expect(item).toHaveTextContent("Nobody's waiting — done for now")
    expect(within(item).getByText("done")).toBeInTheDocument()
    expect(within(item).queryByRole("link")).toBeNull()
    expect(screen.getByText("1 of 4")).toBeInTheDocument()
  })

  it("opens the two-factor setup dialog and refreshes once verified", async () => {
    const user = userEvent.setup()
    render(ui(NONE))

    await user.click(screen.getByRole("button", { name: "Set up two-factor" }))
    const dialog = await screen.findByRole("dialog", {
      name: "Set up two-factor",
    })
    await user.click(
      within(dialog).getByRole("button", { name: "Verify code" })
    )

    expect(refresh).toHaveBeenCalledOnce()
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("announces a tick that lands while on the page, politely", () => {
    const { rerender } = render(ui(NONE))
    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("aria-live", "polite")
    expect(status).toHaveTextContent("")

    rerender(ui({ ...NONE, twoFactor: true }))
    expect(status).toHaveTextContent("Two-factor set up. 1 of 4 done.")

    rerender(ui({ ...NONE, twoFactor: true, createdTask: true }))
    expect(status).toHaveTextContent("Task created. 2 of 4 done.")

    rerender(
      ui({
        twoFactor: true,
        createdTask: true,
        copiedTask: true,
        approvedMember: false,
      })
    )
    expect(status).toHaveTextContent("Task copied. 3 of 4 done.")
  })

  it("announces nothing for items already done on first render", () => {
    render(ui({ ...NONE, twoFactor: true }))
    expect(screen.getByRole("status")).toHaveTextContent("")
  })

  it("at 4 of 4 records checklist_done once, says it's complete and leaves", async () => {
    vi.useFakeTimers()
    const record = vi
      .fn<(step: "checklist_done") => Promise<unknown>>()
      .mockResolvedValue(undefined)
    const three = {
      twoFactor: true,
      createdTask: true,
      copiedTask: true,
      approvedMember: false,
    }
    const { rerender } = render(ui(three, { record }))
    expect(record).not.toHaveBeenCalled()

    rerender(ui({ ...three, approvedMember: true }, { record }))

    expect(record).toHaveBeenCalledExactlyOnceWith("checklist_done")
    expect(screen.getByRole("status")).toHaveTextContent(
      "Member approved. 4 of 4 done. Checklist complete."
    )
    await act(() => vi.advanceTimersByTimeAsync(400))
    expect(screen.queryByRole("heading", { name: "Get started" })).toBeNull()
    // The live region outlives the card.
    expect(screen.getByRole("status")).toBeInTheDocument()
  })

  it("moves focus to the next heading when it leaves holding focus", async () => {
    const record = vi
      .fn<(step: "checklist_done") => Promise<unknown>>()
      .mockResolvedValue(undefined)
    const three = {
      twoFactor: true,
      createdTask: true,
      copiedTask: true,
      approvedMember: false,
    }
    const { rerender } = render(ui(three, { record, pending: 2 }))
    screen.getByRole("link", { name: /Approve a member/ }).focus()

    rerender(ui({ ...three, approvedMember: true }, { record, pending: 2 }))

    expect(document.getElementById("next")).toHaveFocus()
  })

  it("renders no card but records checklist_done when it is already 4 of 4", () => {
    const record = vi
      .fn<(step: "checklist_done") => Promise<unknown>>()
      .mockResolvedValue(undefined)
    render(
      ui(
        {
          twoFactor: true,
          createdTask: true,
          copiedTask: true,
          approvedMember: true,
        },
        { record }
      )
    )

    expect(record).toHaveBeenCalledExactlyOnceWith("checklist_done")
    expect(screen.queryByRole("heading", { name: "Get started" })).toBeNull()
  })

  it("renders no card in the server HTML when it is already 4 of 4", () => {
    const html = renderToString(
      ui({
        twoFactor: true,
        createdTask: true,
        copiedTask: true,
        approvedMember: true,
      })
    )
    expect(html).not.toContain("Get started")
  })

  it("has no axe violations", async () => {
    const { container } = render(ui({ ...NONE, twoFactor: true }))
    expect(await axeViolations(container)).toEqual([])
  })
})
