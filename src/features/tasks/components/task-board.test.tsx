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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { BOARD_OWNERS, OTHER_MEMBER, VIEWER, boardCard } from "./board-fixtures"
import { TaskBoard } from "./task-board"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const {
  moveTaskAction,
  markDoneAction,
  reopenTaskAction,
  refresh,
  toastError,
  toastSuccess,
  toastUndo,
  toastInfo,
  search,
} = vi.hoisted(() => ({
  moveTaskAction: vi.fn(),
  markDoneAction: vi.fn(),
  reopenTaskAction: vi.fn(),
  refresh: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastUndo: vi.fn(),
  toastInfo: vi.fn(),
  search: { current: "" },
}))

vi.mock("../actions", () => ({
  moveTaskAction,
  markDoneAction,
  reopenTaskAction,
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  useSearchParams: () => new URLSearchParams(search.current),
}))
vi.mock("@/components/ui/toast", () => ({
  toast: Object.assign(toastInfo, {
    error: toastError,
    success: toastSuccess,
    undo: toastUndo,
  }),
}))

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
  search.current = ""
  window.history.replaceState(null, "", "/dashboard?view=board")
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

const card = boardCard

const SPREAD = card(1, {
  title: "Lay out the spread",
  column: "to_do",
  moves: ["doing"],
  yours: true,
})
const CARTOON = card(2, {
  title: "Draw the cartoon",
  column: "to_do",
  moves: [],
})
const PHOTOS = card(3, {
  title: "Edit the photos",
  column: "doing",
  moves: ["to_do", "for_review"],
  ownerId: "photo",
})
const STORY = card(4, {
  title: "Write the story",
  column: "doing",
  ownerId: "news",
  ownerKind: "section",
  ownerName: "News",
})
const CARDS = [SPREAD, CARTOON, PHOTOS, STORY]

const REVIEWED = card(5, {
  title: "Check the proofs",
  column: "for_review",
  moves: ["done"],
})

type Props = Partial<React.ComponentProps<typeof TaskBoard>>

function board(props: Props = {}) {
  return (
    <TaskBoard
      cards={CARDS}
      owners={BOARD_OWNERS}
      viewerId={VIEWER}
      homeFilter={{ kind: "all" }}
      {...props}
    />
  )
}

// A column's region is named by its heading, which reads "<label>, n tasks".
const column = (label: string) =>
  screen.getByRole("region", { name: new RegExp(`^${label}\\s*,`) })

async function chooseMove(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
  to: string
) {
  await user.click(
    screen.getByRole("button", { name: `More actions, ${title}` })
  )
  await user.click(
    await screen.findByRole("menuitem", { name: `Move to ${to}` })
  )
}

/**
 * Presses a toast action until the Board takes it: one move saves at a time,
 * and a press while the last save is still finishing is ignored. Done once
 * `action` has been called `times` times in all.
 */
async function pressOnceIdle(
  press: () => unknown,
  action: ReturnType<typeof vi.fn>,
  times: number
) {
  await waitFor(async () => {
    if (action.mock.calls.length < times) await press()
    expect(action).toHaveBeenCalledTimes(times)
  })
}

const MOVED = {
  ok: true,
  data: { column: "doing", movedAt: "2026-11-15T09:00:00.987654+00:00" },
}

describe("TaskBoard", () => {
  it("shows four columns in order, each headed with its label and count", () => {
    render(board())

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent)
    expect(headings).toEqual([
      "To Do2, 2 tasks",
      "Doing2, 2 tasks",
      "For Review0, 0 tasks",
      "Done0, 0 tasks",
    ])
  })

  it("gives each empty column its own line", () => {
    render(board())

    expect(
      within(column("For Review")).getByText("Nothing waiting for review.")
    ).toBeVisible()
    expect(
      within(column("For Review")).getByText(
        "Cards land here when someone finishes a draft."
      )
    ).toBeVisible()
    expect(
      within(column("Done")).getByText("Nothing done in the last 30 days.")
    ).toBeVisible()
    expect(within(column("To Do")).queryByText("Nothing to start.")).toBeNull()
  })

  it("ends the Done column with the 30-day note", () => {
    render(
      board({
        cards: [...CARDS, card(7, { title: "Printed", column: "done" })],
      })
    )

    const note = within(column("Done")).getByText(
      "Showing tasks done in the last 30 days."
    )
    expect(column("Done").lastElementChild).toBe(note)
    expect(screen.getAllByText(/Showing tasks done/)).toHaveLength(1)
  })

  it("labels each card with its owner and marks Yours", () => {
    render(board())

    const article = screen
      .getByRole("heading", { name: "Lay out the spread" })
      .closest("article")!
    expect(within(article).getByText("Layout")).toHaveAttribute(
      "data-owner",
      "layout"
    )
    expect(within(article).getByText("Yours")).toBeInTheDocument()
  })

  it("puts the columns in one focusable, named region", () => {
    render(board())

    const row = screen.getByRole("region", { name: "Board columns" })
    expect(row).toHaveAttribute("tabindex", "0")
    expect(row).toHaveClass("overflow-x-auto", "relative")
  })

  it("gives only a movable card the drag wiring, and every card a link", () => {
    render(board())

    const wired = (title: string) =>
      screen.getByRole("link", { name: title }).hasAttribute("aria-describedby")
    expect(wired("Lay out the spread")).toBe(true)
    expect(wired("Draw the cartoon")).toBe(false)
    expect(
      screen.getByRole("link", { name: "Draw the cartoon" })
    ).toHaveAttribute("href", `/dashboard/tasks/${CARTOON.id}`)
  })

  describe("filter chips", () => {
    it("names each chip with its count and filters on the tap, with no request", async () => {
      const user = userEvent.setup()
      const push = vi.spyOn(window.history, "pushState")
      render(board())

      const group = screen.getByRole("radiogroup", { name: "Filter tasks" })
      expect(
        within(group)
          .getAllByRole("radio")
          .map((radio) => radio.textContent)
      ).toEqual([
        "All4, 4 tasks",
        "Mine1, 1 task",
        "News1, 1 task",
        "Layout2, 2 tasks",
        "Photo1, 1 task",
      ])

      await user.click(
        within(group).getByRole("radio", { name: "Mine, 1 task" })
      )

      expect(
        within(group).getByRole("radio", { name: "Mine, 1 task" })
      ).toBeChecked()
      expect(screen.getByText("Showing 1 task in Mine.")).toBeInTheDocument()
      expect(screen.queryByText("Draw the cartoon")).toBeNull()
      expect(screen.getByText("Lay out the spread")).toBeInTheDocument()
      // Counts stay the window's.
      expect(
        within(group).getByRole("radio", { name: "Layout, 2 tasks" })
      ).toBeInTheDocument()
      expect(window.location.search).toContain("owner=mine")
      expect(push).toHaveBeenCalledOnce()
      expect(moveTaskAction).not.toHaveBeenCalled()
      expect(refresh).not.toHaveBeenCalled()
    })

    it("moves between chips with the arrow keys without choosing", async () => {
      const user = userEvent.setup()
      render(board())

      screen.getByRole("radio", { name: "All, 4 tasks" }).focus()
      await user.keyboard("{ArrowRight}")

      expect(screen.getByRole("radio", { name: "Mine, 1 task" })).toHaveFocus()
      expect(screen.getByRole("radio", { name: "All, 4 tasks" })).toBeChecked()
    })

    it("applies the home scope when owner is missing or not a filter", () => {
      search.current = "owner=zzz"
      render(board({ homeFilter: { kind: "desk", id: "layout" } }))

      expect(
        screen.getByRole("radio", { name: "Layout, 2 tasks" })
      ).toBeChecked()
      expect(screen.queryByText("Write the story")).toBeNull()
    })

    it("reads the URL's owner and keeps its chip at zero", () => {
      search.current = "owner=desk:photo"
      render(board({ cards: [SPREAD] }))

      expect(
        screen.getByRole("radio", { name: "Photo, 0 tasks" })
      ).toBeChecked()
      expect(
        screen.getByRole("heading", {
          level: 2,
          name: "No tasks in Photo right now.",
        })
      ).toBeInTheDocument()
    })

    it("shows All articles only as the home scope, after Mine", () => {
      render(board({ homeFilter: { kind: "articles" } }))

      const labels = screen
        .getAllByRole("radio")
        .map((radio) => radio.textContent)
      expect(labels.slice(0, 3)).toEqual([
        "All4, 4 tasks",
        "Mine1, 1 task",
        "All articles1, 1 task",
      ])
    })

    it("offers Show all from an empty filter", async () => {
      const user = userEvent.setup()
      search.current = "owner=mine"
      render(board({ cards: [CARTOON] }))

      expect(
        screen.getByRole("heading", {
          level: 2,
          name: "Nothing's assigned to you right now.",
        })
      ).toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: "Show all" }))
      expect(screen.getByText("Draw the cartoon")).toBeInTheDocument()
      expect(window.location.search).toContain("owner=all")
    })
  })

  it("shows the first-run state when no task exists", () => {
    render(board({ cards: [] }))

    expect(
      screen.getByRole("heading", { name: "No tasks yet." })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Tasks the Editorial Board creates show up here, one card per piece of work."
      )
    ).toBeInTheDocument()
  })

  describe("the column switcher", () => {
    it("has a button per column named with its count, and scrolls and focuses the heading on a tap", async () => {
      const user = userEvent.setup()
      render(board())

      const nav = screen.getByRole("navigation", { name: "Jump to column" })
      expect(
        within(nav)
          .getAllByRole("button")
          .map((button) => button.textContent)
      ).toEqual([
        "To Do2, 2 tasks",
        "Doing2, 2 tasks",
        "For Review0, 0 tasks",
        "Done0, 0 tasks",
      ])
      expect(
        within(nav).getByRole("button", { name: "To Do, 2 tasks" })
      ).toHaveAttribute("aria-current", "true")

      await user.click(
        within(nav).getByRole("button", { name: "Doing, 2 tasks" })
      )

      expect(
        within(column("Doing")).getByRole("heading", { level: 2 })
      ).toHaveFocus()
      expect(
        within(nav).getByRole("button", { name: "Doing, 2 tasks" })
      ).toHaveAttribute("aria-current", "true")
      expect(window.location.search).toContain("column=doing")
    })
  })

  describe("coming back from Task detail", () => {
    it("remembers the column and card in the URL when a card opens", async () => {
      const user = userEvent.setup()
      render(board())
      const link = screen.getByRole("link", { name: "Edit the photos" })
      link.addEventListener("click", (event) => event.preventDefault())

      await user.click(link)

      const params = new URLSearchParams(window.location.search)
      expect(params.get("column")).toBe("doing")
      expect(params.get("focus")).toBe(PHOTOS.id)
    })

    it("focuses the card the URL names, once", () => {
      window.history.replaceState(
        null,
        "",
        `/dashboard?view=board&column=doing&focus=${PHOTOS.id}`
      )
      render(board())

      expect(
        screen.getByRole("link", { name: "Edit the photos" })
      ).toHaveFocus()
      // The column the URL names is the one in view.
      expect(
        within(
          screen.getByRole("navigation", { name: "Jump to column" })
        ).getByRole("button", { name: "Doing, 2 tasks" })
      ).toHaveAttribute("aria-current", "true")
      expect(new URLSearchParams(window.location.search).has("focus")).toBe(
        false
      )
    })

    it("moves no focus for a card that isn't there", () => {
      window.history.replaceState(null, "", "/dashboard?view=board&focus=gone")
      render(board())

      expect(document.body).toHaveFocus()
    })
  })

  describe("moving", () => {
    it("offers Move to rows first in the overflow menu, only for the card's moves", async () => {
      const user = userEvent.setup()
      render(board())

      await user.click(
        screen.getByRole("button", { name: "More actions, Edit the photos" })
      )

      const items = (await screen.findAllByRole("menuitem")).map(
        (item) => item.textContent
      )
      expect(items.slice(0, 2)).toEqual(["Move to To Do", "Move to For Review"])
      expect(items).toContain("Download .ics")
    })

    it("moves at once with the card's version, offers Undo and focuses the card", async () => {
      const user = userEvent.setup()
      // Held open, so the optimistic column is checked while the move saves:
      // once it resolves, the card falls back to these props (the refresh
      // that would carry the new column never comes in a test).
      let save: (result: typeof MOVED) => void = () => {}
      moveTaskAction.mockReturnValue(
        new Promise((resolve) => {
          save = resolve
        })
      )
      render(board())

      await chooseMove(user, "Lay out the spread", "Doing")

      expect(moveTaskAction).toHaveBeenCalledExactlyOnceWith({
        taskId: SPREAD.id,
        toColumn: "doing",
        expectedMovedAt: SPREAD.movedAt,
      })
      expect(
        await within(column("Doing")).findByRole("heading", {
          level: 3,
          name: "Lay out the spread",
        })
      ).toBeInTheDocument()
      save(MOVED)
      await waitFor(() =>
        expect(toastUndo).toHaveBeenCalledWith(
          "Moved to Doing.",
          expect.objectContaining({
            action: expect.objectContaining({ label: "Undo" }),
          })
        )
      )
      await waitFor(() =>
        expect(
          screen.getByRole("link", { name: "Lay out the spread" })
        ).toHaveFocus()
      )
    })

    it("undoes with the version the move returned and the column it left", async () => {
      const user = userEvent.setup()
      moveTaskAction.mockResolvedValue(MOVED)
      render(board())
      await chooseMove(user, "Lay out the spread", "Doing")
      await waitFor(() => expect(toastUndo).toHaveBeenCalled())
      const { action } = toastUndo.mock.calls[0][1]
      moveTaskAction.mockResolvedValue({
        ok: true,
        data: { column: "to_do", movedAt: "later" },
      })

      await pressOnceIdle(action.onClick, moveTaskAction, 2)

      await waitFor(() =>
        expect(moveTaskAction).toHaveBeenLastCalledWith({
          taskId: SPREAD.id,
          toColumn: "to_do",
          expectedMovedAt: MOVED.data.movedAt,
        })
      )
      await waitFor(() =>
        expect(toastInfo).toHaveBeenCalledWith("Moved back to To Do.")
      )
    })

    it("undoes a move that cleared a revision note with the move alone, never restoring the note", async () => {
      const user = userEvent.setup()
      const SENT_BACK = card(6, {
        title: "Fix the headline",
        column: "doing",
        moves: ["to_do", "for_review"],
        sentBack: true,
      })
      moveTaskAction.mockResolvedValue({
        ok: true,
        data: { column: "for_review", movedAt: "2026-11-15T09:00:01+00:00" },
      })
      render(board({ cards: [SENT_BACK] }))
      await chooseMove(user, "Fix the headline", "For Review")
      await waitFor(() => expect(toastUndo).toHaveBeenCalled())
      const { action } = toastUndo.mock.calls[0][1]
      moveTaskAction.mockResolvedValue({
        ok: true,
        data: { column: "doing", movedAt: "2026-11-15T09:00:02+00:00" },
      })

      await pressOnceIdle(action.onClick, moveTaskAction, 2)

      await waitFor(() =>
        expect(toastInfo).toHaveBeenCalledWith("Moved back to Doing.")
      )
      // Undo is the same column move, with nothing about the note.
      expect(moveTaskAction).toHaveBeenLastCalledWith({
        taskId: SENT_BACK.id,
        toColumn: "doing",
        expectedMovedAt: "2026-11-15T09:00:01+00:00",
      })
      expect(Object.keys(moveTaskAction.mock.lastCall![0])).toEqual([
        "taskId",
        "toColumn",
        "expectedMovedAt",
      ])
    })

    it("says who moved it when Undo is stale, and leaves the card where it is", async () => {
      const user = userEvent.setup()
      moveTaskAction.mockResolvedValue(MOVED)
      render(board())
      await chooseMove(user, "Lay out the spread", "Doing")
      await waitFor(() => expect(toastUndo).toHaveBeenCalled())
      const { action } = toastUndo.mock.calls[0][1]
      moveTaskAction.mockResolvedValue({
        ok: false,
        code: "tasks.stale",
        params: { column: "for_review", movedByName: "Ben Baker" },
      })

      await pressOnceIdle(action.onClick, moveTaskAction, 2)

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(
          "Can't undo — Ben Baker moved this card since."
        )
      )
      expect(refresh).toHaveBeenCalled()
    })

    it("marks a For Review card done through markDoneAction, with Reopen", async () => {
      const user = userEvent.setup()
      markDoneAction.mockResolvedValue({ ok: true, data: { column: "done" } })
      render(board({ cards: [REVIEWED] }))

      await chooseMove(user, "Check the proofs", "Done")

      expect(markDoneAction).toHaveBeenCalledExactlyOnceWith({
        taskId: REVIEWED.id,
      })
      expect(moveTaskAction).not.toHaveBeenCalled()
      await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
      expect(toastSuccess.mock.calls[0][0]).toBe("Marked done.")

      reopenTaskAction.mockResolvedValue({
        ok: true,
        data: { column: "doing" },
      })
      await pressOnceIdle(
        toastSuccess.mock.calls[0][1].action.onClick,
        reopenTaskAction,
        1
      )
      await waitFor(() =>
        expect(reopenTaskAction).toHaveBeenCalledWith({ taskId: REVIEWED.id })
      )
      await waitFor(() => expect(toastInfo).toHaveBeenCalledWith("Reopened."))
    })

    it("puts a stale move back with where the card is now", async () => {
      const user = userEvent.setup()
      moveTaskAction.mockResolvedValue({
        ok: false,
        code: "tasks.stale",
        params: { column: "for_review", movedByName: "Ben Baker" },
      })
      render(board())

      await chooseMove(user, "Lay out the spread", "Doing")

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(
          "That card moved — it's now in For Review."
        )
      )
      expect(refresh).toHaveBeenCalledOnce()
      await waitFor(() =>
        expect(
          within(column("To Do")).getByText("Lay out the spread")
        ).toBeInTheDocument()
      )
    })

    it("keeps taskErrorMessage for other refusals and thrown calls", async () => {
      const user = userEvent.setup()
      moveTaskAction.mockResolvedValue({ ok: false, code: "tasks.not_allowed" })
      render(board())

      await chooseMove(user, "Lay out the spread", "Doing")

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith("Couldn't save — try again.")
      )
    })

    it("offers no move on any card while one saves", async () => {
      const user = userEvent.setup()
      moveTaskAction.mockReturnValue(new Promise(() => {}))
      render(board())

      await chooseMove(user, "Lay out the spread", "Doing")
      await user.click(
        screen.getByRole("button", { name: "More actions, Edit the photos" })
      )

      expect(screen.queryByRole("menuitem", { name: /^Move to/ })).toBeNull()
      expect(moveTaskAction).toHaveBeenCalledTimes(1)
    })
  })

  describe("highlights", () => {
    it("highlights a card someone else moved once, never on the first render", () => {
      const { rerender } = render(board())
      expect(document.querySelector("[data-highlight]")).toBeNull()

      rerender(
        board({
          cards: CARDS.map((c) =>
            c.id === PHOTOS.id
              ? { ...c, column: "for_review" as const, movedBy: OTHER_MEMBER }
              : c
          ),
        })
      )

      const marked = document.querySelectorAll("[data-highlight]")
      expect([...marked].map((el) => el.getAttribute("data-card-id"))).toEqual([
        PHOTOS.id,
      ])
      expect(
        within(column("For Review")).getByText("Edit the photos")
      ).toBeInTheDocument()
    })

    it("never highlights the viewer's own move or new task", () => {
      const { rerender } = render(board())

      rerender(
        board({
          cards: [
            ...CARDS.map((c) =>
              c.id === PHOTOS.id
                ? { ...c, column: "for_review" as const, movedBy: VIEWER }
                : c
            ),
            card(8, { title: "Mine new", createdBy: VIEWER }),
          ],
        })
      )

      expect(document.querySelector("[data-highlight]")).toBeNull()
    })

    it("highlights another member's new task", () => {
      const { rerender } = render(board())

      rerender(
        board({
          cards: [
            ...CARDS,
            card(8, { title: "Fresh", createdBy: OTHER_MEMBER }),
          ],
        })
      )

      expect(
        document.querySelector("[data-highlight]")?.getAttribute("data-card-id")
      ).toBe(card(8, { title: "" }).id)
    })
  })

  describe("focus after a refetch", () => {
    it("hands focus to the neighbor and says where the card went when it leaves the filter", async () => {
      const user = userEvent.setup()
      search.current = "owner=desk:layout"
      const { rerender } = render(board())
      await user.click(screen.getByRole("link", { name: "Draw the cartoon" }))
      screen.getByRole("link", { name: "Draw the cartoon" }).focus()

      rerender(
        board({
          cards: CARDS.map((c) =>
            c.id === CARTOON.id
              ? {
                  ...c,
                  ownerId: "photo",
                  column: "doing" as const,
                  movedBy: OTHER_MEMBER,
                  movedByName: "Ben Baker",
                }
              : c
          ),
        })
      )

      await waitFor(() =>
        expect(
          screen.getByText("Draw the cartoon moved to Doing by Ben Baker.")
        ).toBeInTheDocument()
      )
    })
  })

  it("has no axe violations", async () => {
    const { container } = render(board())

    expect(await axeViolations(container)).toEqual([])
  })

  it("has no axe violations in the empty states", async () => {
    const { container, rerender } = render(board({ cards: [] }))
    expect(await axeViolations(container)).toEqual([])

    search.current = "owner=mine"
    rerender(board({ cards: [CARTOON] }))
    expect(await axeViolations(container)).toEqual([])
  })
})
