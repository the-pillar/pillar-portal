import { describe, expect, it } from "vitest"

import { highlightedIds } from "./board-highlights"

const ME = "me"
const card = (
  id: string,
  column: string,
  movedBy: string | null = null,
  createdBy: string | null = null
) => ({ id, column, movedBy, createdBy })

describe("highlightedIds", () => {
  it("highlights a card someone else moved to another column", () => {
    expect(
      highlightedIds([card("a", "to_do")], [card("a", "doing", "them")], ME)
    ).toEqual(["a"])
  })

  it("never highlights the viewer's own move or an unmoved card", () => {
    expect(
      highlightedIds(
        [card("a", "to_do"), card("b", "doing")],
        [card("a", "doing", ME), card("b", "doing", "them")],
        ME
      )
    ).toEqual([])
  })

  it("highlights a new card another member created, not the viewer's own", () => {
    expect(
      highlightedIds(
        [card("a", "to_do")],
        [
          card("a", "to_do"),
          card("b", "to_do", null, "them"),
          card("c", "to_do", null, ME),
        ],
        ME
      )
    ).toEqual(["b"])
  })
})
