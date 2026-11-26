// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const {
  getWhatsMine,
  WhatsMineTasks,
  getMyOnboarding,
  recordOnboardingAction,
} = vi.hoisted(() => ({
  getWhatsMine: vi.fn(),
  getMyOnboarding: vi.fn(),
  recordOnboardingAction: vi.fn().mockResolvedValue({ ok: true }),
  WhatsMineTasks: vi.fn(
    ({
      whatsMine,
    }: {
      whatsMine: { waiting: unknown[]; tasks: unknown[] }
      focusTargetId: string
    }) => (
      <>
        {whatsMine.waiting.length > 0 && (
          <h2>Waiting for you ({whatsMine.waiting.length})</h2>
        )}
        {whatsMine.tasks.length > 0 && (
          <h2>My tasks ({whatsMine.tasks.length})</h2>
        )}
      </>
    )
  ),
}))

vi.mock("@/features/tasks", () => ({ getWhatsMine, WhatsMineTasks }))
// first-run-card.test.tsx covers the card; here it only has to be rendered
// with the page's props.
vi.mock("@/features/members", () => ({
  getMyOnboarding,
  recordOnboardingAction,
  FirstRunCard: ({
    shown,
    record,
  }: {
    shown: boolean
    record: (step: "first_run_shown") => void
  }) => {
    if (!shown) record("first_run_shown")
    return <h2>Welcome to the portal.</h2>
  },
}))

import { WhatsMineView } from "./whats-mine-view"

beforeEach(() => {
  getMyOnboarding.mockResolvedValue(null)
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

async function renderPage() {
  return render(await WhatsMineView())
}

describe("WhatsMineView", () => {
  it("has an h1 that can take focus, for the item that leaves after an answer", async () => {
    getWhatsMine.mockResolvedValue({ waiting: [], tasks: [] })
    await renderPage()

    const h1 = screen.getByRole("heading", { level: 1, name: "What's mine" })
    expect(h1).toHaveAttribute("id", "whats-mine-heading")
    expect(h1).toHaveAttribute("tabindex", "-1")
  })

  it("shows the empty state, and no sections, when nothing is open", async () => {
    getWhatsMine.mockResolvedValue({ waiting: [], tasks: [] })
    await renderPage()

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Nothing on your plate right now.",
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "New assignments will show up here — your editor or head will also message you."
      )
    ).toBeInTheDocument()
    expect(WhatsMineTasks).not.toHaveBeenCalled()
  })

  it("renders WhatsMineTasks with the h1 as its focus target, and no empty state", async () => {
    const whatsMine = { waiting: [{}, {}], tasks: [{}] }
    getWhatsMine.mockResolvedValue(whatsMine)
    await renderPage()

    expect(WhatsMineTasks.mock.calls[0][0]).toEqual({
      whatsMine,
      focusTargetId: "whats-mine-heading",
    })
    expect(
      screen.getByRole("heading", { level: 2, name: "Waiting for you (2)" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { level: 2, name: "My tasks (1)" })
    ).toBeInTheDocument()
    expect(screen.queryByText("Nothing on your plate right now.")).toBeNull()
  })

  it("lets a query failure throw", async () => {
    getWhatsMine.mockRejectedValue(new Error("boom"))

    await expect(WhatsMineView()).rejects.toThrow("boom")
  })

  it("has no axe violations, empty or listed", async () => {
    getWhatsMine.mockResolvedValue({ waiting: [], tasks: [] })
    const empty = await renderPage()
    expect(await axeViolations(empty.container)).toEqual([])
    empty.unmount()

    getWhatsMine.mockResolvedValue({ waiting: [{}], tasks: [{}] })
    const listed = await renderPage()
    expect(await axeViolations(listed.container)).toEqual([])
  })

  describe("the staff first-run card (Story 8.9)", () => {
    const STAFF = {
      tourAndChecklist: false,
      firstRunShown: false,
      firstRunClosed: false,
    }

    it("shows above the lists for a member who gets it, recording the showing", async () => {
      getWhatsMine.mockResolvedValue({ waiting: [], tasks: [] })
      getMyOnboarding.mockResolvedValue(STAFF)
      await renderPage()

      expect(
        screen.getByRole("heading", { name: "Welcome to the portal." })
      ).toBeInTheDocument()
      expect(recordOnboardingAction).toHaveBeenCalledWith("first_run_shown")
    })

    it.each([
      ["closed", { ...STAFF, firstRunClosed: true }],
      ["the tour and checklist's member", { ...STAFF, tourAndChecklist: true }],
      ["a failed read", null],
    ])("is absent for %s", async (_, onboarding) => {
      getWhatsMine.mockResolvedValue({ waiting: [], tasks: [] })
      getMyOnboarding.mockResolvedValue(onboarding)
      await renderPage()

      expect(screen.queryByText("Welcome to the portal.")).toBeNull()
    })

    it("has no axe violations", async () => {
      getWhatsMine.mockResolvedValue({ waiting: [], tasks: [] })
      getMyOnboarding.mockResolvedValue({ ...STAFF, firstRunShown: true })
      const view = await renderPage()

      expect(await axeViolations(view.container)).toEqual([])
    })
  })
})
