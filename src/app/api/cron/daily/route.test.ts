import { beforeEach, describe, expect, it, vi } from "vitest"

const SECRET = "a-cron-secret-of-at-least-32-characters-for-tests"

const { runDailyJob, recordErrorEvent, after, admin } = vi.hoisted(() => ({
  runDailyJob: vi.fn(),
  recordErrorEvent: vi.fn(async () => {}),
  after: vi.fn(),
  admin: { rpc: vi.fn() },
}))

vi.mock("./pipeline", () => ({ runDailyJob }))
vi.mock("next/server", () => ({ after }))
vi.mock("@/lib/record-error-event", () => ({ recordErrorEvent }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }))
vi.mock("@/lib/env.server", () => ({
  serverEnv: {
    CRON_SECRET: "a-cron-secret-of-at-least-32-characters-for-tests",
  },
}))

import { GET, maxDuration } from "./route"

const request = (authorization?: string) =>
  new Request("http://localhost/api/cron/daily", {
    headers: authorization === undefined ? {} : { authorization },
  })

beforeEach(() => {
  vi.clearAllMocks()
  runDailyJob.mockResolvedValue({
    skipped: false,
    runId: 1,
    status: "ok",
    steps: [{ name: "reminders", status: "ok", durationMs: 5 }],
  })
})

describe("GET /api/cron/daily", () => {
  it("allows 300 seconds", () => {
    expect(maxDuration).toBe(300)
  })

  it.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["the secret without Bearer", SECRET],
    [
      "a wrong secret of the same length",
      `Bearer ${"x".repeat(SECRET.length)}`,
    ],
    ["a shorter secret", "Bearer short"],
    ["a longer secret", `Bearer ${SECRET}extra`],
    ["a lowercase scheme", `bearer ${SECRET}`],
  ])("answers 401 and touches nothing with %s", async (_label, header) => {
    const response = await GET(request(header))

    expect(response.status).toBe(401)
    expect(runDailyJob).not.toHaveBeenCalled()
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(recordErrorEvent).not.toHaveBeenCalled()
  })

  it("runs the pipeline with the admin client for the right secret", async () => {
    const response = await GET(request(`Bearer ${SECRET}`))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({
      status: "ok",
      steps: [{ name: "reminders", status: "ok", durationMs: 5 }],
    })
    expect(runDailyJob).toHaveBeenCalledWith(
      admin,
      expect.any(Number),
      expect.objectContaining({ recordFault: expect.any(Function) })
    )
  })

  it("answers 200 {skipped:true} when a run is already open", async () => {
    runDailyJob.mockResolvedValue({ skipped: true })

    const response = await GET(request(`Bearer ${SECRET}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ skipped: true })
  })

  it("answers 500 for a failed run, with the steps", async () => {
    runDailyJob.mockResolvedValue({
      skipped: false,
      runId: 1,
      status: "failed",
      steps: [{ name: "drain", status: "failed", durationMs: 1 }],
    })

    const response = await GET(request(`Bearer ${SECRET}`))
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ status: "failed" })
  })

  it("records a step's fault through after()", async () => {
    runDailyJob.mockImplementation(async (_admin, _t, deps) => {
      deps.recordFault({ code: "42501" }, "cron daily reminders")
      return { skipped: true }
    })

    await GET(request(`Bearer ${SECRET}`))
    expect(after).toHaveBeenCalledOnce()
    await after.mock.calls[0][0]()
    expect(recordErrorEvent).toHaveBeenCalledWith(
      { code: "42501" },
      { route: "cron daily reminders" }
    )
  })

  it("records a thrown pipeline and answers 500 with no details", async () => {
    runDailyJob.mockRejectedValue(new Error("secret detail"))

    const response = await GET(request(`Bearer ${SECRET}`))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ status: "error" })
    await after.mock.calls[0][0]()
    expect(recordErrorEvent).toHaveBeenCalledWith(expect.any(Error), {
      route: "cron daily",
    })
  })
})
