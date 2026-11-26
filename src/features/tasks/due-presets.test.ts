import { describe, expect, it } from "vitest"

import { duePresets } from "./due-presets"

// 2026-11-16 is a Monday, 2026-11-20 a Friday (Manila).
const at = (iso: string) => duePresets(new Date(iso))
const values = (iso: string) => at(iso).map((preset) => preset.value)
const labels = (iso: string) => at(iso).map((preset) => preset.label)

describe("duePresets", () => {
  it("offers Today, Tomorrow and this Friday, each at 5 PM", () => {
    expect(labels("2026-11-16T02:00:00Z")).toEqual([
      "Today 5 PM",
      "Tomorrow 5 PM",
      "Friday 5 PM",
    ])
    expect(values("2026-11-16T02:00:00Z")).toEqual([
      "2026-11-16T17:00",
      "2026-11-17T17:00",
      "2026-11-20T17:00",
    ])
  })

  it("moves to Next Friday on a Friday", () => {
    expect(labels("2026-11-20T02:00:00Z")[2]).toBe("Next Friday 5 PM")
    expect(values("2026-11-20T02:00:00Z")).toEqual([
      "2026-11-20T17:00",
      "2026-11-21T17:00",
      "2026-11-27T17:00",
    ])
  })

  it("moves to Next Friday on a Thursday, when tomorrow is Friday", () => {
    expect(labels("2026-11-19T02:00:00Z")[2]).toBe("Next Friday 5 PM")
    expect(values("2026-11-19T02:00:00Z")).toEqual([
      "2026-11-19T17:00",
      "2026-11-20T17:00",
      "2026-11-27T17:00",
    ])
  })

  it("keeps Friday 5 PM on a Saturday, the Friday six days on", () => {
    expect(labels("2026-11-21T02:00:00Z")[2]).toBe("Friday 5 PM")
    expect(values("2026-11-21T02:00:00Z")[2]).toBe("2026-11-27T17:00")
  })

  it("keeps Friday 5 PM on a Wednesday, two days on", () => {
    expect(values("2026-11-18T02:00:00Z")[2]).toBe("2026-11-20T17:00")
  })

  it("reads the day in Manila: 4 PM UTC Thursday is already Friday there", () => {
    expect(values("2026-11-19T16:00:00Z")).toEqual([
      "2026-11-20T17:00",
      "2026-11-21T17:00",
      "2026-11-27T17:00",
    ])
  })

  it("is still Thursday at 11:59 PM in Manila", () => {
    expect(values("2026-11-19T15:59:00Z")[0]).toBe("2026-11-19T17:00")
  })

  it("carries across a month and year end", () => {
    expect(values("2026-12-30T02:00:00Z")).toEqual([
      "2026-12-30T17:00",
      "2026-12-31T17:00",
      "2027-01-01T17:00",
    ])
  })
})
