// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { getBoard, getBoardOwners, getMyHomeScope, canCreateTask, TaskBoard } =
  vi.hoisted(() => ({
    getBoard: vi.fn(),
    canCreateTask: vi.fn(),
    getBoardOwners: vi.fn(),
    getMyHomeScope: vi.fn(),
    TaskBoard: vi.fn(() => <p>board</p>),
  }))

vi.mock("@/features/members", () => ({ getMyHomeScope }))
vi.mock("@/features/tasks", async () => {
  // vi.importActual isn't an import statement, so the slice-boundary lint
  // rule (which wants @/features/tasks through its index) doesn't see it.
  const board = await vi.importActual<typeof import("@/features/tasks/board")>(
    "@/features/tasks/board"
  )
  return {
    ownerFilterParam: board.ownerFilterParam,
    parseOwnerFilterParam: board.parseOwnerFilterParam,
    getBoard,
    getBoardOwners,
    canCreateTask,
    TaskBoard,
  }
})

import { BoardColumns } from "./board-columns"

beforeEach(() => {
  canCreateTask.mockResolvedValue(true)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const OWNERS = [
  { kind: "section", id: "news", name: "News" },
  { kind: "desk", id: "layout", name: "Layout" },
]

function props(call = 0) {
  return (TaskBoard.mock.calls[call] as unknown as [Record<string, unknown>])[0]
}

describe("BoardColumns", () => {
  it("reads the whole window once, unfiltered, and hands it to TaskBoard with the viewer and home scope", async () => {
    getBoardOwners.mockResolvedValue(OWNERS)
    getMyHomeScope.mockResolvedValue({ kind: "desk", id: "layout" })
    getBoard.mockResolvedValue([{ id: "a" }])

    render(await BoardColumns({ viewerId: "me" }))

    expect(getBoard).toHaveBeenCalledWith()
    expect(screen.getByText("board")).toBeInTheDocument()
    expect(props()).toEqual({
      cards: [{ id: "a" }],
      owners: OWNERS,
      viewerId: "me",
      homeFilter: { kind: "desk", id: "layout" },
      canCreate: true,
    })
  })

  it("hands canCreate false when can_create_task says no", async () => {
    canCreateTask.mockResolvedValue(false)
    getBoardOwners.mockResolvedValue(OWNERS)
    getMyHomeScope.mockResolvedValue({ kind: "all" })
    getBoard.mockResolvedValue([])

    render(await BoardColumns({ viewerId: "me" }))

    expect(props().canCreate).toBe(false)
  })

  it("falls back to All when the home scope names no listed owner", async () => {
    getBoardOwners.mockResolvedValue(OWNERS)
    getMyHomeScope.mockResolvedValue({ kind: "desk", id: "gone" })
    getBoard.mockResolvedValue([])

    render(await BoardColumns({ viewerId: "me" }))

    expect(props().homeFilter).toEqual({ kind: "all" })
  })

  it("lets a query failure throw", async () => {
    getBoardOwners.mockResolvedValue(OWNERS)
    getMyHomeScope.mockResolvedValue({ kind: "all" })
    getBoard.mockRejectedValue(new Error("boom"))

    await expect(BoardColumns({ viewerId: "me" })).rejects.toThrow("boom")
  })
})
