// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode, useOptimistic } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { StepUpContext, type StepUpRequester } from "./step-up"
import { useCommand } from "./use-command"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const { refresh, toastError } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }))

// resetAllMocks drops the mockImplementations some tests give toastError and
// refresh; restoreAllMocks undoes the navigator.onLine and console spies.
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

type Code = "thing.refused" | "thing.failed"
type Result = { ok: true; data: { id: string } } | { ok: false; code: Code }

const COPY: Record<Code, string> = {
  "thing.refused": "Refused copy",
  "thing.failed": "Failed copy",
}

function renderCommand() {
  return renderHook(() =>
    useCommand({
      errorMessage: (code: Code) => COPY[code],
      thrownCode: "thing.failed",
    })
  )
}

// useCommand as the command components use it: an optimistic value set
// inside the thunk, before the action's promise is returned.
function useOptimisticCommand(initial: string) {
  const { isPending, run } = useCommand({
    errorMessage: (code: Code) => COPY[code],
    thrownCode: "thing.failed",
  })
  const [shown, setShown] = useOptimistic(initial)
  return {
    isPending,
    shown,
    change(value: string, call: () => Promise<Result>) {
      run(() => {
        setShown(value)
        return call()
      })
    },
  }
}

describe("useCommand", () => {
  it("hands a success to onSuccess while still pending, with no toast or refresh", async () => {
    const { result } = renderCommand()
    const seen: { result: unknown; pending: boolean }[] = []
    const onFailure = vi.fn()

    act(() => {
      result.current.run(
        async (): Promise<Result> => ({ ok: true, data: { id: "t1" } }),
        {
          onSuccess: (success) =>
            seen.push({ result: success, pending: result.current.isPending }),
          onFailure,
        }
      )
    })

    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(seen).toEqual([
      { result: { ok: true, data: { id: "t1" } }, pending: true },
    ])
    expect(toastError).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalled()
  })

  it("toasts a refused result's copy, re-reads the page, then calls onFailure", async () => {
    const { result } = renderCommand()
    const order: string[] = []
    toastError.mockImplementation(() => order.push("toast"))
    refresh.mockImplementation(() => order.push("refresh"))
    const onSuccess = vi.fn()

    act(() => {
      result.current.run(
        async (): Promise<Result> => ({ ok: false, code: "thing.refused" }),
        {
          onSuccess,
          onFailure: (code) => order.push(`onFailure:${code}`),
        }
      )
    })

    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(toastError).toHaveBeenCalledWith("Refused copy")
    expect(order).toEqual(["toast", "refresh", "onFailure:thing.refused"])
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it("treats a thrown call as the caller's thrown code", async () => {
    const { result } = renderCommand()
    const order: string[] = []
    toastError.mockImplementation(() => order.push("toast"))
    refresh.mockImplementation(() => order.push("refresh"))
    const onSuccess = vi.fn()

    act(() => {
      result.current.run(
        (): Promise<Result> => Promise.reject(new Error("network")),
        {
          onSuccess,
          onFailure: (code) => order.push(`onFailure:${code}`),
        }
      )
    })

    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(toastError).toHaveBeenCalledWith("Failed copy")
    expect(order).toEqual(["toast", "refresh", "onFailure:thing.failed"])
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it("skips the re-read while offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
    const { result } = renderCommand()

    act(() => {
      result.current.run(async (): Promise<Result> => ({
        ok: false,
        code: "thing.refused",
      }))
    })

    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(toastError).toHaveBeenCalledWith("Refused copy")
    expect(refresh).not.toHaveBeenCalled()
  })

  // The reason run takes a thunk: React warns about an optimistic update made
  // outside a transition or action.
  it("runs the thunk inside the transition, so an optimistic value shows until the call settles", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const { result } = renderHook(() => useOptimisticCommand("to_do"))
    let settle: (value: Result) => void = () => {}

    act(() => {
      result.current.change(
        "doing",
        () =>
          new Promise<Result>((resolve) => {
            settle = resolve
          })
      )
    })

    await waitFor(() => expect(result.current.isPending).toBe(true))
    expect(result.current.shown).toBe("doing")

    await act(async () => settle({ ok: false, code: "thing.refused" }))
    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(result.current.shown).toBe("to_do")
    expect(toastError).toHaveBeenCalledWith("Refused copy")

    const messages = consoleError.mock.calls.map((args) =>
      args.map(String).join(" ")
    )
    expect(
      messages.filter((message) => /outside a transition/.test(message))
    ).toEqual([])
  })

  it("ignores a run while one is pending, never calling its thunk", async () => {
    const { result } = renderCommand()
    let settle: (value: Result) => void = () => {}
    const first = vi.fn(
      () =>
        new Promise<Result>((resolve) => {
          settle = resolve
        })
    )
    const second = vi.fn(async (): Promise<Result> => ({
      ok: true,
      data: { id: "t2" },
    }))

    act(() => {
      result.current.run(first)
    })
    await waitFor(() => expect(result.current.isPending).toBe(true))

    act(() => {
      result.current.run(second)
    })
    expect(second).not.toHaveBeenCalled()

    await act(async () => settle({ ok: true, data: { id: "t1" } }))
    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })
})

describe("useCommand step-up", () => {
  type StepUpResult =
    | { ok: true; data: { id: string } }
    | { ok: false; code: Code | "auth.step_up_required" }

  const STEP_UP: StepUpResult = { ok: false, code: "auth.step_up_required" }
  const OK: StepUpResult = { ok: true, data: { id: "t1" } }

  function renderWith(requester: StepUpRequester | null) {
    return renderHook(
      () =>
        useCommand({
          errorMessage: (code: Code | "auth.step_up_required") =>
            code === "auth.step_up_required" ? "Step-up copy" : COPY[code],
          thrownCode: "thing.failed",
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(StepUpContext.Provider, { value: requester }, children),
      }
    )
  }

  it("asks for a code, then retries the call once and hands on the success", async () => {
    const requestStepUp = vi.fn().mockResolvedValue(true)
    const call = vi
      .fn<() => Promise<StepUpResult>>()
      .mockResolvedValueOnce(STEP_UP)
      .mockResolvedValueOnce(OK)
    const onSuccess = vi.fn()
    const { result } = renderWith({ requestStepUp })

    act(() => result.current.run(call, { onSuccess }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(OK))
    expect(requestStepUp).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledTimes(2)
    expect(toastError).not.toHaveBeenCalled()
  })

  it("ends quietly when the prompt is cancelled", async () => {
    const requestStepUp = vi.fn().mockResolvedValue(false)
    const call = vi.fn(async () => STEP_UP)
    const onSuccess = vi.fn()
    const onFailure = vi.fn()
    const { result } = renderWith({ requestStepUp })

    act(() => result.current.run(call, { onSuccess, onFailure }))

    await waitFor(() => expect(requestStepUp).toHaveBeenCalled())
    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(call).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalled()
  })

  it("takes the failure path on a second refusal, without a third call", async () => {
    const requestStepUp = vi.fn().mockResolvedValue(true)
    const call = vi.fn(async () => STEP_UP)
    const { result } = renderWith({ requestStepUp })

    act(() => result.current.run(call))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Step-up copy"))
    expect(call).toHaveBeenCalledTimes(2)
    expect(requestStepUp).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalled()
  })

  it("doesn't turn a synchronous throw from the thunk on retry into the toast", async () => {
    const requestStepUp = vi.fn().mockResolvedValue(true)
    let calls = 0
    const call = (): Promise<StepUpResult> => {
      if (++calls === 2) throw new Error("programming error")
      return Promise.resolve(STEP_UP)
    }
    const { result } = renderWith({ requestStepUp })
    // React reports the throw as an uncaught error; it is the expected one.
    const swallow = (event: ErrorEvent) => event.preventDefault()
    window.addEventListener("error", swallow)

    act(() => result.current.run(call))

    await waitFor(() => expect(calls).toBe(2))
    await new Promise((resolve) => setTimeout(resolve))
    window.removeEventListener("error", swallow)
    expect(toastError).not.toHaveBeenCalled()
  })

  it("takes the failure path at once with no provider", async () => {
    const call = vi.fn(async () => STEP_UP)
    const { result } = renderWith(null)

    act(() => result.current.run(call))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Step-up copy"))
    expect(call).toHaveBeenCalledTimes(1)
  })
})
