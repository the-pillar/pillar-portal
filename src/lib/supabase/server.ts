import "server-only"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import { clientEnv } from "@/lib/env.client"
import type { Database } from "@/lib/supabase/database.types"
import {
  authCookieOptions,
  SHARED_UNTIL_COOKIE,
} from "@/lib/supabase/shared-session"

/**
 * A Supabase client for Server Components, Server Actions and Route Handlers
 * that acts as the caller: the publishable key plus the request's session
 * cookies, so RLS sees who is asking. Create one per request and never share
 * it.
 *
 * Get the caller's identity from `supabase.auth.getClaims()`, which verifies
 * the access token's signature. `getSession()` returns whatever the cookie
 * says, so lint bans it (AD-7).
 *
 * `shared` says whether session writes make browser-session cookies (a shared
 * computer, AD-22). It defaults to whether the deadline cookie is present; a
 * sign-in passes it explicitly, since the cookie isn't there yet.
 */
export async function createClient({ shared }: { shared?: boolean } = {}) {
  const cookieStore = await cookies()
  const isShared = shared ?? cookieStore.has(SHARED_UNTIL_COOKIE)

  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        // The no-store headers passed as the second argument can't be set
        // through next/headers. src/proxy.ts refreshes the session before
        // every /dashboard and /admin request; it owns the response and sets
        // both.
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, authCookieOptions(options, isShared))
            }
          } catch {
            // Server Components can't set cookies, so this throws there. Under
            // /dashboard and /admin it is safe to ignore: src/proxy.ts has
            // already written the refreshed session and forwarded it to the
            // render. On unproxied pages (/login, /) a refresh done here is
            // dropped; the redirect to a proxied path refreshes again within
            // refresh_token_reuse_interval.
          }
        },
      },
    }
  )
}
