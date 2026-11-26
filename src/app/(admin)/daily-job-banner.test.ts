import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Result = { data: unknown; error: unknown }
type Query = { table: string; calls: unknown[][] }

const { state, createClient } = vi.hoisted(() => {
  const state = {
    production: true,
    queries: [] as Query[],
    // The results the queries resolve to, in order.
    results: [] as Result[],
  }
  const from = (table: string) => {
    const query: Query = { table, calls: [] }
    state.queries.push(query)
    const record =
      (name: string) =>
      (...args: unknown[]) => (query.calls.push([name, ...args]), builder)
    const builder = {
      select: record("select"),
      eq: record("eq"),
      is: record("is"),
      in: record("in"),
      order: record("order"),
      limit: record("limit"),
      maybeSingle: async () => {
        query.calls.push(["maybeSingle"])
        return state.results.shift() ?? { data: null, error: null }
      },
    }
    return builder
  }
  return { state, createClient: vi.fn(async () => ({ from })) }
})

vi.mock("@/lib/supabase/server", () => ({ createClient }))
vi.mock("@/lib/env.server", () => ({
  get isProduction() {
    return state.production
  },
}))

import { ADMIN_BANNER_SOURCES } from "./admin-banner-sources"
import {
  DAILY_JOB_STALE_HOURS,
  dailyJobBanner,
  dailyJobBannerOf,
} from "./daily-job-banner"

const HOUR_MS = 60 * 60 * 1000
const NOW = new Date("2026-12-01T04:00:00.000Z")
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

beforeEach(() => {
  state.production = true
  state.queries = []
  state.results = []
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

const okRun = (age: number) => ({
  startedAt: ago(age),
  status: "ok" as const,
  failedStepLabel: null,
})

describe("dailyJobBannerOf", () => {
  it("counts a run stale after 36 hours", () => {
    expect(DAILY_JOB_STALE_HOURS).toBe(36)
  })

  it("shows nothing for a run exactly 36 h old, or a recent one", () => {
    expect(dailyJobBannerOf(okRun(36 * HOUR_MS), null, NOW)).toBeNull()
    expect(dailyJobBannerOf(okRun(HOUR_MS), null, NOW)).toBeNull()
  })

  it("shows stale 36 h + 1 ms after the last start, since start + 36 h", () => {
    const run = okRun(36 * HOUR_MS + 1)
    expect(dailyJobBannerOf(run, null, NOW)).toEqual({
      id: "daily-job",
      family: "attention",
      // 2026-11-29T15:59:59.999Z is 23:59 on Nov 29 in Manila.
      text: "Daily jobs haven't run since Nov 29, 11:59 PM. Reminders and queued emails are waiting.",
      since: new Date(NOW.getTime() - 1).toISOString(),
    })
  })

  it("with no run, is stale since the bootstrap start (37 h ago)", () => {
    const banner = dailyJobBannerOf(null, ago(37 * HOUR_MS), NOW)
    expect(banner?.text).toBe(
      "Daily jobs haven't run since Nov 29, 11:00 PM. Reminders and queued emails are waiting."
    )
    expect(banner?.since).toBe(ago(HOUR_MS))
  })

  it("with no run and a recent bootstrap, or neither, shows nothing", () => {
    expect(dailyJobBannerOf(null, ago(35 * HOUR_MS), NOW)).toBeNull()
    expect(dailyJobBannerOf(null, null, NOW)).toBeNull()
  })

  it("names the failed step of the last run, since its start", () => {
    const run = {
      startedAt: ago(2 * HOUR_MS),
      status: "failed" as const,
      failedStepLabel: "email drain",
    }
    expect(dailyJobBannerOf(run, null, NOW)).toEqual({
      id: "daily-job",
      family: "attention",
      text: "Last run's email drain failed.",
      since: ago(2 * HOUR_MS),
    })
  })

  it("lets stale win over failed", () => {
    const run = {
      startedAt: ago(40 * HOUR_MS),
      status: "failed" as const,
      failedStepLabel: "retention",
    }
    expect(dailyJobBannerOf(run, null, NOW)?.text).toMatch(/haven't run since/)
  })

  it("calls a failed run with no failed step the daily job", () => {
    const run = {
      startedAt: ago(HOUR_MS),
      status: "failed" as const,
      failedStepLabel: null,
    }
    expect(dailyJobBannerOf(run, null, NOW)?.text).toBe(
      "Last run's daily job failed."
    )
  })

  it("throws on a start that isn't a timestamp", () => {
    expect(() =>
      dailyJobBannerOf({ ...okRun(0), startedAt: "nope" }, null, NOW)
    ).toThrow(RangeError)
  })
})

describe("dailyJobBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] })
  })

  it("reads the newest non-skipped run through the caller's session", async () => {
    state.results = [
      { data: { id: 7, started_at: ago(HOUR_MS), status: "ok" }, error: null },
    ]

    await expect(dailyJobBanner()).resolves.toEqual([])
    expect(state.queries).toEqual([
      {
        table: "job_runs",
        calls: [
          ["select", "id, started_at, status"],
          ["eq", "job", "daily"],
          ["is", "run_id", null],
          ["in", "status", ["ok", "failed"]],
          ["order", "started_at", { ascending: false }],
          ["limit", 1],
          ["maybeSingle"],
        ],
      },
    ])
  })

  it("names the failed step of a failed run", async () => {
    state.results = [
      {
        data: { id: 7, started_at: ago(HOUR_MS), status: "failed" },
        error: null,
      },
      { data: { step: "drain" }, error: null },
    ]

    await expect(dailyJobBanner()).resolves.toEqual([
      {
        id: "daily-job",
        family: "attention",
        text: "Last run's email drain failed.",
        since: ago(HOUR_MS),
      },
    ])
    expect(state.queries[1]).toEqual({
      table: "job_runs",
      calls: [
        ["select", "step"],
        ["eq", "run_id", 7],
        ["eq", "status", "failed"],
        ["order", "started_at", { ascending: true }],
        ["limit", 1],
        ["maybeSingle"],
      ],
    })
  })

  it("falls back to the bootstrap row when no run has happened", async () => {
    state.results = [
      { data: null, error: null },
      { data: { started_at: ago(37 * HOUR_MS) }, error: null },
    ]

    const [banner] = await dailyJobBanner()
    expect(banner.text).toMatch(/^Daily jobs haven't run since/)
    expect(state.queries[1].calls).toContainEqual(["eq", "job", "bootstrap"])
  })

  it("returns nothing with neither a run nor a bootstrap row", async () => {
    await expect(dailyJobBanner()).resolves.toEqual([])
  })

  it("returns no banner, and queries nothing, outside production", async () => {
    state.production = false

    await expect(dailyJobBanner()).resolves.toEqual([])
    expect(createClient).not.toHaveBeenCalled()
  })

  it("throws a failed read, with the database error as its cause", async () => {
    const failure = { code: "42501", message: "permission denied" }
    state.results = [{ data: null, error: failure }]

    const error = await dailyJobBanner().catch((thrown: unknown) => thrown)
    expect((error as Error).message).toBe(
      "dailyJobBanner: reading the last run failed"
    )
    expect((error as Error).cause).toBe(failure)
  })

  it("is the admin banner source at index 1", () => {
    expect(ADMIN_BANNER_SOURCES[1]).toBe(dailyJobBanner)
  })
})
