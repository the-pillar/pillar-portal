// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

afterEach(cleanup)

import { QuotaMeter } from "./quota-meter"
import type { EmailQuotaStatus } from "./quota"

// 2026-11-26 is a Thursday. 10:00 PHT, past the 8:00 AM turnover.
const DAYTIME = new Date("2026-11-26T02:00:00Z")
// 07:59 PHT.
const EARLY = new Date("2026-11-25T23:59:00Z")

const STATUS: EmailQuotaStatus = {
  providerDay: "2026-11-26",
  sentToday: 10,
  limitToday: 100,
  queued: 0,
  finishesOn: null,
}

function meter(status: Partial<EmailQuotaStatus>, now = DAYTIME) {
  const { container } = render(
    <QuotaMeter status={{ ...STATUS, ...status }} now={now} />
  )
  return container
}

const fill = (container: HTMLElement) =>
  container.querySelector("[data-fill]") as HTMLElement

describe("QuotaMeter", () => {
  it("reads sent, limit and queued as text", () => {
    meter({ sentToday: 40, queued: 3 })
    expect(screen.getByText(/40 \/ 100 today/).textContent).toBe(
      "40 / 100 today · 3 queued"
    )
  })

  it("adds the weekday the queue finishes when it spills", () => {
    meter({ sentToday: 100, queued: 0, finishesOn: "2026-11-27" })
    expect(screen.getByText(/100 \/ 100 today/).textContent).toBe(
      "100 / 100 today · 0 queued · finishes Fri"
    )
  })

  it("leaves out finishes when the queue empties today", () => {
    meter({ queued: 5, finishesOn: "2026-11-26" })
    expect(screen.getByText(/10 \/ 100 today/).textContent).not.toContain(
      "finishes"
    )
  })

  it("hides the bar from assistive technology", () => {
    const container = meter({})
    expect(fill(container).parentElement).toHaveAttribute("aria-hidden", "true")
  })

  it.each([
    [79, "normal"],
    [80, "attention"],
    [100, "attention"],
  ])("fills at %i of 100 in the %s color", (sent, color) => {
    const container = meter({ sentToday: sent })
    expect(fill(container)).toHaveAttribute("data-fill", color)
    expect(fill(container).style.width).toBe(`${sent}%`)
  })

  it("counts a limit of 0 as full", () => {
    const container = meter({ sentToday: 0, limitToday: 0 })
    expect(fill(container)).toHaveAttribute("data-fill", "attention")
    expect(fill(container).style.width).toBe("100%")
  })

  it("says the daily limit is reached, with emails going out tomorrow", () => {
    meter({ sentToday: 100, queued: 81, finishesOn: "2026-11-27" })
    expect(
      screen.getByText(
        "Daily limit reached — 81 emails will go out tomorrow from 8:00 AM."
      )
    ).toBeInTheDocument()
  })

  it("keeps the normal line, with finishes, when the queue outlasts tomorrow", () => {
    meter({ sentToday: 100, queued: 250, finishesOn: "2026-11-28" })
    expect(screen.getByText(/100 \/ 100 today/).textContent).toBe(
      "100 / 100 today · 250 queued · finishes Sat"
    )
    expect(screen.queryByText(/Daily limit reached/)).not.toBeInTheDocument()
  })

  it("keeps the normal line when the month is used up and the queue finishes on the 1st", () => {
    meter({
      providerDay: "2026-11-26",
      sentToday: 40,
      limitToday: 40,
      queued: 10,
      finishesOn: "2026-12-01",
    })
    expect(screen.getByText(/40 \/ 40 today/).textContent).toBe(
      "40 / 40 today · 10 queued · finishes Tue"
    )
    expect(screen.queryByText(/Daily limit reached/)).not.toBeInTheDocument()
  })

  it("keeps the normal line, without finishes, for a limit of 0 that never empties", () => {
    meter({ sentToday: 0, limitToday: 0, queued: 3, finishesOn: null })
    expect(screen.getByText(/0 \/ 0 today/).textContent).toBe(
      "0 / 0 today · 3 queued"
    )
    expect(screen.queryByText(/Daily limit reached/)).not.toBeInTheDocument()
  })

  it("says today before 8:00 AM Philippine time", () => {
    meter({ sentToday: 100, queued: 81, finishesOn: "2026-11-27" }, EARLY)
    expect(
      screen.getByText(
        "Daily limit reached — 81 emails will go out today from 8:00 AM."
      )
    ).toBeInTheDocument()
  })

  it("says one email for one", () => {
    meter({ sentToday: 100, queued: 1, finishesOn: "2026-11-27" })
    expect(
      screen.getByText(
        "Daily limit reached — 1 email will go out tomorrow from 8:00 AM."
      )
    ).toBeInTheDocument()
  })

  it("keeps the normal line at the limit with nothing queued", () => {
    meter({ sentToday: 100, queued: 0 })
    expect(screen.getByText(/100 \/ 100 today/)).toBeInTheDocument()
    expect(screen.queryByText(/Daily limit reached/)).not.toBeInTheDocument()
  })
})
