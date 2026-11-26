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

import type { TaskDetailLink } from "../queries/task-detail"
import { SlotDeliverables } from "./slot-deliverables"

const {
  addDeliverableLinksAction,
  removeDeliverableLinkAction,
  refresh,
  toast,
  toastError,
  toastSuccess,
} = vi.hoisted(() => {
  const toastSuccess = vi.fn()
  const toastError = vi.fn()
  return {
    addDeliverableLinksAction: vi.fn(),
    removeDeliverableLinkAction: vi.fn(),
    refresh: vi.fn(),
    toastSuccess,
    toastError,
    toast: Object.assign(vi.fn(), {
      success: toastSuccess,
      error: toastError,
    }),
  }
})

vi.mock("../actions", () => ({
  addDeliverableLinksAction,
  removeDeliverableLinkAction,
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("@/components/ui/toast", () => ({ toast }))

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

const SLOT = "00000000-0000-4000-8000-000000000031"
const ROW_ID = `slot-${SLOT}`
const HEADING_ID = "task-heading"

const CANVA: TaskDetailLink = {
  id: "00000000-0000-4000-8000-0000000000a1",
  url: "https://www.canva.com/design/DAF1/edit",
  addedByName: null,
}
const DOCS: TaskDetailLink = {
  id: "00000000-0000-4000-8000-0000000000a2",
  url: "https://docs.google.com/document/d/1Mn/edit",
  addedByName: "Paolo",
}
const DRIVE: TaskDetailLink = {
  id: "00000000-0000-4000-8000-0000000000a3",
  url: "https://drive.google.com/drive/folders/9",
  addedByName: null,
}

type Props = Partial<React.ComponentProps<typeof SlotDeliverables>>

function view(props: Props = {}) {
  const merged = {
    slotId: SLOT,
    roleLabel: "Layout Artist",
    links: [],
    canAdd: false,
    canRemove: false,
    full: false,
    rowId: ROW_ID,
    headingId: HEADING_ID,
    ...props,
  }
  return (
    <main>
      <h1 id={HEADING_ID} tabIndex={-1}>
        Task
      </h1>
      <ul>
        <li id={ROW_ID} tabIndex={-1}>
          <SlotDeliverables {...merged} />
        </li>
      </ul>
    </main>
  )
}

function mount(props: Props = {}) {
  const result = render(view(props))
  return {
    ...result,
    update: (next: Props) => result.rerender(view({ ...props, ...next })),
  }
}

const ADD_NAME = "Add a link for Layout Artist"

describe("what the slot offers", () => {
  it("shows nothing to a member who can't add or remove, on an empty slot", () => {
    const { container } = mount()

    expect(container.querySelector("li")).toBeEmptyDOMElement()
  })

  it("lists others' links to a member with no controls", () => {
    mount({ links: [CANVA, DOCS] })

    expect(screen.getByRole("link", { name: /^Canva/ })).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("offers the holder the hint above + Add a link while the slot has no links", () => {
    mount({ canAdd: true })

    expect(
      screen.getByText("Add the link to your work here when it's ready.")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: ADD_NAME })).toBeInTheDocument()
  })

  it("drops the hint once the slot has a link", () => {
    mount({ canAdd: true, links: [CANVA], canRemove: true })

    expect(screen.queryByText(/Add the link to your work/)).toBeNull()
    expect(screen.getByRole("button", { name: ADD_NAME })).toBeInTheDocument()
  })

  it("says 5 of 5 links instead of the button on a full slot", () => {
    mount({
      links: [
        CANVA,
        DOCS,
        DRIVE,
        { ...CANVA, id: "x4" },
        { ...CANVA, id: "x5" },
      ],
      canRemove: true,
      full: true,
    })

    expect(screen.getByText("5 of 5 links")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: ADD_NAME })).toBeNull()
  })

  it('labels "added by" only on a link someone else added', () => {
    mount({ links: [CANVA, DOCS] })

    expect(screen.getAllByText(/added by/)).toHaveLength(1)
    expect(screen.getByText("added by Paolo")).toBeInTheDocument()
  })

  it("names each remove button for its site, its place and the role", () => {
    mount({ links: [CANVA, DOCS], canRemove: true })

    expect(
      screen.getByRole("button", {
        name: "Remove Canva link 1 from Layout Artist",
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: "Remove Google Docs link 2 from Layout Artist",
      })
    ).toBeInTheDocument()
  })

  it("is axe clean with links, remove buttons and an open field", async () => {
    const user = userEvent.setup()
    const { container } = mount({
      links: [CANVA, DOCS],
      canAdd: true,
      canRemove: true,
    })
    await user.click(screen.getByRole("button", { name: ADD_NAME }))

    expect(await axeViolations(container)).toEqual([])
  })
})

describe("adding", () => {
  async function openField(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: ADD_NAME }))
    return screen.getByRole("textbox", { name: "Link for Layout Artist" })
  }

  it("opens a labelled field with the link attributes, focused, with Add and Cancel", async () => {
    const user = userEvent.setup()
    mount({ canAdd: true })

    const field = await openField(user)

    expect(field).toHaveFocus()
    expect(field).toHaveAttribute("placeholder", "Paste a link")
    expect(field).toHaveAttribute("inputmode", "url")
    expect(field).toHaveAttribute("autocapitalize", "none")
    expect(field).toHaveAttribute("autocorrect", "off")
    expect(field).toHaveAttribute("spellcheck", "false")
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: ADD_NAME })).toBeNull()
  })

  it("adds one link on Enter, toasts, closes the field and focuses the new row", async () => {
    const user = userEvent.setup()
    addDeliverableLinksAction.mockResolvedValue({
      ok: true,
      data: { slotId: SLOT, count: 1 },
    })
    const { update } = mount({ canAdd: true })
    await openField(user)

    await user.keyboard("canva.com/design/x{Enter}")

    expect(addDeliverableLinksAction).toHaveBeenCalledExactlyOnceWith({
      slotId: SLOT,
      urls: ["https://canva.com/design/x"],
    })
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Added 1 link.")
    )
    expect(screen.queryByRole("textbox")).toBeNull()

    // The refreshed page brings the link.
    update({ canAdd: true, canRemove: true, links: [CANVA] })
    const link = await screen.findByRole("link", {
      name: /^Canva/,
    })
    await waitFor(() => expect(link).toHaveFocus())
    expect(screen.queryByText(/added by/)).toBeNull()
  })

  it("splits several pasted links and trims to the room the page shows, keeping the field open and emptied with a note", async () => {
    const user = userEvent.setup()
    addDeliverableLinksAction.mockResolvedValue({
      ok: true,
      data: { slotId: SLOT, count: 2 },
    })
    mount({ canAdd: true, canRemove: true, links: [CANVA, DOCS, DRIVE] })
    const field = await openField(user)

    await user.click(field)
    await user.paste(
      "https://a.example/1 b.example/2\nhttps://www.facebook.com/page/posts/3"
    )
    await user.click(screen.getByRole("button", { name: "Add" }))

    expect(addDeliverableLinksAction).toHaveBeenCalledExactlyOnceWith({
      slotId: SLOT,
      urls: ["https://a.example/1", "https://b.example/2"],
    })
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Added 2 links.")
    )
    expect(field).toHaveValue("")
    expect(field).toHaveFocus()
    expect(
      screen.getByText(
        "1 link didn't fit: facebook.com/…. A slot holds up to 5."
      )
    ).toHaveAttribute("role", "status")
  })

  it("names the failing link when the field holds several, and sends nothing", async () => {
    const user = userEvent.setup()
    mount({ canAdd: true })
    const field = await openField(user)

    await user.type(field, "canva.com/x mailto:a@b")
    await user.click(screen.getByRole("button", { name: "Add" }))

    expect(addDeliverableLinksAction).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent(
      "mailto:a@b: Only web links work here, like https://…"
    )
    expect(field).toHaveFocus()
    expect(field).toHaveAccessibleDescription(/Only web links work here/)
  })

  it("gives the message alone for a single bad link, and clears it as the field is edited", async () => {
    const user = userEvent.setup()
    mount({ canAdd: true })
    const field = await openField(user)

    await user.type(field, "hello")
    await user.click(screen.getByRole("button", { name: "Add" }))
    expect(screen.getByRole("alert")).toHaveTextContent(
      /^This doesn't look like a link\. Copy the full address from your browser\.$/
    )

    await user.type(field, "!")
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it.each([
    [1, "Only 1 more link fits on this slot."],
    [3, "Only 3 more links fit on this slot."],
    [0, "This slot already has 5 links."],
  ])(
    "shows the server's limit (remaining %s) under the field, refreshes and keeps the text",
    async (remaining, message) => {
      const user = userEvent.setup()
      addDeliverableLinksAction.mockResolvedValue({
        ok: false,
        code: "tasks.invalid_links",
        params: { reason: "limit", remaining },
      })
      mount({ canAdd: true })
      const field = await openField(user)

      await user.type(field, "canva.com/x")
      await user.click(screen.getByRole("button", { name: "Add" }))

      expect(await screen.findByRole("alert")).toHaveTextContent(message)
      expect(refresh).toHaveBeenCalled()
      expect(field).toHaveValue("canva.com/x")
      expect(field).toHaveFocus()
      expect(toastSuccess).not.toHaveBeenCalled()
    }
  )

  it("says a link didn't save for a refused list", async () => {
    const user = userEvent.setup()
    addDeliverableLinksAction.mockResolvedValue({
      ok: false,
      code: "tasks.invalid_links",
      params: { reason: "link" },
    })
    mount({ canAdd: true })
    await openField(user)

    await user.keyboard("canva.com/x{Enter}")

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A link didn't save. Check the links and try again."
    )
  })

  it.each([
    ["tasks.not_allowed", "You can't add links to this slot anymore."],
    ["tasks.not_found", "This task or slot is gone."],
  ])(
    "on %s toasts the copy, refreshes, closes the field and focuses the slot row",
    async (code, message) => {
      const user = userEvent.setup()
      addDeliverableLinksAction.mockResolvedValue({ ok: false, code })
      mount({ canAdd: true })
      await openField(user)

      await user.keyboard("canva.com/x{Enter}")

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(message))
      expect(refresh).toHaveBeenCalled()
      expect(screen.queryByRole("textbox")).toBeNull()
      expect(
        document.getElementById(
          code === "tasks.not_found" ? HEADING_ID : ROW_ID
        )
      ).toHaveFocus()
    }
  )

  it("on tasks.not_found focuses the page heading directly", async () => {
    const user = userEvent.setup()
    addDeliverableLinksAction.mockResolvedValue({
      ok: false,
      code: "tasks.not_found",
    })
    mount({ canAdd: true })
    await user.click(screen.getByRole("button", { name: ADD_NAME }))

    await user.keyboard("canva.com/x{Enter}")

    await waitFor(() =>
      expect(document.getElementById(HEADING_ID)).toHaveFocus()
    )
  })

  it("hands focus to the slot row when the focused + Add a link goes with the capability", async () => {
    const { update } = mount({ canAdd: true })
    screen.getByRole("button", { name: ADD_NAME }).focus()

    update({ canAdd: false })

    await waitFor(() => expect(document.getElementById(ROW_ID)).toHaveFocus())
  })

  it("hands focus to the slot row when the focused remove button goes with the capability", async () => {
    const { update } = mount({ links: [CANVA], canRemove: true })
    screen
      .getByRole("button", { name: "Remove Canva link 1 from Layout Artist" })
      .focus()

    update({ canRemove: false })

    await waitFor(() => expect(document.getElementById(ROW_ID)).toHaveFocus())
  })

  it("hands focus to the page heading when the slot row goes with it", async () => {
    const user = userEvent.setup()
    const { rerender } = render(view({ canAdd: true }))
    await user.click(screen.getByRole("button", { name: ADD_NAME }))
    expect(screen.getByRole("textbox")).toHaveFocus()

    // The slot is gone from the refreshed page.
    rerender(
      <main>
        <h1 id={HEADING_ID} tabIndex={-1}>
          Task
        </h1>
      </main>
    )

    await waitFor(() => expect(screen.getByRole("heading")).toHaveFocus())
  })

  it("ignores a second press of Add while the first is saving, and shows a spinner", async () => {
    const user = userEvent.setup()
    let finish: (value: unknown) => void = () => {}
    addDeliverableLinksAction.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    mount({ canAdd: true })
    const field = await openField(user)

    await user.type(field, "canva.com/x")
    const add = screen.getByRole("button", { name: "Add" })
    await user.click(add)
    await user.click(add)

    expect(addDeliverableLinksAction).toHaveBeenCalledTimes(1)
    expect(add).toHaveAttribute("aria-disabled", "true")
    expect(add.querySelector("svg")).not.toBeNull()
    finish({ ok: true, data: { slotId: SLOT, count: 1 } })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
  })

  it("toasts and refreshes when the call itself fails", async () => {
    const user = userEvent.setup()
    addDeliverableLinksAction.mockRejectedValue(new Error("offline"))
    mount({ canAdd: true })
    await openField(user)

    await user.keyboard("canva.com/x{Enter}")

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't save — try again.")
    )
    expect(refresh).toHaveBeenCalled()
  })

  it("keeps an open field and its text through a refresh that takes the add offer away", async () => {
    const user = userEvent.setup()
    const { update } = mount({ canAdd: true })
    const field = await openField(user)
    await user.type(field, "canva.com/half")

    update({ canAdd: false, full: false, links: [CANVA, DOCS] })

    expect(
      screen.getByRole("textbox", { name: "Link for Layout Artist" })
    ).toHaveValue("canva.com/half")
    expect(screen.getByRole("textbox")).toHaveFocus()
    expect(screen.getByRole("link", { name: /Canva/ })).toBeInTheDocument()
  })

  it("sends a live refresh's links in without moving focus", async () => {
    const user = userEvent.setup()
    const { update } = mount({ canAdd: true })
    const field = await openField(user)

    update({ canAdd: true, links: [DOCS] })

    expect(screen.getByText("added by Paolo")).toBeInTheDocument()
    expect(field).toHaveFocus()
  })
})

describe("closing the field", () => {
  it("closes on Cancel without a toast and focuses + Add a link", async () => {
    const user = userEvent.setup()
    mount({ canAdd: true })
    await user.click(screen.getByRole("button", { name: ADD_NAME }))
    await user.keyboard("canva.com/x")

    await user.click(screen.getByRole("button", { name: "Cancel" }))

    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.getByRole("button", { name: ADD_NAME })).toHaveFocus()
    expect(toast).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it("closes on Escape with the key default-prevented, so no toast is dismissed, and starts empty next time", async () => {
    const user = userEvent.setup()
    mount({ canAdd: true })
    await user.click(screen.getByRole("button", { name: ADD_NAME }))
    await user.keyboard("canva.com/x")
    const seen: boolean[] = []
    const record = (event: KeyboardEvent) => seen.push(event.defaultPrevented)
    document.addEventListener("keydown", record)

    await user.keyboard("{Escape}")
    document.removeEventListener("keydown", record)

    expect(seen).toEqual([true])
    expect(screen.getByRole("button", { name: ADD_NAME })).toHaveFocus()
    await user.click(screen.getByRole("button", { name: ADD_NAME }))
    expect(screen.getByRole("textbox")).toHaveValue("")
  })

  it("focuses the slot row when Escape closes a field whose offer is gone", async () => {
    const user = userEvent.setup()
    const { update } = mount({ canAdd: true })
    await user.click(screen.getByRole("button", { name: ADD_NAME }))
    update({ canAdd: false })

    await user.keyboard("{Escape}")

    expect(document.getElementById(ROW_ID)).toHaveFocus()
  })
})

describe("removing", () => {
  async function askToRemove(
    user: ReturnType<typeof userEvent.setup>,
    name: string
  ) {
    const button = screen.getByRole("button", { name })
    await user.click(button)
    return { button, dialog: await screen.findByRole("alertdialog") }
  }

  it("asks first, with the site, address and role, and Keep link primary and focused", async () => {
    const user = userEvent.setup()
    mount({ links: [CANVA, DOCS], canRemove: true })

    const { dialog } = await askToRemove(
      user,
      "Remove Canva link 1 from Layout Artist"
    )

    expect(
      within(dialog).getByRole("heading", { name: "Remove this link?" })
    ).toBeInTheDocument()
    expect(dialog).toHaveTextContent(
      "Canva (https://www.canva.com/design/DAF1/edit) will be removed from Layout Artist. This can't be undone."
    )
    expect(
      within(dialog).getByRole("button", { name: "Keep link" })
    ).toHaveFocus()
    expect(removeDeliverableLinkAction).not.toHaveBeenCalled()
  })

  it("returns focus to the remove button on Keep link and on Escape", async () => {
    const user = userEvent.setup()
    mount({ links: [CANVA, DOCS], canRemove: true })
    const name = "Remove Canva link 1 from Layout Artist"

    const { button } = await askToRemove(user, name)
    await user.click(screen.getByRole("button", { name: "Keep link" }))
    await waitFor(() => expect(button).toHaveFocus())

    await askToRemove(user, name)
    await user.keyboard("{Escape}")
    await waitFor(() => expect(button).toHaveFocus())
    expect(removeDeliverableLinkAction).not.toHaveBeenCalled()
  })

  it("removes on confirm, toasts, and focuses the next remove button once the link is gone", async () => {
    const user = userEvent.setup()
    removeDeliverableLinkAction.mockResolvedValue({
      ok: true,
      data: { removed: true },
    })
    const { update } = mount({ links: [CANVA, DOCS, DRIVE], canRemove: true })
    await askToRemove(user, "Remove Canva link 1 from Layout Artist")

    await user.click(screen.getByRole("button", { name: "Remove link" }))

    expect(removeDeliverableLinkAction).toHaveBeenCalledExactlyOnceWith({
      linkId: CANVA.id,
    })
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Link removed.")
    )
    update({ links: [DOCS, DRIVE] })
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Remove Google Docs link 1 from Layout Artist",
        })
      ).toHaveFocus()
    )
  })

  it("focuses the previous remove button when the last link goes", async () => {
    const user = userEvent.setup()
    removeDeliverableLinkAction.mockResolvedValue({
      ok: true,
      data: { removed: true },
    })
    const { update } = mount({ links: [CANVA, DOCS], canRemove: true })
    await askToRemove(user, "Remove Google Docs link 2 from Layout Artist")

    await user.click(screen.getByRole("button", { name: "Remove link" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    update({ links: [CANVA] })

    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Remove Canva link 1 from Layout Artist",
        })
      ).toHaveFocus()
    )
  })

  it("focuses + Add a link when the only link goes, for the holder", async () => {
    const user = userEvent.setup()
    removeDeliverableLinkAction.mockResolvedValue({
      ok: true,
      data: { removed: true },
    })
    const { update } = mount({
      links: [CANVA],
      canRemove: true,
      canAdd: true,
    })
    await askToRemove(user, "Remove Canva link 1 from Layout Artist")

    await user.click(screen.getByRole("button", { name: "Remove link" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    update({ links: [] })

    await waitFor(() =>
      expect(screen.getByRole("button", { name: ADD_NAME })).toHaveFocus()
    )
  })

  it("focuses the slot row when the only link goes and nothing can add (the approver)", async () => {
    const user = userEvent.setup()
    removeDeliverableLinkAction.mockResolvedValue({
      ok: true,
      data: { removed: true },
    })
    const { update } = mount({ links: [CANVA], canRemove: true })
    await askToRemove(user, "Remove Canva link 1 from Layout Artist")

    await user.click(screen.getByRole("button", { name: "Remove link" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    update({ links: [] })

    await waitFor(() => expect(document.getElementById(ROW_ID)).toHaveFocus())
  })

  it("says so when the link was already removed, and focuses as for a removal", async () => {
    const user = userEvent.setup()
    removeDeliverableLinkAction.mockResolvedValue({
      ok: true,
      data: { removed: false },
    })
    const { update } = mount({ links: [CANVA, DOCS], canRemove: true })
    await askToRemove(user, "Remove Canva link 1 from Layout Artist")

    await user.click(screen.getByRole("button", { name: "Remove link" }))

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith("That link was already removed.")
    )
    expect(toastSuccess).not.toHaveBeenCalled()
    update({ links: [DOCS] })
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Remove Google Docs link 1 from Layout Artist",
        })
      ).toHaveFocus()
    )
  })

  it("toasts, closes and refreshes when the member may no longer remove it", async () => {
    const user = userEvent.setup()
    removeDeliverableLinkAction.mockResolvedValue({
      ok: false,
      code: "tasks.not_allowed",
    })
    mount({ links: [CANVA], canRemove: true })
    await askToRemove(user, "Remove Canva link 1 from Layout Artist")

    await user.click(screen.getByRole("button", { name: "Remove link" }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "You can't remove this link anymore."
      )
    )
    expect(refresh).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("hands focus to the slot row when a live refresh removes the focused row", async () => {
    const user = userEvent.setup()
    const { update } = mount({ links: [CANVA, DOCS] })
    const link = screen.getByRole("link", { name: /Google Docs/ })
    link.focus()
    expect(link).toHaveFocus()

    update({ links: [CANVA] })

    await waitFor(() => expect(document.getElementById(ROW_ID)).toHaveFocus())
    void user
  })
})
