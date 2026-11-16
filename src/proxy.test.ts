import { readdirSync } from "node:fs"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories and vi.hoisted run before this file's imports.
const { createServerClient, getClaims, rpc, signOut } = await vi.hoisted(
  async () => {
    // Importing next/server throws unless AsyncLocalStorage is on globalThis,
    // which the Next runtime provides and plain Node doesn't.
    const { AsyncLocalStorage } = await import("node:async_hooks")
    globalThis.AsyncLocalStorage ??= AsyncLocalStorage

    const getClaims = vi.fn()
    const rpc = vi.fn()
    const signOut = vi.fn()
    return {
      getClaims,
      rpc,
      signOut,
      createServerClient: vi.fn<
        (url: string, key: string, options: unknown) => object
      >(() => ({ auth: { getClaims, signOut }, rpc })),
    }
  }
)

vi.mock("@supabase/ssr", () => ({ createServerClient }))
vi.mock("@/lib/env.client", () => ({
  clientEnv: {
    NEXT_PUBLIC_SITE_URL: "https://pillar.example",
    NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}))

import { AuthRetryableFetchError } from "@supabase/supabase-js"
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server"
import { NextRequest } from "next/server"

import { config, proxy } from "./proxy"

type CookieToSet = {
  name: string
  value: string
  options: Record<string, unknown>
}
type CookieMethods = {
  getAll: () => { name: string; value: string }[]
  setAll: (cookies: CookieToSet[], headers: Record<string, string>) => void
}

const SUB = "00000000-0000-4000-8000-000000000001"
const SESSION_COOKIE = "sb-ref-auth-token"
const NO_STORE = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
}

// The cookie methods the proxy handed to createServerClient.
function cookieMethods(): CookieMethods {
  const options = createServerClient.mock.calls[0][2] as {
    cookies: CookieMethods
  }
  return options.cookies
}

// A request that claims to be for another host every way it can, so a
// redirect built from the request would point there.
function request(
  path: string,
  { method = "GET", cookie }: { method?: string; cookie?: string } = {}
) {
  const headers: Record<string, string> = {
    host: "evil.example",
    "x-forwarded-host": "evil.example",
    "x-forwarded-proto": "https",
  }
  if (cookie) headers.cookie = cookie
  return new NextRequest(`https://evil.example${path}`, { method, headers })
}

// NextResponse.next() marks a pass-through with this header.
function passesThrough(response: Response) {
  return response.headers.get("x-middleware-next") === "1"
}

const SHARED_COOKIE = "pillar-shared-until"
const SIGNED_IN = { data: { claims: { sub: SUB } }, error: null }

beforeEach(() => {
  // A personal session unless a test says otherwise.
  rpc.mockResolvedValue({ data: [], error: null })
  signOut.mockResolvedValue({ error: null })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("proxy", () => {
  it("sends a signed-out visitor to <SITE_URL>/login with the path and query in next", async () => {
    getClaims.mockResolvedValue({ data: null, error: null })

    const response = await proxy(request("/dashboard?view=board"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://pillar.example/login?next=%2Fdashboard%3Fview%3Dboard"
    )
    expect(passesThrough(response)).toBe(false)
  })

  it("keeps a deep link's full path and query in next", async () => {
    getClaims.mockResolvedValue({ data: null, error: null })

    const response = await proxy(request("/dashboard/tasks/1?x=1&y=a%20b"))

    const location = new URL(response.headers.get("location")!)
    expect(location.origin).toBe("https://pillar.example")
    expect(location.pathname).toBe("/login")
    expect(location.searchParams.get("next")).toBe(
      "/dashboard/tasks/1?x=1&y=a%20b"
    )
  })

  it("redirects a signed-out HEAD like a GET", async () => {
    getClaims.mockResolvedValue({ data: null, error: null })

    const response = await proxy(request("/admin", { method: "HEAD" }))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://pillar.example/login?next=%2Fadmin"
    )
  })

  it("builds the Supabase client from env.client and the request's cookies", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: SUB } }, error: null })

    await proxy(request("/dashboard", { cookie: `${SESSION_COOKIE}=abc; a=b` }))

    expect(createServerClient).toHaveBeenCalledOnce()
    expect(createServerClient.mock.calls[0].slice(0, 2)).toEqual([
      "https://ref.supabase.co",
      "sb_publishable_test",
    ])
    // Cookies only: no cookieOptions, so @supabase/ssr's default 400-day
    // maxAge stands (NFR8).
    expect(Object.keys(createServerClient.mock.calls[0][2] as object)).toEqual([
      "cookies",
    ])
    expect(cookieMethods().getAll()).toEqual([
      { name: SESSION_COOKIE, value: "abc" },
      { name: "a", value: "b" },
    ])
  })

  it("passes a signed-in member through, writing no cookies", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: SUB } }, error: null })

    const response = await proxy(
      request("/dashboard?view=board", { cookie: `${SESSION_COOKIE}=abc` })
    )

    expect(passesThrough(response)).toBe(true)
    expect(response.headers.get("location")).toBeNull()
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(response.headers.get("cache-control")).toBeNull()
    // The render gets the request's cookies as they came in.
    expect(response.headers.get("x-middleware-request-cookie")).toBe(
      `${SESSION_COOKIE}=abc`
    )
  })

  it("puts a refreshed session on the response and forwards it to the render", async () => {
    const maxAge = 400 * 24 * 60 * 60
    getClaims.mockImplementation(async () => {
      // What getClaims() does when expires_at has passed: refresh, then
      // write the new session through setAll.
      cookieMethods().setAll(
        [
          {
            name: SESSION_COOKIE,
            value: "base64-refreshed",
            options: { path: "/", sameSite: "lax", httpOnly: false, maxAge },
          },
        ],
        NO_STORE
      )
      return { data: { claims: { sub: SUB } }, error: null }
    })

    const response = await proxy(
      request("/dashboard", { cookie: `${SESSION_COOKIE}=base64-expired` })
    )

    expect(passesThrough(response)).toBe(true)
    // For the browser: the new cookie, with the library's options.
    expect(response.cookies.get(SESSION_COOKIE)).toMatchObject({
      value: "base64-refreshed",
      path: "/",
      sameSite: "lax",
      maxAge,
    })
    expect(response.headers.get("set-cookie")).toContain(
      `${SESSION_COOKIE}=base64-refreshed`
    )
    // For the render: the request's Cookie header, replaced.
    expect(response.headers.get("x-middleware-override-headers")).toContain(
      "cookie"
    )
    expect(response.headers.get("x-middleware-request-cookie")).toBe(
      `${SESSION_COOKIE}=base64-refreshed`
    )
    // And never cached.
    for (const [name, value] of Object.entries(NO_STORE)) {
      expect(response.headers.get(name)).toBe(value)
    }
  })

  it("sends a visitor whose refresh token is dead to /login, carrying the cookie deletions", async () => {
    getClaims.mockImplementation(async () => {
      // A non-retryable refresh error: supabase-js removes the session.
      cookieMethods().setAll(
        [
          {
            name: SESSION_COOKIE,
            value: "",
            options: { path: "/", sameSite: "lax", maxAge: 0 },
          },
        ],
        NO_STORE
      )
      return {
        data: null,
        error: { name: "AuthApiError", code: "refresh_token_not_found" },
      }
    })

    const response = await proxy(
      request("/dashboard?view=board", {
        cookie: `${SESSION_COOKIE}=base64-dead`,
      })
    )

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://pillar.example/login?next=%2Fdashboard%3Fview%3Dboard"
    )
    const setCookie = response.headers.get("set-cookie")
    expect(setCookie).toContain(`${SESSION_COOKIE}=;`)
    expect(setCookie).toContain("Max-Age=0")
    for (const [name, value] of Object.entries(NO_STORE)) {
      expect(response.headers.get(name)).toBe(value)
    }
  })

  it("sends a visitor to /login while Auth is unreachable, leaving the session cookies in place", async () => {
    // A retryable refresh error: supabase-js keeps the session and writes
    // nothing, so /login can send the member on once Auth is back.
    getClaims.mockResolvedValue({
      data: null,
      error: new AuthRetryableFetchError("fetch failed", 0),
    })

    const response = await proxy(
      request("/dashboard?view=board", {
        cookie: `${SESSION_COOKIE}=base64-expired`,
      })
    )

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://pillar.example/login?next=%2Fdashboard%3Fview%3Dboard"
    )
    expect(response.headers.get("set-cookie")).toBeNull()
  })

  it("sets no cookies or cache headers on a plain signed-out redirect", async () => {
    getClaims.mockResolvedValue({ data: null, error: null })

    const response = await proxy(request("/dashboard"))

    expect(response.headers.get("set-cookie")).toBeNull()
    expect(response.headers.get("cache-control")).toBeNull()
    expect(response.headers.get("expires")).toBeNull()
    expect(response.headers.get("pragma")).toBeNull()
  })

  it.each(["POST", "PUT", "DELETE", "OPTIONS"])(
    "passes a signed-out %s through (a Server Action decides for itself)",
    async (method) => {
      getClaims.mockResolvedValue({ data: null, error: null })

      const response = await proxy(request("/dashboard", { method }))

      expect(passesThrough(response)).toBe(true)
      expect(response.headers.get("location")).toBeNull()
    }
  )

  it("passes the request through when getClaims() throws; the layout decides", async () => {
    getClaims.mockRejectedValue(new TypeError("fetch failed"))

    const response = await proxy(request("/dashboard?view=board"))

    expect(passesThrough(response)).toBe(true)
    expect(response.headers.get("location")).toBeNull()
  })
})

describe("shared-computer idle limit (AD-22)", () => {
  const DEADLINE_ISO = "2026-11-16T10:30:00+00:00"
  const DEADLINE_MS = Date.parse(DEADLINE_ISO)
  const withCookies = `${SESSION_COOKIE}=abc; ${SHARED_COOKIE}=${DEADLINE_MS}`

  it("signs out an expired session, then redirects a GET to /login with the idle flag and cleared cookies", async () => {
    getClaims.mockResolvedValue(SIGNED_IN)
    rpc.mockResolvedValue({
      data: [{ expires_at: DEADLINE_ISO, expired: true }],
      error: null,
    })
    signOut.mockImplementation(async () => {
      cookieMethods().setAll(
        [
          {
            name: SESSION_COOKIE,
            value: "",
            options: { path: "/", maxAge: 0 },
          },
        ],
        NO_STORE
      )
      return { error: null }
    })

    const response = await proxy(
      request("/dashboard?view=board", { cookie: withCookies })
    )

    expect(signOut).toHaveBeenCalledWith({ scope: "local" })
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://pillar.example/login?next=%2Fdashboard%3Fview%3Dboard&signed_out=idle"
    )
    const setCookie = response.headers.get("set-cookie")
    expect(setCookie).toContain(`${SESSION_COOKIE}=;`)
    expect(setCookie).toContain(`${SHARED_COOKIE}=;`)
  })

  it("signs out an expired session on a POST and passes it through", async () => {
    getClaims.mockResolvedValue(SIGNED_IN)
    rpc.mockResolvedValue({
      data: [{ expires_at: DEADLINE_ISO, expired: true }],
      error: null,
    })

    const response = await proxy(
      request("/dashboard", { method: "POST", cookie: withCookies })
    )

    expect(signOut).toHaveBeenCalledOnce()
    expect(passesThrough(response)).toBe(true)
    expect(response.headers.get("location")).toBeNull()
  })

  it("deletes the auth cookies itself when the local sign-out fails", async () => {
    getClaims.mockResolvedValue(SIGNED_IN)
    rpc.mockResolvedValue({
      data: [{ expires_at: DEADLINE_ISO, expired: true }],
      error: null,
    })
    signOut.mockRejectedValue(new TypeError("fetch failed"))

    const response = await proxy(request("/dashboard", { cookie: withCookies }))

    expect(response.status).toBe(307)
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`)
  })

  it("re-sets the deadline cookie unchanged for an active session, without renewing", async () => {
    getClaims.mockResolvedValue(SIGNED_IN)
    rpc.mockResolvedValue({
      data: [{ expires_at: DEADLINE_ISO, expired: false }],
      error: null,
    })

    const response = await proxy(
      request("/dashboard", {
        cookie: `${SESSION_COOKIE}=abc; ${SHARED_COOKIE}=1`,
      })
    )

    expect(passesThrough(response)).toBe(true)
    expect(response.cookies.get(SHARED_COOKIE)).toMatchObject({
      value: String(DEADLINE_MS),
      httpOnly: false,
      secure: true,
      sameSite: "lax",
    })
    expect(response.cookies.get(SHARED_COOKIE)?.maxAge).toBeUndefined()
    expect(rpc.mock.calls).toEqual([["check_session_idle"]])
  })

  it("doesn't re-set a deadline cookie that already holds the same value", async () => {
    getClaims.mockResolvedValue(SIGNED_IN)
    rpc.mockResolvedValue({
      data: [{ expires_at: DEADLINE_ISO, expired: false }],
      error: null,
    })

    const response = await proxy(request("/dashboard", { cookie: withCookies }))

    expect(passesThrough(response)).toBe(true)
    expect(response.cookies.get(SHARED_COOKIE)).toBeUndefined()
  })

  it("deletes a stale deadline cookie for a personal session", async () => {
    getClaims.mockResolvedValue(SIGNED_IN)

    const response = await proxy(request("/dashboard", { cookie: withCookies }))

    expect(response.headers.get("set-cookie")).toContain(`${SHARED_COOKIE}=;`)
  })

  it("writes a refreshed shared session without maxAge, and a personal one with it", async () => {
    const maxAge = 400 * 24 * 60 * 60
    const refresh = async () => {
      cookieMethods().setAll(
        [
          {
            name: SESSION_COOKIE,
            value: "base64-refreshed",
            options: { path: "/", sameSite: "lax", maxAge },
          },
        ],
        NO_STORE
      )
      return SIGNED_IN
    }
    getClaims.mockImplementation(refresh)

    const shared = await proxy(request("/dashboard", { cookie: withCookies }))
    expect(shared.cookies.get(SESSION_COOKIE)?.maxAge).toBeUndefined()

    createServerClient.mockClear()
    const personal = await proxy(
      request("/dashboard", { cookie: `${SESSION_COOKIE}=abc` })
    )
    expect(personal.cookies.get(SESSION_COOKIE)?.maxAge).toBe(maxAge)
  })

  it("passes through, logged, when the check throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    getClaims.mockResolvedValue(SIGNED_IN)
    rpc.mockRejectedValue(new TypeError("fetch failed"))

    const response = await proxy(request("/dashboard", { cookie: withCookies }))

    expect(passesThrough(response)).toBe(true)
    expect(signOut).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it("doesn't check the idle clock for a signed-out visitor", async () => {
    getClaims.mockResolvedValue({ data: null, error: null })

    await proxy(request("/dashboard"))

    expect(rpc).not.toHaveBeenCalled()
  })
})

describe("config.matcher", () => {
  it("is exactly /dashboard and /admin, and the paths under them", () => {
    expect(config).toEqual({
      matcher: ["/dashboard/:path*", "/admin/:path*"],
    })
  })

  it.each([
    "/dashboard",
    "/dashboard/",
    "/dashboard?view=board",
    "/dashboard/tasks/1?x=1",
    "/admin",
    "/admin/members",
  ])("runs the proxy on %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true)
  })

  it.each([
    "/api/cron/daily",
    "/api/webhooks/resend",
    "/api/health",
    "/apply",
    "/status",
    "/login",
    "/login?next=%2Fdashboard",
    "/auth/callback",
    "/_next/static/chunks/main.js",
    "/_next/image?url=%2Flogo.png&w=64&q=75",
    "/favicon.ico",
    "/robots.txt",
    "/sitemap.xml",
    "/",
    "/dashboardx",
    "/administrator",
  ])("doesn't run the proxy on %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false)
  })

  // Member and admin routes live in these route groups. A route added there
  // outside /dashboard or /admin would escape the proxy, so it fails here.
  const GROUPS = ["(member)", "(admin)"]
  // Private folders (`_x`), dynamic segments, nested groups and slots aren't
  // a literal first path segment.
  const NOT_A_SEGMENT = /^[_([@]/

  function groupEntries(group: string) {
    try {
      return readdirSync(new URL(`./app/${group}/`, import.meta.url), {
        withFileTypes: true,
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
  }

  const routeDirs = GROUPS.flatMap((group) =>
    groupEntries(group)
      .filter((entry) => entry.isDirectory() && !NOT_A_SEGMENT.test(entry.name))
      .map((entry) => entry.name)
  )

  it("finds the member routes", () => {
    expect(routeDirs).toContain("dashboard")
  })

  it.each(routeDirs)("runs the proxy on every route under /%s", (dir) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `/${dir}` })).toBe(true)
    expect(unstable_doesMiddlewareMatch({ config, url: `/${dir}/x` })).toBe(
      true
    )
  })

  it.each(GROUPS)("has no page directly in %s (it would be /)", (group) => {
    const pages = groupEntries(group).filter(
      (entry) =>
        entry.isFile() && /^page\.(tsx|ts|jsx|js|mdx)$/.test(entry.name)
    )
    expect(pages.map((entry) => entry.name)).toEqual([])
  })
})
