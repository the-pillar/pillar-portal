import { afterEach, describe, expect, it, vi } from "vitest"

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock("@/lib/supabase/server", () => ({ createClient }))
// queries.ts imports through @/features/members, whose index.ts also pulls in
// actions.ts (env.client).
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

// The members barrel's actions.ts reads the server-only env, which requires
// SUPABASE_SECRET_KEY; these tests use none of the actions.
vi.mock("@/features/members/actions", () => ({}))

import { getPlanner } from "./queries/planner"

afterEach(() => {
  vi.clearAllMocks()
})

type Call = { method: string; args: unknown[] }

const T1 = "00000000-0000-4000-8000-0000000000b1"
const T2 = "00000000-0000-4000-8000-0000000000b2"
const T3 = "00000000-0000-4000-8000-0000000000b3"
const ME = "00000000-0000-4000-8000-0000000000a1"
const OTHER = "00000000-0000-4000-8000-0000000000a2"

const task = (
  id: string,
  dueAt: string,
  extra: Record<string, unknown> = {}
) => ({
  id,
  title: `Task ${id.slice(-2)}`,
  due_at: dueAt,
  column: "to_do",
  revision_note_at: null,
  sections: null,
  desks: { name: "Layout" },
  owning_section_id: null,
  owning_desk_id: "layout",
  task_assignments: [{ member_id: ME, state: "on_it" }],
  ...extra,
})

type Fixture = {
  openSlots?: unknown[]
  openError?: unknown
  taskRows?: unknown[]
  taskError?: unknown
  directoryError?: unknown
}

// The tasks query and the directory read record their builder calls, so a
// test can see exactly what was asked.
function mockPlanner(fixture: Fixture = {}) {
  const taskCalls: Call[] = []
  const directoryCalls: Call[] = []
  const rpc = vi.fn(async (name: string) => {
    expect(name).toBe("my_open_slots")
    return {
      data: fixture.openSlots ?? [
        { id: "s1", task_id: T1, state: "awaiting_response" },
        { id: "s2", task_id: T1, state: "on_it" },
      ],
      error: fixture.openError ?? null,
    }
  })
  const recorder = (calls: Call[], result: () => unknown) => {
    const builder: Record<string, unknown> = {}
    for (const method of ["select", "order", "gte", "lt"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args })
        return builder
      }
    }
    builder.then = (resolve: (value: unknown) => void) => resolve(result())
    return builder
  }
  const from = vi.fn((table: string) => {
    if (table === "tasks") {
      return recorder(taskCalls, () => ({
        data: fixture.taskRows ?? [],
        error: fixture.taskError ?? null,
      }))
    }
    if (table === "member_directory") {
      return recorder(directoryCalls, () => ({
        data: [
          { id: ME, name: "Sam Layout" },
          { id: OTHER, name: "Olive Writer" },
        ],
        error: fixture.directoryError ?? null,
      }))
    }
    throw new Error(`unexpected table: ${table}`)
  })
  createClient.mockResolvedValue({ from, rpc })
  return { taskCalls, directoryCalls, rpc, from }
}

const callsOf = (calls: Call[], ...methods: string[]) =>
  calls.filter((call) => methods.includes(call.method))

describe("getPlanner", () => {
  it("reads one unfiltered month, from Manila midnight on the 1st to the next 1st, with the Board's select and ordering", async () => {
    const { taskCalls, from } = mockPlanner()

    await getPlanner("2026-10")

    expect(from.mock.calls.filter(([table]) => table === "tasks")).toHaveLength(
      1
    )
    expect(callsOf(taskCalls, "gte", "lt")).toEqual([
      { method: "gte", args: ["due_at", "2026-09-30T16:00:00.000Z"] },
      { method: "lt", args: ["due_at", "2026-10-31T16:00:00.000Z"] },
    ])
    expect(callsOf(taskCalls, "select")).toEqual([
      {
        method: "select",
        args: [
          "id, title, due_at, column, revision_note_at, owning_section_id, owning_desk_id, moved_at, moved_by, created_by, done_at, sections(name), desks(name), task_assignments(member_id, state)",
        ],
      },
    ])
    expect(callsOf(taskCalls, "order")).toEqual([
      { method: "order", args: ["due_at"] },
      { method: "order", args: ["id"] },
      {
        method: "order",
        args: ["created_at", { referencedTable: "task_assignments" }],
      },
      {
        method: "order",
        args: ["id", { referencedTable: "task_assignments" }],
      },
    ])
  })

  it("returns [] with no further query when the month has no tasks", async () => {
    const { directoryCalls, rpc } = mockPlanner({ taskRows: [] })

    await expect(getPlanner("2026-10")).resolves.toEqual([])
    expect(rpc).not.toHaveBeenCalled()
    expect(directoryCalls).toEqual([])
  })

  it("keeps every task, Done included, marks yours from my_open_slots, and orders by due date then id", async () => {
    const { rpc } = mockPlanner({
      taskRows: [
        task(T1, "2026-10-20T09:00:00+00:00"),
        task(T3, "2026-10-10T09:00:00+00:00", { column: "done" }),
        task(T2, "2026-10-10T09:00:00+00:00", {
          owning_section_id: "news",
          owning_desk_id: null,
          sections: { name: "News" },
          desks: null,
        }),
      ],
    })

    const cards = await getPlanner("2026-10")

    expect(rpc).toHaveBeenCalledWith("my_open_slots")
    // T2 and T3 share a due time, so the id breaks the tie.
    expect(
      cards.map((card) => [
        card.id,
        card.column,
        card.yours,
        card.ownerKind,
        card.ownerId,
      ])
    ).toEqual([
      [T2, "to_do", false, "section", "news"],
      [T3, "done", false, "desk", "layout"],
      [T1, "to_do", true, "desk", "layout"],
    ])
  })

  it("builds task cards with names from the whole member_directory", async () => {
    const { directoryCalls } = mockPlanner({
      taskRows: [
        task(T1, "2026-10-01T00:00:00+00:00", {
          title: "Masthead brief",
          column: "doing",
          revision_note_at: "2026-09-30T00:00:00+00:00",
          sections: { name: "News" },
          desks: null,
          owning_section_id: "news",
          owning_desk_id: null,
          task_assignments: [
            { member_id: ME, state: "on_it" },
            { member_id: OTHER, state: "awaiting_response" },
            { member_id: "gone", state: "needs_reassignment" },
          ],
        }),
      ],
    })

    const cards = await getPlanner("2026-10")

    expect(directoryCalls).toEqual([{ method: "select", args: ["id, name"] }])
    expect(cards).toEqual([
      {
        id: T1,
        title: "Masthead brief",
        ownerName: "News",
        dueAt: "2026-10-01T00:00:00+00:00",
        column: "doing",
        overdue: true,
        sentBack: true,
        hasAwaitingResponse: true,
        hasNeedsReassignment: true,
        ownerId: "news",
        ownerKind: "section",
        yours: true,
        doneAt: null,
        assignees: [
          { id: ME, name: "Sam Layout", initials: "SL", handedBack: false },
          {
            id: OTHER,
            name: "Olive Writer",
            initials: "OW",
            handedBack: false,
          },
          // Their only slot is handed back.
          {
            id: "gone",
            name: "Former member",
            initials: "FM",
            handedBack: true,
          },
        ],
      },
    ])
  })

  it("throws when the read returns max_rows rows, which may be cut short", async () => {
    mockPlanner({
      taskRows: Array.from({ length: 1000 }, (_, n) =>
        task(`id-${n}`, "2026-10-10T09:00:00+00:00")
      ),
    })

    await expect(getPlanner("2026-10")).rejects.toThrow(
      "getPlanner: the month reached PostgREST's max_rows"
    )
  })

  it.each([
    ["tasks", { taskError: { message: "x" } }],
    [
      "my_open_slots",
      {
        taskRows: [task(T1, "2026-10-01T00:00:00+00:00")],
        openError: { message: "x" },
      },
    ],
    [
      "member_directory",
      {
        taskRows: [task(T1, "2026-10-01T00:00:00+00:00")],
        directoryError: { message: "x" },
      },
    ],
  ])("throws when reading %s fails", async (name, fixture) => {
    mockPlanner(fixture)

    await expect(getPlanner("2026-10")).rejects.toThrow(
      `getPlanner: reading ${name} failed`
    )
  })
})
