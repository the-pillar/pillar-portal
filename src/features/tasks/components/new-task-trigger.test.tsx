// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const { openNewTask } = vi.hoisted(() => ({ openNewTask: vi.fn() }))
vi.mock("../new-task-url", () => ({ openNewTask }))

import { NewTaskTrigger } from "./new-task-trigger"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("NewTaskTrigger", () => {
  it("opens the New task sheet from the URL, with no prefill", async () => {
    const user = userEvent.setup()
    render(<NewTaskTrigger />)

    await user.click(screen.getByRole("button", { name: "Create a task" }))

    expect(openNewTask).toHaveBeenCalledExactlyOnceWith()
  })
})
