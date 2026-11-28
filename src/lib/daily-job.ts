/**
 * The daily job's vocabulary (AD-13), shared by the pipeline that writes its
 * `job_runs` rows (src/app/api/cron/daily/pipeline.ts) and the admin banner
 * that reads them. The steps run in position order; 3 and 4 (archive purges
 * and cycle erasures) are reserved for Epic 3.
 */
export const DAILY_JOB = "daily"

/** A step's `job_runs.step` name to how the banner says it. */
export const DAILY_STEP_LABELS: Record<string, string> = {
  reminders: "reminders",
  drain: "email drain",
  sweep: "session sweep",
  retention: "retention",
}
