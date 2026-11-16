// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { PositionGroup } from "../position-groups"
import { MemberPositionEditor } from "./member-position-editor"

const { updateMemberAction, refresh, toastError, toastSuccess } = vi.hoisted(
  () => ({
    updateMemberAction: vi.fn(),
    refresh: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
  })
)

vi.mock("../actions", () => ({ updateMemberAction }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const ID = "00000000-0000-4000-8000-000000000093"
const GROUPS: PositionGroup[] = [
  {
    id: "staff",
    label: "Staff",
    positions: [
      { id: "staff_layout_artist", title: "Staff Layout Artist" },
      { id: "staff_writer", title: "Staff Writer" },
    ],
  },
  {
    id: "heads",
    label: "Heads",
    positions: [{ id: "head_layout_artist", title: "Head Layout Artist" }],
  },
]
const MEMBER = {
  id: ID,
  name: "Head Layout Artist",
  heldPositions: [
    { id: "head_layout_artist", title: "Head Layout Artist", isPrimary: true },
  ],
  canChangePositions: true,
}

describe("MemberPositionEditor", () => {
  it("offers nothing when canChangePositions is false", () => {
    render(
      <MemberPositionEditor
        member={{ ...MEMBER, canChangePositions: false }}
        positionGroups={GROUPS}
        focusTargetId="roster-heading"
      />
    )

    expect(screen.queryByRole("button")).toBeNull()
  })

  it("opens the picker filled with the held positions and saves the new set", async () => {
    updateMemberAction.mockResolvedValue({ ok: true, data: { memberId: ID } })
    const user = userEvent.setup()
    render(
      <MemberPositionEditor
        member={MEMBER}
        positionGroups={GROUPS}
        focusTargetId="roster-heading"
      />
    )

    await user.click(
      screen.getByRole("button", {
        name: "Change positions for Head Layout Artist",
      })
    )

    expect(
      screen.getByRole("checkbox", { name: "Head Layout Artist" })
    ).toBeChecked()
    expect(
      screen.getByRole("checkbox", { name: "Staff Layout Artist" })
    ).not.toBeChecked()

    await user.click(
      screen.getByRole("checkbox", { name: "Head Layout Artist" })
    )
    await user.click(
      screen.getByRole("checkbox", { name: "Staff Layout Artist" })
    )
    await user.click(screen.getByRole("button", { name: /^Save/ }))

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Positions updated.")
    )
    expect(updateMemberAction).toHaveBeenCalledExactlyOnceWith({
      memberId: ID,
      positions: ["staff_layout_artist"],
      primaryPosition: "staff_layout_artist",
    })
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("keeps a held Editor-in-Chief checked and fixed, and sends it back", async () => {
    updateMemberAction.mockResolvedValue({ ok: true, data: { memberId: ID } })
    const user = userEvent.setup()
    render(
      <MemberPositionEditor
        member={{
          ...MEMBER,
          heldPositions: [
            {
              id: "editor_in_chief",
              title: "Editor-in-Chief",
              isPrimary: true,
            },
            { id: "staff_writer", title: "Staff Writer", isPrimary: false },
          ],
        }}
        positionGroups={GROUPS}
        focusTargetId="roster-heading"
      />
    )

    await user.click(screen.getByRole("button", { name: /^Change positions/ }))

    const eic = screen.getByRole("checkbox", { name: "Editor-in-Chief" })
    expect(eic).toBeChecked()
    expect(eic).toHaveAttribute("aria-disabled", "true")
    expect(eic).toHaveAccessibleDescription("Moves only by transfer")

    await user.click(screen.getByRole("button", { name: /^Save/ }))

    await waitFor(() => expect(updateMemberAction).toHaveBeenCalled())
    expect(updateMemberAction).toHaveBeenCalledWith({
      memberId: ID,
      positions: ["staff_writer", "editor_in_chief"],
      primaryPosition: "editor_in_chief",
    })
  })

  it("keeps the picker open and toasts the copy when the command is refused", async () => {
    updateMemberAction.mockResolvedValue({
      ok: false,
      code: "members.save_failed",
    })
    const user = userEvent.setup()
    render(
      <>
        <h2 id="roster-heading" tabIndex={-1}>
          Active members
        </h2>
        <MemberPositionEditor
          member={MEMBER}
          positionGroups={GROUPS}
          focusTargetId="roster-heading"
        />
      </>
    )

    await user.click(screen.getByRole("button", { name: /^Change positions/ }))
    await user.click(screen.getByRole("button", { name: /^Save/ }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't save — try again.")
    )
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0)
    expect(document.activeElement).toBe(screen.getByRole("heading"))
  })
})
