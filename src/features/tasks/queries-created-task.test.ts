import { afterEach, describe, expect, it, vi } from "vitest"

const { createClient, getCurrentMember } = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentMember: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/server", () => ({ createClient }))
vi.mock("@/features/members", () => ({ getCurrentMember }))

import { hasCreatedTaskForViewer } from "./queries/created-task"

const VIEWER = "00000000-0000-4000-8000-000000000001"

afterEach(() => {
  vi.clearAllMocks()
})

function mockCount(result: { data: unknown[] | null; error: unknown }) {
  const calls: unknown[][] = []
  const builder = {
    select: (...args: unknown[]) => (calls.push(["select", ...args]), builder),
    eq: (...args: unknown[]) => (calls.push(["eq", ...args]), builder),
    limit: (...args: unknown[]) => (calls.push(["limit", ...args]), builder),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
  }
  createClient.mockResolvedValue({
    from: (table: string) => (calls.push(["from", table]), builder),
  })
  return calls
}

describe("hasCreatedTaskForViewer", () => {
  it("counts the viewer's own tasks with a one-row read", async () => {
    getCurrentMember.mockResolvedValue({ id: VIEWER, state: "active" })
    const calls = mockCount({ data: [{ id: "t" }], error: null })

    expect(await hasCreatedTaskForViewer()).toBe(true)
    expect(calls).toEqual([
      ["from", "tasks"],
      ["select", "id"],
      ["eq", "created_by", VIEWER],
      ["limit", 1],
    ])
  })

  it("is false with none", async () => {
    getCurrentMember.mockResolvedValue({ id: VIEWER, state: "active" })
    mockCount({ data: [], error: null })

    expect(await hasCreatedTaskForViewer()).toBe(false)
  })

  it.each([null, { id: VIEWER, state: "pending" }])(
    "is false without a query for a caller who isn't active (%j)",
    async (member) => {
      getCurrentMember.mockResolvedValue(member)

      expect(await hasCreatedTaskForViewer()).toBe(false)
      expect(createClient).not.toHaveBeenCalled()
    }
  )

  it("throws on a query error", async () => {
    getCurrentMember.mockResolvedValue({ id: VIEWER, state: "active" })
    mockCount({ data: null, error: { code: "57014", message: "canceled" } })

    await expect(hasCreatedTaskForViewer()).rejects.toThrow(
      "hasCreatedTaskForViewer: reading tasks failed"
    )
  })
})
