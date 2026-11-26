// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen, within } from "@testing-library/react"
import axe from "axe-core"
import { afterEach, describe, expect, it, vi } from "vitest"

const { after, getCurrentMember, recordErrorEvent } = vi.hoisted(() => ({
  after: vi.fn<(task: () => unknown) => void>(),
  getCurrentMember: vi.fn(),
  recordErrorEvent: vi.fn(async () => {}),
}))

vi.mock("next/server", () => ({ after }))
vi.mock("@/lib/record-error-event", () => ({ recordErrorEvent }))
vi.mock("@/features/members", () => ({ getCurrentMember }))

import NotFound, { metadata } from "./not-found"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderNotFound() {
  return render(await NotFound())
}

describe("the root not-found page", () => {
  it("is titled Page not found (the root template adds the brand)", () => {
    expect(metadata).toEqual({ title: "Page not found" })
  })

  it.each([
    [
      "an active staff member",
      { state: "active", role: "staff" },
      "Go to What's mine",
      "/dashboard",
    ],
    [
      "an active admin",
      { state: "active", role: "editorial_admin" },
      "Go to Admin home",
      "/admin",
    ],
    ["a signed-out visitor", null, "Sign in", "/login"],
    [
      "a pending member",
      { state: "pending", role: "staff" },
      "Sign in",
      "/login",
    ],
  ])(
    "shows the header and a way home for %s",
    async (_who, member, label, href) => {
      getCurrentMember.mockResolvedValue(member)
      await renderNotFound()

      expect(screen.getByRole("banner")).toBeInTheDocument()
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "This page doesn't exist.",
        })
      ).toBeInTheDocument()
      const main = screen.getByRole("main")
      expect(within(main).getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href
      )
    }
  )

  it("makes the way home a primary Button, not a hand-rolled link", async () => {
    getCurrentMember.mockResolvedValue(null)
    await renderNotFound()

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "data-variant",
      "default"
    )
  })

  it("falls back to Sign in, and records the fault after the response, when the lookup throws", async () => {
    const error = new Error("members read failed")
    getCurrentMember.mockRejectedValue(error)
    await renderNotFound()

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login"
    )
    expect(recordErrorEvent).not.toHaveBeenCalled()
    await after.mock.calls[0][0]()
    expect(recordErrorEvent).toHaveBeenCalledWith(error, {
      route: "render not-found",
    })
  })

  it("has no axe violations", async () => {
    getCurrentMember.mockResolvedValue(null)
    const { container } = await renderNotFound()

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    })
    expect(results.violations).toEqual([])
  })
})
