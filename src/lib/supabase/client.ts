import {
  createBrowserClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr"

import { clientEnv } from "@/lib/env.client"
import type { Database } from "@/lib/supabase/database.types"
import {
  authCookieOptions,
  SHARED_UNTIL_COOKIE,
} from "@/lib/supabase/shared-session"

/**
 * A Supabase client for Client Components, acting as the signed-in user
 * through the session cookies. It holds the publishable key only; RLS decides
 * what it can read, and it can write nothing directly (AD-1).
 *
 * It reads and writes `document.cookie` itself so a shared computer's session
 * writes (a token refresh, step-up's `mfa.verify`) stay browser-session
 * cookies, as on the server (AD-22): `@supabase/ssr` forces a 400-day
 * `maxAge` on every write.
 */
export function createClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(document.cookie)
        },
        setAll(cookiesToSet) {
          const shared = parseCookieHeader(document.cookie).some(
            ({ name }) => name === SHARED_UNTIL_COOKIE
          )
          for (const { name, value, options } of cookiesToSet) {
            document.cookie = serializeCookieHeader(
              name,
              value,
              authCookieOptions(options, shared)
            )
          }
        },
      },
    }
  )
}
