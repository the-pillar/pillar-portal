import { describe, expect, it } from "vitest"

import {
  buildCalendarEvent,
  calendarRoutePath,
  googleCalendarUrl,
} from "./calendar"
import { buildIcs } from "./ics-file"

const TASK = {
  id: "00000000-0000-4000-8000-000000000021",
  title: "Lay out the spread",
  description: "a, b; c\nsecond line",
  dueAt: "2026-10-10T09:00:00+00:00",
  referenceUrls: ["https://example.com/ref"],
}
const SITE = "https://pillar.example"

describe("calendar builders", () => {
  it("titles, times and links the event", () => {
    const event = buildCalendarEvent(TASK, SITE)
    expect(event.title).toBe("Due: Lay out the spread")
    expect(event.start.toISOString()).toBe("2026-10-10T09:00:00.000Z")
    expect(event.end.toISOString()).toBe("2026-10-10T09:15:00.000Z")
    expect(event.details).toContain("a, b; c")
    expect(event.details).toContain("• example.com: https://example.com/ref")
    expect(event.details).toContain(`${SITE}/dashboard/tasks/${TASK.id}`)
  })

  it("holds only the task link for a sparse task", () => {
    const event = buildCalendarEvent(
      { ...TASK, description: null, referenceUrls: [] },
      SITE
    )
    expect(event.details).toBe(`Task: ${SITE}/dashboard/tasks/${TASK.id}`)
  })

  it("builds a Google URL with UTC dates and encoded values", () => {
    const url = googleCalendarUrl(buildCalendarEvent(TASK, SITE))
    expect(url).toMatch(
      /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=Due%3A%20Lay%20out/
    )
    expect(url).toContain("dates=20261010T090000Z/20261010T091500Z")
    expect(url).toContain("a%2C%20b%3B%20c%0Asecond%20line")
  })

  it("writes a UTC event with two alarms and escaped text", () => {
    const ics = buildIcs(buildCalendarEvent(TASK, SITE))!
    expect(ics).toContain("DTSTART:20261010T090000Z")
    expect(ics).toContain("SUMMARY:Due: Lay out the spread")
    expect(ics).toContain("a\\, b\\; c\\nsecond line")
    expect(ics).toContain("UID:task-00000000-0000-4000-8000-000000000021")
    expect(ics).toMatch(/^TRIGGER:-P1D\r?$/m)
    expect(ics).toMatch(/^TRIGGER:-PT1H\r?$/m)
    expect(ics).not.toContain("-P1DT")
    expect((ics.match(/BEGIN:VALARM/g) ?? []).length).toBe(2)
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1)
  })

  it("lists every link by site after the description", () => {
    const event = buildCalendarEvent(
      {
        ...TASK,
        referenceUrls: [
          "https://drive.google.com/drive/folders/1",
          "https://www.canva.com/design/2",
        ],
      },
      SITE
    )
    expect(event.details).toBe(
      [
        TASK.description,
        "• Google Drive: https://drive.google.com/drive/folders/1\n• Canva: https://www.canva.com/design/2",
        `Task: ${SITE}/dashboard/tasks/${TASK.id}`,
      ].join("\n\n")
    )
  })

  describe("the Google URL's 4,000-character budget", () => {
    const FIVE = Array.from(
      { length: 5 },
      (_, i) => `https://example.com/${i}/${"a".repeat(2000)}`
    )
    const taskLink = `Task: ${SITE}/dashboard/tasks/${TASK.id}`

    it("cuts the description first, keeping every link", () => {
      const long = "x".repeat(5000)
      const event = buildCalendarEvent(
        { ...TASK, description: long, referenceUrls: ["https://a.com/1"] },
        SITE
      )
      const url = googleCalendarUrl(event)
      expect(url.length).toBeLessThanOrEqual(4000)
      const text = decodeURIComponent(url)
      expect(text).toContain("…\n\n• a.com: https://a.com/1\n\nTask:")
      expect(text).toContain(taskLink)
      expect(event.details).toContain(long)
      expect(buildIcs(event)).toContain("xxxxxxxxxx")
    })

    it("cuts on a code point boundary, with no split surrogate", () => {
      const emoji = "😀".repeat(1500)
      const url = googleCalendarUrl(
        buildCalendarEvent({ ...TASK, description: emoji }, SITE)
      )
      expect(url.length).toBeLessThanOrEqual(4000)
      expect(() => decodeURIComponent(url)).not.toThrow()
      const text = decodeURIComponent(url)
      expect(text).toContain("😀…")
      expect(text).toContain(taskLink)
    })

    it("drops links whole from the last once the description is gone", () => {
      const event = buildCalendarEvent(
        { ...TASK, description: "keep me", referenceUrls: FIVE },
        SITE
      )
      const url = googleCalendarUrl(event)
      expect(url.length).toBeLessThanOrEqual(4000)
      const text = decodeURIComponent(url)
      expect(text).toContain(FIVE[0])
      expect(text).not.toContain(FIVE[4])
      expect(text).toContain(taskLink)
      // Whole links only: a dropped link leaves no stub of itself behind.
      expect(text).not.toContain(`${FIVE[4].slice(0, 40)}`)
    })

    it("keeps the task link when nothing else fits", () => {
      const url = googleCalendarUrl(
        buildCalendarEvent(
          {
            ...TASK,
            description: "😀".repeat(2000),
            referenceUrls: FIVE,
          },
          SITE
        )
      )
      expect(url.length).toBeLessThanOrEqual(4000)
      expect(decodeURIComponent(url)).toContain(taskLink)
    })

    it("fits an emoji-heavy description with five 2,048-character links", () => {
      const longest = Array.from({ length: 5 }, (_, i) =>
        `https://example.com/${i}/`.padEnd(2048, "a")
      )
      expect(longest.every((link) => link.length === 2048)).toBe(true)
      const url = googleCalendarUrl(
        buildCalendarEvent(
          {
            ...TASK,
            description: "Brief 📸🎨📰 ".repeat(400),
            referenceUrls: longest,
          },
          SITE
        )
      )
      expect(url.length).toBeLessThanOrEqual(4000)
      const text = decodeURIComponent(url)
      expect(text).toContain(taskLink)
      expect(text).toContain(longest[0])
      for (const link of longest.slice(1)) {
        expect(text).not.toContain(link.slice(0, 40))
      }
    })

    it("carries every link in the file", () => {
      const ics = buildIcs(
        buildCalendarEvent({ ...TASK, referenceUrls: FIVE }, SITE)
      )!
      const unfolded = ics.replace(/\r?\n[ \t]/g, "")
      for (const link of FIVE) expect(unfolded).toContain(link)
    })
  })

  it("builds route paths", () => {
    expect(calendarRoutePath("x")).toBe("/api/tasks/x/ics")
    expect(calendarRoutePath("x", "google")).toBe("/api/tasks/x/ics?to=google")
  })
})
