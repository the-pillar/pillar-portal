import "server-only"

import type { AdminBanner } from "@/lib/admin-banners"
import { DAILY_JOB, DAILY_STEP_LABELS } from "@/lib/daily-job"
import { isProduction } from "@/lib/env.server"
import { createClient } from "@/lib/supabase/server"
import { formatInPht } from "@/lib/time"

/**
 * The daily job is stale once its newest non-skipped run started more than
 * this many hours ago. It runs every day around 08:00 to 08:59 Manila, so a
 * missed day shows within hours.
 */
export const DAILY_JOB_STALE_HOURS = 36

const HOUR_MS = 60 * 60 * 1000
const STALE_MS = DAILY_JOB_STALE_HOURS * HOUR_MS

const DAILY_JOB_BANNER_ID = "daily-job"
const TIME_FORMAT = "MMM d, h:mm a"

/** The newest daily run that did work, with the label of its failed step. */
export type LatestDailyRun = {
  /** `job_runs.started_at`. */
  startedAt: string
  status: "ok" | "failed"
  /** The first failed step's label, when the run failed. */
  failedStepLabel: string | null
}

function parse(value: string, what: string): number {
  const time = Date.parse(value)
  if (Number.isNaN(time)) {
    throw new RangeError(`dailyJobBannerOf: ${what} isn't a timestamp`)
  }
  return time
}

/**
 * The daily-job banner (Story 4.3) for the newest non-skipped run, or null
 * when all is well. Stale wins over failed (one banner, id `daily-job`).
 *
 * - Stale: the run started more than 36 hours before `now` (exactly 36 is
 *   still on time). With no run at all, the same rule applies to the
 *   bootstrap row's start, so a fresh install isn't stale for a day and a
 *   job that never started is. `since` is that start plus 36 hours; the text
 *   names the start.
 * - Failed: the latest run closed `failed`. `since` is the run's start.
 * - Neither a run nor a bootstrap row: no banner.
 *
 * `lastRun` is the newest `ok` or `failed` run of the `daily` job (a
 * `skipped` row means a run was already open, not that work happened).
 */
export function dailyJobBannerOf(
  lastRun: LatestDailyRun | null,
  bootstrapAt: string | null,
  now: Date
): AdminBanner | null {
  const anchor = lastRun?.startedAt ?? bootstrapAt
  if (anchor === null) return null

  const anchorTime = parse(anchor, "the last start")
  if (now.getTime() - anchorTime > STALE_MS) {
    return {
      id: DAILY_JOB_BANNER_ID,
      family: "attention",
      text: `Daily jobs haven't run since ${formatInPht(anchorTime, TIME_FORMAT)}. Reminders and queued emails are waiting.`,
      since: new Date(anchorTime + STALE_MS).toISOString(),
    }
  }

  if (lastRun?.status === "failed") {
    return {
      id: DAILY_JOB_BANNER_ID,
      family: "attention",
      text: `Last run's ${lastRun.failedStepLabel ?? "daily job"} failed.`,
      since: new Date(anchorTime).toISOString(),
    }
  }

  return null
}

/**
 * The admin banner source for the daily job (one entry in
 * ADMIN_BANNER_SOURCES). Only production runs the cron for real, so anywhere
 * else it returns [] without a query. It reads through the admin's own
 * session (RLS lets only admins read `job_runs`). A failed query throws; the
 * banner slot logs and records it, and the other banners still show.
 */
export async function dailyJobBanner(): Promise<AdminBanner[]> {
  if (!isProduction) return []

  const supabase = await createClient()
  const latest = await supabase
    .from("job_runs")
    .select("id, started_at, status")
    .eq("job", DAILY_JOB)
    .is("run_id", null)
    .in("status", ["ok", "failed"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latest.error) {
    throw new Error("dailyJobBanner: reading the last run failed", {
      cause: latest.error,
    })
  }

  let lastRun: LatestDailyRun | null = null
  let bootstrapAt: string | null = null

  if (latest.data) {
    const { id, started_at: startedAt, status } = latest.data
    let failedStepLabel: string | null = null
    if (status === "failed") {
      const step = await supabase
        .from("job_runs")
        .select("step")
        .eq("run_id", id)
        .eq("status", "failed")
        .order("started_at", { ascending: true })
        .limit(1)
        .maybeSingle()
      if (step.error) {
        throw new Error("dailyJobBanner: reading the failed step failed", {
          cause: step.error,
        })
      }
      const name = step.data?.step
      failedStepLabel = name ? (DAILY_STEP_LABELS[name] ?? name) : null
    }
    lastRun = {
      startedAt,
      status: status === "failed" ? "failed" : "ok",
      failedStepLabel,
    }
  } else {
    const bootstrap = await supabase
      .from("job_runs")
      .select("started_at")
      .eq("job", "bootstrap")
      .eq("status", "ok")
      .order("started_at", { ascending: true })
      .limit(1)
      .maybeSingle()
    if (bootstrap.error) {
      throw new Error("dailyJobBanner: reading the bootstrap run failed", {
        cause: bootstrap.error,
      })
    }
    bootstrapAt = bootstrap.data?.started_at ?? null
  }

  const banner = dailyJobBannerOf(lastRun, bootstrapAt, new Date())
  return banner ? [banner] : []
}
