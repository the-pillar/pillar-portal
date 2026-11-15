import { describe, expect, it } from "vitest"

import { ACCOUNT_STATE_COPY, memberStateOf } from "./account-state"
import { whereMemberState } from "./account-state"

const AT = "2026-10-12T09:00:00+00:00"

describe("memberStateOf", () => {
  it.each([
    ["staff", null, null, "active"],
    ["editorial_admin", null, null, "active"],
    ["pending", null, null, "pending"],
    ["pending", AT, null, "declined"],
    ["staff", null, AT, "deactivated"],
    ["editorial_admin", null, AT, "deactivated"],
    // Precedence: deactivated over declined over pending.
    ["pending", AT, AT, "deactivated"],
    ["pending", null, AT, "deactivated"],
    // A row the database's CHECK refuses still reads as not active.
    ["staff", AT, null, "declined"],
  ] as const)(
    "role %s, declined_at %s, deactivated_at %s is %s",
    (role, declinedAt, deactivatedAt, state) => {
      expect(memberStateOf({ role, declinedAt, deactivatedAt })).toBe(state)
    }
  )
})

describe("ACCOUNT_STATE_COPY", () => {
  it("uses EXPERIENCE.md's titles and texts", () => {
    expect(ACCOUNT_STATE_COPY).toEqual({
      pending: {
        title: "Awaiting approval",
        text: "You're signed in — a Board member will approve you shortly. Tell your editor or head you've joined.",
      },
      declined: {
        title: "Access declined",
        text: "Your access request wasn't approved. If this is a mistake, ask your editor or head.",
      },
      deactivated: {
        title: "No access",
        text: "Your access to the portal has ended. If this is a mistake, ask your editor or head.",
      },
    })
  })
})

describe("whereMemberState", () => {
  type Row = {
    role: "pending" | "staff" | "editorial_admin"
    declined_at: string | null
    deactivated_at: string | null
  }
  type Filter = {
    eq(column: "role", value: "pending"): Filter
    neq(column: "role", value: "pending"): Filter
    is(column: "declined_at" | "deactivated_at", value: null): Filter
  }

  // A recorder that applies each call to a row, as PostgREST would.
  function keeps(row: Row, state: "pending" | "active") {
    let kept = true
    const filter: Filter = {
      eq: (column, value) => ((kept &&= row[column] === value), filter),
      neq: (column, value) => ((kept &&= row[column] !== value), filter),
      is: (column, value) => ((kept &&= row[column] === value), filter),
    }
    whereMemberState(filter, state)
    return kept
  }

  const rows: Row[] = []
  for (const role of ["pending", "staff", "editorial_admin"] as const)
    for (const declined_at of [null, AT])
      for (const deactivated_at of [null, AT])
        rows.push({ role, declined_at, deactivated_at })

  it.each(rows)(
    "keeps role $role, declined_at $declined_at, deactivated_at $deactivated_at exactly in its state",
    (row) => {
      const state = memberStateOf({
        role: row.role,
        declinedAt: row.declined_at,
        deactivatedAt: row.deactivated_at,
      })
      expect(keeps(row, "pending")).toBe(state === "pending")
      expect(keeps(row, "active")).toBe(state === "active")
    }
  )
})
