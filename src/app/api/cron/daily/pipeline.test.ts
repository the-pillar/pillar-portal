import { beforeEach, describe, expect, it, vi } from "vitest"

const { drainOutbox } = vi.hoisted(() => ({ drainOutbox: vi.fn() }))

vi.mock("@/features/email", () => ({ drainOutbox }))
vi.mock("@/lib/record-error-event", () => ({
  errorCodeOf: (error: unknown) =>
    (error as { code?: string } | null)?.code ?? "unknown",
}))

import { DAILY_STEPS, DRAIN_BUDGET_MS, runDailyJob } from "./pipeline"

type Call = { fn: string; args: Record<string, unknown> | undefined }

// An admin stub: `results` maps an RPC name to what it resolves to, or a
// function of its args; every call is kept in order.
function admin(results: Record<string, unknown> = {}) {
  const calls: Call[] = []
  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    calls.push({ fn, args })
    const result = results[fn]
    const value = typeof result === "function" ? result(args) : result
    return value ?? { data: null, error: null }
  })
  return { client: { rpc } as never, calls, rpc }
}

const happy = {
  begin_job_run: { data: 41, error: null },
  enqueue_due_reminders: { data: 3, error: null },
  sweep_shared_sessions: { data: 2, error: null },
  run_retention: {
    data: { error_events_deleted: 4, outbox_cleared: 5 },
    error: null,
  },
}

beforeEach(() => {
  drainOutbox.mockReset()
  drainOutbox.mockResolvedValue({
    claimed: 3,
    sent: 3,
    dropped: 0,
    failed: 0,
    gone: 0,
  })
})

describe("DAILY_STEPS", () => {
  it("is reminders 1, drain 2, sweep 5, retention 6, with gaps for 3 and 4", () => {
    expect(DAILY_STEPS.map(({ position, name }) => [position, name])).toEqual([
      [1, "reminders"],
      [2, "drain"],
      [5, "sweep"],
      [6, "retention"],
    ])
    expect(DAILY_STEPS.every((step) => step.label.length > 0)).toBe(true)
  })
})

describe("runDailyJob", () => {
  it("opens a run, runs the four steps in order, logs each and closes ok", async () => {
    const { client, calls } = admin(happy)
    const run = await runDailyJob(client, Date.now())

    expect(run).toMatchObject({
      skipped: false,
      runId: 41,
      status: "ok",
      steps: [
        { name: "reminders", status: "ok" },
        { name: "drain", status: "ok" },
        { name: "sweep", status: "ok" },
        { name: "retention", status: "ok" },
      ],
    })
    expect(calls.map((call) => call.fn)).toEqual([
      "begin_job_run",
      "enqueue_due_reminders",
      "record_job_step",
      "record_job_step",
      "sweep_shared_sessions",
      "record_job_step",
      "run_retention",
      "record_job_step",
      "end_job_run",
    ])
    expect(calls[0].args).toEqual({ job: "daily" })
    expect(
      calls.filter((c) => c.fn === "record_job_step").map((c) => c.args)
    ).toEqual([
      expect.objectContaining({
        run_id: 41,
        step: "reminders",
        status: "ok",
        detail: { queued: 3 },
      }),
      expect.objectContaining({
        run_id: 41,
        step: "drain",
        status: "ok",
        detail: { claimed: 3, sent: 3, dropped: 0, failed: 0, gone: 0 },
      }),
      expect.objectContaining({
        run_id: 41,
        step: "sweep",
        status: "ok",
        detail: { sessions_deleted: 2 },
      }),
      expect.objectContaining({
        run_id: 41,
        step: "retention",
        status: "ok",
        detail: { error_events_deleted: 4, outbox_cleared: 5 },
      }),
    ])
    expect(calls.at(-1)).toEqual({
      fn: "end_job_run",
      args: { id: 41, status: "ok", detail: { failed_steps: 0 } },
    })
  })

  it("skips everything when a run is already open", async () => {
    const { client, calls } = admin({
      begin_job_run: { data: null, error: null },
    })

    await expect(runDailyJob(client, Date.now())).resolves.toEqual({
      skipped: true,
    })
    expect(calls.map((call) => call.fn)).toEqual(["begin_job_run"])
    expect(drainOutbox).not.toHaveBeenCalled()
  })

  it("gives the drain what is left of 240 s from the run's start", async () => {
    const { client } = admin(happy)
    const startedAt = Date.now() - 30_000
    await runDailyJob(client, startedAt)

    const { deadlineMs } = drainOutbox.mock.calls[0][0]
    expect(deadlineMs).toBeLessThanOrEqual(DRAIN_BUDGET_MS - 30_000)
    expect(deadlineMs).toBeGreaterThan(DRAIN_BUDGET_MS - 31_000)
  })

  it("never gives the drain a negative deadline", async () => {
    const { client } = admin(happy)
    await runDailyJob(client, Date.now() - 500_000)
    expect(drainOutbox.mock.calls[0][0].deadlineMs).toBe(0)
  })

  it("runs later steps after a failed one, logs it failed and closes the run failed", async () => {
    const fault = { code: "42501" }
    const { client, calls } = admin({
      ...happy,
      enqueue_due_reminders: { data: null, error: fault },
    })
    const recordFault = vi.fn()

    const run = await runDailyJob(client, Date.now(), { recordFault })

    expect(run).toMatchObject({
      skipped: false,
      status: "failed",
      steps: [
        { name: "reminders", status: "failed" },
        { name: "drain", status: "ok" },
        { name: "sweep", status: "ok" },
        { name: "retention", status: "ok" },
      ],
    })
    expect(recordFault).toHaveBeenCalledWith(fault, "cron daily reminders")
    expect(calls.find((c) => c.fn === "record_job_step")?.args).toMatchObject({
      step: "reminders",
      status: "failed",
      detail: { code: "42501" },
    })
    expect(calls.at(-1)).toEqual({
      fn: "end_job_run",
      args: { id: 41, status: "failed", detail: { failed_steps: 1 } },
    })
    expect(drainOutbox).toHaveBeenCalledOnce()
  })

  it("fails the drain step, and the run, when the drain reports a fault, recording nothing twice", async () => {
    drainOutbox.mockResolvedValue({
      claimed: 0,
      sent: 0,
      dropped: 0,
      failed: 0,
      gone: 0,
      faulted: true,
    })
    const { client, calls } = admin(happy)
    const recordFault = vi.fn()

    const run = await runDailyJob(client, Date.now(), { recordFault })

    expect(run).toMatchObject({ status: "failed" })
    expect(run).toMatchObject({
      steps: expect.arrayContaining([
        { name: "drain", status: "failed", durationMs: expect.any(Number) },
      ]),
    })
    expect(recordFault).not.toHaveBeenCalled()
    expect(
      calls.find((c) => c.fn === "record_job_step" && c.args?.step === "drain")
        ?.args
    ).toMatchObject({
      status: "failed",
      detail: { code: "email.drain_faulted" },
    })
  })

  it("treats a throwing drain like any failed step", async () => {
    drainOutbox.mockRejectedValue(new Error("boom"))
    const { client } = admin(happy)
    const recordFault = vi.fn()

    const run = await runDailyJob(client, Date.now(), { recordFault })

    expect(run).toMatchObject({ status: "failed" })
    expect(recordFault).toHaveBeenCalledWith(
      expect.any(Error),
      "cron daily drain"
    )
  })

  it("records a step it couldn't log, and goes on", async () => {
    const logFault = { code: "P0001" }
    const { client, calls } = admin({
      ...happy,
      record_job_step: { data: null, error: logFault },
    })
    const recordFault = vi.fn()

    const run = await runDailyJob(client, Date.now(), { recordFault })

    expect(run).toMatchObject({ status: "ok" })
    expect(recordFault).toHaveBeenCalledTimes(4)
    expect(calls.at(-1)?.fn).toBe("end_job_run")
  })

  it("runs steps in position order whatever the array order", async () => {
    const order: string[] = []
    const step = (position: number, name: string) => ({
      position,
      name,
      label: name,
      run: async () => (order.push(name), {}),
    })
    const { client } = admin(happy)

    await runDailyJob(client, Date.now(), {
      steps: [step(6, "c"), step(1, "a"), step(5, "b")],
    })
    expect(order).toEqual(["a", "b", "c"])
  })

  it("lets a failed begin_job_run or end_job_run reach the caller", async () => {
    const begin = admin({
      begin_job_run: { data: null, error: new Error("down") },
    })
    await expect(runDailyJob(begin.client, Date.now())).rejects.toThrow("down")

    const end = admin({
      ...happy,
      end_job_run: { data: null, error: new Error("end") },
    })
    await expect(runDailyJob(end.client, Date.now())).rejects.toThrow("end")
  })
})
