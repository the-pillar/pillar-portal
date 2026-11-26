import { afterEach, describe, expect, it, vi } from "vitest"

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock("@/lib/supabase/server", () => ({ createClient }))
// ./queries/shared reaches the members barrel, whose actions.ts reads the
// server-only env and env.client; these tests use neither.
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))
vi.mock("@/features/members/actions", () => ({}))

import { getDeliverableLinks } from "./queries/deliverable-links"

afterEach(() => {
  vi.clearAllMocks()
})

type Call = { method: string; args: unknown[] }

const T1 = "00000000-0000-4000-8000-0000000000b1"
const T2 = "00000000-0000-4000-8000-0000000000b2"
const S1 = "00000000-0000-4000-8000-0000000000c1"
const S2 = "00000000-0000-4000-8000-0000000000c2"
const OLIVE = "00000000-0000-4000-8000-0000000000a1"
const GONE = "00000000-0000-4000-8000-0000000000a2"

// As the database returns them: in seq order, which isn't id or time order.
const LINKS = [
  {
    id: "00000000-0000-4000-8000-0000000000d3",
    slot_id: S1,
    url: "https://canva.example/3",
    added_by: OLIVE,
    added_at: "2026-11-26T02:00:00.123456+00:00",
    task_assignments: { task_id: T1 },
  },
  {
    id: "00000000-0000-4000-8000-0000000000d1",
    slot_id: S1,
    url: "https://canva.example/1",
    added_by: GONE,
    added_at: "2026-11-26T02:00:00.123456+00:00",
    task_assignments: { task_id: T1 },
  },
  {
    id: "00000000-0000-4000-8000-0000000000d2",
    slot_id: S2,
    url: "https://drive.example/2",
    added_by: OLIVE,
    added_at: "2026-11-26T03:00:00+00:00",
    task_assignments: { task_id: T2 },
  },
]

type Fixture = {
  links?: unknown
  linksError?: unknown
  directoryError?: unknown
}

function mockRead(fixture: Fixture = {}) {
  const linkCalls: Call[] = []
  const directoryCalls: Call[] = []
  const recorder = (calls: Call[], result: () => unknown) => {
    const builder: Record<string, unknown> = {}
    for (const method of ["select", "order", "in"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args })
        return builder
      }
    }
    builder.then = (resolve: (value: unknown) => void) => resolve(result())
    return builder
  }
  const from = vi.fn((table: string) => {
    if (table === "task_deliverable_links") {
      return recorder(linkCalls, () => ({
        data: fixture.links ?? LINKS,
        error: fixture.linksError ?? null,
      }))
    }
    if (table === "member_directory") {
      // GONE has left, so the directory doesn't list them.
      return recorder(directoryCalls, () => ({
        data: [{ id: OLIVE, name: "Olive Writer" }],
        error: fixture.directoryError ?? null,
      }))
    }
    throw new Error(`unexpected table: ${table}`)
  })
  createClient.mockResolvedValue({ from })
  return { linkCalls, directoryCalls, from }
}

describe("getDeliverableLinks", () => {
  it("returns [] without a query for no ids", async () => {
    const { from } = mockRead()

    expect(await getDeliverableLinks([])).toEqual([])
    expect(createClient).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it("filters the given tasks in the query and orders by seq", async () => {
    const { linkCalls } = mockRead()

    await getDeliverableLinks([T1, T2])

    expect(linkCalls).toContainEqual({
      method: "in",
      args: ["task_assignments.task_id", [T1, T2]],
    })
    expect(linkCalls).toContainEqual({ method: "order", args: ["seq"] })
  })

  it("keeps the database's seq order and names each link's adder", async () => {
    mockRead()

    const links = await getDeliverableLinks([T1, T2])

    expect(links.map((link) => link.url)).toEqual([
      "https://canva.example/3",
      "https://canva.example/1",
      "https://drive.example/2",
    ])
    expect(links[0]).toEqual({
      id: "00000000-0000-4000-8000-0000000000d3",
      slotId: S1,
      taskId: T1,
      url: "https://canva.example/3",
      addedBy: OLIVE,
      addedByName: "Olive Writer",
      addedAt: "2026-11-26T02:00:00.123456+00:00",
    })
    expect(links[2].taskId).toBe(T2)
  })

  it('names a member who has left "Former member"', async () => {
    mockRead()

    const links = await getDeliverableLinks([T1, T2])

    expect(links[1].addedByName).toBe("Former member")
  })

  it("reads the directory only for the members who added a link", async () => {
    const { directoryCalls } = mockRead()

    await getDeliverableLinks([T1, T2])

    expect(directoryCalls).toContainEqual({
      method: "in",
      args: ["id", [OLIVE, GONE]],
    })
  })

  it("skips the directory when there are no links", async () => {
    const { directoryCalls } = mockRead({ links: [] })

    expect(await getDeliverableLinks([T1])).toEqual([])
    expect(directoryCalls).toEqual([])
  })

  it("throws, naming the function, on a link query error", async () => {
    mockRead({ linksError: { message: "boom" } })

    await expect(getDeliverableLinks([T1])).rejects.toThrow(
      /getDeliverableLinks/
    )
  })

  it("throws, naming the function, on a directory query error", async () => {
    mockRead({ directoryError: { message: "boom" } })

    await expect(getDeliverableLinks([T1])).rejects.toThrow(
      /getDeliverableLinks/
    )
  })
})
