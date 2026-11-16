import { Suspense } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const {
  requireActiveMember,
  MemberShell,
  NoticeToast,
  OfflineToast,
  getNewTaskLayoutData,
  NewTaskButton,
  NewTaskSheet,
  SharedSessionWatcher,
  RedirectError,
} = vi.hoisted(() => {
  // Like Next's redirect(), which requireActiveMember calls, the mock throws.
  class RedirectError extends Error {
    constructor(readonly url: string) {
      super(`NEXT_REDIRECT ${url}`)
    }
  }
  return {
    requireActiveMember: vi.fn(),
    MemberShell: vi.fn(() => null),
    NoticeToast: vi.fn(() => null),
    OfflineToast: vi.fn(() => null),
    getNewTaskLayoutData: vi.fn(),
    NewTaskButton: vi.fn(() => null),
    NewTaskSheet: vi.fn(() => null),
    SharedSessionWatcher: vi.fn(() => null),
    RedirectError,
  }
})

// requireActiveMember's own tests (queries.test.ts) cover who it redirects.
vi.mock("@/features/members", () => ({
  requireActiveMember,
  SharedSessionWatcher,
}))
vi.mock("@/features/tasks", () => ({
  getNewTaskLayoutData,
  NewTaskButton,
  NewTaskSheet,
}))
vi.mock("./member-shell", () => ({ MemberShell }))
// notice-toast.test.tsx and offline-toast.test.tsx cover what they show.
vi.mock("../notice-toast", () => ({ NoticeToast }))
vi.mock("../offline-toast", () => ({ OfflineToast }))

import type { CurrentMember } from "@/features/members"

import MemberLayout from "./layout"

const MEMBER = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Head Layout Artist",
  role: "editorial_admin",
  state: "active",
} satisfies CurrentMember

const NEW_TASK = {
  options: { owners: [], slotMembersByRole: {}, allMembers: [] },
  homeOwner: "desk:layout",
}

beforeEach(() => {
  getNewTaskLayoutData.mockResolvedValue(null)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("MemberLayout", () => {
  it("runs the shared state check, and renders nothing when it redirects", async () => {
    requireActiveMember.mockRejectedValue(new RedirectError("/login"))

    await expect(MemberLayout({ children: null })).rejects.toEqual(
      new RedirectError("/login")
    )
    expect(requireActiveMember).toHaveBeenCalledOnce()
    expect(MemberShell).not.toHaveBeenCalled()
  })

  it.each(["staff", "editorial_admin"] as const)(
    "renders the member shell for an active %s member, with the notice-toast reader and the offline toast mounted before the page",
    async (role) => {
      const member = { ...MEMBER, role }
      requireActiveMember.mockResolvedValue(member)

      const element = await MemberLayout({ children: "page" })

      expect(element.type).toBe(MemberShell)
      expect(element.props).toEqual({
        member,
        newTask: undefined,
        children: [
          expect.objectContaining({
            type: Suspense,
            props: expect.objectContaining({
              fallback: null,
              children: expect.objectContaining({ type: NoticeToast }),
            }),
          }),
          null,
          expect.objectContaining({ type: OfflineToast }),
          expect.objectContaining({ type: SharedSessionWatcher }),
          "page",
        ],
      })
    }
  )

  it("mounts the New task button and the sheet in Suspense only when can_create_task allows", async () => {
    requireActiveMember.mockResolvedValue({ ...MEMBER })
    getNewTaskLayoutData.mockResolvedValue(NEW_TASK)

    const element = await MemberLayout({ children: "page" })

    expect(element.props.newTask).toEqual(
      expect.objectContaining({ type: NewTaskButton })
    )
    expect(element.props.children[1]).toEqual(
      expect.objectContaining({
        type: Suspense,
        props: expect.objectContaining({
          fallback: null,
          children: expect.objectContaining({
            type: NewTaskSheet,
            props: {
              options: NEW_TASK.options,
              homeOwner: "desk:layout",
            },
          }),
        }),
      })
    )
  })
})
