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

import type { MemberApprovalsData } from "../queries"
import { MemberApprovals } from "./member-approvals"
import { MemberApprovalsSkeleton } from "./member-approvals-skeleton"

const { approveMemberAction } = vi.hoisted(() => ({
  approveMemberAction: vi.fn(),
}))

vi.mock("../actions", () => ({
  approveMemberAction,
  declineMemberAction: vi.fn(),
  renameMemberAction: vi.fn(),
  resetMemberMfaAction: vi.fn(),
  updateMemberAction: vi.fn(),
  deactivateMemberAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/components/ui/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

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

const ROSTER: MemberApprovalsData["roster"] = [
  {
    id: "00000000-0000-4000-8000-000000000061",
    name: "Head Layout Artist",
    email: "persona-head_layout_artist@example.com",
    positionTitles: ["Head Layout Artist"],
    googleName: null,
    canRename: true,
    canResetMfa: true,
    heldPositions: [
      {
        id: "head_layout_artist",
        title: "Head Layout Artist",
        isPrimary: true,
      },
    ],
    canChangePositions: true,
    canDeactivate: true,
    deactivateBlockedBy: null,
  },
  {
    id: "00000000-0000-4000-8000-000000000062",
    name: "News Editor and Online Manager",
    email: "demo-news_editor@example.com",
    positionTitles: ["News Editor", "Online Manager"],
    googleName: "NEWS EDITOR",
    canRename: false,
    canResetMfa: false,
    heldPositions: [
      { id: "news_editor", title: "News Editor", isPrimary: true },
      { id: "online_manager", title: "Online Manager", isPrimary: false },
    ],
    canChangePositions: false,
    canDeactivate: false,
    deactivateBlockedBy: null,
  },
]

const POSITION_GROUPS: MemberApprovalsData["positionGroups"] = [
  {
    id: "staff",
    label: "Staff",
    positions: [{ id: "staff_writer", title: "Staff Writer" }],
  },
]

const PENDING: MemberApprovalsData["pending"] = [
  {
    id: "00000000-0000-4000-8000-000000000071",
    name: "Ana Reyes",
    email: "ana.reyes@gmail.com",
    signedInAt: "2026-10-19T01:05:00+00:00",
    signedInLabel: "Mon, Oct 19, 2026 at 9:05 AM PHT",
    lookAlikeName: null,
    googleName: null,
    canRename: true,
  },
  {
    id: "00000000-0000-4000-8000-000000000072",
    name: "Ben Cruz",
    email: "ben.cruz@gmail.com",
    signedInAt: "2026-10-20T01:05:00+00:00",
    signedInLabel: "Tue, Oct 20, 2026 at 9:05 AM PHT",
    lookAlikeName: null,
    googleName: null,
    canRename: true,
  },
]

describe("MemberApprovals", () => {
  it("offers Edit name only on the rows whose canRename is true", () => {
    render(
      <MemberApprovals
        approvals={{
          pending: PENDING,
          roster: ROSTER,
          positionGroups: POSITION_GROUPS,
        }}
      />
    )

    expect(
      screen
        .getAllByRole("button", { name: /^Edit name for / })
        .map((button) => button.getAttribute("aria-label"))
    ).toEqual([
      "Edit name for Ana Reyes",
      "Edit name for Ben Cruz",
      "Edit name for Head Layout Artist",
    ])
  })

  it("says nobody is waiting when the list is empty, and still shows the roster", async () => {
    const { container } = render(
      <MemberApprovals
        approvals={{
          pending: [],
          roster: ROSTER,
          positionGroups: POSITION_GROUPS,
        }}
      />
    )

    const awaiting = screen.getByRole("region", { name: "Awaiting approval" })
    expect(awaiting).toHaveTextContent("No one is waiting for approval.")
    expect(within(awaiting).queryByRole("list")).toBeNull()
    expect(
      screen.getByRole("region", { name: "Active members" })
    ).toBeInTheDocument()
    expect(await axeViolations(container)).toEqual([])
  })

  it("lists the pending members in the order given, under a focusable heading", async () => {
    const { container } = render(
      <MemberApprovals
        approvals={{
          pending: PENDING,
          roster: ROSTER,
          positionGroups: POSITION_GROUPS,
        }}
      />
    )

    const awaiting = screen.getByRole("region", { name: "Awaiting approval" })
    expect(
      within(awaiting)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent)
    ).toEqual(["Ana Reyes", "Ben Cruz"])
    expect(
      screen.getByRole("heading", { level: 2, name: "Awaiting approval" })
    ).toHaveAttribute("tabindex", "-1")
    expect(awaiting).not.toHaveTextContent("No one is waiting for approval.")
    expect(await axeViolations(container)).toEqual([])
  })

  it.each(PENDING.map((member) => [member.name, member] as const))(
    "gives %s's card the Awaiting approval heading as its focus target",
    async (name, member) => {
      const user = userEvent.setup()
      approveMemberAction.mockResolvedValue({
        ok: true,
        data: { memberId: member.id },
      })
      render(
        <MemberApprovals
          approvals={{
            pending: PENDING,
            roster: ROSTER,
            positionGroups: POSITION_GROUPS,
          }}
        />
      )

      await user.click(
        screen.getByRole("button", { name: `Pick positions, ${name}` })
      )
      const card = screen
        .getByRole("heading", { level: 3, name })
        .closest("li")!
      await user.click(
        within(card).getByRole("checkbox", { name: "Staff Writer" })
      )
      await user.click(screen.getByRole("button", { name: `Approve, ${name}` }))

      await waitFor(() =>
        expect(
          screen.getByRole("heading", { level: 2, name: "Awaiting approval" })
        ).toHaveFocus()
      )
      expect(approveMemberAction).toHaveBeenCalledExactlyOnceWith({
        memberId: member.id,
        positions: ["staff_writer"],
        primaryPosition: "staff_writer",
      })
    }
  )

  it("shows each active member's name, email and positions, with Edit name only where offered", () => {
    render(
      <MemberApprovals
        approvals={{
          pending: [],
          roster: ROSTER,
          positionGroups: POSITION_GROUPS,
        }}
      />
    )

    const rows = within(
      screen.getByRole("region", { name: "Active members" })
    ).getAllByRole("listitem")
    expect(rows.map((row) => row.textContent)).toEqual([
      "Head Layout ArtistEdit namepersona-head_layout_artist@example.comHead Layout ArtistChange positionsReset two-factorDeactivate",
      "News Editor and Online Managerdemo-news_editor@example.comNews Editor · Online Manager",
    ])
    expect(
      within(screen.getByRole("region", { name: "Active members" }))
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"))
    ).toEqual([
      "Edit name for Head Layout Artist",
      "Change positions for Head Layout Artist",
      "Reset two-factor for Head Layout Artist",
      "Deactivate Head Layout Artist",
    ])
  })
})

describe("MemberApprovalsSkeleton", () => {
  it("is a status with a loading label", async () => {
    const { container } = render(<MemberApprovalsSkeleton />)

    expect(screen.getByRole("status")).toHaveTextContent("Loading members")
    expect(await axeViolations(container)).toEqual([])
  })
})
