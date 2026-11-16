import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import type { Database } from "@/lib/supabase/database.types"

import { checkIdle, endIdleSession, finishSignIn } from "./idle"

type Client = SupabaseClient<Database>

function client(parts: object) {
  return parts as unknown as Client
}

describe("checkIdle", () => {
  it("reads no row as a personal session", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    expect(await checkIdle(client({ rpc }))).toEqual({ kind: "personal" })
    expect(rpc).toHaveBeenCalledWith("check_session_idle")
  })

  it("reads an unexpired row as active with its deadline in ms", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ expires_at: "2026-11-16T10:30:00+00:00", expired: false }],
      error: null,
    })
    expect(await checkIdle(client({ rpc }))).toEqual({
      kind: "active",
      expiresAt: Date.parse("2026-11-16T10:30:00Z"),
    })
  })

  it("reads an expired row as expired", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ expires_at: "2026-11-16T10:30:00+00:00", expired: true }],
      error: null,
    })
    expect(await checkIdle(client({ rpc }))).toEqual({ kind: "expired" })
  })

  it("throws an RPC error", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error("x") })
    await expect(checkIdle(client({ rpc }))).rejects.toThrow("x")
  })
})

function jar() {
  return {
    getAll: vi.fn(() =>
      ["sb-r-auth-token.0", "sb-r-auth-token-code-verifier", "theme"].map(
        (name) => ({ name })
      )
    ),
    delete: vi.fn(),
  }
}

describe("endIdleSession", () => {
  it("signs out locally and removes only the deadline cookie on success", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null })
    const cookies = jar()
    await endIdleSession(client({ auth: { signOut } }), cookies)
    expect(signOut).toHaveBeenCalledWith({ scope: "local" })
    expect(cookies.delete.mock.calls).toEqual([["pillar-shared-until"]])
  })

  it("deletes the auth cookies itself when sign-out returns an error", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: new Error("x") })
    const cookies = jar()
    await endIdleSession(client({ auth: { signOut } }), cookies)
    expect(cookies.delete.mock.calls.map(([name]) => name)).toEqual([
      "sb-r-auth-token.0",
      "sb-r-auth-token-code-verifier",
      "pillar-shared-until",
    ])
  })

  it("deletes the auth cookies itself when sign-out throws", async () => {
    const signOut = vi.fn().mockRejectedValue(new Error("x"))
    const cookies = jar()
    await endIdleSession(client({ auth: { signOut } }), cookies)
    expect(cookies.delete).toHaveBeenCalledWith("sb-r-auth-token.0")
  })
})

describe("finishSignIn", () => {
  it("deletes the deadline cookie and signs out when marking fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const signOut = vi.fn().mockResolvedValue({ error: null })
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error("x") })
    const jar = { set: vi.fn(), delete: vi.fn() }

    const ok = await finishSignIn(client({ auth: { signOut }, rpc }), jar, true)

    expect(ok).toBe(false)
    expect(signOut).toHaveBeenCalledWith({ scope: "local" })
    expect(jar.delete).toHaveBeenCalledWith("pillar-shared-until")
    expect(jar.set).not.toHaveBeenCalled()
  })
})
