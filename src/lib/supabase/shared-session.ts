// Shared-computer sessions (AD-22), client-safe. The idle clock itself lives in
// Postgres (`check_session_idle`); the browser holds only its deadline, in a
// cookie it can read.

/**
 * The cookie holding the shared session's deadline in epoch milliseconds. Its
 * presence also tells the cookie writers to make the auth cookies browser-
 * session cookies. Never put any other cookie value in browser-readable state.
 */
export const SHARED_UNTIL_COOKIE = "pillar-shared-until"

/** How long before the deadline every tab warns: 2 minutes. */
export const WARNING_LEAD_MS = 2 * 60 * 1000

/** Grace past the deadline before a tab reloads, since expiry is strictly after. */
export const DEADLINE_GRACE_MS = 2000

type CookieOptions = {
  maxAge?: number
  expires?: Date
  [key: string]: unknown
}

/**
 * The options for an auth cookie write. `@supabase/ssr` forces `maxAge` 400
 * days on every set and 0 on a removal; for a shared session this drops
 * `maxAge` and `expires` from a set, so the cookie ends when the browser
 * closes. A removal (`maxAge` 0 or less) is left alone.
 */
export function authCookieOptions<T extends CookieOptions>(
  options: T,
  shared: boolean
): T {
  if (!shared) return options
  if (options.maxAge === undefined || options.maxAge <= 0) return options
  const { maxAge: _maxAge, expires: _expires, ...rest } = options
  void _maxAge
  void _expires
  return rest as unknown as T
}

/**
 * The options for the deadline cookie: readable by script (the watcher reads
 * it), Secure, Lax, and a session cookie.
 */
export function sharedUntilCookieOptions() {
  return {
    path: "/",
    httpOnly: false,
    secure: true,
    sameSite: "lax" as const,
  }
}

/** Set by the Google action when the box is ticked, read by the callback. */
export const SHARED_SIGN_IN_COOKIE = "pillar-shared-signin"

/** Short-lived, server-only: it only carries the choice across Google. */
export function sharedSignInCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    maxAge: 600,
  }
}
