import { beforeEach, describe, expect, it, vi } from "vitest"

const { after, cookieStore, createClient, getClaims, recordErrorEvent, rpc } =
  vi.hoisted(() => ({
    // Holds each scheduled callback; runAfter() runs them, as Next does once
    // the response is sent.
    after: vi.fn<(task: () => unknown) => void>(),
    cookieStore: {
      getAll: vi.fn(() => [{ name: "sb-r-auth-token" }]),
      delete: vi.fn(),
      set: vi.fn(),
    },
    createClient: vi.fn(),
    getClaims: vi.fn(),
    recordErrorEvent: vi.fn(async () => {}),
    rpc: vi.fn(),
  }))

vi.mock("@/lib/supabase/server", () => ({ createClient }))
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }))
vi.mock("next/server", () => ({ after }))
vi.mock("@/lib/record-error-event", () => ({ recordErrorEvent }))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

import { AuthRetryableFetchError } from "@supabase/supabase-js"

import { POST } from "./route"

const SIGNED_IN = { data: { claims: { sub: "u" } }, error: null }

const CHECK_DEADLINE = "2999-01-01T00:00:00+00:00"
const RENEWED = "2999-01-01T00:20:00+00:00"

// check_session_idle answers `check`; renew_shared_session answers `renew`.
function answer(
  check: { data: unknown; error: unknown },
  renew: { data: unknown; error: unknown } = { data: RENEWED, error: null }
) {
  rpc.mockImplementation(async (name: string) =>
    name === "check_session_idle" ? check : renew
  )
}
const ACTIVE = {
  data: [{ expires_at: CHECK_DEADLINE, expired: false }],
  error: null,
}

function post(origin: string | null = "https://pillar.example") {
  return POST(
    new Request("https://pillar.example/api/session/activity", {
      method: "POST",
      headers: origin === null ? {} : { origin },
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getClaims.mockResolvedValue(SIGNED_IN)
  createClient.mockResolvedValue({
    auth: { getClaims, signOut: vi.fn().mockResolvedValue({ error: null }) },
    rpc,
  })
})

describe("POST /api/session/activity", () => {
  it.each(["https://evil.example", null])(
    "answers 403 for the Origin %j without touching the session",
    async (origin) => {
      const res = await post(origin)
      expect(res.status).toBe(403)
      expect(res.headers.get("cache-control")).toBe("private, no-store")
      expect(createClient).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalled()
    }
  )

  it("answers 500, not 401, while Auth is unreachable", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const error = new AuthRetryableFetchError("fetch failed", 0)
    getClaims.mockResolvedValue({ data: null, error })

    expect((await post()).status).toBe(500)
    for (const [task] of after.mock.calls) await task()
    expect(recordErrorEvent).toHaveBeenCalledWith(error, {
      route: "route /api/session/activity",
    })
    log.mockRestore()
  })

  it("answers 401 when signed out", async () => {
    getClaims.mockResolvedValue({ data: null, error: null })
    expect((await post()).status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("renews an active shared session: 204 and the new deadline cookie", async () => {
    answer(ACTIVE)

    const res = await post()

    expect(res.status).toBe(204)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "check_session_idle",
      "renew_shared_session",
    ])
    expect(cookieStore.set).toHaveBeenCalledExactlyOnceWith(
      "pillar-shared-until",
      String(Date.parse(RENEWED)),
      expect.objectContaining({ httpOnly: false, secure: true })
    )
  })

  it("answers 204 for a personal session and deletes a stale deadline cookie", async () => {
    answer({ data: [], error: null })

    expect((await post()).status).toBe(204)
    expect(rpc).toHaveBeenCalledExactlyOnceWith("check_session_idle")
    expect(cookieStore.delete).toHaveBeenCalledWith("pillar-shared-until")
    expect(cookieStore.set).not.toHaveBeenCalled()
  })

  it("signs out an expired session and answers 401 without renewing", async () => {
    answer({
      data: [{ expires_at: "2000-01-01T00:00:00+00:00", expired: true }],
      error: null,
    })

    expect((await post()).status).toBe(401)
    expect(rpc).not.toHaveBeenCalledWith("renew_shared_session")
    expect(cookieStore.delete).toHaveBeenCalledWith("pillar-shared-until")
    expect(cookieStore.set).not.toHaveBeenCalled()
  })

  it.each([
    ["the row is gone", null],
    ["it idled out in between", CHECK_DEADLINE],
  ])(
    "signs out and answers 401 when the renew finds %s",
    async (_case, renewed) => {
      answer(ACTIVE, { data: renewed, error: null })

      expect((await post()).status).toBe(401)
      expect(cookieStore.delete).toHaveBeenCalledWith("pillar-shared-until")
      expect(cookieStore.set).not.toHaveBeenCalled()
    }
  )

  it("answers 500, logged and recorded after the response, on an RPC error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const error = { message: "boom" }
    answer(ACTIVE, { data: null, error })

    expect((await post()).status).toBe(500)
    expect(log).toHaveBeenCalled()
    expect(recordErrorEvent).not.toHaveBeenCalled()
    for (const [task] of after.mock.calls) await task()
    expect(recordErrorEvent).toHaveBeenCalledWith(error, {
      route: "route /api/session/activity",
    })
    log.mockRestore()
  })
})
