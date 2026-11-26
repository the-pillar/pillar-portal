// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

const { success } = vi.hoisted(() => ({ success: vi.fn() }))
vi.mock("@/components/ui/toast", () => ({ toast: { success } }))

import { CopyForMessenger } from "./copy-for-messenger"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

const MESSAGE = "📌 T — Writer · due Fri, Oct 16, 5:00 PM\nhttps://x.test/y"

describe("CopyForMessenger", () => {
  it("copies and toasts, with no text box", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup({ writeToClipboard: false })
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    render(<CopyForMessenger message={MESSAGE} />)
    await user.click(screen.getByRole("button", { name: "Copy for Messenger" }))
    expect(writeText).toHaveBeenCalledWith(MESSAGE)
    expect(success).toHaveBeenCalledWith("Copied — paste it in Messenger.")
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  })

  it("shrugs off a rejecting onCopied: the toast still shows (vitest fails the run on an unhandled rejection)", async () => {
    const user = userEvent.setup({ writeToClipboard: false })
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    render(
      <CopyForMessenger
        message={MESSAGE}
        onCopied={() => Promise.reject(new Error("network"))}
      />
    )
    await user.click(screen.getByRole("button", { name: "Copy for Messenger" }))
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(success).toHaveBeenCalledWith("Copied — paste it in Messenger.")
  })

  it("calls onCopied after a copy that worked, and not after one that did not", async () => {
    const onCopied = vi.fn()
    const user = userEvent.setup({ writeToClipboard: false })
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    render(<CopyForMessenger message={MESSAGE} onCopied={onCopied} />)
    await user.click(screen.getByRole("button", { name: "Copy for Messenger" }))
    expect(onCopied).toHaveBeenCalledOnce()

    cleanup()
    onCopied.mockClear()
    vi.stubGlobal("navigator", {})
    render(<CopyForMessenger message={MESSAGE} onCopied={onCopied} />)
    await user.click(screen.getByRole("button", { name: "Copy for Messenger" }))
    expect(onCopied).not.toHaveBeenCalled()
  })

  it.each([
    ["no clipboard", {}],
    [
      "a refused write",
      { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) } },
    ],
  ])("shows a selected text box on %s", async (_name, nav) => {
    const user = userEvent.setup({ writeToClipboard: false })
    vi.stubGlobal("navigator", nav)
    render(<CopyForMessenger message={MESSAGE} />)
    await user.click(screen.getByRole("button", { name: "Copy for Messenger" }))
    const box = screen.getByRole("textbox", { name: "Message to copy" })
    expect(box).toHaveValue(MESSAGE)
    expect(box).toHaveFocus()
    expect((box as HTMLTextAreaElement).selectionEnd).toBe(MESSAGE.length)
    expect(
      screen.getByText("Copy this and paste it in Messenger.")
    ).toBeInTheDocument()
    expect(success).not.toHaveBeenCalled()
    const { violations } = await axe.run(document.body, {
      rules: {
        "color-contrast": { enabled: false },
        region: { enabled: false },
      },
    })
    expect(violations).toEqual([])
  })
})
