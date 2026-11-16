import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

import { clientEnv } from "@/lib/env.client"
import type { Database } from "@/lib/supabase/database.types"
import { checkIdle, endIdleSession } from "@/lib/supabase/idle"
import {
  authCookieOptions,
  SHARED_UNTIL_COOKIE,
  sharedUntilCookieOptions,
} from "@/lib/supabase/shared-session"

/**
 * Runs before every request under /dashboard and /admin (AD-7).
 *
 * - Refreshes the session: `getClaims()` refreshes an expired access token,
 *   and the new cookies go both on the response (for the browser) and onto
 *   the request (so the render sees the new token). Server Components can't
 *   write cookies, so without this a persona is signed out after about an
 *   hour.
 * - Sends a signed-out GET or HEAD to `/login?next=<path and query>`, built
 *   from NEXT_PUBLIC_SITE_URL, never from the request's host. Other methods
 *   (Server Action POSTs) pass through.
 *
 * - Enforces the shared-computer idle limit (AD-22): after the session check,
 *   `check_session_idle` (a read; only the person's input moves the clock). An
 *   expired session is signed out locally and its cookies cleared; a GET or
 *   HEAD goes to `/login?next=…&signed_out=idle`, any other method passes
 *   through and fails as signed out. An active shared session re-sets the
 *   deadline cookie the tabs read; a personal one deletes a stale deadline
 *   cookie. A check that throws passes through, logged.
 *
 * It only routes: the layouts, RLS and the commands still decide access, so a
 * `getClaims()` that throws passes the request through to them.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  // The headers @supabase/ssr passes with a session write (today the no-store
  // Cache-Control, Expires and Pragma, on the first write only). They keep a
  // response carrying one visitor's session out of any shared cache, so every
  // response here that carries the session gets all of them.
  const sessionHeaders: Record<string, string> = {}

  // Whether session writes make browser-session cookies: the deadline cookie
  // is the hint, re-synced below on every proxied request.
  const shared = request.cookies.has(SHARED_UNTIL_COOKIE)

  const supabase = createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(
              name,
              value,
              authCookieOptions(options, shared)
            )
          }
          Object.assign(sessionHeaders, headers)
          for (const [key, value] of Object.entries(sessionHeaders)) {
            response.headers.set(key, value)
          }
        },
      },
    }
  )

  let signedIn: boolean
  try {
    const { data } = await supabase.auth.getClaims()
    // An Auth error getClaims() returns counts as signed out: a dead refresh
    // token, or AuthRetryableFetchError while Auth is unreachable. The
    // redirect keeps `next`, and a retryable error leaves the session cookies
    // in place, so /login sends the member on once Auth is back. Only a throw
    // passes through.
    signedIn = Boolean(data?.claims.sub)
  } catch {
    return response
  }

  const isRead = request.method === "GET" || request.method === "HEAD"

  // 307. It carries any session cookies the attempt wrote, such as the
  // deletions after a dead refresh token, and the headers that came with them.
  function redirectToLogin(idle: boolean) {
    const login = new URL("/login", clientEnv.NEXT_PUBLIC_SITE_URL)
    login.searchParams.set(
      "next",
      request.nextUrl.pathname + request.nextUrl.search
    )
    if (idle) login.searchParams.set("signed_out", "idle")
    const redirect = NextResponse.redirect(login)
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie)
    }
    for (const [key, value] of Object.entries(sessionHeaders)) {
      redirect.headers.set(key, value)
    }
    return redirect
  }

  if (signedIn) {
    try {
      const idle = await checkIdle(supabase)
      if (idle.kind === "expired") {
        await endIdleSession(supabase, {
          getAll: () => request.cookies.getAll(),
          delete: (name) => {
            request.cookies.delete(name)
            response.cookies.delete(name)
          },
        })
        return isRead ? redirectToLogin(true) : response
      }
      if (idle.kind === "active") {
        // Only when it differs: a check that ran before a renewal must not
        // overwrite the newer deadline the activity route set meanwhile.
        if (
          request.cookies.get(SHARED_UNTIL_COOKIE)?.value !==
          String(idle.expiresAt)
        ) {
          response.cookies.set(
            SHARED_UNTIL_COOKIE,
            String(idle.expiresAt),
            sharedUntilCookieOptions()
          )
        }
      } else if (shared) {
        response.cookies.delete(SHARED_UNTIL_COOKIE)
      }
    } catch (error) {
      console.error("proxy: the idle check failed", error)
    }
    return response
  }

  if (!isRead) return response
  return redirectToLogin(false)
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
}
