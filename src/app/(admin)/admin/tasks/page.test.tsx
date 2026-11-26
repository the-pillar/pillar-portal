// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render } from "@testing-library/react"
import axe from "axe-core"
import type { ReactElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Button } from "@/components/ui/button"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const {
  getTaskFormOptions,
  getReviewQueue,
  getHandedBackQueue,
  getReassignOptions,
  canCreateTask,
  NewTaskLink,
  ReviewQueue,
  HandedBackQueue,
  requireAdmin,
  recordCopiedTaskAction,
} = vi.hoisted(() => ({
  getTaskFormOptions: vi.fn(),
  getReviewQueue: vi.fn(),
  getHandedBackQueue: vi.fn(),
  getReassignOptions: vi.fn(),
  canCreateTask: vi.fn(),
  NewTaskLink: vi.fn(
    ({ label, className }: { label?: string; className?: string }) => (
      <button type="button" className={className}>
        {label}
      </button>
    )
  ),
  ReviewQueue: vi.fn(() => null),
  HandedBackQueue: vi.fn(() => null),
  requireAdmin: vi.fn(),
  recordCopiedTaskAction: vi.fn(),
}))

vi.mock("@/features/tasks", () => ({
  getTaskFormOptions,
  getReviewQueue,
  getHandedBackQueue,
  getReassignOptions,
  canCreateTask,
  NewTaskLink,
  ReviewQueue,
  HandedBackQueue,
}))
vi.mock("../../require-admin", () => ({ requireAdmin }))
vi.mock("@/features/members", () => ({ recordCopiedTaskAction }))

import AdminTasksPage, { metadata } from "./page"

const OPTIONS = {
  owners: [{ kind: "section" as const, id: "news", name: "News" }],
  slotMembersByRole: {},
  allMembers: [],
}

const REASSIGN_OPTIONS = {
  slotMembersByRole: {},
  allMembers: [],
  roleLabels: {},
}

const QUEUE = [
  {
    id: "00000000-0000-4000-8000-000000000041",
    title: "Lay out the spread",
    ownerName: "Layout",
    dueAt: "2099-01-01T00:00:00+00:00",
    column: "for_review" as const,
    overdue: false,
    sentBack: false,
    hasAwaitingResponse: false,
    hasNeedsReassignment: false,
    assignees: [],
  },
]

const HANDED_BACK = [
  {
    slotId: "00000000-0000-4000-8000-000000000051",
    slotUpdatedAt: "2026-11-02T02:15:42.123456+00:00",
    taskId: "00000000-0000-4000-8000-000000000042",
    taskTitle: "Draw the strip",
    dueAt: "2099-01-01T00:00:00+00:00",
    role: "cartoonist" as const,
    roleLabel: "Cartoonist",
    memberId: "00000000-0000-4000-8000-000000000061",
    memberName: "Editor-in-Chief",
    reason: null,
  },
]

type PageElement = ReactElement<{
  id?: string
  tabIndex?: number
  className?: string
  children?: unknown
  tasks?: unknown
  slots?: unknown
  focusTargetId?: string
  options?: unknown
  label?: string
  asChild?: boolean
}>

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function mockReads({
  handedBack = HANDED_BACK as unknown[],
  queue = QUEUE as unknown[],
  canCreate = true,
} = {}) {
  requireAdmin.mockResolvedValue({ role: "editorial_admin" })
  getHandedBackQueue.mockResolvedValue(handedBack)
  getReviewQueue.mockResolvedValue(queue)
  getTaskFormOptions.mockResolvedValue(OPTIONS)
  getReassignOptions.mockResolvedValue(REASSIGN_OPTIONS)
  canCreateTask.mockResolvedValue(canCreate)
}

describe("AdminTasksPage", () => {
  it("is titled Tasks", () => {
    expect(metadata.title).toBe("Tasks")
  })

  it("renders the h1, then Needs reassignment, then the review queue, then the New task button", async () => {
    mockReads()

    const page = (await AdminTasksPage()) as PageElement
    const [h1, handedBack, queue, button] = page.props.children as PageElement[]

    expect(h1.type).toBe("h1")
    expect(h1.props.children).toBe("Tasks")
    // Focusable like What's mine's h1: the target when a row leaves.
    expect(h1.props.id).toBeTruthy()
    expect(h1.props.tabIndex).toBe(-1)
    expect(h1.props.className).toContain("focus-visible:outline-2")

    expect(handedBack.type).toBe(HandedBackQueue)
    expect(handedBack.props).toEqual({
      slots: HANDED_BACK,
      options: REASSIGN_OPTIONS,
      focusTargetId: h1.props.id,
      onCopied: recordCopiedTaskAction,
    })

    expect(queue.type).toBe(ReviewQueue)
    expect(queue.props).toEqual({ tasks: QUEUE, focusTargetId: h1.props.id })

    // A primary Button wrapping the sheet's link (asChild).
    expect(button.type).toBe(Button)
    expect(button.props.asChild).toBe(true)
    const link = button.props.children as PageElement
    expect(link.type).toBe(NewTaskLink)
    expect(link.props.label).toBe("New task")
  })

  it("has no axe violations", async () => {
    mockReads()

    const { container } = render((await AdminTasksPage()) as ReactElement)

    // color-contrast can't be computed in jsdom (it is always "incomplete").
    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(results.violations).toEqual([])
  })

  it("offers no New task button without can_create_task", async () => {
    mockReads({ canCreate: false })

    const page = (await AdminTasksPage()) as PageElement
    const [, , , button] = page.props.children as PageElement[]

    expect(button).toBeFalsy()
  })

  it("builds the picker's options from the form options already read, reading them once", async () => {
    mockReads()

    await AdminTasksPage()

    expect(getTaskFormOptions).toHaveBeenCalledOnce()
    expect(getReassignOptions).toHaveBeenCalledExactlyOnceWith(OPTIONS)
  })

  it("builds no picker options when nothing needs reassignment, and hands the queue none", async () => {
    mockReads({ handedBack: [] })

    const page = (await AdminTasksPage()) as PageElement
    const [, handedBack] = page.props.children as PageElement[]

    expect(getReassignOptions).not.toHaveBeenCalled()
    expect(getTaskFormOptions).toHaveBeenCalledOnce()
    expect(handedBack.type).toBe(HandedBackQueue)
    expect(handedBack.props).toEqual({
      slots: [],
      options: null,
      focusTargetId: "admin-tasks-heading",
      onCopied: recordCopiedTaskAction,
    })
  })

  it("runs the admin check first, then reads both queues and the form options together", async () => {
    let releaseHandedBack: (value: unknown) => void = () => {}
    mockReads()
    getHandedBackQueue.mockReturnValue(
      new Promise((resolve) => (releaseHandedBack = resolve))
    )

    const rendering = AdminTasksPage()
    await vi.waitFor(() => expect(getTaskFormOptions).toHaveBeenCalledOnce())

    // Every read started while the Needs reassignment queue is still loading.
    expect(getHandedBackQueue).toHaveBeenCalledOnce()
    expect(getReviewQueue).toHaveBeenCalledOnce()
    const checkedAt = requireAdmin.mock.invocationCallOrder[0]!
    for (const read of [
      getHandedBackQueue,
      getReviewQueue,
      getTaskFormOptions,
    ]) {
      expect(read.mock.invocationCallOrder[0]).toBeGreaterThan(checkedAt)
    }
    // The picker's options wait for the queue: they're built only for rows.
    expect(getReassignOptions).not.toHaveBeenCalled()

    releaseHandedBack(HANDED_BACK)
    await expect(rendering).resolves.toBeTruthy()
    expect(getReassignOptions).toHaveBeenCalledOnce()
  })

  it("reads nothing when the admin check redirects", async () => {
    const redirectError = new Error("NEXT_REDIRECT /login")
    requireAdmin.mockRejectedValue(redirectError)

    await expect(AdminTasksPage()).rejects.toBe(redirectError)
    expect(getHandedBackQueue).not.toHaveBeenCalled()
    expect(getReviewQueue).not.toHaveBeenCalled()
    expect(getTaskFormOptions).not.toHaveBeenCalled()
    expect(getReassignOptions).not.toHaveBeenCalled()
  })

  it.each([
    ["getHandedBackQueue", getHandedBackQueue],
    ["getReviewQueue", getReviewQueue],
    ["getTaskFormOptions", getTaskFormOptions],
    ["getReassignOptions", getReassignOptions],
  ])("lets a failed %s throw", async (name, read) => {
    const failure = new Error(`${name}: reading failed`)
    mockReads()
    read.mockRejectedValue(failure)

    await expect(AdminTasksPage()).rejects.toBe(failure)
  })
})
