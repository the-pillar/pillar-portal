import { describe, expect, it, vi } from "vitest"

import { safeReturnPath } from "@/features/members"

// The members barrel carries server-only code (AGENTS.md › Known pitfalls).
vi.mock("@/lib/supabase/server", () => ({}))
vi.mock("@/features/members/actions", () => ({}))
vi.mock("@/lib/env.client", () => ({
  clientEnv: { NEXT_PUBLIC_SITE_URL: "https://pillar.example" },
}))

import { boardHref, returnLink, taskHref } from "./return-link"

describe("returnLink", () => {
  it.each([
    ["/dashboard", "What's mine"],
    ["/dashboard?view=board", "Board"],
    ["/dashboard?view=board&owner=layout&column=doing&focus=abc", "Board"],
    ["/dashboard?view=planner&month=2026-11&owner=mine", "Planner"],
    ["/admin/tasks", "Tasks"],
    ["/admin", "Admin home"],
  ])("labels %s as %s and keeps the path", (path, label) => {
    expect(returnLink(path)).toEqual({ href: path, label })
  })

  it.each([
    "/dashboard?view=nonsense",
    "/dashboard/tasks/abc",
    "/admin/members",
    "/somewhere",
    "",
  ])("falls back to What's mine for %j", (path) => {
    expect(returnLink(path)).toEqual({
      href: "/dashboard",
      label: "What's mine",
    })
  })
})

describe("taskHref", () => {
  it("is bare without a from", () => {
    expect(taskHref("t1")).toBe("/dashboard/tasks/t1")
  })
  it("encodes the from", () => {
    expect(taskHref("t1", "/dashboard?view=board&column=doing")).toBe(
      "/dashboard/tasks/t1?from=%2Fdashboard%3Fview%3Dboard%26column%3Ddoing"
    )
  })
})

describe("boardHref", () => {
  it("carries the chip, the column and the card to focus", () => {
    const href = boardHref({ owner: "layout", column: "doing", id: "t1" })
    expect(href).toBe(
      "/dashboard?view=board&owner=layout&column=doing&focus=t1"
    )
    expect(returnLink(href)).toEqual({ href, label: "Board" })
  })
})

describe("returnLink after the real safeReturnPath", () => {
  it.each(["//evil.example", "https://evil.example/x", "/.//x"])(
    "sends the hostile from %j to What's mine",
    (from) => {
      expect(returnLink(safeReturnPath(from))).toEqual({
        href: "/dashboard",
        label: "What's mine",
      })
    }
  )
})
