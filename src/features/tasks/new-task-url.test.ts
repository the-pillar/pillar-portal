import { describe, expect, it } from "vitest"

import {
  isNewTaskRequested,
  parseNewDue,
  parseOwnerChoice,
  resolveNewTaskPrefill,
} from "./new-task-url"

const OWNERS = [
  { kind: "section" as const, id: "news", name: "News" },
  { kind: "desk" as const, id: "layout", name: "Layout" },
]

const params = (query: string) => new URLSearchParams(query)

describe("parseNewDue", () => {
  it("reads a day as that day at 5:00 PM", () => {
    expect(parseNewDue("2026-11-20")).toBe("2026-11-20T17:00")
  })

  it.each(["2026-13-40", "2026-02-30", "tomorrow", "", null, ["2026-11-20"]])(
    "ignores %j",
    (value) => {
      expect(parseNewDue(value)).toBeNull()
    }
  )
})

describe("parseOwnerChoice", () => {
  it("accepts a listed section or desk", () => {
    expect(parseOwnerChoice("desk:layout", OWNERS)).toBe("desk:layout")
    expect(parseOwnerChoice("section:news", OWNERS)).toBe("section:news")
  })

  it.each(["desk:zzz", "all", "mine", "articles", "", null, "layout"])(
    "refuses %j",
    (value) => {
      expect(parseOwnerChoice(value, OWNERS)).toBeNull()
    }
  )
})

describe("isNewTaskRequested", () => {
  it("is true only for new=task", () => {
    expect(isNewTaskRequested(params("new=task"))).toBe(true)
    expect(isNewTaskRequested(params("new=1"))).toBe(false)
    expect(isNewTaskRequested(params(""))).toBe(false)
  })
})

describe("resolveNewTaskPrefill", () => {
  it("prefers a valid new_owner", () => {
    expect(
      resolveNewTaskPrefill(
        params("new=task&new_owner=desk:layout&owner=section:news"),
        OWNERS,
        "section:news"
      )
    ).toEqual({ owner: "desk:layout", dueAt: "" })
  })

  it("falls back to the URL's owner when it names a section or desk", () => {
    expect(
      resolveNewTaskPrefill(
        params("new=task&new_owner=desk:zzz&owner=section:news"),
        OWNERS,
        "desk:layout"
      ).owner
    ).toBe("section:news")
  })

  it("skips an owner chip that is not a section or desk, then uses the home scope", () => {
    expect(
      resolveNewTaskPrefill(
        params("new=task&owner=mine"),
        OWNERS,
        "desk:layout"
      ).owner
    ).toBe("desk:layout")
  })

  it("leaves the owner empty when nothing applies", () => {
    expect(resolveNewTaskPrefill(params("new=task"), OWNERS, null).owner).toBe(
      ""
    )
  })

  it("ignores bad parameters", () => {
    expect(
      resolveNewTaskPrefill(
        params("new=task&new_owner=desk:zzz&new_due=2026-13-40"),
        OWNERS,
        null
      )
    ).toEqual({ owner: "", dueAt: "" })
  })

  it("reads new_due", () => {
    expect(
      resolveNewTaskPrefill(params("new=task&new_due=2026-11-20"), OWNERS, null)
        .dueAt
    ).toBe("2026-11-20T17:00")
  })
})
