// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MemberDeactivate } from "./member-deactivate"

const { deactivateMemberAction, refresh, toastError, toastSuccess } =
  vi.hoisted(() => ({
    deactivateMemberAction: vi.fn(),
    refresh: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
  }))

vi.mock("../actions", () => ({ deactivateMemberAction }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("@/components/ui/toast", () => ({
  toast: { error: toastError, success: toastSuccess },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const ID = "00000000-0000-4000-8000-000000000092"
const MEMBER = {
  id: ID,
  name: "Staff Writer",
  canDeactivate: true,
  deactivateBlockedBy: null,
} as const

function renderDeactivate(
  member: Parameters<typeof MemberDeactivate>[0]["member"] = MEMBER
) {
  return render(
    <>
      <h2 id="roster-heading" tabIndex={-1}>
        Active members
      </h2>
      <MemberDeactivate member={member} focusTargetId="roster-heading" />
    </>
  )
}

describe("MemberDeactivate", () => {
  it("offers nothing when canDeactivate is false", () => {
    renderDeactivate({ ...MEMBER, canDeactivate: false })

    expect(screen.queryByRole("button")).toBeNull()
  })

  it("confirms with the copy, then deactivates, toasts and moves focus to the heading", async () => {
    deactivateMemberAction.mockResolvedValue({
      ok: true,
      data: { memberId: ID },
    })
    const user = userEvent.setup()
    renderDeactivate()

    const button = screen.getByRole("button", {
      name: "Deactivate Staff Writer",
    })
    expect(button).toHaveClass("min-h-11")
    await user.click(button)

    const dialog = screen.getByRole("alertdialog", {
      name: "Deactivate Staff Writer?",
    })
    expect(dialog).toHaveTextContent(
      "They lose access right away, and their open slots move to Needs reassignment."
    )
    expect(deactivateMemberAction).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Deactivate" }))

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Staff Writer deactivated.")
    )
    expect(deactivateMemberAction).toHaveBeenCalledExactlyOnceWith({
      memberId: ID,
    })
    expect(document.activeElement).toBe(screen.getByRole("heading"))
  })

  it("shows a refused command's copy and keeps focus on the heading", async () => {
    deactivateMemberAction.mockResolvedValue({
      ok: false,
      code: "members.last_admin",
    })
    const user = userEvent.setup()
    renderDeactivate()

    await user.click(
      screen.getByRole("button", { name: "Deactivate Staff Writer" })
    )
    await user.click(screen.getByRole("button", { name: "Deactivate" }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "You can't demote or deactivate the last Editorial Board admin."
      )
    )
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it.each([
    [
      "members.sole_editor_in_chief",
      "Transfer Editor-in-Chief to someone else first.",
    ],
    [
      "members.last_admin",
      "You can't demote or deactivate the last Editorial Board admin.",
    ],
  ] as const)(
    "disables itself with the %s line as visible text",
    async (code, line) => {
      const user = userEvent.setup()
      renderDeactivate({ ...MEMBER, deactivateBlockedBy: code })

      const button = screen.getByRole("button", {
        name: "Deactivate Staff Writer",
      })
      expect(button).toHaveAttribute("aria-disabled", "true")
      expect(button).toHaveAccessibleDescription(line)
      expect(screen.getByText(line)).toBeVisible()

      await user.click(button)

      expect(screen.queryByRole("alertdialog")).toBeNull()
      expect(deactivateMemberAction).not.toHaveBeenCalled()
    }
  )
})
