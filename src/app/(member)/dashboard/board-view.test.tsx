// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const { TaskChangesRefresher, BoardColumns } = vi.hoisted(() => ({
  TaskChangesRefresher: vi.fn(() => <p>refresher</p>),
  // An async Server Component, which React can't render on the client.
  BoardColumns: vi.fn(({ viewerId }: { viewerId: string }) => (
    <p>columns for {viewerId}</p>
  )),
}))

vi.mock("@/features/tasks", () => ({ TaskChangesRefresher }))
vi.mock("./board-columns", () => ({ BoardColumns }))

import {
  Suspense,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react"

import { BoardColumnsSkeleton } from "./board-skeleton"
import { BoardView } from "./board-view"

// The first element of `type` in a rendered tree, searched depth-first.
function findElement(node: ReactNode, type: unknown): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type)
      if (found) return found
    }
    return undefined
  }
  if (!isValidElement(node)) return undefined
  if (node.type === type) return node
  return findElement((node.props as { children?: ReactNode }).children, type)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("BoardView", () => {
  it("has the serif h1 Board, the live refresher and the columns", () => {
    render(<BoardView viewerId="me" />)

    const h1 = screen.getByRole("heading", { level: 1, name: "Board" })
    expect(h1).toHaveClass("font-heading")
    expect(screen.getByText("refresher")).toBeInTheDocument()
    expect(screen.getByText("columns for me")).toBeInTheDocument()
  })

  it("marks its root for the wide shell", () => {
    const { container } = render(<BoardView viewerId="me" />)

    expect(container.firstElementChild).toHaveAttribute("data-wide-view")
  })

  it("loads the columns under one unkeyed Suspense boundary, with the refresher outside it", () => {
    const tree = BoardView({ viewerId: "me" })
    const boundary = findElement(tree, Suspense)

    expect(boundary?.key).toBeNull()
    const props = boundary?.props as {
      fallback: ReactElement
      children: ReactNode
    }
    expect(props.fallback.type).toBe(BoardColumnsSkeleton)
    expect(findElement(props.children, BoardColumns)).toBeDefined()
    expect(findElement(props.children, TaskChangesRefresher)).toBeUndefined()
  })
})
