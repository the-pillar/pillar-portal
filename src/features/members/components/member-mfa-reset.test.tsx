// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MemberMfaReset } from "./member-mfa-reset"

const { resetMemberMfaAction, refresh, toastError, toastSuccess } = vi.hoisted(
  () => ({
    resetMemberMfaAction: vi.fn(),
    refresh: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
  })
)

vi.mock("../actions", () => ({ resetMemberMfaAction }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("@/components/ui/toast", () => ({
  toast: { error: toastError, success: toastSuccess },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const ID = "00000000-0000-4000-8000-000000000091"
const MEMBER = { id: ID, name: "Head Layout Artist", canResetMfa: true }

function renderReset(member = MEMBER) {
  return render(
    <>
      <h2 id="roster-heading" tabIndex={-1}>
        Active members
      </h2>
      <MemberMfaReset member={member} focusTargetId="roster-heading" />
    </>
  )
}

describe("MemberMfaReset", () => {
  it("offers nothing when canResetMfa is false", () => {
    renderReset({ ...MEMBER, canResetMfa: false })

    expect(screen.queryByRole("button")).toBeNull()
  })

  it("confirms with the copy, then resets, toasts and moves focus to the heading", async () => {
    resetMemberMfaAction.mockResolvedValue({ ok: true, data: { memberId: ID } })
    const user = userEvent.setup()
    renderReset()

    const button = screen.getByRole("button", {
      name: "Reset two-factor for Head Layout Artist",
    })
    expect(button).toHaveClass("min-h-11")
    await user.click(button)

    const dialog = screen.getByRole("alertdialog", {
      name: "Reset Head Layout Artist's two-factor?",
    })
    expect(dialog).toHaveTextContent(
      "They'll set it up again the next time it's needed."
    )
    expect(resetMemberMfaAction).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Reset two-factor" }))

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "Head Layout Artist's two-factor was reset."
      )
    )
    expect(resetMemberMfaAction).toHaveBeenCalledExactlyOnceWith({
      memberId: ID,
    })
    expect(document.activeElement).toBe(screen.getByRole("heading"))
  })

  it("makes no call when the confirmation is cancelled", async () => {
    const user = userEvent.setup()
    renderReset()

    await user.click(
      screen.getByRole("button", {
        name: "Reset two-factor for Head Layout Artist",
      })
    )
    await user.click(screen.getByRole("button", { name: "Cancel" }))

    expect(resetMemberMfaAction).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it("toasts the stale copy and re-reads when the member changed", async () => {
    resetMemberMfaAction.mockResolvedValue({
      ok: false,
      code: "members.stale",
    })
    const user = userEvent.setup()
    renderReset()

    await user.click(
      screen.getByRole("button", {
        name: "Reset two-factor for Head Layout Artist",
      })
    )
    await user.click(screen.getByRole("button", { name: "Reset two-factor" }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Something changed since you opened this. Review the latest and try again."
      )
    )
    expect(refresh).toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByRole("heading"))
  })
})
