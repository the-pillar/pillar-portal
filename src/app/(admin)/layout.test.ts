import { Suspense } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const {
  requireAdmin,
  AdminShell,
  AdminBannerSlot,
  NoticeToast,
  OfflineToast,
  getNewTaskLayoutData,
  NewTaskButton,
  NewTaskSheet,
  SharedSessionWatcher,
  StepUpProvider,
  RedirectError,
} = vi.hoisted(() => {
  // Like Next's redirect(), which requireAdmin calls, the mock throws.
  class RedirectError extends Error {
    constructor(readonly url: string) {
      super(`NEXT_REDIRECT ${url}`)
    }
  }
  return {
    requireAdmin: vi.fn(),
    AdminShell: vi.fn(() => null),
    AdminBannerSlot: vi.fn(() => null),
    NoticeToast: vi.fn(() => null),
    OfflineToast: vi.fn(() => null),
    getNewTaskLayoutData: vi.fn(),
    NewTaskButton: vi.fn(() => null),
    NewTaskSheet: vi.fn(() => null),
    SharedSessionWatcher: vi.fn(() => null),
    StepUpProvider: vi.fn(() => null),
    RedirectError,
  }
})

// require-admin.test.ts covers who requireAdmin redirects, and where.
vi.mock("@/features/tasks", () => ({
  getNewTaskLayoutData,
  NewTaskButton,
  NewTaskSheet,
}))
vi.mock("./require-admin", () => ({ requireAdmin }))
vi.mock("./admin-shell", () => ({ AdminShell }))
vi.mock("./admin-banners", () => ({ AdminBannerSlot }))
// notice-toast.test.tsx covers what it shows.
vi.mock("../notice-toast", () => ({ NoticeToast }))
// offline-toast.test.tsx covers when it toasts.
vi.mock("../offline-toast", () => ({ OfflineToast }))
// step-up-provider.test.tsx covers the prompt.
vi.mock("@/features/members", () => ({
  SharedSessionWatcher,
  StepUpProvider,
}))

import type { CurrentMember } from "@/features/members"

import AdminLayout from "./layout"

const MEMBER = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Editor-in-Chief",
  role: "editorial_admin",
  state: "active",
} satisfies CurrentMember

const NEW_TASK = {
  options: { owners: [], slotMembersByRole: {}, allMembers: [] },
  homeOwner: null,
}

beforeEach(() => {
  getNewTaskLayoutData.mockResolvedValue(null)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("AdminLayout", () => {
  it.each(["/login", "/dashboard?notice=admin-restricted"])(
    "runs the admin check, and renders nothing when it redirects to %s",
    async (url) => {
      requireAdmin.mockRejectedValue(new RedirectError(url))

      await expect(AdminLayout({ children: null })).rejects.toEqual(
        new RedirectError(url)
      )
      expect(requireAdmin).toHaveBeenCalledOnce()
      expect(AdminShell).not.toHaveBeenCalled()
      expect(AdminBannerSlot).not.toHaveBeenCalled()
    }
  )

  it("renders the admin shell with the banner slot for an active editorial_admin member, with the notice-toast reader and the offline toast mounted before the page, which sits in the step-up provider", async () => {
    requireAdmin.mockResolvedValue(MEMBER)

    const element = await AdminLayout({ children: "page" })

    expect(element.type).toBe(AdminShell)
    expect(element.props).toEqual({
      member: MEMBER,
      banners: expect.objectContaining({ type: AdminBannerSlot, props: {} }),
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
        expect.objectContaining({
          type: StepUpProvider,
          props: { children: "page" },
        }),
      ],
    })
    // The slot reads its sources only when React renders it, after the check.
    expect(AdminBannerSlot).not.toHaveBeenCalled()
  })

  it("mounts the New task button and the sheet in Suspense only when can_create_task allows", async () => {
    requireAdmin.mockResolvedValue(MEMBER)
    getNewTaskLayoutData.mockResolvedValue(NEW_TASK)

    const element = await AdminLayout({ children: "page" })

    expect(element.props.newTask).toEqual(
      expect.objectContaining({ type: NewTaskButton })
    )
    expect(element.props.children[1]).toEqual(
      expect.objectContaining({
        type: Suspense,
        props: expect.objectContaining({
          children: expect.objectContaining({
            type: NewTaskSheet,
            props: { options: NEW_TASK.options, homeOwner: null },
          }),
        }),
      })
    )
  })
})
