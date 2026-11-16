// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest"

import { OnboardingTour } from "./onboarding-tour"

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }))

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(async () => {
  cleanup()
  vi.clearAllMocks()
  window.history.replaceState(null, "", "/")
  // Radix's focus scope returns focus in a timeout after it unmounts; let it
  // run before the next test renders its own #top.
  await new Promise((resolve) => setTimeout(resolve, 0))
})

async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

// jsdom lays nothing out: give each target a box and say it is rendered.
function page(
  visible: string[] = ["counts", "new-task", "my-dashboard", "members"]
) {
  return (
    <>
      <h1 id="top">Admin home</h1>
      {visible.map((name) => (
        <div
          key={name}
          data-tour={name}
          ref={(node) => {
            if (!node) return
            node.getClientRects = () => [{}] as unknown as DOMRectList
            node.getBoundingClientRect = () =>
              ({
                top: 100,
                left: 40,
                width: 200,
                height: 40,
                bottom: 140,
                right: 240,
              }) as DOMRect
          }}
        >
          {name}
        </div>
      ))}
    </>
  )
}

function renderTour(
  props: {
    replay?: boolean
    record?: Mock<(step: "tour_seen") => Promise<unknown>>
  } = {},
  visible?: string[]
) {
  const record =
    props.record ??
    vi
      .fn<(step: "tour_seen") => Promise<unknown>>()
      .mockResolvedValue(undefined)
  const view = render(
    <>
      {page(visible)}
      <OnboardingTour
        replay={props.replay ?? false}
        record={record}
        returnFocusId="top"
      />
    </>
  )
  return { record, view }
}

describe("OnboardingTour", () => {
  it("opens on step 1, named for its step, with focus on the heading", async () => {
    renderTour()

    const dialog = await screen.findByRole("dialog", {
      name: "Tour, step 1 of 4: Needs you",
    })
    expect(dialog).toHaveAttribute("data-onboarding-tour")
    expect(dialog).toHaveTextContent("What needs you shows up here.")
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Needs you/ })).toHaveFocus()
    )
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Skip tour" })
    ).toBeInTheDocument()
  })

  it("walks the four steps in EXPERIENCE's words, scrolling each target into view", async () => {
    const user = userEvent.setup()
    renderTour()

    const bodies = [
      "What needs you shows up here.",
      "New task, on every page, creates and assigns a task.",
      "The Board and your own tasks are under My dashboard.",
      "Approve people who sign in, under Members.",
    ]
    const titles = ["Needs you", "New task", "My dashboard", "Members"]
    for (let i = 0; i < 4; i++) {
      const dialog = await screen.findByRole("dialog", {
        name: `Tour, step ${i + 1} of 4: ${titles[i]}`,
      })
      expect(dialog).toHaveTextContent(bodies[i])
      await waitFor(() =>
        expect(
          screen.getByRole("heading", { name: new RegExp(titles[i]) })
        ).toHaveFocus()
      )
      if (i < 3) await user.click(screen.getByRole("button", { name: "Next" }))
    }

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(4)
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull()
  })

  it("ends on Done: records tour_seen once and focuses the h1", async () => {
    const user = userEvent.setup()
    const { record } = renderTour()
    for (let i = 0; i < 3; i++) {
      await user.click(await screen.findByRole("button", { name: "Next" }))
    }

    await user.click(screen.getByRole("button", { name: "Done" }))

    expect(record).toHaveBeenCalledExactlyOnceWith("tour_seen")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(document.getElementById("top")).toHaveFocus()
  })

  it("ends on Skip tour and on Escape, each recording once", async () => {
    const user = userEvent.setup()
    const first = renderTour()
    await user.click(await screen.findByRole("button", { name: "Skip tour" }))
    expect(first.record).toHaveBeenCalledExactlyOnceWith("tour_seen")
    cleanup()

    const second = renderTour()
    await screen.findByRole("dialog")
    await user.keyboard("{Escape}")
    expect(second.record).toHaveBeenCalledExactlyOnceWith("tour_seen")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("stays open when the scrim is pressed: only Done, Skip tour and Escape end it", async () => {
    const { record } = renderTour()
    await screen.findByRole("dialog")
    await new Promise((resolve) => setTimeout(resolve, 10))

    const scrim = document.querySelector("[data-slot=onboarding-tour-scrim]")!
    fireEvent.pointerDown(scrim)
    fireEvent.pointerUp(scrim)
    fireEvent.click(scrim)

    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(record).not.toHaveBeenCalled()
  })

  it("writes nothing on a replay, and drops ?tour from the URL when it ends", async () => {
    window.history.replaceState(null, "", "/admin?tour=again")
    const user = userEvent.setup()
    const { record } = renderTour({ replay: true })

    await user.click(await screen.findByRole("button", { name: "Skip tour" }))

    expect(record).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledExactlyOnceWith("/admin", { scroll: false })
  })

  it("centers when the target isn't on screen (no spotlight)", async () => {
    renderTour({}, [])

    const dialog = await screen.findByRole("dialog")
    expect(dialog.className).toContain("top-1/2")
    expect(
      document.querySelector("[data-slot=onboarding-tour-scrim] > div")
    ).toBeNull()
  })

  it("spotlights a target that is on screen", async () => {
    renderTour()
    await screen.findByRole("dialog")

    await waitFor(() =>
      expect(
        document.querySelector("[data-slot=onboarding-tour-scrim] > div")
      ).not.toBeNull()
    )
  })

  it("carries on when the write fails", async () => {
    const user = userEvent.setup()
    renderTour({
      record: vi
        .fn<(step: "tour_seen") => Promise<unknown>>()
        .mockRejectedValue(new Error("down")),
    })

    await user.click(await screen.findByRole("button", { name: "Skip tour" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("has no axe violations", async () => {
    renderTour()
    const dialog = await screen.findByRole("dialog")
    expect(await axeViolations(dialog)).toEqual([])
  })
})
