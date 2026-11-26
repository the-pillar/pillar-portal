import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { rpc, createClient, revalidatePath, after, recordErrorEvent } =
  vi.hoisted(() => ({
    rpc: vi.fn(),
    createClient: vi.fn(),
    revalidatePath: vi.fn(),
    // Holds each scheduled callback; runAfter() runs them, as Next does once
    // the response is sent.
    after: vi.fn<(task: () => unknown) => void>(),
    recordErrorEvent: vi.fn(async () => {}),
  }))

vi.mock("@/lib/supabase/server", () => ({ createClient }))
vi.mock("next/cache", () => ({ revalidatePath }))
vi.mock("next/server", () => ({ after }))
vi.mock("@/lib/record-error-event", () => ({ recordErrorEvent }))
// taskCreateSchema (via ./schemas) imports @/features/members for
// PRODUCTION_ROLE_LABELS, which pulls in the members slice's own
// supabase/server and env.client imports.
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

import {
  addDeliverableLinksAction,
  createTaskAction,
  deleteTaskAction,
  handBackSlotAction,
  markDoneAction,
  moveTaskAction,
  reassignSlotAction,
  removeDeliverableLinkAction,
  reopenTaskAction,
  respondToSlotAction,
  sendBackTaskAction,
  updateTaskAction,
} from "./actions"

const MEMBER_ID = "00000000-0000-4000-8000-000000000001"

const VALID_INPUT = {
  title: "Lay out the spread",
  description: null,
  owningSectionId: "news",
  owningDeskId: null,
  dueAt: "2026-10-31T23:30",
  referenceUrls: [],
  slots: [{ role: "layout_artist", memberId: MEMBER_ID }],
}

async function runAfter() {
  for (const [task] of after.mock.calls) await task()
}

beforeEach(() => {
  createClient.mockResolvedValue({ rpc })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("createTaskAction", () => {
  it("cleans the links and sends the list, an empty one as []", async () => {
    rpc.mockResolvedValue({ data: "task-1", error: null })

    await createTaskAction({
      ...VALID_INPUT,
      referenceUrls: ["canva.com/x", "HTTPS://Drive.google.com/y"],
    })
    expect(rpc.mock.calls[0][1].reference_urls).toEqual([
      "https://canva.com/x",
      "https://Drive.google.com/y",
    ])

    await createTaskAction(VALID_INPUT)
    expect(rpc.mock.calls[1][1].reference_urls).toEqual([])
  })

  it.each([
    ["a link that isn't one", ["hello"]],
    ["a mailto link", ["mailto:a@b.com"]],
    ["six links", Array.from({ length: 6 }, (_, i) => `https://a.com/${i}`)],
    ["a missing list", undefined],
    ["a null list", null],
  ])("rejects %s without calling the database", async (_name, links) => {
    const result = await createTaskAction({
      ...VALID_INPUT,
      referenceUrls: links,
    })

    expect(result).toEqual({ ok: false, code: "tasks.create_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it("maps the database's refusal of the list to its own copy, unrecorded", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "tasks.invalid_links" },
    })

    const result = await createTaskAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, code: "tasks.invalid_links" })
    expect(after).not.toHaveBeenCalled()
  })

  it("rejects invalid input without calling the database", async () => {
    const result = await createTaskAction({ ...VALID_INPUT, title: "" })

    expect(result).toEqual({ ok: false, code: "tasks.create_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it("calls create_task with the PHT due date converted to a UTC instant, then revalidates and returns the new id", async () => {
    rpc.mockResolvedValue({ data: "task-1", error: null })

    const result = await createTaskAction(VALID_INPUT)

    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_task", {
      title: "Lay out the spread",
      description: null,
      owning_section_id: "news",
      owning_desk_id: null,
      due_at: "2026-10-31T15:30:00.000Z",
      reference_urls: [],
      slots: [{ role: "layout_artist", member_id: MEMBER_ID }],
    })
    // Admin home's "Create a task" checklist item ticks live (Story 8.9).
    expect(revalidatePath).toHaveBeenCalledTimes(3)
    expect(revalidatePath).toHaveBeenNthCalledWith(1, "/admin/tasks")
    expect(revalidatePath).toHaveBeenNthCalledWith(
      2,
      "/(member)/dashboard",
      "layout"
    )
    expect(revalidatePath).toHaveBeenNthCalledWith(
      3,
      "/(admin)/admin",
      "layout"
    )
    expect(result).toEqual({ ok: true, data: { id: "task-1" } })
  })

  it.each(["auth.not_active", "tasks.not_admin"])(
    "maps the database's %s error straight through",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { message } })

      const result = await createTaskAction(VALID_INPUT)

      expect(result).toEqual({ ok: false, code: message })
    }
  )

  it.each([
    "tasks.no_slots",
    "tasks.invalid_slot_member",
    "permission denied for function create_task",
  ])(
    "maps an unrecognized database error (%s) to the generic code",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { message } })

      const result = await createTaskAction(VALID_INPUT)

      expect(result).toEqual({ ok: false, code: "tasks.create_failed" })
    }
  )

  it("maps task_assignments' unique-violation (23505) to tasks.duplicate_slot, not the generic code", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "task_assignments_task_id_member_id_role_key"',
      },
    })

    const result = await createTaskAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, code: "tasks.duplicate_slot" })
  })

  it("doesn't revalidate when the database call fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "tasks.not_admin" } })

    await createTaskAction(VALID_INPUT)

    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

const SLOT_ID = "00000000-0000-4000-8000-000000000011"
const TASK_ID = "00000000-0000-4000-8000-000000000021"

// The edit form's submission: one existing slot, with the member it loaded.
const VALID_EDIT = {
  taskId: TASK_ID,
  title: "Lay out the spread",
  description: null,
  dueAt: "2026-10-31T23:30",
  referenceUrls: [],
  slots: [
    {
      id: SLOT_ID,
      loadedMemberId: MEMBER_ID,
      role: "layout_artist",
      memberId: MEMBER_ID,
    },
  ],
}

// The reassign picker's submission, the version as PostgREST returns it.
const VALID_REASSIGN = {
  slotId: SLOT_ID,
  memberId: MEMBER_ID,
  expectedUpdatedAt: "2026-10-30T02:15:42.123456+00:00",
}

describe("respondToSlotAction", () => {
  it("rejects invalid input without calling the database", async () => {
    const result = await respondToSlotAction({
      slotId: "abc",
      response: "on_it",
    })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it("answers I'm on it without a reason, even if one is passed, then revalidates the dashboard", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    const result = await respondToSlotAction({
      slotId: SLOT_ID,
      response: "on_it",
      reason: "Ignored",
    })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("respond_to_slot", {
      slot_id: SLOT_ID,
      response: "on_it",
    })
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/(member)/dashboard",
      "layout"
    )
    expect(result).toEqual({ ok: true, data: { state: "on_it" } })
  })

  it("sends the trimmed reason with needs_reassignment", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    const result = await respondToSlotAction({
      slotId: SLOT_ID,
      response: "needs_reassignment",
      reason: "  Exams all week  ",
    })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("respond_to_slot", {
      slot_id: SLOT_ID,
      response: "needs_reassignment",
      reason: "Exams all week",
    })
    expect(result).toEqual({ ok: true, data: { state: "needs_reassignment" } })
  })

  it("sends no reason when it is blank", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await respondToSlotAction({
      slotId: SLOT_ID,
      response: "needs_reassignment",
      reason: "   ",
    })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("respond_to_slot", {
      slot_id: SLOT_ID,
      response: "needs_reassignment",
    })
  })

  it("rejects a reason over 280 characters without calling the database", async () => {
    const result = await respondToSlotAction({
      slotId: SLOT_ID,
      response: "needs_reassignment",
      reason: "x".repeat(281),
    })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it.each(["auth.not_active", "tasks.not_found", "tasks.not_allowed"])(
    "maps the database's %s error straight through, without revalidating",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { message } })

      const result = await respondToSlotAction({
        slotId: SLOT_ID,
        response: "on_it",
      })

      expect(result).toEqual({ ok: false, code: message })
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )

  it.each([
    "tasks.not_admin",
    'new row for relation "assignment_reasons" violates check constraint',
    "permission denied for function respond_to_slot",
  ])("maps any other error (%s) to tasks.save_failed", async (message) => {
    rpc.mockResolvedValue({ data: null, error: { message } })

    const result = await respondToSlotAction({
      slotId: SLOT_ID,
      response: "on_it",
    })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
  })
})

describe("moveTaskAction", () => {
  it("rejects invalid input without calling the database", async () => {
    const result = await moveTaskAction({
      taskId: TASK_ID,
      toColumn: "archived",
      expectedMovedAt: "2026-11-15T01:02:03.123456+00:00",
    })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it("calls move_task, then revalidates the dashboard and returns the new column", async () => {
    rpc.mockResolvedValue({
      data: "2026-11-15T02:00:00.654321+00:00",
      error: null,
    })

    const result = await moveTaskAction({
      taskId: TASK_ID,
      toColumn: "for_review",
      expectedMovedAt: "2026-11-15T01:02:03.123456+00:00",
    })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("move_task", {
      task_id: TASK_ID,
      to_column: "for_review",
      expected_moved_at: "2026-11-15T01:02:03.123456+00:00",
    })
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/(member)/dashboard",
      "layout"
    )
    // The version comes back exactly as the database wrote it.
    expect(result).toEqual({
      ok: true,
      data: {
        column: "for_review",
        movedAt: "2026-11-15T02:00:00.654321+00:00",
      },
    })
  })

  it("maps tasks.stale with the column and the mover's name from the error's details", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        message: "tasks.stale",
        details: JSON.stringify({
          column: "for_review",
          moved_by: TASK_ID,
          moved_by_name: "Ben Baker",
        }),
      },
    })

    const result = await moveTaskAction({
      taskId: TASK_ID,
      toColumn: "doing",
      expectedMovedAt: "2026-11-15T01:02:03.123456+00:00",
    })

    expect(result).toEqual({
      ok: false,
      code: "tasks.stale",
      params: { column: "for_review", movedByName: "Ben Baker" },
    })
    expect(after).not.toHaveBeenCalled()
  })

  it("maps tasks.stale with unreadable details to no params", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "tasks.stale", details: "not json" },
    })

    const result = await moveTaskAction({
      taskId: TASK_ID,
      toColumn: "doing",
      expectedMovedAt: "2026-11-15T01:02:03.123456+00:00",
    })

    expect(result).toEqual({ ok: false, code: "tasks.stale" })
  })

  it.each(["auth.not_active", "tasks.not_found", "tasks.not_allowed"])(
    "maps the database's %s error straight through, without revalidating",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { message } })

      const result = await moveTaskAction({
        taskId: TASK_ID,
        toColumn: "doing",
        expectedMovedAt: "2026-11-15T01:02:03.123456+00:00",
      })

      expect(result).toEqual({ ok: false, code: message })
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )

  it("maps any other error to tasks.save_failed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "fetch failed" } })

    const result = await moveTaskAction({
      taskId: TASK_ID,
      toColumn: "doing",
      expectedMovedAt: "2026-11-15T01:02:03.123456+00:00",
    })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
  })
})

describe("updateTaskAction with deliverable links", () => {
  it("carries the role tasks.slot_has_links names, and records nothing", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: "tasks.slot_has_links",
        details: JSON.stringify({ role: "layout_artist" }),
      },
    })

    const result = await updateTaskAction(VALID_EDIT)

    expect(result).toEqual({
      ok: false,
      code: "tasks.slot_has_links",
      params: { role: "layout_artist" },
    })
    expect(after).not.toHaveBeenCalled()
  })

  it("answers tasks.slot_has_links without params when details are unreadable", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: "tasks.slot_has_links",
        details: "not json",
      },
    })

    const result = await updateTaskAction(VALID_EDIT)

    expect(result).toEqual({ ok: false, code: "tasks.slot_has_links" })
  })
})

const LINK_SLOT = "00000000-0000-4000-8000-000000000031"
const LINK_ID = "00000000-0000-4000-8000-000000000041"

describe("addDeliverableLinksAction", () => {
  it("cleans the links, calls add_deliverable_links once and revalidates both areas", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    const result = await addDeliverableLinksAction({
      slotId: LINK_SLOT,
      urls: ["canva.com/design/x", "HTTPS://example.com/y"],
    })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("add_deliverable_links", {
      slot_id: LINK_SLOT,
      urls: ["https://canva.com/design/x", "https://example.com/y"],
    })
    expect(revalidatePath.mock.calls).toEqual([
      ["/(member)/dashboard", "layout"],
      ["/(admin)/admin", "layout"],
    ])
    expect(result).toEqual({ ok: true, data: { slotId: LINK_SLOT, count: 2 } })
  })

  it.each([
    ["no links", { slotId: LINK_SLOT, urls: [] }],
    [
      "six links",
      { slotId: LINK_SLOT, urls: Array(6).fill("https://a.example/x") },
    ],
    ["a bad link", { slotId: LINK_SLOT, urls: ["mailto:a@b"] }],
    ["a bad id", { slotId: "nope", urls: ["https://a.example/x"] }],
  ])(
    "refuses %s without calling the database or recording",
    async (_, input) => {
      const result = await addDeliverableLinksAction(input)

      expect(result).toEqual({
        ok: false,
        code: "tasks.invalid_links",
        params: { reason: "link" },
      })
      expect(rpc).not.toHaveBeenCalled()
      expect(after).not.toHaveBeenCalled()
    }
  )

  it.each([["auth.not_active"], ["tasks.not_found"], ["tasks.not_allowed"]])(
    "maps %s without recording it",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })

      const result = await addDeliverableLinksAction({
        slotId: LINK_SLOT,
        urls: ["https://a.example/x"],
      })

      expect(result).toEqual({ ok: false, code: message })
      expect(after).not.toHaveBeenCalled()
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )

  it("carries a refused limit's reason and room left", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: "tasks.invalid_links",
        details: JSON.stringify({ reason: "limit", remaining: 1 }),
      },
    })

    const result = await addDeliverableLinksAction({
      slotId: LINK_SLOT,
      urls: ["https://a.example/x"],
    })

    expect(result).toEqual({
      ok: false,
      code: "tasks.invalid_links",
      params: { reason: "limit", remaining: 1 },
    })
    expect(after).not.toHaveBeenCalled()
  })

  it("maps anything else to tasks.save_failed and records it", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "boom" },
    })

    const result = await addDeliverableLinksAction({
      slotId: LINK_SLOT,
      urls: ["https://a.example/x"],
    })
    await runAfter()

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(recordErrorEvent).toHaveBeenCalledWith(
      { code: "XX000", message: "boom" },
      expect.objectContaining({ route: "action addDeliverableLinksAction" })
    )
  })
})

describe("removeDeliverableLinkAction", () => {
  it("passes the id and says whether it removed one", async () => {
    rpc.mockResolvedValue({ data: true, error: null })

    const result = await removeDeliverableLinkAction({ linkId: LINK_ID })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("remove_deliverable_link", {
      link_id: LINK_ID,
    })
    expect(result).toEqual({ ok: true, data: { removed: true } })
    expect(revalidatePath.mock.calls).toEqual([
      ["/(member)/dashboard", "layout"],
      ["/(admin)/admin", "layout"],
    ])
  })

  it("answers removed: false for a link already gone", async () => {
    rpc.mockResolvedValue({ data: false, error: null })

    expect(await removeDeliverableLinkAction({ linkId: LINK_ID })).toEqual({
      ok: true,
      data: { removed: false },
    })
  })

  it.each(["auth.not_active", "tasks.not_allowed"])(
    "maps %s without recording it",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })

      expect(await removeDeliverableLinkAction({ linkId: LINK_ID })).toEqual({
        ok: false,
        code: message,
      })
      expect(after).not.toHaveBeenCalled()
    }
  )

  it("refuses a bad id without calling the database", async () => {
    expect(await removeDeliverableLinkAction({ linkId: "x" })).toEqual({
      ok: false,
      code: "tasks.save_failed",
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("records an unexpected error and answers tasks.save_failed", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "boom" },
    })

    const result = await removeDeliverableLinkAction({ linkId: LINK_ID })
    await runAfter()

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(recordErrorEvent).toHaveBeenCalledTimes(1)
  })
})

describe("error copy", () => {
  it("maps each code to its copy", async () => {
    const { TASK_ERROR_COPY } = await import("./errors")
    expect(TASK_ERROR_COPY).toEqual({
      "auth.not_active": "Sign in to do that.",
      "tasks.invalid_links":
        "A link didn't save. Check the links and try again.",
      "tasks.not_admin": "Only the Editorial Board can create tasks.",
      "tasks.duplicate_slot":
        "The same member already has that role — remove one.",
      // EXPERIENCE.md's Save failed line, as every other save shows it.
      "tasks.create_failed": "Couldn't save — try again.",
      "tasks.not_found": "This task was deleted or the link is wrong.",
      "tasks.not_allowed": "Couldn't save — try again.",
      "tasks.save_failed": "Couldn't save — try again.",
      "tasks.not_approver": "Only the task's head or a top editor can do that.",
      "tasks.stale":
        "Something changed since you opened this. Review the latest and try again.",
      // A member who left while the edit form was open: the stale line.
      "tasks.invalid_slot_member":
        "Something changed since you opened this. Review the latest and try again.",
      "tasks.slot_has_links":
        "A slot has deliverable links. Remove them on the task first, or reassign the slot.",
    })
  })
})

describe("handBackSlotAction", () => {
  it("rejects invalid input without calling the database", async () => {
    const result = await handBackSlotAction({ slotId: "abc" })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it("rejects a reason over 280 characters", async () => {
    const result = await handBackSlotAction({
      slotId: SLOT_ID,
      reason: "x".repeat(281),
    })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("sends the trimmed reason to hand_back_slot, then revalidates the dashboard", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    const result = await handBackSlotAction({
      slotId: SLOT_ID,
      reason: "  Out sick  ",
    })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("hand_back_slot", {
      slot_id: SLOT_ID,
      reason: "Out sick",
    })
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/(member)/dashboard",
      "layout"
    )
    expect(result).toEqual({ ok: true, data: { state: "needs_reassignment" } })
  })

  it("sends no reason when it is blank", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await handBackSlotAction({ slotId: SLOT_ID, reason: "   " })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("hand_back_slot", {
      slot_id: SLOT_ID,
    })
  })

  it.each([
    ["auth.not_active", "auth.not_active"],
    ["tasks.not_found", "tasks.not_found"],
    ["tasks.not_allowed", "tasks.not_allowed"],
    ["something unexpected", "tasks.save_failed"],
  ])(
    "maps the database error %s to %s without revalidating",
    async (message, code) => {
      rpc.mockResolvedValue({ data: null, error: { message } })

      const result = await handBackSlotAction({ slotId: SLOT_ID })

      expect(result).toEqual({ ok: false, code })
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )
})

describe.each([
  ["markDoneAction", markDoneAction, "mark_done", { column: "done" }],
  ["reopenTaskAction", reopenTaskAction, "reopen_task", { column: "doing" }],
] as const)("%s", (_name, action, rpcName, data) => {
  it("rejects invalid input without calling the database", async () => {
    const result = await action({ taskId: "abc" })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it(`calls ${rpcName}, then revalidates the dashboard and the admin pages and returns the new column`, async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    const result = await action({ taskId: TASK_ID })

    expect(rpc).toHaveBeenCalledExactlyOnceWith(rpcName, { task_id: TASK_ID })
    // The admin layout holds the review queue and Admin home's count.
    expect(revalidatePath.mock.calls).toEqual([
      ["/(member)/dashboard", "layout"],
      ["/(admin)/admin", "layout"],
    ])
    expect(result).toEqual({ ok: true, data })
  })

  it.each([
    ["auth.not_active", "auth.not_active"],
    ["tasks.not_found", "tasks.not_found"],
    ["tasks.not_approver", "tasks.not_approver"],
    ["tasks.stale", "tasks.stale"],
    ["tasks.not_allowed", "tasks.save_failed"],
    ["fetch failed", "tasks.save_failed"],
  ])(
    "maps the database error %s to %s without revalidating",
    async (message, code) => {
      rpc.mockResolvedValue({ data: null, error: { message } })

      const result = await action({ taskId: TASK_ID })

      expect(result).toEqual({ ok: false, code })
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )
})

describe("sendBackTaskAction", () => {
  it("rejects invalid input without calling the database", async () => {
    const result = await sendBackTaskAction({ taskId: "abc", note: "Fix" })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it.each(["", "   ", "x".repeat(5001)])(
    "rejects the note %j without calling the database",
    async (note) => {
      const result = await sendBackTaskAction({ taskId: TASK_ID, note })

      expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
      expect(createClient).not.toHaveBeenCalled()
    }
  )

  it("sends the trimmed note to send_back_task, then revalidates the dashboard and the admin pages", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    const result = await sendBackTaskAction({
      taskId: TASK_ID,
      note: "  fix captions ",
    })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("send_back_task", {
      task_id: TASK_ID,
      note: "fix captions",
    })
    expect(revalidatePath.mock.calls).toEqual([
      ["/(member)/dashboard", "layout"],
      ["/(admin)/admin", "layout"],
    ])
    expect(result).toEqual({ ok: true, data: { column: "doing" } })
  })

  it.each([
    ["auth.not_active", "auth.not_active"],
    ["tasks.not_found", "tasks.not_found"],
    ["tasks.not_approver", "tasks.not_approver"],
    ["tasks.stale", "tasks.stale"],
    ["tasks.invalid_note", "tasks.save_failed"],
    ["something unexpected", "tasks.save_failed"],
  ])(
    "maps the database error %s to %s without revalidating",
    async (message, code) => {
      rpc.mockResolvedValue({ data: null, error: { message } })

      const result = await sendBackTaskAction({ taskId: TASK_ID, note: "Fix" })

      expect(result).toEqual({ ok: false, code })
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )
})

describe("deleteTaskAction", () => {
  // As PostgREST returns it, microseconds included.
  const VERSION = "2026-10-30T02:15:42.123456+00:00"

  it.each([
    [
      "a task id that isn't a UUID",
      { taskId: "abc", expectedUpdatedAt: VERSION },
    ],
    ["no version", { taskId: TASK_ID }],
    [
      "a version that isn't a timestamp",
      { taskId: TASK_ID, expectedUpdatedAt: "yesterday" },
    ],
    [
      "a version without an offset",
      { taskId: TASK_ID, expectedUpdatedAt: "2026-10-30T02:15:42.123456" },
    ],
  ])("rejects %s without calling the database", async (_name, input) => {
    const result = await deleteTaskAction(input)

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it("passes the version to delete_task exactly as given, then revalidates the dashboard and the admin pages and returns the task id", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    const result = await deleteTaskAction({
      taskId: TASK_ID,
      expectedUpdatedAt: VERSION,
    })

    expect(rpc).toHaveBeenCalledExactlyOnceWith("delete_task", {
      task_id: TASK_ID,
      expected_updated_at: VERSION,
    })
    expect(revalidatePath.mock.calls).toEqual([
      ["/(member)/dashboard", "layout"],
      ["/(admin)/admin", "layout"],
    ])
    expect(result).toEqual({ ok: true, data: { taskId: TASK_ID } })
  })

  it.each([
    ["auth.not_active", "auth.not_active"],
    ["tasks.not_found", "tasks.not_found"],
    ["tasks.not_approver", "tasks.not_approver"],
    ["tasks.stale", "tasks.stale"],
    ["tasks.not_allowed", "tasks.save_failed"],
    ["fetch failed", "tasks.save_failed"],
  ])(
    "maps the database error %s to %s without revalidating",
    async (message, code) => {
      rpc.mockResolvedValue({ data: null, error: { message } })

      const result = await deleteTaskAction({
        taskId: TASK_ID,
        expectedUpdatedAt: VERSION,
      })

      expect(result).toEqual({ ok: false, code })
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )
})

describe("updateTaskAction", () => {
  const NEW_MEMBER = "00000000-0000-4000-8000-000000000002"
  const EDIT_INPUT = {
    taskId: TASK_ID,
    title: "  Lay out the spread, v2  ",
    description: null,
    dueAt: "2026-10-31T23:30",
    referenceUrls: ["https://example.com/brief"],
    loadedReferenceUrls: [],
    slots: [
      {
        id: SLOT_ID,
        loadedMemberId: MEMBER_ID,
        role: "layout_artist",
        memberId: NEW_MEMBER,
      },
      { role: "writer", memberId: NEW_MEMBER },
    ],
  }

  it.each([
    ["a task id that isn't a UUID", { ...EDIT_INPUT, taskId: "abc" }],
    [
      "an existing slot without its loaded member",
      {
        ...EDIT_INPUT,
        slots: [{ id: SLOT_ID, role: "layout_artist", memberId: MEMBER_ID }],
      },
    ],
    [
      "a new slot with a loaded member",
      {
        ...EDIT_INPUT,
        slots: [
          { loadedMemberId: MEMBER_ID, role: "writer", memberId: NEW_MEMBER },
        ],
      },
    ],
    ["a blank title", { ...EDIT_INPUT, title: "  " }],
    ["no slots", { ...EDIT_INPUT, slots: [] }],
    [
      "a repeated pair",
      {
        ...EDIT_INPUT,
        slots: [
          { role: "writer", memberId: NEW_MEMBER },
          { role: "writer", memberId: NEW_MEMBER },
        ],
      },
    ],
    [
      "a due date that can't convert",
      { ...EDIT_INPUT, dueAt: "2026-02-30T10:00" },
    ],
  ])("rejects %s without calling the database", async (_name, input) => {
    const result = await updateTaskAction(input)

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it("never refuses a link equal to one the form loaded, and cleans the rest", async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    const loaded = "https://example.com/has a space"

    const result = await updateTaskAction({
      ...EDIT_INPUT,
      referenceUrls: [loaded, "canva.com/x"],
      loadedReferenceUrls: [loaded],
    })

    expect(result.ok).toBe(true)
    expect(rpc.mock.calls[0][1].reference_urls).toEqual([
      loaded,
      "https://canva.com/x",
    ])
  })

  it("refuses a link that isn't the loaded one when it is invalid", async () => {
    const result = await updateTaskAction({
      ...EDIT_INPUT,
      referenceUrls: ["https://example.com/has a space"],
      loadedReferenceUrls: ["https://example.com/other"],
    })

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
  })

  it("maps the database's refusal of the list to its own copy, unrecorded", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "tasks.invalid_links" },
    })

    const result = await updateTaskAction(EDIT_INPUT)

    expect(result).toEqual({ ok: false, code: "tasks.invalid_links" })
    expect(after).not.toHaveBeenCalled()
  })

  it("calls update_task with the trimmed fields, the PHT due date as a UTC instant and the slots (an id and the loaded member only on an existing one), then revalidates the dashboard and the admin pages", async () => {
    rpc.mockResolvedValue({ data: false, error: null })

    const result = await updateTaskAction(EDIT_INPUT)

    expect(rpc).toHaveBeenCalledExactlyOnceWith("update_task", {
      task_id: TASK_ID,
      title: "Lay out the spread, v2",
      description: null,
      due_at: "2026-10-31T15:30:00.000Z",
      reference_urls: ["https://example.com/brief"],
      slots: [
        {
          id: SLOT_ID,
          loaded_member_id: MEMBER_ID,
          role: "layout_artist",
          member_id: NEW_MEMBER,
        },
        { role: "writer", member_id: NEW_MEMBER },
      ],
    })
    expect(rpc.mock.calls[0][1].slots[1]).not.toHaveProperty("id")
    expect(rpc.mock.calls[0][1].slots[1]).not.toHaveProperty("loaded_member_id")
    expect(revalidatePath.mock.calls).toEqual([
      ["/(member)/dashboard", "layout"],
      ["/(admin)/admin", "layout"],
    ])
    expect(result).toEqual({
      ok: true,
      data: { taskId: TASK_ID, newAssignee: false },
    })
  })

  it("passes update_task's true through as newAssignee", async () => {
    rpc.mockResolvedValue({ data: true, error: null })

    const result = await updateTaskAction(EDIT_INPUT)

    expect(result).toEqual({
      ok: true,
      data: { taskId: TASK_ID, newAssignee: true },
    })
  })

  it.each([
    ["auth.not_active", "auth.not_active"],
    ["tasks.not_found", "tasks.not_found"],
    ["tasks.not_approver", "tasks.not_approver"],
    ["tasks.stale", "tasks.stale"],
    ["tasks.duplicate_slot", "tasks.duplicate_slot"],
    ["tasks.invalid_slot_member", "tasks.invalid_slot_member"],
    ["tasks.not_allowed", "tasks.not_allowed"],
    ["tasks.slot_has_links", "tasks.slot_has_links"],
    ["tasks.no_slots", "tasks.save_failed"],
    ["fetch failed", "tasks.save_failed"],
  ])(
    "maps the database error %s to %s without revalidating",
    async (message, code) => {
      rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })

      const result = await updateTaskAction(EDIT_INPUT)

      expect(result).toEqual({ ok: false, code })
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )

  it("maps task_assignments' unique-violation (23505) to tasks.duplicate_slot, as create does, and doesn't record it", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "task_assignments_task_id_member_id_role_key"',
      },
    })

    const result = await updateTaskAction(EDIT_INPUT)

    expect(result).toEqual({ ok: false, code: "tasks.duplicate_slot" })
    expect(after).not.toHaveBeenCalled()
  })
})

describe("reassignSlotAction", () => {
  it.each([
    ["a slot id that isn't a UUID", { ...VALID_REASSIGN, slotId: "abc" }],
    ["no member", { ...VALID_REASSIGN, memberId: undefined }],
    ["a member id that isn't a UUID", { ...VALID_REASSIGN, memberId: "" }],
    ["no version", { slotId: SLOT_ID, memberId: MEMBER_ID }],
    [
      "a version that isn't a timestamp",
      { ...VALID_REASSIGN, expectedUpdatedAt: "yesterday" },
    ],
    [
      "a version without an offset",
      { ...VALID_REASSIGN, expectedUpdatedAt: "2026-10-30T02:15:42.123456" },
    ],
  ])("rejects %s without calling the database", async (_name, input) => {
    const result = await reassignSlotAction(input)

    expect(result).toEqual({ ok: false, code: "tasks.save_failed" })
    expect(createClient).not.toHaveBeenCalled()
  })

  it("calls reassign_slot once with the slot, the member and the version exactly as given, then revalidates the dashboard and the admin pages and returns the slot id", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    const result = await reassignSlotAction(VALID_REASSIGN)

    expect(rpc).toHaveBeenCalledExactlyOnceWith("reassign_slot", {
      slot_id: SLOT_ID,
      member_id: MEMBER_ID,
      expected_updated_at: "2026-10-30T02:15:42.123456+00:00",
    })
    expect(revalidatePath.mock.calls).toEqual([
      ["/(member)/dashboard", "layout"],
      ["/(admin)/admin", "layout"],
    ])
    expect(result).toEqual({ ok: true, data: { slotId: SLOT_ID } })
  })

  it.each([
    ["auth.not_active", "auth.not_active"],
    ["tasks.not_found", "tasks.not_found"],
    ["tasks.not_approver", "tasks.not_approver"],
    ["tasks.not_allowed", "tasks.not_allowed"],
    ["tasks.stale", "tasks.stale"],
    ["tasks.invalid_slot_member", "tasks.invalid_slot_member"],
    ["tasks.duplicate_slot", "tasks.duplicate_slot"],
    ["tasks.no_slots", "tasks.save_failed"],
    ["fetch failed", "tasks.save_failed"],
  ])(
    "maps the database error %s to %s without revalidating",
    async (message, code) => {
      rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })

      const result = await reassignSlotAction(VALID_REASSIGN)

      expect(result).toEqual({ ok: false, code })
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )

  it("maps task_assignments' unique-violation (23505) to tasks.duplicate_slot and doesn't record it", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "task_assignments_task_id_member_id_role_key"',
      },
    })

    const result = await reassignSlotAction(VALID_REASSIGN)

    expect(result).toEqual({ ok: false, code: "tasks.duplicate_slot" })
    expect(after).not.toHaveBeenCalled()
  })
})

describe("recording unexpected errors", () => {
  // A raw database error, as PostgREST returns it.
  const RAW = {
    code: "42501",
    message: "permission denied for function move_task",
    details: null,
    hint: null,
  }

  it.each([
    [
      "createTaskAction",
      () => createTaskAction(VALID_INPUT),
      { route: "action createTaskAction", entityType: "task" },
    ],
    [
      "respondToSlotAction",
      () => respondToSlotAction({ slotId: SLOT_ID, response: "on_it" }),
      {
        route: "action respondToSlotAction",
        entityType: "task_assignment",
        entityId: SLOT_ID,
      },
    ],
    [
      "handBackSlotAction",
      () => handBackSlotAction({ slotId: SLOT_ID }),
      {
        route: "action handBackSlotAction",
        entityType: "task_assignment",
        entityId: SLOT_ID,
      },
    ],
    [
      "moveTaskAction",
      () =>
        moveTaskAction({
          taskId: TASK_ID,
          toColumn: "doing",
          expectedMovedAt: "2026-11-15T01:02:03.123456+00:00",
        }),
      { route: "action moveTaskAction", entityType: "task", entityId: TASK_ID },
    ],
    [
      "markDoneAction",
      () => markDoneAction({ taskId: TASK_ID }),
      { route: "action markDoneAction", entityType: "task", entityId: TASK_ID },
    ],
    [
      "sendBackTaskAction",
      () => sendBackTaskAction({ taskId: TASK_ID, note: "Fix" }),
      {
        route: "action sendBackTaskAction",
        entityType: "task",
        entityId: TASK_ID,
      },
    ],
    [
      "reopenTaskAction",
      () => reopenTaskAction({ taskId: TASK_ID }),
      {
        route: "action reopenTaskAction",
        entityType: "task",
        entityId: TASK_ID,
      },
    ],
    [
      "deleteTaskAction",
      () =>
        deleteTaskAction({
          taskId: TASK_ID,
          expectedUpdatedAt: "2026-10-30T02:15:42.123456+00:00",
        }),
      {
        route: "action deleteTaskAction",
        entityType: "task",
        entityId: TASK_ID,
      },
    ],
    [
      "updateTaskAction",
      () => updateTaskAction({ ...VALID_EDIT, taskId: TASK_ID }),
      {
        route: "action updateTaskAction",
        entityType: "task",
        entityId: TASK_ID,
      },
    ],
    [
      "reassignSlotAction",
      () => reassignSlotAction(VALID_REASSIGN),
      {
        route: "action reassignSlotAction",
        entityType: "task_assignment",
        entityId: SLOT_ID,
      },
    ],
  ])(
    "%s records an unexpected error after the response, with its action and entity",
    async (_name, call, where) => {
      rpc.mockResolvedValue({ data: null, error: RAW })

      const result = await call()

      expect(result).toMatchObject({ ok: false })
      expect(recordErrorEvent).not.toHaveBeenCalled()
      expect(after).toHaveBeenCalledOnce()

      await runAfter()
      expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(RAW, where)
    }
  )

  it.each(["tasks.no_slots", "tasks.invalid_slot_member"])(
    "records create_task's backstop code %s",
    async (message) => {
      const error = { code: "P0001", message }
      rpc.mockResolvedValue({ data: null, error })

      await createTaskAction(VALID_INPUT)
      await runAfter()

      expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(error, {
        route: "action createTaskAction",
        entityType: "task",
      })
    }
  )

  it("records update_task's backstop code tasks.no_slots", async () => {
    const error = { code: "P0001", message: "tasks.no_slots" }
    rpc.mockResolvedValue({ data: null, error })

    await updateTaskAction(VALID_EDIT)
    await runAfter()

    expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(error, {
      route: "action updateTaskAction",
      entityType: "task",
      entityId: TASK_ID,
    })
  })

  it("records send_back_task's backstop code tasks.invalid_note", async () => {
    const error = { code: "P0001", message: "tasks.invalid_note" }
    rpc.mockResolvedValue({ data: null, error })

    await sendBackTaskAction({ taskId: TASK_ID, note: "Fix" })
    await runAfter()

    expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(error, {
      route: "action sendBackTaskAction",
      entityType: "task",
      entityId: TASK_ID,
    })
  })

  it.each([
    [
      "createTaskAction",
      () => createTaskAction(VALID_INPUT),
      "tasks.not_admin",
    ],
    [
      "respondToSlotAction",
      () => respondToSlotAction({ slotId: SLOT_ID, response: "on_it" }),
      "tasks.not_allowed",
    ],
    [
      "handBackSlotAction",
      () => handBackSlotAction({ slotId: SLOT_ID }),
      "tasks.not_found",
    ],
    [
      "moveTaskAction",
      () =>
        moveTaskAction({
          taskId: TASK_ID,
          toColumn: "doing",
          expectedMovedAt: "2026-11-15T01:02:03.123456+00:00",
        }),
      "auth.not_active",
    ],
    [
      "markDoneAction",
      () => markDoneAction({ taskId: TASK_ID }),
      "tasks.not_approver",
    ],
    [
      "sendBackTaskAction",
      () => sendBackTaskAction({ taskId: TASK_ID, note: "Fix" }),
      "tasks.stale",
    ],
    [
      "reopenTaskAction",
      () => reopenTaskAction({ taskId: TASK_ID }),
      "tasks.not_found",
    ],
    [
      "deleteTaskAction",
      () =>
        deleteTaskAction({
          taskId: TASK_ID,
          expectedUpdatedAt: "2026-10-30T02:15:42.123456+00:00",
        }),
      "tasks.stale",
    ],
    [
      "updateTaskAction",
      () => updateTaskAction(VALID_EDIT),
      "tasks.duplicate_slot",
    ],
    [
      "updateTaskAction",
      () => updateTaskAction(VALID_EDIT),
      "tasks.invalid_slot_member",
    ],
    [
      "updateTaskAction",
      () => updateTaskAction(VALID_EDIT),
      "tasks.not_allowed",
    ],
    [
      "updateTaskAction",
      () => updateTaskAction(VALID_EDIT),
      "tasks.invalid_links",
    ],
    [
      "createTaskAction",
      () => createTaskAction(VALID_INPUT),
      "tasks.invalid_links",
    ],
  ])("%s doesn't record a known code (%s)", async (_name, call, message) => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })

    await call()

    expect(after).not.toHaveBeenCalled()
    expect(recordErrorEvent).not.toHaveBeenCalled()
  })

  it.each([
    "auth.not_active",
    "tasks.not_found",
    "tasks.not_approver",
    "tasks.not_allowed",
    "tasks.stale",
    "tasks.invalid_slot_member",
    "tasks.duplicate_slot",
  ])("reassignSlotAction doesn't record a known code (%s)", async (message) => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })

    await reassignSlotAction(VALID_REASSIGN)

    expect(after).not.toHaveBeenCalled()
    expect(recordErrorEvent).not.toHaveBeenCalled()
  })

  it("doesn't record task_assignments' duplicate pair (23505), which has its own copy", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    })

    await createTaskAction(VALID_INPUT)

    expect(after).not.toHaveBeenCalled()
  })

  it.each([
    ["createTaskAction", () => createTaskAction({ ...VALID_INPUT, title: "" })],
    [
      "createTaskAction (a due date that can't convert)",
      () => createTaskAction({ ...VALID_INPUT, dueAt: "2026-02-30T10:00" }),
    ],
    ["respondToSlotAction", () => respondToSlotAction({ slotId: "abc" })],
    ["handBackSlotAction", () => handBackSlotAction({ slotId: "abc" })],
    [
      "moveTaskAction",
      () => moveTaskAction({ taskId: TASK_ID, toColumn: "x" }),
    ],
    ["markDoneAction", () => markDoneAction({ taskId: "abc" })],
    [
      "sendBackTaskAction (a blank note)",
      () => sendBackTaskAction({ taskId: TASK_ID, note: "  " }),
    ],
    ["reopenTaskAction", () => reopenTaskAction({ taskId: "abc" })],
    [
      "deleteTaskAction",
      () => deleteTaskAction({ taskId: TASK_ID, expectedUpdatedAt: null }),
    ],
    ["updateTaskAction", () => updateTaskAction({ ...VALID_EDIT, slots: [] })],
    [
      "updateTaskAction (a due date that can't convert)",
      () => updateTaskAction({ ...VALID_EDIT, dueAt: "2026-02-30T10:00" }),
    ],
    [
      "reassignSlotAction",
      () => reassignSlotAction({ ...VALID_REASSIGN, expectedUpdatedAt: null }),
    ],
  ])("%s doesn't record a parse failure", async (_name, call) => {
    await call()

    expect(rpc).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
    expect(recordErrorEvent).not.toHaveBeenCalled()
  })

  it("doesn't record a success", async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await moveTaskAction({
      taskId: TASK_ID,
      toColumn: "doing",
      expectedMovedAt: "2026-11-15T01:02:03.123456+00:00",
    })

    expect(after).not.toHaveBeenCalled()
  })
})
