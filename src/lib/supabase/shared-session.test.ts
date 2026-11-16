import { describe, expect, it } from "vitest"

import {
  authCookieOptions,
  SHARED_UNTIL_COOKIE,
  sharedUntilCookieOptions,
  WARNING_LEAD_MS,
} from "./shared-session"

const SET = {
  path: "/",
  sameSite: "lax" as const,
  maxAge: 34560000,
  expires: new Date(0),
}

describe("authCookieOptions", () => {
  it("leaves a personal session's options alone", () => {
    expect(authCookieOptions(SET, false)).toBe(SET)
  })

  it("drops maxAge and expires from a shared session's set", () => {
    const options = authCookieOptions(SET, true)
    expect(options).toEqual({ path: "/", sameSite: "lax" })
    expect("maxAge" in options).toBe(false)
    expect("expires" in options).toBe(false)
  })

  it("leaves a removal alone", () => {
    const removal = { path: "/", maxAge: 0 }
    expect(authCookieOptions(removal, true)).toBe(removal)
  })
})

describe("deadline cookie", () => {
  it("is readable by script, Secure, Lax and a session cookie", () => {
    const options = sharedUntilCookieOptions()
    expect(options).toMatchObject({
      httpOnly: false,
      secure: true,
      sameSite: "lax",
    })
    expect("maxAge" in options).toBe(false)
    expect(SHARED_UNTIL_COOKIE).toBe("pillar-shared-until")
  })

  it("warns 2 minutes before the deadline", () => {
    expect(WARNING_LEAD_MS).toBe(120_000)
  })
})
