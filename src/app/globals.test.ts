import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "../..")
const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8")
const orgSql = readFileSync(
  path.join(
    root,
    "supabase/migrations/20260927141747_core_org_reference_data.sql"
  ),
  "utf8"
)

// The ids of the `sections` and `desks` rows the migration inserts.
function ids(table: "sections" | "desks"): string[] {
  const block = new RegExp(
    `insert into public\\.${table} \\([^)]*\\) values([\\s\\S]*?);`
  ).exec(orgSql)?.[1]
  if (!block) throw new Error(`no ${table} insert in the migration`)
  return [...block.matchAll(/\('([a-z_]+)',/g)].map((m) => m[1])
}

// `writers` owns no task in practice (articles belong to desks), has no
// owner-* token and takes the neutral fallback (the plan's Design Notes).
const NEUTRAL = new Set(["writers"])

describe("globals.css owner colors", () => {
  const orgIds = [...ids("sections"), ...ids("desks")]

  it("reads every section and desk id from the migration", () => {
    expect(orgIds).toHaveLength(13)
  })

  it.each(orgIds.filter((id) => !NEUTRAL.has(id)))(
    'maps data-owner="%s" to its owner token',
    (id) => {
      expect(css).toMatch(
        new RegExp(
          `\\[data-owner="${id}"\\]\\s*\\{\\s*--owner:\\s*var\\(--color-owner-${id}\\);`
        )
      )
      expect(css).toMatch(new RegExp(`--color-owner-${id}:\\s*#`))
    }
  )

  it("leaves the neutral ids to the fallback", () => {
    for (const id of NEUTRAL) {
      expect(css).not.toContain(`[data-owner="${id}"]`)
      expect(orgIds).toContain(id)
    }
  })

  it("has a [data-owner] fallback ahead of the id rules", () => {
    const fallback = css.indexOf("[data-owner] {")
    expect(fallback).toBeGreaterThan(-1)
    expect(fallback).toBeLessThan(css.indexOf('[data-owner="news"]'))
  })
})

describe("globals.css avatar colors", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("maps data-avatar=%i", (n) => {
    expect(css).toMatch(new RegExp(`--color-avatar-${n}:\\s*#`))
    expect(css).toMatch(
      new RegExp(
        `\\[data-avatar="${n}"\\]\\s*\\{\\s*--avatar:\\s*var\\(--color-avatar-${n}\\);`
      )
    )
  })
})

describe("globals.css reduced motion", () => {
  const rule =
    /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}\n/.exec(
      css
    )?.[1]

  it("is one unlayered rule on every element", () => {
    expect(rule).toBeDefined()
    expect(css.match(/@media \(prefers-reduced-motion/g)).toHaveLength(1)
    expect(rule).toContain("*,")
    expect(rule).toContain("*::before")
    expect(rule).toContain("*::after")
  })

  it("neutralizes tw-animate's enter and exit variables", () => {
    for (const v of ["translate-x", "translate-y", "scale", "rotate"]) {
      expect(rule).toContain(`--tw-enter-${v}:`)
      expect(rule).toContain(`--tw-exit-${v}:`)
    }
  })

  it("caps durations above zero and never sets transform or translate", () => {
    expect(rule).toContain("animation-duration: var(--motion-reduced-fade)")
    expect(rule).toContain("transition-duration: var(--motion-reduced-fade)")
    expect(rule).toContain("scroll-behavior: auto")
    expect(rule).not.toMatch(/(^|\s)(transform|translate)\s*:/)
  })

  it("lets only fades and color tints transition, so nothing moved by script slides", () => {
    const list = /transition-property:([^;]*);/.exec(rule ?? "")?.[1]
    expect(list).toBeDefined()
    expect(list).toContain("opacity")
    expect(list).toContain("!important")
    expect(list).not.toMatch(
      /\b(all|transform|translate|scale|rotate|top|left|height|width)\b/
    )
  })
})
