import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"

import { SHARED_UNTIL_COOKIE, sharedUntilCookieOptions } from "./shared-session"

export type IdleState =
  | { kind: "personal" }
  | { kind: "active"; expiresAt: number }
  | { kind: "expired" }

/**
 * Asks Postgres about the caller's session (`check_session_idle`, a read that
 * never moves the clock). No row means a personal session. Throws on an RPC
 * error: callers decide whether that passes through.
 */
export async function checkIdle(
  supabase: SupabaseClient<Database>
): Promise<IdleState> {
  const { data, error } = await supabase.rpc("check_session_idle")
  if (error) throw error
  const row = data?.[0]
  if (!row) return { kind: "personal" }
  if (row.expired) return { kind: "expired" }
  return { kind: "active", expiresAt: new Date(row.expires_at).getTime() }
}

/** The part of a cookie store (Next's, or the proxy's) that sign-out needs. */
export type CookieJar = {
  getAll(): { name: string }[]
  delete(name: string): unknown
}

function isAuthCookie(name: string) {
  return name.startsWith("sb-") && name.includes("-auth-token")
}

/**
 * Ends an idle shared session in this browser: a local sign-out, and when that
 * fails (returned or thrown) the auth cookies are deleted directly. The
 * deadline cookie goes either way. It never deletes the `shared_sessions` row
 * (only a manual sign-out does), so a token that survives still reads as
 * expired.
 */
export async function endIdleSession(
  supabase: SupabaseClient<Database>,
  jar: CookieJar
): Promise<void> {
  let failed: boolean
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" })
    failed = error !== null
  } catch {
    failed = true
  }
  if (failed) {
    for (const { name } of jar.getAll()) {
      if (isAuthCookie(name)) jar.delete(name)
    }
  }
  jar.delete(SHARED_UNTIL_COOKIE)
}

/** The part of a cookie store a sign-in needs to write the deadline cookie. */
export type SignInJar = {
  set(name: string, value: string, options: object): unknown
  delete(name: string): unknown
}

/**
 * Finishes a sign-in made with `createClient({ shared })`. Shared: marks the
 * session (`mark_shared_session`) and sets the deadline cookie. Personal:
 * deletes a stale deadline cookie. Returns false when marking fails, in
 * which case the session is signed out again and the caller reports that the
 * sign-in didn't finish.
 */
export async function finishSignIn(
  supabase: SupabaseClient<Database>,
  jar: SignInJar,
  shared: boolean
): Promise<boolean> {
  if (!shared) {
    jar.delete(SHARED_UNTIL_COOKIE)
    return true
  }
  try {
    const { data, error } = await supabase.rpc("mark_shared_session")
    if (error || data === null) throw error ?? new Error("no deadline")
    jar.set(
      SHARED_UNTIL_COOKIE,
      String(new Date(data).getTime()),
      sharedUntilCookieOptions()
    )
    return true
  } catch (error) {
    console.error("finishSignIn: marking the shared session failed", error)
    jar.delete(SHARED_UNTIL_COOKIE)
    try {
      await supabase.auth.signOut({ scope: "local" })
    } catch {
      // The caller reports the failure; a leftover session is still a normal
      // personal one and is never shared.
    }
    return false
  }
}
