import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { drainOutbox } from "@/features/email"
import { DAILY_JOB, DAILY_STEP_LABELS } from "@/lib/daily-job"
import { errorCodeOf } from "@/lib/record-error-event"
import type { Database } from "@/lib/supabase/database.types"

// The drain stops claiming this long after the run began; the route's
// maxDuration (300 s) leaves the rest for the sweep, retention and the log.
export const DRAIN_BUDGET_MS = 240_000

export type AdminClient = SupabaseClient<Database>

export type StepDetail = Record<string, number | string>

export type DailyStep = {
  /** Run order. 3 and 4 are reserved (AD-13: archive purges, cycle erasures). */
  position: number
  /** The `job_runs.step` value. */
  name: string
  /** How the admin banner names it. */
  label: string
  run: (admin: AdminClient, startedAt: number) => Promise<StepDetail>
}

async function numberOf(
  call: PromiseLike<{ data: unknown; error: unknown }>
): Promise<number> {
  const { data, error } = await call
  if (error) throw error
  if (typeof data !== "number") throw new Error("daily: expected a count")
  return data
}

// A drain that stopped on a fault it already recorded.
class DrainFaulted extends Error {
  constructor(readonly counts: StepDetail) {
    super("daily: the drain faulted")
  }
}

export const DAILY_STEPS: DailyStep[] = [
  {
    position: 1,
    name: "reminders",
    label: DAILY_STEP_LABELS.reminders,
    run: async (admin) => ({
      queued: await numberOf(admin.rpc("enqueue_due_reminders")),
    }),
  },
  {
    position: 2,
    name: "drain",
    label: DAILY_STEP_LABELS.drain,
    run: async (_admin, startedAt) => {
      const result = await drainOutbox({
        deadlineMs: Math.max(0, startedAt + DRAIN_BUDGET_MS - Date.now()),
      })
      // drainOutbox never throws and has recorded its own fault: a faulted
      // drain fails the step without a second error_events row.
      const { faulted, ...counts } = result
      if (faulted) throw new DrainFaulted(counts)
      return counts
    },
  },
  {
    position: 5,
    name: "sweep",
    label: DAILY_STEP_LABELS.sweep,
    run: async (admin) => ({
      sessions_deleted: await numberOf(admin.rpc("sweep_shared_sessions")),
    }),
  },
  {
    position: 6,
    name: "retention",
    label: DAILY_STEP_LABELS.retention,
    run: async (admin) => {
      const { data, error } = await admin.rpc("run_retention")
      if (error) throw error
      const counts: Record<string, number> = {}
      if (typeof data === "object" && data !== null && !Array.isArray(data)) {
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === "number") counts[key] = value
        }
      }
      return counts
    },
  },
]

export type StepOutcome = {
  name: string
  status: "ok" | "failed"
  durationMs: number
}

export type DailyRun =
  | { skipped: true }
  | {
      skipped: false
      runId: number
      status: "ok" | "failed"
      steps: StepOutcome[]
    }

export type RunDeps = {
  /** Called with a step's thrown fault and its route, `cron daily <step>`. */
  recordFault?: (thrown: unknown, route: string) => void
  steps?: DailyStep[]
  now?: () => number
}

/**
 * Opens a `daily` run and runs the steps in position order (AD-13). Every
 * step is timed and logged through `record_job_step`, runs even if an
 * earlier one failed, and its fault is handed to `recordFault`. The run then
 * closes `ok`, or `failed` when any step failed. A concurrent run makes
 * `begin_job_run` log `skipped` and return null: nothing else runs.
 *
 * A thrown `begin_job_run` or `end_job_run` propagates to the route; a thrown
 * `record_job_step` is recorded and the pipeline carries on.
 */
export async function runDailyJob(
  admin: AdminClient,
  startedAt: number,
  deps: RunDeps = {}
): Promise<DailyRun> {
  const recordFault = deps.recordFault ?? (() => {})
  const now = deps.now ?? Date.now
  const steps = [...(deps.steps ?? DAILY_STEPS)].sort(
    (a, b) => a.position - b.position
  )

  const begun = await admin.rpc("begin_job_run", { job: DAILY_JOB })
  if (begun.error) throw begun.error
  if (begun.data === null) return { skipped: true }
  const runId = begun.data

  const outcomes: StepOutcome[] = []
  for (const step of steps) {
    const began = now()
    let status: "ok" | "failed" = "ok"
    let detail: StepDetail
    try {
      detail = await step.run(admin, startedAt)
    } catch (thrown) {
      status = "failed"
      // The code only (the allowlist), never a message.
      if (thrown instanceof DrainFaulted) {
        detail = { ...thrown.counts, code: "email.drain_faulted" }
      } else {
        detail = { code: errorCodeOf(thrown) }
        recordFault(thrown, `cron daily ${step.name}`)
      }
    }
    const durationMs = Math.max(0, now() - began)
    outcomes.push({ name: step.name, status, durationMs })

    try {
      const logged = await admin.rpc("record_job_step", {
        run_id: runId,
        step: step.name,
        status,
        duration_ms: durationMs,
        detail,
      })
      if (logged.error) throw logged.error
    } catch (thrown) {
      recordFault(thrown, `cron daily ${step.name} log`)
    }
  }

  const failed = outcomes.filter((outcome) => outcome.status === "failed")
  const status = failed.length > 0 ? "failed" : "ok"
  const ended = await admin.rpc("end_job_run", {
    id: runId,
    status,
    detail: { failed_steps: failed.length },
  })
  if (ended.error) throw ended.error

  return { skipped: false, runId, status, steps: outcomes }
}
