import { createHash, timingSafeEqual } from "node:crypto"

import { after } from "next/server"

import { serverEnv } from "@/lib/env.server"
import { recordErrorEvent } from "@/lib/record-error-event"
import { createAdminClient } from "@/lib/supabase/admin"

import { runDailyJob } from "./pipeline"

// The pipeline's drain stops claiming after 240 s; the function gets 300.
export const maxDuration = 300

const NO_STORE = { "Cache-Control": "no-store" }

// Equal-length SHA-256 digests make the comparison constant-time whatever the
// header's length.
function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest()
}

function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? ""
  return timingSafeEqual(
    digest(header),
    digest(`Bearer ${serverEnv.CRON_SECRET}`)
  )
}

/**
 * The daily cron (AD-3, AD-13): Vercel Cron's GET, authorized only by
 * `Authorization: Bearer <CRON_SECRET>` (/api isn't proxied and there is no
 * session). Any mismatch is a 401 that touches nothing. Otherwise it runs the
 * fixed pipeline: 200 with the steps' outcomes, 200 `{skipped:true}` when a
 * run is already open, 500 when a step failed or the run couldn't be logged.
 */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return new Response("Unauthorized", { status: 401, headers: NO_STORE })
  }

  const startedAt = Date.now()
  try {
    const run = await runDailyJob(createAdminClient(), startedAt, {
      recordFault: (thrown, route) =>
        after(() => recordErrorEvent(thrown, { route })),
    })
    if (run.skipped) {
      return Response.json({ skipped: true }, { headers: NO_STORE })
    }
    return Response.json(
      { status: run.status, steps: run.steps },
      { status: run.status === "ok" ? 200 : 500, headers: NO_STORE }
    )
  } catch (thrown) {
    after(() => recordErrorEvent(thrown, { route: "cron daily" }))
    return Response.json(
      { status: "error" },
      { status: 500, headers: NO_STORE }
    )
  }
}
