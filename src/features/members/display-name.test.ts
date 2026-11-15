import { describe, expect, it } from "vitest"

import { displayNameSchema } from "./display-name"

function issue(input: unknown) {
  const result = displayNameSchema.safeParse(input)
  return result.success ? null : result.error.issues[0].message
}

describe("displayNameSchema", () => {
  it("trims", () => {
    expect(displayNameSchema.parse("  Axel Aranzado ")).toBe("Axel Aranzado")
  })

  it.each(["", "   ", "\t\n "])("calls %j blank", (input) => {
    expect(issue(input)).toBe("members.name_blank")
  })

  it("accepts 100 characters and refuses 101", () => {
    expect(issue("x".repeat(100))).toBeNull()
    expect(issue("x".repeat(101))).toBe("members.name_too_long")
  })

  it("counts code points, not UTF-16 units", () => {
    expect(issue("😀".repeat(100))).toBeNull()
    expect(issue("😀".repeat(101))).toBe("members.name_too_long")
  })

  it("trims before counting", () => {
    expect(issue("x".repeat(100) + "   ")).toBeNull()
  })

  it("refuses a non-string as a parse failure", () => {
    expect(displayNameSchema.safeParse(null).success).toBe(false)
  })
})
