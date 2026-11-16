import { isAuthRetryableFetchError } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import { after } from "next/server"

import { clientEnv } from "@/lib/env.client"
import { recordErrorEvent } from "@/lib/record-error-event"
import { checkIdle, endIdleSession } from "@/lib/supabase/idle"
import { createClient } from "@/lib/supabase/server"
import {
  SHARED_UNTIL_COOKIE,
  sharedUntilCookieOptions,
} from "@/lib/supabase/shared-session"

const NO_STORE = { "Cache-Control": "private, no-store" }

function reply(status: number) {
  return new Response(null, { status, headers: NO_STORE })
}

// The shared-computer activity ping (AD-22): the only thing besides
// renew_shared_session() that moves the idle clock. The watcher posts it on
// the person's own input (and from Stay signed in); nothing in the app calls
// it on a timer. /api isn't proxied, so the Origin and the session are
// checked here.
//
// - foreign or missing Origin: 403
// - signed out: 401 (a retryable Auth error is a 500 instead)
// - active shared session: 204, the deadline cookie re-set to the new deadline
// - personal session: 204, a stale deadline cookie deleted
// - expired shared session: signed out here, 401 (renewing never revives it)
// - an RPC error or a throw: 500, logged and recorded after the response
export async function POST(request: Request) {
  if (
    request.headers.get("origin") !==
    new URL(clientEnv.NEXT_PUBLIC_SITE_URL).origin
  ) {
    return reply(403)
  }

  try {
    const supabase = await createClient()
    const { data, error: claimsError } = await supabase.auth.getClaims()
    // Auth being unreachable is a fault, not a sign-out: the watcher treats
    // a 401 as the idle sign-out.
    if (claimsError && isAuthRetryableFetchError(claimsError)) {
      throw claimsError
    }
    if (claimsError || !data?.claims?.sub) return reply(401)

    const cookieStore = await cookies()
    // Postgres decides expiry (check_session_idle), never this server's clock.
    const idle = await checkIdle(supabase)
    if (idle.kind === "expired") {
      await endIdleSession(supabase, cookieStore)
      return reply(401)
    }
    if (idle.kind === "personal") {
      cookieStore.delete(SHARED_UNTIL_COOKIE)
      return reply(204)
    }

    const { data: deadline, error } = await supabase.rpc("renew_shared_session")
    if (error) throw error
    const expiresAt = deadline === null ? null : new Date(deadline).getTime()
    // The row went, or idled out, between the check and the renew.
    if (expiresAt === null || expiresAt <= idle.expiresAt) {
      await endIdleSession(supabase, cookieStore)
      return reply(401)
    }

    cookieStore.set(
      SHARED_UNTIL_COOKIE,
      String(expiresAt),
      sharedUntilCookieOptions()
    )
    return reply(204)
  } catch (error) {
    console.error("POST /api/session/activity failed", error)
    after(() =>
      recordErrorEvent(error, { route: "route /api/session/activity" })
    )
    return reply(500)
  }
}
