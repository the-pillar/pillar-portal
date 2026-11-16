// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { useSyncExternalStore } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { subscribeCreatedTask } from "../created-task-signal"
import { openNewTask } from "../new-task-url"
import type { TaskFormOptions } from "../queries/task-form"
import { NewTaskSheet } from "./new-task-sheet"
import { TaskForm } from "./task-form"

const { createTaskAction, toastSuccess, toastError, toastNotice } = vi.hoisted(
  () => ({
    createTaskAction: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastNotice: vi.fn(),
  })
)

vi.mock("../actions", () => ({ createTaskAction, updateTaskAction: vi.fn() }))
// The URL the component reads is the real one jsdom holds; the history
// writers below tell it when it changed.
vi.mock("next/navigation", () => {
  const subscribe = (callback: () => void) => {
    window.addEventListener("urlchange", callback)
    window.addEventListener("popstate", callback)
    return () => {
      window.removeEventListener("urlchange", callback)
      window.removeEventListener("popstate", callback)
    }
  }
  return {
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
    useSearchParams: () => {
      const query = useSyncExternalStore(
        subscribe,
        () => window.location.search,
        () => ""
      )
      return new URLSearchParams(query)
    },
    usePathname: () =>
      useSyncExternalStore(
        subscribe,
        () => window.location.pathname,
        () => "/"
      ),
  }
})
vi.mock("@/components/ui/toast", () => ({
  toast: Object.assign(vi.fn(), {
    success: toastSuccess,
    error: toastError,
    notice: toastNotice,
  }),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))
vi.mock("@/features/members/actions", () => ({}))

const MEMBER_1 = "00000000-0000-4000-8000-000000000001"

const OPTIONS: TaskFormOptions = {
  owners: [
    { kind: "section", id: "news", name: "News" },
    { kind: "desk", id: "layout", name: "Layout" },
  ],
  slotMembersByRole: {
    layout_artist: [
      { id: MEMBER_1, name: "Staff Layout Artist", openSlots: 2 },
    ],
  },
  allMembers: [{ id: MEMBER_1, name: "Staff Layout Artist", openSlots: 2 }],
  roleLabels: {
    writer: "Writer",
    layout_artist: "Layout Artist",
    cartoonist: "Cartoonist",
    photojournalist: "Photojournalist",
    broadcast_journalist: "Broadcast Journalist",
    videojournalist: "Videojournalist",
  },
}

let restore: (() => void) | undefined

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
  window.history.replaceState(null, "", "/dashboard")
  const push = window.history.pushState.bind(window.history)
  const replace = window.history.replaceState.bind(window.history)
  window.history.pushState = (...args) => {
    push(...args)
    window.dispatchEvent(new Event("urlchange"))
  }
  window.history.replaceState = (...args) => {
    replace(...args)
    window.dispatchEvent(new Event("urlchange"))
  }
  restore = () => {
    window.history.pushState = push
    window.history.replaceState = replace
  }
})

afterEach(() => {
  cleanup()
  restore?.()
  vi.clearAllMocks()
})

async function axeViolations(node: Element) {
  const results = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
  })
  return results.violations
}

function renderSheet(homeOwner: string | null = null) {
  return render(
    <>
      <h1>Board</h1>
      <NewTaskSheet options={OPTIONS} homeOwner={homeOwner} />
    </>
  )
}

function openFromUrl(query = "new=task") {
  window.history.replaceState(null, "", `/dashboard?${query}`)
}

async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  comboboxName: string | RegExp,
  optionName: string | RegExp
) {
  await user.click(screen.getByRole("combobox", { name: comboboxName }))
  await user.click(await screen.findByRole("option", { name: optionName }))
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Title"), "Lay out the spread")
  await chooseOption(user, "Role", "Layout Artist")
  await chooseOption(user, "Member", /Staff Layout Artist/)
  fireEvent.change(screen.getByLabelText("Due date"), {
    target: { value: "2026-11-27T17:00" },
  })
}

describe("NewTaskSheet", () => {
  it("renders nothing until the URL asks for it", () => {
    renderSheet()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("opens from the URL with the owner and due date prefilled, focus on Title", async () => {
    openFromUrl("new=task&new_owner=desk:layout&new_due=2026-11-20")
    renderSheet()

    const dialog = await screen.findByRole("dialog", { name: "New task" })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByLabelText("Title")).toHaveFocus()
    expect(screen.getByRole("combobox", { name: "Owner" })).toHaveTextContent(
      "Layout"
    )
    expect(screen.getByLabelText("Due date")).toHaveValue("2026-11-20T17:00")
    expect(
      screen.getByRole("button", { name: "Close New task" })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Create task" })).toBeEnabled()
  })

  it("falls back to the page's owner chip, then the home scope", async () => {
    openFromUrl("new=task&owner=section:news")
    const { unmount } = renderSheet("desk:layout")
    expect(
      await screen.findByRole("combobox", { name: "Owner" })
    ).toHaveTextContent("News")
    unmount()

    openFromUrl("new=task")
    renderSheet("desk:layout")
    expect(
      await screen.findByRole("combobox", { name: "Owner" })
    ).toHaveTextContent("Layout")
  })

  it("ignores a bad new_owner and new_due", async () => {
    openFromUrl("new=task&new_owner=desk:zzz&new_due=2026-13-40")
    renderSheet()

    await screen.findByRole("dialog")
    expect(screen.getByRole("combobox", { name: "Owner" })).toHaveTextContent(
      "Choose an owner"
    )
    expect(screen.getByLabelText("Due date")).toHaveValue("")
  })

  it("shows each member with their open slots", async () => {
    openFromUrl()
    renderSheet()
    await screen.findByRole("dialog")

    const user = userEvent.setup()
    await chooseOption(user, "Role", "Layout Artist")
    await user.click(screen.getByRole("combobox", { name: "Member" }))
    expect(
      await screen.findByRole("option", {
        name: "Staff Layout Artist · 2 active",
      })
    ).toBeInTheDocument()
  })

  it("closes untouched without asking, and removes its parameters", async () => {
    openFromUrl("new=task&new_owner=desk:layout")
    renderSheet()
    const user = userEvent.setup()

    await user.click(
      await screen.findByRole("button", { name: "Close New task" })
    )

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(screen.queryByText("Discard this task?")).not.toBeInTheDocument()
    expect(window.location.search).toBe("")
  })

  it("returns focus to the page heading when the URL opened it", async () => {
    openFromUrl()
    renderSheet()
    const user = userEvent.setup()
    await screen.findByRole("dialog")

    await user.keyboard("{Escape}")

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Board" })).toHaveFocus()
    )
  })

  it("returns focus to the opener it was opened from", async () => {
    window.history.replaceState(null, "", "/dashboard")
    render(
      <>
        <button type="button" onClick={() => openNewTask()}>
          Add
        </button>
        <NewTaskSheet options={OPTIONS} homeOwner={null} />
      </>
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Add" }))
    await screen.findByRole("dialog")
    expect(window.location.search).toBe("?new=task")

    await user.click(screen.getByRole("button", { name: "Close New task" }))

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add" })).toHaveFocus()
    )
  })

  it("closes on Back when nothing was typed", async () => {
    window.history.replaceState(null, "", "/dashboard")
    renderSheet()
    act(() => openNewTask({ owner: "desk:layout" }))
    await screen.findByRole("dialog")

    act(() => window.history.back())

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(screen.queryByText("Discard this task?")).not.toBeInTheDocument()
  })

  it("asks to discard on Back when something was typed, and keeps the text", async () => {
    window.history.replaceState(null, "", "/dashboard")
    renderSheet()
    const user = userEvent.setup()
    act(() => openNewTask({ owner: "desk:layout" }))
    await user.type(await screen.findByLabelText("Title"), "Half a thought")

    act(() => window.history.back())

    expect(
      await screen.findByRole("alertdialog", { name: "Discard this task?" })
    ).toBeInTheDocument()
    expect(window.location.search).toContain("new=task")
    expect(window.location.search).toContain("new_owner=desk%3Alayout")
    await user.click(screen.getByRole("button", { name: "Keep editing" }))
    expect(screen.getByLabelText("Title")).toHaveValue("Half a thought")
  })

  describe("swipe down (below md)", () => {
    function stubPhone(phone: boolean) {
      window.matchMedia = vi.fn((query: string) => ({
        matches: phone && query.includes("max-width: 767px"),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia
    }

    async function openPhoneSheet(phone = true) {
      stubPhone(phone)
      openFromUrl()
      renderSheet()
      const sheet = await screen.findByRole("dialog")
      Object.defineProperty(sheet, "offsetHeight", { value: 800 })
      const strip = sheet.querySelector<HTMLElement>(
        '[data-slot="new-task-grab"]'
      )!
      return { sheet, strip }
    }

    // jsdom stamps events with the real clock, so the last move's speed is
    // set by direction: `settle` ends with a small move back up (no flick).
    function swipe(strip: HTMLElement, dy: number, settle = false) {
      const pointer = { pointerId: 1, pointerType: "touch" }
      fireEvent.pointerDown(strip, { ...pointer, clientY: 100, button: 0 })
      fireEvent.pointerMove(strip, { ...pointer, clientY: 100 + dy + 10 })
      if (settle) {
        fireEvent.pointerMove(strip, { ...pointer, clientY: 100 + dy })
      }
      fireEvent.pointerUp(strip, { ...pointer, clientY: 100 + dy })
    }

    it("follows the finger and closes past a quarter of the height", async () => {
      const { sheet, strip } = await openPhoneSheet()
      fireEvent.pointerDown(strip, {
        pointerId: 1,
        clientY: 100,
        button: 0,
        pointerType: "touch",
      })
      fireEvent.pointerMove(strip, {
        pointerId: 1,
        clientY: 400,
        pointerType: "touch",
      })
      expect(sheet.style.transform).toBe("translateY(300px)")
      fireEvent.pointerUp(strip, {
        pointerId: 1,
        clientY: 400,
        pointerType: "touch",
      })

      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
      expect(screen.queryByText("Discard this task?")).not.toBeInTheDocument()
      expect(window.location.search).toBe("")
    })

    it("springs back from a short, slow drag", async () => {
      const { sheet, strip } = await openPhoneSheet()
      swipe(strip, 60, true)

      expect(sheet.style.transform).toBe("")
      expect(screen.getByRole("dialog")).toBeInTheDocument()
      expect(window.location.search).toBe("?new=task")
    })

    it("asks to discard instead of closing when something was typed", async () => {
      const { sheet, strip } = await openPhoneSheet()
      const user = userEvent.setup()
      await user.type(screen.getByLabelText("Title"), "Typed")

      swipe(strip, 400)

      expect(
        await screen.findByRole("alertdialog", { name: "Discard this task?" })
      ).toBeInTheDocument()
      expect(sheet.style.transform).toBe("")
      expect(screen.getByLabelText("Title")).toHaveValue("Typed")
    })

    it("leaves the panel alone from md", async () => {
      const { sheet, strip } = await openPhoneSheet(false)
      swipe(strip, 400)

      expect(sheet.style.transform).toBe("")
      expect(screen.getByRole("dialog")).toBeInTheDocument()
    })
  })

  it("asks on Escape with text typed: Keep editing is focused, Discard task closes", async () => {
    openFromUrl()
    renderSheet()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText("Title"), "Typed")

    await user.keyboard("{Escape}")

    const alert = await screen.findByRole("alertdialog", {
      name: "Discard this task?",
    })
    expect(alert).toHaveTextContent("What you typed will be lost.")
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus()

    await user.click(screen.getByRole("button", { name: "Discard task" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(window.location.search).toBe("")
  })

  it("does not count the prefills as typing", async () => {
    openFromUrl("new=task&new_owner=desk:layout&new_due=2026-11-20")
    renderSheet()
    const user = userEvent.setup()
    await screen.findByRole("dialog")

    await user.keyboard("{Escape}")

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(screen.queryByText("Discard this task?")).not.toBeInTheDocument()
  })

  it("creates the task: closes, toasts with Copy for Messenger and signals the id", async () => {
    openFromUrl("new=task&new_owner=desk:layout")
    createTaskAction.mockResolvedValue({ ok: true, data: { id: "task-9" } })
    const created = vi.fn()
    const unsubscribe = subscribeCreatedTask(created)
    renderSheet()
    const user = userEvent.setup()
    await screen.findByRole("dialog")
    await fillValidForm(user)

    await user.click(screen.getByRole("button", { name: "Create task" }))

    await waitFor(() => expect(createTaskAction).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(toastSuccess).toHaveBeenCalledWith(
      "Task created.",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Copy for Messenger" }),
      })
    )
    expect(created).toHaveBeenCalledWith("task-9")
    expect(screen.queryByText("Discard this task?")).not.toBeInTheDocument()
    expect(window.location.search).toBe("")
    unsubscribe()
  })

  it("blocks a create with no due date, naming the field and staying open", async () => {
    openFromUrl("new=task&new_owner=desk:layout")
    renderSheet()
    const user = userEvent.setup()
    await screen.findByRole("dialog")
    await user.type(screen.getByLabelText("Title"), "Lay out the spread")
    await chooseOption(user, "Role", "Layout Artist")
    await chooseOption(user, "Member", /Staff Layout Artist/)

    await user.click(screen.getByRole("button", { name: "Create task" }))

    expect(await screen.findByText("Add a due date")).toBeInTheDocument()
    expect(screen.getByLabelText("Due date")).toHaveFocus()
    expect(createTaskAction).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("stays open with the typed values when the command is refused", async () => {
    openFromUrl("new=task&new_owner=desk:layout")
    createTaskAction.mockResolvedValue({ ok: false, code: "tasks.not_admin" })
    renderSheet()
    const user = userEvent.setup()
    await screen.findByRole("dialog")
    await fillValidForm(user)

    await user.click(screen.getByRole("button", { name: "Create task" }))

    await waitFor(() => expect(toastError).toHaveBeenCalledOnce())
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByLabelText("Title")).toHaveValue("Lay out the spread")
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it("has no axe violations open, or with the discard dialog over it", async () => {
    openFromUrl("new=task&new_owner=desk:layout")
    renderSheet()
    const user = userEvent.setup()
    await screen.findByRole("dialog")
    expect(await axeViolations(document.body)).toEqual([])

    await user.type(screen.getByLabelText("Title"), "Typed")
    await user.keyboard("{Escape}")
    await screen.findByRole("alertdialog")
    expect(await axeViolations(document.body)).toEqual([])
  })

  it("focuses its own Title, not an edit form's, when opened over one", async () => {
    openFromUrl()
    render(
      <>
        <h1>Edit task</h1>
        <TaskForm options={OPTIONS} idPrefix="task" />
        <NewTaskSheet options={OPTIONS} homeOwner={null} />
      </>
    )

    await screen.findByRole("dialog", { name: "New task" })

    const dialog = screen.getByRole("dialog", { name: "New task" })
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toHaveAttribute("id", "new-task-title")
  })

  it("counts changing only the owner as typing", async () => {
    openFromUrl()
    renderSheet()
    const user = userEvent.setup()
    await screen.findByRole("dialog")
    await chooseOption(user, "Owner", "News")

    await user.keyboard("{Escape}")

    expect(
      await screen.findByRole("alertdialog", { name: "Discard this task?" })
    ).toBeInTheDocument()
  })

  it("forgets its history entry after Back, so a later URL-opened sheet closes by rewriting the URL", async () => {
    window.history.replaceState(null, "", "/dashboard")
    renderSheet()
    act(() => openNewTask())
    await screen.findByRole("dialog")
    act(() => window.history.back())
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )

    openFromUrl("new=task&new_owner=desk:layout")
    const back = vi.spyOn(window.history, "back")
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole("button", { name: "Close New task" })
    )

    await waitFor(() => expect(window.location.search).toBe(""))
    expect(back).not.toHaveBeenCalled()
  })

  it("never grays Create task out: it shows a spinner while saving and ignores a second press", async () => {
    openFromUrl("new=task&new_owner=desk:layout")
    let finish: (value: unknown) => void = () => {}
    createTaskAction.mockReturnValue(
      new Promise((resolve) => (finish = resolve))
    )
    renderSheet()
    const user = userEvent.setup()
    await screen.findByRole("dialog")
    await fillValidForm(user)
    const button = screen.getByRole("button", { name: "Create task" })

    await user.click(button)
    await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "true"))
    expect(button).not.toBeDisabled()
    expect(button.querySelector("svg.animate-spin")).not.toBeNull()
    await user.click(button)
    expect(createTaskAction).toHaveBeenCalledOnce()

    await act(async () => finish({ ok: true, data: { id: "t" } }))
  })
})
