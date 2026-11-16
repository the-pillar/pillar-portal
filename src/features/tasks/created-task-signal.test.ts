import { afterEach, describe, expect, it, vi } from "vitest"

import {
  clearCreatedTask,
  emitCreatedTask,
  subscribeCreatedTask,
} from "./created-task-signal"

afterEach(() => {
  vi.useRealTimers()
  clearCreatedTask("a")
})

describe("created task signal", () => {
  it("tells a subscriber the id, and stops after it unsubscribes", () => {
    const heard = vi.fn()
    const off = subscribeCreatedTask(heard)
    emitCreatedTask("a")
    expect(heard).toHaveBeenCalledExactlyOnceWith("a")

    clearCreatedTask("a")
    off()
    emitCreatedTask("a")
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it("replays a fresh id to a view that mounts just after, until it is cleared", () => {
    emitCreatedTask("a")
    const late = vi.fn()
    subscribeCreatedTask(late)()
    expect(late).toHaveBeenCalledExactlyOnceWith("a")

    clearCreatedTask("a")
    const later = vi.fn()
    subscribeCreatedTask(later)()
    expect(later).not.toHaveBeenCalled()
  })

  it("does not replay a stale id", () => {
    vi.useFakeTimers()
    emitCreatedTask("a")
    vi.advanceTimersByTime(61_000)
    const late = vi.fn()
    subscribeCreatedTask(late)()
    expect(late).not.toHaveBeenCalled()
  })
})
