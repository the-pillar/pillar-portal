import { describe, expect, it } from "vitest"

import { AVATAR_SLOT_COUNT, avatarSlot } from "./avatar-slot"

describe("avatarSlot", () => {
  it.each([
    ["", 6],
    ["a", 5],
    ["member-1", 2],
    ["00000000-0000-0000-0000-000000000001", 7],
  ])("maps %j to a fixed slot", (id, slot) => {
    expect(avatarSlot(id)).toBe(avatarSlot(id))
    expect(avatarSlot(id)).toBe(slot)
  })

  it("stays within 1…8 and reaches every slot", () => {
    const seen = new Set<number>()
    for (let i = 0; i < 400; i++) {
      const slot = avatarSlot(`member-${i}`)
      expect(slot).toBeGreaterThanOrEqual(1)
      expect(slot).toBeLessThanOrEqual(AVATAR_SLOT_COUNT)
      expect(Number.isInteger(slot)).toBe(true)
      seen.add(slot)
    }
    expect(seen.size).toBe(AVATAR_SLOT_COUNT)
  })
})
