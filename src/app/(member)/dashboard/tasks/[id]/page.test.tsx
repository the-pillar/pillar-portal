// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const {
  getReassignOptions,
  getTaskDetail,
  TaskChangesRefresher,
  TaskDetailView,
  TaskNotFound,
  requireActiveMember,
  recordCopiedTaskAction,
  safeReturnPath,
} = vi.hoisted(() => ({
  getReassignOptions: vi.fn(),
  getTaskDetail: vi.fn(),
  TaskDetailView: vi.fn<
    (props: {
      task: unknown
      reassignOptions?: unknown
      returnLink?: unknown
    }) => React.ReactNode
  >(() => <h1>Task detail view</h1>),
  TaskChangesRefresher: vi.fn((props: { deliverableLinks?: boolean }) => (
    <p data-live={String(props.deliverableLinks)}>refresher</p>
  )),
  // Its copy and link have their own tests (task-not-found.test.tsx).
  TaskNotFound: vi.fn(() => <h1>Task not found</h1>),
  requireActiveMember: vi.fn(),
  recordCopiedTaskAction: vi.fn(),
  // Stands in for the members slice's check (its own tests cover it).
  safeReturnPath: vi.fn((next: unknown) =>
    typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/dashboard"
  ),
}))

vi.mock("@/features/tasks", async () => ({
  getReassignOptions,
  getTaskDetail,
  TaskChangesRefresher,
  TaskDetailView,
  TaskNotFound,
  returnLink: (
    await vi.importActual<typeof import("@/features/tasks/return-link")>(
      "@/features/tasks/return-link"
    )
  ).returnLink,
}))
// The shared state check has its own tests (members' queries.test.ts).
vi.mock("@/features/members", () => ({
  requireActiveMember,
  recordCopiedTaskAction,
  safeReturnPath,
}))

import TaskPage, { metadata } from "./page"

const TASK_ID = "00000000-0000-4000-8000-000000000021"

beforeEach(() => {
  requireActiveMember.mockResolvedValue({ state: "active" })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderPage(
  id: string,
  searchParams: Record<string, string | string[] | undefined> = {}
) {
  return render(
    await TaskPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve(searchParams),
    })
  )
}

describe("TaskPage", () => {
  it("is titled Task", () => {
    expect(metadata.title).toBe("Task")
  })

  it("runs the shared state check first and reads no task when it redirects", async () => {
    const redirectError = new Error("NEXT_REDIRECT /login")
    requireActiveMember.mockRejectedValue(redirectError)

    await expect(
      TaskPage({
        params: Promise.resolve({ id: TASK_ID }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toBe(redirectError)
    expect(getTaskDetail).not.toHaveBeenCalled()
  })

  it("loads the task by its id and renders TaskDetailView with it", async () => {
    const task = {
      id: TASK_ID,
      title: "Lay out the spread",
      canReassign: false,
    }
    getTaskDetail.mockResolvedValue(task)

    await renderPage(TASK_ID)

    expect(getTaskDetail).toHaveBeenCalledExactlyOnceWith(TASK_ID)
    expect(TaskDetailView).toHaveBeenCalledOnce()
    expect(TaskDetailView.mock.calls[0][0]).toStrictEqual({
      task,
      reassignOptions: undefined,
      onCopied: recordCopiedTaskAction,
      returnLink: { href: "/dashboard", label: "What's mine" },
    })
    expect(screen.getByText("Task detail view")).toBeInTheDocument()
  })

  it("mounts the refresher with the deliverable links listener beside the view", async () => {
    getTaskDetail.mockResolvedValue({ id: TASK_ID, canReassign: false })

    await renderPage(TASK_ID)

    expect(screen.getByText("refresher")).toHaveAttribute("data-live", "true")
  })

  it("mounts no refresher when there is no task", async () => {
    getTaskDetail.mockResolvedValue(null)

    await renderPage(TASK_ID)

    expect(screen.queryByText("refresher")).not.toBeInTheDocument()
  })

  it.each([
    [
      "/dashboard?view=board&owner=layout&column=doing&focus=x",
      "Board",
      "/dashboard?view=board&owner=layout&column=doing&focus=x",
    ],
    ["/dashboard?view=planner&month=2026-11", "Planner", undefined],
    ["/admin/tasks", "Tasks", undefined],
    ["/admin", "Admin home", undefined],
    ["//evil.example", "What's mine", "/dashboard"],
    ["https://evil.example/x", "What's mine", "/dashboard"],
    [undefined, "What's mine", "/dashboard"],
    [["/admin", "/admin/tasks"], "What's mine", "/dashboard"],
  ])(
    "names the view %j as %s after safeReturnPath",
    async (from, label, href) => {
      getTaskDetail.mockResolvedValue({ id: TASK_ID, canReassign: false })

      await renderPage(TASK_ID, { from })

      expect(safeReturnPath).toHaveBeenCalledWith(from)
      expect(TaskDetailView.mock.calls[0][0]).toMatchObject({
        returnLink: { href: href ?? from, label },
      })
    }
  )

  it("reads no reassign options when task_capabilities doesn't offer Reassign", async () => {
    getTaskDetail.mockResolvedValue({ id: TASK_ID, canReassign: false })

    await renderPage(TASK_ID)

    expect(getReassignOptions).not.toHaveBeenCalled()
    expect(TaskDetailView.mock.calls[0][0].reassignOptions).toBeUndefined()
  })

  it("reads the reassign options, after the task, only when it offers Reassign, and passes them on", async () => {
    const task = { id: TASK_ID, title: "Lay out the spread", canReassign: true }
    const reassignOptions = {
      slotMembersByRole: {},
      allMembers: [],
      roleLabels: {},
    }
    getTaskDetail.mockResolvedValue(task)
    getReassignOptions.mockResolvedValue(reassignOptions)

    await renderPage(TASK_ID)

    expect(getReassignOptions).toHaveBeenCalledExactlyOnceWith()
    expect(getTaskDetail.mock.invocationCallOrder[0]).toBeLessThan(
      getReassignOptions.mock.invocationCallOrder[0]
    )
    expect(TaskDetailView.mock.calls[0][0]).toStrictEqual({
      task,
      reassignOptions,
      onCopied: recordCopiedTaskAction,
      returnLink: { href: "/dashboard", label: "What's mine" },
    })
  })

  it.each([TASK_ID, "abc"])(
    "shows the shared not-found block when there's no task for %j",
    async (id) => {
      getTaskDetail.mockResolvedValue(null)

      await renderPage(id)

      expect(getTaskDetail).toHaveBeenCalledExactlyOnceWith(id)
      expect(TaskNotFound).toHaveBeenCalledOnce()
      expect(
        screen.getByRole("heading", { level: 1, name: "Task not found" })
      ).toBeInTheDocument()
      expect(TaskDetailView).not.toHaveBeenCalled()
      expect(getReassignOptions).not.toHaveBeenCalled()
    }
  )

  // RLS hides a deleted task from every caller, so getTaskDetail reads no
  // row for it (queries.test.ts) and the page can't tell it from a bad link.
  it("shows the same not-found for a deleted task", async () => {
    getTaskDetail.mockResolvedValue(null)

    await renderPage(TASK_ID)

    expect(TaskNotFound).toHaveBeenCalledOnce()
    expect(TaskDetailView).not.toHaveBeenCalled()
  })

  // A failed read is not a missing task: the page rejects, so
  // (member)/error.tsx shows "Couldn't load this page." inside the shell
  // rather than the not-found block.
  it("rejects when the task read throws, showing no not-found", async () => {
    const readError = new Error("Couldn't read the task")
    getTaskDetail.mockRejectedValue(readError)

    await expect(
      TaskPage({
        params: Promise.resolve({ id: TASK_ID }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toBe(readError)
    expect(TaskNotFound).not.toHaveBeenCalled()
    expect(TaskDetailView).not.toHaveBeenCalled()
    expect(getReassignOptions).not.toHaveBeenCalled()
  })
})
