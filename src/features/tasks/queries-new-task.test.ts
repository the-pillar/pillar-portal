import { afterEach, describe, expect, it, vi } from "vitest"

const recordErrorEvent = vi.hoisted(() => vi.fn())

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { createClient, getTaskFormOptions, getReassignOptions, getMyHomeScope } =
  vi.hoisted(() => ({
    createClient: vi.fn(),
    getTaskFormOptions: vi.fn(),
    getReassignOptions: vi.fn(),
    getMyHomeScope: vi.fn(),
  }))

vi.mock("server-only", () => ({}))
// after() runs its callback at once here.
vi.mock("next/server", () => ({
  after: (callback: () => unknown) => void callback(),
}))
vi.mock("@/lib/record-error-event", () => ({
  recordErrorEvent: (...args: unknown[]) => recordErrorEvent(...args),
}))
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  // cache() memoizes per request; each test is its own.
  cache: <T>(fn: T) => fn,
}))
vi.mock("@/lib/supabase/server", () => ({ createClient }))
vi.mock("@/features/members", () => ({ getMyHomeScope }))
vi.mock("./queries/task-form", () => ({ getTaskFormOptions }))
vi.mock("./queries/reassign", () => ({ getReassignOptions }))

import {
  canCreateTask,
  getNewTaskLayoutData,
  getTaskFormOptionsWithLoad,
} from "./queries/new-task"

const MEMBER = "00000000-0000-4000-8000-000000000001"

const OPTIONS = {
  owners: [
    { kind: "section" as const, id: "news", name: "News" },
    { kind: "desk" as const, id: "layout", name: "Layout" },
  ],
  slotMembersByRole: { layout_artist: [{ id: MEMBER, name: "Head" }] },
  allMembers: [{ id: MEMBER, name: "Head" }],
  roleLabels: {},
}

function mockCan(data: unknown, error: unknown = null) {
  const rpc = vi.fn(() => Promise.resolve({ data, error }))
  createClient.mockResolvedValue({ rpc })
  return rpc
}

function mockReads() {
  getTaskFormOptions.mockResolvedValue(OPTIONS)
  getReassignOptions.mockResolvedValue({
    slotMembersByRole: {},
    allMembers: [{ id: MEMBER, name: "Head", openSlots: 4 }],
    roleLabels: {},
  })
  getMyHomeScope.mockResolvedValue({ kind: "desk", id: "layout" })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe("canCreateTask", () => {
  it("is can_create_task()'s answer", async () => {
    const rpc = mockCan(true)
    expect(await canCreateTask()).toBe(true)
    expect(rpc).toHaveBeenCalledExactlyOnceWith("can_create_task")

    mockCan(false)
    expect(await canCreateTask()).toBe(false)
  })

  it("is false when the read fails", async () => {
    mockCan(null, { message: "boom" })
    expect(await canCreateTask()).toBe(false)
    expect(recordErrorEvent).toHaveBeenCalledOnce()
  })
})

describe("getTaskFormOptionsWithLoad", () => {
  it("adds each member's open slots to the desk lists and everyone", async () => {
    mockReads()

    const options = await getTaskFormOptionsWithLoad()

    expect(options.slotMembersByRole.layout_artist).toEqual([
      { id: MEMBER, name: "Head", openSlots: 4 },
    ])
    expect(options.allMembers).toEqual([
      { id: MEMBER, name: "Head", openSlots: 4 },
    ])
    expect(options.owners).toEqual(OPTIONS.owners)
  })
})

describe("getNewTaskLayoutData", () => {
  it("is null, and reads nothing more, without can_create_task", async () => {
    mockCan(false)
    mockReads()

    expect(await getNewTaskLayoutData()).toBeNull()
    expect(getTaskFormOptions).not.toHaveBeenCalled()
  })

  it("carries the options with load and the home scope as an owner", async () => {
    mockCan(true)
    mockReads()

    const data = await getNewTaskLayoutData()

    expect(data?.homeOwner).toBe("desk:layout")
    expect(data?.options.allMembers[0]?.openSlots).toBe(4)
  })

  it.each([
    { kind: "all" },
    { kind: "articles" },
    { kind: "desk", id: "gone" },
  ])("has no home owner for %j", async (scope) => {
    mockCan(true)
    mockReads()
    getMyHomeScope.mockResolvedValue(scope)

    expect((await getNewTaskLayoutData())?.homeOwner).toBeNull()
  })

  it("is null rather than breaking the layout when a read fails", async () => {
    mockCan(true)
    getTaskFormOptions.mockRejectedValue(new Error("boom"))

    expect(await getNewTaskLayoutData()).toBeNull()
    expect(recordErrorEvent).toHaveBeenCalledOnce()
  })
})
