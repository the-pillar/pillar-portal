// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { TaskFormOptions } from "../queries/task-form"
import { TaskForm } from "./task-form"

const { createTaskAction, updateTaskAction } = vi.hoisted(() => ({
  createTaskAction: vi.fn(),
  updateTaskAction: vi.fn(),
}))

vi.mock("../actions", () => ({ createTaskAction, updateTaskAction }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("@/components/ui/toast", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    notice: vi.fn(),
  }),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

const OPTIONS: TaskFormOptions = {
  owners: [{ kind: "section", id: "news", name: "News" }],
  slotMembersByRole: {},
  allMembers: [],
  roleLabels: {
    writer: "Writer",
    layout_artist: "Layout Artist",
    cartoonist: "Cartoonist",
    photojournalist: "Photojournalist",
    broadcast_journalist: "Broadcast Journalist",
    videojournalist: "Videojournalist",
  },
}

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const row = (n: number) =>
  screen.getByLabelText(`Reference link ${n}`) as HTMLInputElement
const rowValues = () =>
  (screen.getAllByLabelText(/^Reference link \d$/) as HTMLInputElement[]).map(
    (input) => input.value
  )
const addButton = () => screen.getByRole("button", { name: "Add a link" })

function paste(input: HTMLElement, text: string) {
  fireEvent.paste(input, { clipboardData: { getData: () => text } })
}

function setValue(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } })
}

const SEVEN = [
  "https://drive.google.com/drive/folders/1",
  "https://www.canva.com/design/2",
  "https://facebook.com/3",
  "https://tiktok.com/4",
  "https://t.me/5",
  "https://instagram.com/p/6",
  "https://youtu.be/7",
]

describe("the Reference links field", () => {
  it("is a fieldset with its legend, optional mark and helper tied to the inputs", () => {
    render(<TaskForm options={OPTIONS} />)

    const group = screen.getByRole("group", { name: /^Reference links/ })
    expect(group).toHaveTextContent("(optional)")
    const helper = screen.getByText(
      "Links to the brief, photos or drafts. Up to 5."
    )
    expect(row(1)).toHaveAttribute("aria-describedby", helper.id)
    expect(row(1)).toHaveAttribute("placeholder", "Paste a link")
    expect(row(1)).toHaveAttribute("inputmode", "url")
    expect(row(1)).toHaveAttribute("autocapitalize", "none")
    expect(row(1)).toHaveAttribute("autocorrect", "off")
    expect(row(1)).toHaveAttribute("spellcheck", "false")
    expect(
      screen.getByRole("button", { name: "Remove reference link 1" })
    ).toBeInTheDocument()
  })

  it("splits seven pasted links into five rows, announces it and names the two left out", () => {
    render(<TaskForm options={OPTIONS} />)

    paste(row(1), SEVEN.join("\n"))

    expect(rowValues()).toEqual(SEVEN.slice(0, 5))
    expect(screen.getByText("Added 5 links.")).toBeInTheDocument()
    const note = screen.getByText(
      "2 links didn't fit: instagram.com/…, youtu.be/…. A task holds up to 5."
    )
    expect(note).toHaveAttribute("role", "status")
    expect(screen.getByText("5 of 5 links")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add a link" })).toBeNull()
  })

  it("fills the empty rows below the pasted one and never overwrites a filled row", async () => {
    const user = userEvent.setup()
    render(<TaskForm options={OPTIONS} />)
    for (let i = 0; i < 3; i += 1) await user.click(addButton())
    await user.type(row(1), "https://a.com/1")
    await user.type(row(2), "https://a.com/2")
    await user.type(row(4), "https://a.com/4")

    paste(row(3), "https://b.com/1 https://b.com/2 https://b.com/3")

    expect(rowValues()).toEqual([
      "https://a.com/1",
      "https://a.com/2",
      "https://b.com/1",
      "https://a.com/4",
      "https://b.com/2",
    ])
    expect(screen.getByText("Added 2 links.")).toBeInTheDocument()
    expect(
      screen.getByText("1 link didn't fit: b.com/…. A task holds up to 5.")
    ).toBeInTheDocument()
  })

  it("leaves a paste of one link to the browser", () => {
    render(<TaskForm options={OPTIONS} />)

    const notPrevented = fireEvent.paste(row(1), {
      clipboardData: { getData: () => "https://a.com/1" },
    })

    expect(notPrevented).toBe(true)
    expect(screen.queryByText(/^Added/)).toBeNull()
  })

  it("splits again on blur, for voice input and keyboard chips that send no paste", async () => {
    const user = userEvent.setup()
    render(<TaskForm options={OPTIONS} />)

    await user.click(row(1))
    setValue(row(1), "canva.com/x  drive.google.com/y")
    await user.tab()

    expect(rowValues()).toEqual([
      "https://canva.com/x",
      "https://drive.google.com/y",
    ])
    expect(screen.getByText("Added 2 links.")).toBeInTheDocument()
  })

  it("cleans a link typed without https:// on blur and shows its site name", async () => {
    const user = userEvent.setup()
    render(<TaskForm options={OPTIONS} />)

    await user.type(row(1), "canva.com/x")
    await user.tab()

    expect(row(1)).toHaveValue("https://canva.com/x")
    expect(
      within(screen.getByRole("group", { name: /^Reference links/ })).getByText(
        "Canva"
      )
    ).toBeInTheDocument()
  })

  it("lowercases an uppercase scheme on blur", async () => {
    const user = userEvent.setup()
    render(<TaskForm options={OPTIONS} />)

    await user.type(row(1), "HTTPS://Drive.google.com/x")
    await user.tab()

    expect(row(1)).toHaveValue("https://Drive.google.com/x")
  })

  it.each([
    ["mailto:a@b", "Only web links work here, like https://…"],
    ["ftp://x", "Only web links work here, like https://…"],
    [
      "hello",
      "This doesn't look like a link. Copy the full address from your browser.",
    ],
    [
      "https://localhost",
      "This doesn't look like a link. Copy the full address from your browser.",
    ],
    [
      `https://a.com/${"a".repeat(2049)}`,
      "This link is too long. Use the site's Share button to get a shorter one.",
    ],
    [
      `https://a.com/${String.fromCharCode(0x200b)}`,
      "This link has a space in it. Paste it again from the address bar.",
    ],
  ])(
    "shows %s as a per-row error tied to the input on blur",
    async (link, message) => {
      const user = userEvent.setup()
      render(<TaskForm options={OPTIONS} />)

      await user.click(row(1))
      setValue(row(1), link)
      await user.tab()

      const error = await screen.findByText(message)
      expect(row(1)).toHaveAttribute("aria-invalid", "true")
      expect(row(1).getAttribute("aria-describedby")).toContain(error.id)
    }
  )

  it("clears a row's error the moment it is fixed", async () => {
    const user = userEvent.setup()
    render(<TaskForm options={OPTIONS} />)

    await user.type(row(1), "hello")
    await user.tab()
    await screen.findByText(/This doesn't look like a link/)

    await user.type(row(1), ".com")
    await waitFor(() =>
      expect(screen.queryByText(/This doesn't look like a link/)).toBeNull()
    )
    expect(row(1)).not.toHaveAttribute("aria-invalid", "true")
  })

  it("adds an empty row and moves focus to it, up to five", async () => {
    const user = userEvent.setup()
    render(<TaskForm options={OPTIONS} />)

    await user.click(addButton())
    expect(row(2)).toHaveFocus()
    for (let i = 0; i < 3; i += 1) await user.click(addButton())
    expect(rowValues()).toHaveLength(5)
    expect(screen.getByText("5 of 5 links")).toBeInTheDocument()
  })

  it("moves focus to the next row's input on remove, else the previous, else Add a link", async () => {
    const user = userEvent.setup()
    render(<TaskForm options={OPTIONS} />)
    await user.click(addButton())
    await user.click(addButton())
    await user.type(row(1), "https://a.com/1")
    await user.type(row(2), "https://a.com/2")
    await user.type(row(3), "https://a.com/3")

    await user.click(
      screen.getByRole("button", { name: "Remove reference link 2" })
    )
    expect(rowValues()).toEqual(["https://a.com/1", "https://a.com/3"])
    expect(row(2)).toHaveFocus()

    await user.click(
      screen.getByRole("button", { name: "Remove reference link 2" })
    )
    expect(row(1)).toHaveFocus()

    await user.click(
      screen.getByRole("button", { name: "Remove reference link 1" })
    )
    expect(addButton()).toHaveFocus()
  })

  it("keeps each error with its own link when a row is removed", async () => {
    const user = userEvent.setup()
    render(<TaskForm options={OPTIONS} />)
    await user.click(addButton())
    await user.click(addButton())
    await user.type(row(1), "https://a.com/1")
    await user.tab()
    await user.type(row(2), "hello")
    await user.tab()
    await user.type(row(3), "https://a.com/3")
    await user.tab()
    await screen.findByText(/This doesn't look like a link/)

    // Remove a row above the errored one: the error moves up with its link.
    await user.click(
      screen.getByRole("button", { name: "Remove reference link 1" })
    )
    await waitFor(() => expect(row(1)).toHaveAttribute("aria-invalid", "true"))
    expect(row(1)).toHaveValue("hello")
    expect(row(2)).not.toHaveAttribute("aria-invalid", "true")

    // Remove the errored row: no error is left on the valid one.
    await user.click(
      screen.getByRole("button", { name: "Remove reference link 1" })
    )
    expect(rowValues()).toEqual(["https://a.com/3"])
    await waitFor(() =>
      expect(row(1)).not.toHaveAttribute("aria-invalid", "true")
    )
    expect(screen.queryByText(/This doesn't look like a link/)).toBeNull()
  })

  it("clears the didn't-fit note when a row is removed or added", async () => {
    const user = userEvent.setup()
    render(<TaskForm options={OPTIONS} />)
    paste(row(1), SEVEN.join(" "))
    expect(screen.getByText(/didn't fit/)).toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "Remove reference link 5" })
    )
    expect(screen.queryByText(/didn't fit/)).toBeNull()
    expect(row(1).getAttribute("aria-describedby")).not.toContain("note")
  })

  it("has no axe violations, empty, filled and with errors", async () => {
    const user = userEvent.setup()
    const { container } = render(<TaskForm options={OPTIONS} />)
    const run = async () =>
      (
        await axe.run(container, {
          rules: { "color-contrast": { enabled: false } },
        })
      ).violations

    expect(await run()).toEqual([])
    paste(row(1), SEVEN.join(" "))
    expect(await run()).toEqual([])
    setValue(row(2), "hello")
    await user.click(row(2))
    await user.tab()
    await screen.findByText(/This doesn't look like a link/)
    expect(await run()).toEqual([])
  })
})
