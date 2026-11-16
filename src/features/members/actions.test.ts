import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// vi.mock factories run before this file's imports, so what they share with
// the tests is created in vi.hoisted.
const {
  after,
  auth,
  cookieStore,
  createClient,
  recordErrorEvent,
  redirect,
  RedirectError,
  revalidatePath,
  rpc,
} = vi.hoisted(() => {
  const auth = {
    signInWithOAuth: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
  }
  // This browser's cookies: the session (in two chunks), the PKCE verifier,
  // and two that aren't Supabase auth cookies.
  const cookieStore = {
    getAll: vi.fn(() =>
      [
        "sb-127-auth-token.0",
        "sb-127-auth-token.1",
        "sb-127-auth-token-code-verifier",
        "sb-127-other",
        "theme",
      ].map((name) => ({ name, value: "x" }))
    ),
    delete: vi.fn(),
    set: vi.fn(),
  }
  // Like Next's redirect(), the mock throws, so nothing after it runs.
  class RedirectError extends Error {
    constructor(readonly url: string) {
      super(`NEXT_REDIRECT ${url}`)
    }
  }
  const rpc = vi.fn()
  return {
    // Holds each scheduled callback; runAfter() runs them, as Next does once
    // the response is sent.
    after: vi.fn<(task: () => unknown) => void>(),
    auth,
    cookieStore,
    createClient: vi.fn(async () => ({ auth, rpc })),
    recordErrorEvent: vi.fn(async () => {}),
    redirect: vi.fn((url: string) => {
      throw new RedirectError(url)
    }),
    RedirectError,
    revalidatePath: vi.fn(),
    rpc,
  }
})

vi.mock("@/lib/supabase/server", () => ({ createClient }))
vi.mock("next/navigation", () => ({ redirect }))
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }))
vi.mock("next/cache", () => ({ revalidatePath }))
vi.mock("next/server", () => ({ after }))
vi.mock("@/lib/record-error-event", () => ({ recordErrorEvent }))
// safeReturnPath checks `next` against the site's origin.
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

const PASSWORD = "a-persona-password-for-tests"

// env.server reads the environment when it loads, so each test stubs it and
// imports the actions afresh. The secret key is built at runtime so no
// key-shaped literal sits in the source.
async function loadActions({ personas }: { personas: string | undefined }) {
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_" + "a-key-for-these-tests-only")
  vi.stubEnv("PROTOTYPE_PERSONAS", personas)
  vi.stubEnv("PROTOTYPE_PERSONA_PASSWORD", PASSWORD)
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")
  vi.resetModules()
  return import("./actions")
}

async function runAfter() {
  for (const [task] of after.mock.calls) await task()
}

function form(fields: Record<string, string> = {}) {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

const AUTHORIZE_URL =
  "http://127.0.0.1:54321/auth/v1/authorize?provider=google&code_challenge=x"

beforeEach(() => {
  auth.signInWithOAuth.mockResolvedValue({
    data: { provider: "google", url: AUTHORIZE_URL },
    error: null,
  })
  auth.signInWithPassword.mockResolvedValue({ data: {}, error: null })
  auth.signOut.mockResolvedValue({ error: null })
  rpc.mockResolvedValue({ data: null, error: null })
})

afterEach(() => {
  vi.clearAllMocks()
  // Puts back console.error after the tests that spy on it.
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe("signInAsPersonaAction", () => {
  it("signs in with the persona's email and the server-held password, then goes to /dashboard", async () => {
    const { signInAsPersonaAction } = await loadActions({ personas: "true" })

    await expect(
      signInAsPersonaAction(null, form({ persona: "head_layout_artist" }))
    ).rejects.toThrow(RedirectError)

    expect(auth.signInWithPassword).toHaveBeenCalledExactlyOnceWith({
      email: "persona-head_layout_artist@example.com",
      password: PASSWORD,
    })
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/dashboard")
  })

  it("goes to the form's next after signing in", async () => {
    const { signInAsPersonaAction } = await loadActions({ personas: "true" })

    await expect(
      signInAsPersonaAction(
        null,
        form({ persona: "staff_layout_artist", next: "/dashboard?view=board" })
      )
    ).rejects.toEqual(new RedirectError("/dashboard?view=board"))

    expect(auth.signInWithPassword).toHaveBeenCalledOnce()
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/dashboard?view=board")
  })

  it.each(["https://evil.example/", "//evil.example", "/.//evil.example", ""])(
    "goes to /dashboard instead of the hostile next %j",
    async (next) => {
      const { signInAsPersonaAction } = await loadActions({ personas: "true" })

      await expect(
        signInAsPersonaAction(null, form({ persona: "editor_in_chief", next }))
      ).rejects.toEqual(new RedirectError("/dashboard"))
      expect(redirect).toHaveBeenCalledExactlyOnceWith("/dashboard")
    }
  )

  it("doesn't use next when sign-in fails", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { name: "AuthApiError", message: "Invalid login credentials" },
    })
    const { signInAsPersonaAction } = await loadActions({ personas: "true" })

    await expect(
      signInAsPersonaAction(
        null,
        form({ persona: "staff_layout_artist", next: "/dashboard?view=board" })
      )
    ).resolves.toEqual({ ok: false, code: "auth.sign_in_failed" })
    expect(redirect).not.toHaveBeenCalled()
  })

  it.each([undefined, "false"])(
    "returns auth.personas_off without calling Auth when PROTOTYPE_PERSONAS is %j",
    async (personas) => {
      const { signInAsPersonaAction } = await loadActions({ personas })

      await expect(
        signInAsPersonaAction(null, form({ persona: "editor_in_chief" }))
      ).resolves.toEqual({ ok: false, code: "auth.personas_off" })
      expect(createClient).not.toHaveBeenCalled()
      expect(auth.signInWithPassword).not.toHaveBeenCalled()
      expect(redirect).not.toHaveBeenCalled()
    }
  )

  it.each([
    ["missing", {}],
    ["unknown", { persona: "admin" }],
    ["a position that isn't a persona", { persona: "staff_writer" }],
    ["an inherited property name", { persona: "constructor" }],
  ])(
    "returns auth.sign_in_failed without calling Auth when the persona is %s",
    async (_label, fields) => {
      const { signInAsPersonaAction } = await loadActions({ personas: "true" })

      await expect(signInAsPersonaAction(null, form(fields))).resolves.toEqual({
        ok: false,
        code: "auth.sign_in_failed",
      })
      expect(auth.signInWithPassword).not.toHaveBeenCalled()
      expect(redirect).not.toHaveBeenCalled()
    }
  )

  it("returns auth.sign_in_failed and stays on /login when Auth refuses the password", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { name: "AuthApiError", message: "Invalid login credentials" },
    })
    const { signInAsPersonaAction } = await loadActions({ personas: "true" })

    await expect(
      signInAsPersonaAction(null, form({ persona: "staff_layout_artist" }))
    ).resolves.toEqual({ ok: false, code: "auth.sign_in_failed" })
    expect(redirect).not.toHaveBeenCalled()
  })

  it("returns auth.sign_in_failed when Auth can't be reached", async () => {
    auth.signInWithPassword.mockRejectedValue(new TypeError("fetch failed"))
    const { signInAsPersonaAction } = await loadActions({ personas: "true" })

    await expect(
      signInAsPersonaAction(null, form({ persona: "staff_layout_artist" }))
    ).resolves.toEqual({ ok: false, code: "auth.sign_in_failed" })
    expect(redirect).not.toHaveBeenCalled()
  })
})

describe("signInWithGoogleAction", () => {
  it("starts Google sign-in with the callback carrying the checked next, then goes to Supabase", async () => {
    const { signInWithGoogleAction } = await loadActions({ personas: "true" })

    await expect(
      signInWithGoogleAction(form({ next: "/dashboard/tasks/X?a=1&b=2" }))
    ).rejects.toEqual(new RedirectError(AUTHORIZE_URL))

    expect(auth.signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
      provider: "google",
      options: {
        redirectTo:
          "https://pillar.example/auth/callback?next=%2Fdashboard%2Ftasks%2FX%3Fa%3D1%26b%3D2",
        queryParams: { prompt: "select_account" },
      },
    })
    expect(redirect).toHaveBeenCalledExactlyOnceWith(AUTHORIZE_URL)
  })

  it("never asks the client to skip its redirect: on the server there is none", async () => {
    const { signInWithGoogleAction } = await loadActions({
      personas: undefined,
    })

    await expect(signInWithGoogleAction(form())).rejects.toThrow(RedirectError)

    const [{ options }] = auth.signInWithOAuth.mock.calls[0]
    expect(options).not.toHaveProperty("skipBrowserRedirect")
    expect(Object.keys(options)).toEqual(["redirectTo", "queryParams"])
  })

  it("asks Google for its account chooser, so after Sign out another account can sign in", async () => {
    const { signInWithGoogleAction } = await loadActions({ personas: "true" })

    await expect(signInWithGoogleAction(form())).rejects.toThrow(RedirectError)

    expect(auth.signInWithOAuth.mock.calls[0][0].options.queryParams).toEqual({
      prompt: "select_account",
    })
  })

  it("logs nothing when sign-in starts", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    const { signInWithGoogleAction } = await loadActions({ personas: "true" })

    await expect(signInWithGoogleAction(form())).rejects.toEqual(
      new RedirectError(AUTHORIZE_URL)
    )
    expect(errorLog).not.toHaveBeenCalled()
  })

  it.each([
    "https://evil.example/",
    "//evil.example",
    "/\\evil.example",
    "/.//evil.example",
    "",
  ])("carries /dashboard instead of the hostile next %j", async (next) => {
    const { signInWithGoogleAction } = await loadActions({ personas: "true" })

    await expect(signInWithGoogleAction(form({ next }))).rejects.toThrow(
      RedirectError
    )
    expect(auth.signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe(
      "https://pillar.example/auth/callback?next=%2Fdashboard"
    )
  })

  it("works with personas off: Google doesn't depend on them", async () => {
    const { signInWithGoogleAction } = await loadActions({ personas: "false" })

    await expect(signInWithGoogleAction(form())).rejects.toEqual(
      new RedirectError(AUTHORIZE_URL)
    )
  })

  const THROWN = new TypeError("boom")

  it.each([
    [
      "returns an error",
      () =>
        auth.signInWithOAuth.mockResolvedValue({
          data: { provider: "google", url: null },
          error: Object.assign(new Error("Unsupported provider"), {
            name: "AuthApiError",
            code: "validation_failed",
            status: 400,
            // Anything else on the error stays out of the log.
            extra: "not logged",
          }),
        }),
      [
        "signInWithGoogleAction: signInWithOAuth returned an error",
        {
          name: "AuthApiError",
          code: "validation_failed",
          status: 400,
          message: "Unsupported provider",
        },
      ],
    ],
    [
      "returns no url",
      () =>
        auth.signInWithOAuth.mockResolvedValue({
          data: { provider: "google", url: null },
          error: null,
        }),
      null,
    ],
    [
      "throws",
      () => auth.signInWithOAuth.mockRejectedValue(THROWN),
      ["signInWithGoogleAction: signInWithOAuth threw", THROWN],
    ],
  ])(
    "goes back to /login with the error and next when signInWithOAuth %s",
    async (_label, fail, logged) => {
      fail()
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
      const { signInWithGoogleAction } = await loadActions({ personas: "true" })

      await expect(
        signInWithGoogleAction(form({ next: "/dashboard?view=board" }))
      ).rejects.toEqual(
        new RedirectError(
          "/login?next=%2Fdashboard%3Fview%3Dboard&error=sign-in"
        )
      )
      expect(redirect).toHaveBeenCalledOnce()
      if (logged === null) {
        expect(errorLog).not.toHaveBeenCalled()
      } else {
        expect(errorLog).toHaveBeenCalledExactlyOnceWith(...logged)
      }
    }
  )
})

describe("shared computer", () => {
  const DEADLINE = "2026-11-16T10:30:00+00:00"

  it("marks the session and sets the deadline cookie when the box is ticked, creating the client shared", async () => {
    rpc.mockResolvedValue({ data: DEADLINE, error: null })
    const { signInAsPersonaAction } = await loadActions({ personas: "true" })

    await expect(
      signInAsPersonaAction(
        null,
        form({ persona: "editor_in_chief", shared: "1" })
      )
    ).rejects.toThrow(RedirectError)

    expect(createClient).toHaveBeenCalledWith({ shared: true })
    expect(rpc).toHaveBeenCalledExactlyOnceWith("mark_shared_session")
    expect(cookieStore.set).toHaveBeenCalledExactlyOnceWith(
      "pillar-shared-until",
      String(Date.parse(DEADLINE)),
      expect.objectContaining({
        httpOnly: false,
        secure: true,
        sameSite: "lax",
      })
    )
  })

  it("deletes a stale deadline cookie and marks nothing when the box is not ticked", async () => {
    const { signInAsPersonaAction } = await loadActions({ personas: "true" })

    await expect(
      signInAsPersonaAction(null, form({ persona: "editor_in_chief" }))
    ).rejects.toThrow(RedirectError)

    expect(createClient).toHaveBeenCalledWith({ shared: false })
    expect(rpc).not.toHaveBeenCalled()
    expect(cookieStore.delete).toHaveBeenCalledExactlyOnceWith(
      "pillar-shared-until"
    )
  })

  it("signs out and reports a failed sign-in when marking fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } })
    const { signInAsPersonaAction } = await loadActions({ personas: "true" })

    await expect(
      signInAsPersonaAction(
        null,
        form({ persona: "editor_in_chief", shared: "1" })
      )
    ).resolves.toEqual({ ok: false, code: "auth.sign_in_failed" })

    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" })
    expect(cookieStore.set).not.toHaveBeenCalled()
  })

  it("forwards shared=1 on the Google redirectTo only when ticked", async () => {
    const { signInWithGoogleAction } = await loadActions({ personas: "true" })

    await expect(
      signInWithGoogleAction(form({ next: "/dashboard", shared: "1" }))
    ).rejects.toThrow(RedirectError)
    expect(auth.signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe(
      "https://pillar.example/auth/callback?next=%2Fdashboard&shared=1"
    )

    expect(cookieStore.set).toHaveBeenCalledWith(
      "pillar-shared-signin",
      "1",
      expect.objectContaining({ httpOnly: true, secure: true, maxAge: 600 })
    )

    auth.signInWithOAuth.mockClear()
    cookieStore.delete.mockClear()
    await expect(
      signInWithGoogleAction(form({ next: "/dashboard" }))
    ).rejects.toThrow(RedirectError)
    expect(auth.signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe(
      "https://pillar.example/auth/callback?next=%2Fdashboard"
    )
    expect(cookieStore.delete).toHaveBeenCalledWith("pillar-shared-signin")
  })
})

describe("signOutAction", () => {
  const AUTH_COOKIES = [
    "sb-127-auth-token.0",
    "sb-127-auth-token.1",
    "sb-127-auth-token-code-verifier",
  ]

  it("ends this browser's session only (scope 'local'), then goes to /login", async () => {
    const { signOutAction } = await loadActions({ personas: "true" })

    await expect(signOutAction()).rejects.toThrow(RedirectError)

    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" })
    // The shared session's idle row goes (best effort), and supabase-js
    // cleared the session cookies itself: only the deadline cookie is deleted.
    expect(rpc).toHaveBeenCalledExactlyOnceWith("end_shared_session")
    expect(cookieStore.delete.mock.calls).toEqual([["pillar-shared-until"]])
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/login")
  })

  it.each([
    [
      "returns an error (the session stays in place)",
      () =>
        auth.signOut.mockResolvedValue({
          error: { name: "AuthRetryableFetchError", status: 0 },
        }),
    ],
    [
      "throws",
      () => auth.signOut.mockRejectedValue(new TypeError("fetch failed")),
    ],
  ])(
    "deletes this browser's auth cookies, then goes to /login, when signOut %s",
    async (_label, fail) => {
      fail()
      const { signOutAction } = await loadActions({ personas: "true" })

      await expect(signOutAction()).rejects.toThrow(RedirectError)

      expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" })
      expect(cookieStore.delete.mock.calls.map(([name]) => name)).toEqual([
        ...AUTH_COOKIES,
        "pillar-shared-until",
      ])
      expect(redirect).toHaveBeenCalledExactlyOnceWith("/login")
    }
  )

  it("goes to plain /login for a form with no next field (MemberMenu's)", async () => {
    const { signOutAction } = await loadActions({ personas: "true" })

    await expect(signOutAction(form())).rejects.toThrow(RedirectError)

    expect(redirect).toHaveBeenCalledExactlyOnceWith("/login")
  })

  it("comes back to /login keeping the form's next (an account-state screen's)", async () => {
    const { signOutAction } = await loadActions({ personas: "true" })

    await expect(
      signOutAction(form({ next: "/dashboard/tasks/X?view=board" }))
    ).rejects.toThrow(RedirectError)

    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" })
    expect(redirect).toHaveBeenCalledExactlyOnceWith(
      "/login?next=%2Fdashboard%2Ftasks%2FX%3Fview%3Dboard"
    )
  })

  it("keeps next after a failed sign-out too, once its cookies are gone", async () => {
    auth.signOut.mockRejectedValue(new TypeError("fetch failed"))
    const { signOutAction } = await loadActions({ personas: "true" })

    await expect(
      signOutAction(form({ next: "/dashboard/tasks/X" }))
    ).rejects.toThrow(RedirectError)

    expect(cookieStore.delete.mock.calls.map(([name]) => name)).toEqual([
      ...AUTH_COOKIES,
      "pillar-shared-until",
    ])
    expect(redirect).toHaveBeenCalledExactlyOnceWith(
      "/login?next=%2Fdashboard%2Ftasks%2FX"
    )
  })

  it.each(["https://evil.example/", "//evil.example", "/.//evil.example", ""])(
    "keeps /dashboard instead of the hostile next %j",
    async (next) => {
      const { signOutAction } = await loadActions({ personas: "true" })

      await expect(signOutAction(form({ next }))).rejects.toThrow(RedirectError)

      expect(redirect).toHaveBeenCalledExactlyOnceWith(
        "/login?next=%2Fdashboard"
      )
    }
  )
})

describe("error copy", () => {
  it("maps each code to the EXPERIENCE.md copy", async () => {
    const { MEMBER_ERROR_COPY } = await import("./errors")
    const stale =
      "Something changed since you opened this. Review the latest and try again."
    expect(MEMBER_ERROR_COPY).toEqual({
      "auth.personas_off": "Persona sign-in is off.",
      "auth.sign_in_failed": "Sign-in didn't finish. Try again.",
      "auth.not_active": "Sign in to do that.",
      "auth.step_up_required": "Couldn't save — try again.",
      "members.stale": stale,
      "members.not_found": stale,
      "members.last_admin":
        "You can't demote or deactivate the last Editorial Board admin.",
      "members.sole_editor_in_chief":
        "Transfer Editor-in-Chief to someone else first.",
      "members.name_blank": "Add a name.",
      "members.name_too_long": "Use 100 characters or fewer.",
      "members.save_failed": "Couldn't save — try again.",
    })
  })
})

const MEMBER_ID = "00000000-0000-4000-8000-000000000041"

const APPROVAL = {
  memberId: MEMBER_ID,
  positions: ["head_photojournalist", "staff_photojournalist"],
  primaryPosition: "staff_photojournalist",
}

describe("approveMemberAction", () => {
  it("calls approve_member with the positions and primary, revalidates the admin area and returns the member id", async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const { approveMemberAction } = await loadActions({ personas: "true" })

    await expect(approveMemberAction(APPROVAL)).resolves.toEqual({
      ok: true,
      data: { memberId: MEMBER_ID },
    })
    expect(rpc).toHaveBeenCalledExactlyOnceWith("approve_member", {
      member_id: MEMBER_ID,
      positions: ["head_photojournalist", "staff_photojournalist"],
      primary_position: "staff_photojournalist",
    })
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/(admin)/admin",
      "layout"
    )
  })

  it.each([
    ["no input", undefined],
    ["a member id that isn't a uuid", { ...APPROVAL, memberId: "nope" }],
    ["no positions", { ...APPROVAL, positions: [] }],
    [
      "Editor-in-Chief",
      {
        ...APPROVAL,
        positions: ["editor_in_chief"],
        primaryPosition: "editor_in_chief",
      },
    ],
    [
      "Editor-in-Chief beside another position",
      { ...APPROVAL, positions: ["staff_writer", "editor_in_chief"] },
    ],
    [
      "a position that isn't a slug",
      {
        ...APPROVAL,
        positions: ["Staff Writer"],
        primaryPosition: "Staff Writer",
      },
    ],
    [
      "more positions than are offered",
      {
        ...APPROVAL,
        positions: Array.from({ length: 22 }, (_, n) => `position_${n}`),
        primaryPosition: "position_0",
      },
    ],
    [
      "a primary that isn't among the positions",
      { ...APPROVAL, primaryPosition: "staff_writer" },
    ],
    ["no primary", { ...APPROVAL, primaryPosition: undefined }],
  ])(
    "returns members.save_failed without calling the database for %s",
    async (_label, input) => {
      const { approveMemberAction } = await loadActions({ personas: "true" })

      await expect(approveMemberAction(input)).resolves.toEqual({
        ok: false,
        code: "members.save_failed",
      })
      expect(createClient).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalled()
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )

  it.each(["auth.not_active", "members.stale", "members.not_found"])(
    "maps the database's %s straight through, without revalidating",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })
      const { approveMemberAction } = await loadActions({ personas: "true" })

      await expect(approveMemberAction(APPROVAL)).resolves.toEqual({
        ok: false,
        code: message,
      })
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )

  it.each([
    "members.not_admin",
    "members.no_positions",
    "members.invalid_position",
    "members.invalid_primary",
    "permission denied for function approve_member",
  ])("maps %j to members.save_failed", async (message) => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })
    const { approveMemberAction } = await loadActions({ personas: "true" })

    await expect(approveMemberAction(APPROVAL)).resolves.toEqual({
      ok: false,
      code: "members.save_failed",
    })
  })
})

describe("declineMemberAction", () => {
  it("calls decline_member, revalidates the admin area and returns the member id", async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const { declineMemberAction } = await loadActions({ personas: "true" })

    await expect(declineMemberAction({ memberId: MEMBER_ID })).resolves.toEqual(
      { ok: true, data: { memberId: MEMBER_ID } }
    )
    expect(rpc).toHaveBeenCalledExactlyOnceWith("decline_member", {
      member_id: MEMBER_ID,
    })
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/(admin)/admin",
      "layout"
    )
  })

  it.each([
    ["no input", undefined],
    ["no member id", {}],
    ["a member id that isn't a uuid", { memberId: "123" }],
  ])(
    "returns members.save_failed without calling the database for %s",
    async (_label, input) => {
      const { declineMemberAction } = await loadActions({ personas: "true" })

      await expect(declineMemberAction(input)).resolves.toEqual({
        ok: false,
        code: "members.save_failed",
      })
      expect(createClient).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalled()
    }
  )

  it.each(["auth.not_active", "members.stale", "members.not_found"])(
    "maps the database's %s straight through, without revalidating",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })
      const { declineMemberAction } = await loadActions({ personas: "true" })

      await expect(
        declineMemberAction({ memberId: MEMBER_ID })
      ).resolves.toEqual({ ok: false, code: message })
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )

  it.each(["members.not_admin", "connection refused"])(
    "maps %j to members.save_failed",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { message } })
      const { declineMemberAction } = await loadActions({ personas: "true" })

      await expect(
        declineMemberAction({ memberId: MEMBER_ID })
      ).resolves.toEqual({ ok: false, code: "members.save_failed" })
    }
  )
})

describe("recording unexpected errors", () => {
  it.each([
    [
      "returns an error",
      () => {
        const error = Object.assign(new Error("Unsupported provider"), {
          name: "AuthApiError",
          code: "validation_failed",
          status: 400,
        })
        auth.signInWithOAuth.mockResolvedValue({
          data: { provider: "google", url: null },
          error,
        })
        return error
      },
    ],
    [
      "throws",
      () => {
        const error = new TypeError("fetch failed")
        auth.signInWithOAuth.mockRejectedValue(error)
        return error
      },
    ],
  ])(
    "signInWithGoogleAction records it after the response when signInWithOAuth %s",
    async (_label, fail) => {
      const error = fail()
      vi.spyOn(console, "error").mockImplementation(() => {})
      const { signInWithGoogleAction } = await loadActions({ personas: "true" })

      await expect(signInWithGoogleAction(form())).rejects.toThrow(
        RedirectError
      )
      expect(recordErrorEvent).not.toHaveBeenCalled()
      expect(after).toHaveBeenCalledOnce()

      await runAfter()
      expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(error, {
        route: "action signInWithGoogleAction",
      })
    }
  )

  it("signInWithGoogleAction records nothing when sign-in starts, or when no url comes back", async () => {
    const { signInWithGoogleAction } = await loadActions({ personas: "true" })
    await expect(signInWithGoogleAction(form())).rejects.toThrow(RedirectError)

    auth.signInWithOAuth.mockResolvedValue({
      data: { provider: "google", url: null },
      error: null,
    })
    await expect(signInWithGoogleAction(form())).rejects.toThrow(RedirectError)

    expect(after).not.toHaveBeenCalled()
  })

  const RAW = {
    code: "42501",
    message: "permission denied for function approve_member",
    details: null,
    hint: null,
  }

  it.each([
    ["approveMemberAction", "approveMemberAction", APPROVAL],
    ["declineMemberAction", "declineMemberAction", { memberId: MEMBER_ID }],
  ] as const)(
    "%s records an unexpected error after the response, with the member",
    async (name, action, input) => {
      rpc.mockResolvedValue({ data: null, error: RAW })
      const actions = await loadActions({ personas: "true" })

      await expect(actions[action](input)).resolves.toEqual({
        ok: false,
        code: "members.save_failed",
      })
      expect(recordErrorEvent).not.toHaveBeenCalled()
      expect(after).toHaveBeenCalledOnce()

      await runAfter()
      expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(RAW, {
        route: `action ${name}`,
        entityType: "member",
        entityId: MEMBER_ID,
      })
    }
  )

  it("approveMemberAction records a backstop code (members.not_admin)", async () => {
    const error = { code: "P0001", message: "members.not_admin" }
    rpc.mockResolvedValue({ data: null, error })
    const { approveMemberAction } = await loadActions({ personas: "true" })

    await approveMemberAction(APPROVAL)
    await runAfter()

    expect(recordErrorEvent).toHaveBeenCalledExactlyOnceWith(error, {
      route: "action approveMemberAction",
      entityType: "member",
      entityId: MEMBER_ID,
    })
  })

  it.each(["auth.not_active", "members.stale", "members.not_found"])(
    "approve and decline don't record a known code (%s)",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })
      const { approveMemberAction, declineMemberAction } = await loadActions({
        personas: "true",
      })

      await approveMemberAction(APPROVAL)
      await declineMemberAction({ memberId: MEMBER_ID })

      expect(after).not.toHaveBeenCalled()
    }
  )

  it("approve and decline don't record a parse failure", async () => {
    const { approveMemberAction, declineMemberAction } = await loadActions({
      personas: "true",
    })

    await approveMemberAction({ ...APPROVAL, positions: [] })
    await declineMemberAction({ memberId: "nope" })

    expect(rpc).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })
})

describe("renameMemberAction", () => {
  it("calls set_member_name with the trimmed name, revalidates both areas and returns the saved name", async () => {
    rpc.mockResolvedValue({ data: "Axel Aranzado", error: null })
    const { renameMemberAction } = await loadActions({ personas: "true" })

    await expect(
      renameMemberAction({ memberId: MEMBER_ID, name: "  Axel Aranzado " })
    ).resolves.toEqual({
      ok: true,
      data: { memberId: MEMBER_ID, name: "Axel Aranzado" },
    })
    expect(rpc).toHaveBeenCalledExactlyOnceWith("set_member_name", {
      member_id: MEMBER_ID,
      name: "Axel Aranzado",
    })
    expect(revalidatePath).toHaveBeenCalledWith("/(admin)/admin", "layout")
    expect(revalidatePath).toHaveBeenCalledWith("/(member)/dashboard", "layout")
  })

  it.each([
    ["an empty name", "", "members.name_blank"],
    ["a blank name", " \t ", "members.name_blank"],
    ["101 characters", "x".repeat(101), "members.name_too_long"],
  ])(
    "returns the name code for %s without calling the database",
    async (_label, name, code) => {
      const { renameMemberAction } = await loadActions({ personas: "true" })

      await expect(
        renameMemberAction({ memberId: MEMBER_ID, name })
      ).resolves.toEqual({ ok: false, code })
      expect(rpc).not.toHaveBeenCalled()
      expect(revalidatePath).not.toHaveBeenCalled()
    }
  )

  it.each([
    ["no input", undefined],
    ["a member id that isn't a uuid", { memberId: "nope", name: "Axel" }],
    ["a name that isn't text", { memberId: MEMBER_ID, name: 7 }],
  ])("returns members.save_failed for %s", async (_label, input) => {
    const { renameMemberAction } = await loadActions({ personas: "true" })

    await expect(renameMemberAction(input)).resolves.toEqual({
      ok: false,
      code: "members.save_failed",
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    "auth.not_active",
    "members.stale",
    "members.not_found",
    "members.name_blank",
    "members.name_too_long",
  ])("maps the database's %s straight through", async (message) => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })
    const { renameMemberAction } = await loadActions({ personas: "true" })

    await expect(
      renameMemberAction({ memberId: MEMBER_ID, name: "Axel" })
    ).resolves.toEqual({ ok: false, code: message })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("maps members.not_admin to members.save_failed", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "members.not_admin" },
    })
    const { renameMemberAction } = await loadActions({ personas: "true" })

    await expect(
      renameMemberAction({ memberId: MEMBER_ID, name: "Axel" })
    ).resolves.toEqual({ ok: false, code: "members.save_failed" })
  })
})

describe("resetMemberMfaAction", () => {
  it("calls reset_member_mfa, revalidates the admin area and returns the member", async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const { resetMemberMfaAction } = await loadActions({ personas: "true" })

    await expect(
      resetMemberMfaAction({ memberId: MEMBER_ID })
    ).resolves.toEqual({ ok: true, data: { memberId: MEMBER_ID } })
    expect(rpc).toHaveBeenCalledExactlyOnceWith("reset_member_mfa", {
      member_id: MEMBER_ID,
    })
    expect(revalidatePath).toHaveBeenCalledWith("/(admin)/admin", "layout")
  })

  it.each([
    ["no input", undefined],
    ["a member id that isn't a uuid", { memberId: "nope" }],
  ])("returns members.save_failed for %s", async (_label, input) => {
    const { resetMemberMfaAction } = await loadActions({ personas: "true" })

    await expect(resetMemberMfaAction(input)).resolves.toEqual({
      ok: false,
      code: "members.save_failed",
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    "auth.not_active",
    "auth.step_up_required",
    "members.stale",
    "members.not_found",
  ])("maps the database's %s straight through", async (message) => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })
    const { resetMemberMfaAction } = await loadActions({ personas: "true" })

    await expect(
      resetMemberMfaAction({ memberId: MEMBER_ID })
    ).resolves.toEqual({ ok: false, code: message })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it.each(["members.not_admin", "members.reset_own_factor"])(
    "maps %s to members.save_failed",
    async (message) => {
      rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })
      const { resetMemberMfaAction } = await loadActions({ personas: "true" })

      await expect(
        resetMemberMfaAction({ memberId: MEMBER_ID })
      ).resolves.toEqual({ ok: false, code: "members.save_failed" })
    }
  )
})

describe("updateMemberAction", () => {
  const INPUT = {
    memberId: MEMBER_ID,
    positions: ["staff_layout_artist", "head_layout_artist"],
    primaryPosition: "head_layout_artist",
  }

  it("calls update_member, revalidates the admin area and returns the member", async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const { updateMemberAction } = await loadActions({ personas: "true" })

    await expect(updateMemberAction(INPUT)).resolves.toEqual({
      ok: true,
      data: { memberId: MEMBER_ID },
    })
    expect(rpc).toHaveBeenCalledExactlyOnceWith("update_member", {
      member_id: MEMBER_ID,
      positions: INPUT.positions,
      primary_position: "head_layout_artist",
    })
    expect(revalidatePath).toHaveBeenCalledWith("/(admin)/admin", "layout")
  })

  it.each([
    ["no input", undefined],
    ["no positions", { ...INPUT, positions: [] }],
    ["a primary outside the set", { ...INPUT, primaryPosition: "news_editor" }],
    ["a member id that isn't a uuid", { ...INPUT, memberId: "nope" }],
  ])("returns members.save_failed for %s", async (_label, input) => {
    const { updateMemberAction } = await loadActions({ personas: "true" })

    await expect(updateMemberAction(input)).resolves.toEqual({
      ok: false,
      code: "members.save_failed",
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    "auth.not_active",
    "auth.step_up_required",
    "members.stale",
    "members.not_found",
    "members.last_admin",
  ])("maps the database's %s straight through", async (message) => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })
    const { updateMemberAction } = await loadActions({ personas: "true" })

    await expect(updateMemberAction(INPUT)).resolves.toEqual({
      ok: false,
      code: message,
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it.each([
    "members.not_admin",
    "members.change_own_positions",
    "members.invalid_position",
  ])("maps %s to members.save_failed", async (message) => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })
    const { updateMemberAction } = await loadActions({ personas: "true" })

    await expect(updateMemberAction(INPUT)).resolves.toEqual({
      ok: false,
      code: "members.save_failed",
    })
  })
})

describe("deactivateMemberAction", () => {
  it("calls deactivate_member, revalidates the root layout and returns the member", async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const { deactivateMemberAction } = await loadActions({ personas: "true" })

    await expect(
      deactivateMemberAction({ memberId: MEMBER_ID })
    ).resolves.toEqual({ ok: true, data: { memberId: MEMBER_ID } })
    expect(rpc).toHaveBeenCalledExactlyOnceWith("deactivate_member", {
      member_id: MEMBER_ID,
    })
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout")
  })

  it.each([
    ["no input", undefined],
    ["a member id that isn't a uuid", { memberId: "nope" }],
  ])("returns members.save_failed for %s", async (_label, input) => {
    const { deactivateMemberAction } = await loadActions({ personas: "true" })

    await expect(deactivateMemberAction(input)).resolves.toEqual({
      ok: false,
      code: "members.save_failed",
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    "auth.step_up_required",
    "members.stale",
    "members.last_admin",
    "members.sole_editor_in_chief",
  ])("maps the database's %s straight through", async (message) => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } })
    const { deactivateMemberAction } = await loadActions({ personas: "true" })

    await expect(
      deactivateMemberAction({ memberId: MEMBER_ID })
    ).resolves.toEqual({ ok: false, code: message })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("maps members.deactivate_self to members.save_failed", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "members.deactivate_self" },
    })
    const { deactivateMemberAction } = await loadActions({ personas: "true" })

    await expect(
      deactivateMemberAction({ memberId: MEMBER_ID })
    ).resolves.toEqual({ ok: false, code: "members.save_failed" })
  })
})
