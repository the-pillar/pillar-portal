import { describe, expect, it } from "vitest"

import vectors from "../../../supabase/tests/tasks/link-vectors.json"
import {
  LINK_ERRORS,
  linkError,
  normalizeLink,
  placeLinks,
  referenceLinkSchema,
  referenceLinksSchema,
  shortLink,
  splitLinks,
} from "./links"

type Vector = {
  url: string | null
  pad_to?: number
  valid: boolean
  why: string
}

// The SQL answer is for the raw string; the form cleans first, so a row the
// SQL refuses can be fine once cleaned (these are the documented ones).
const CLEANED_BY_THE_FORM = new Set([
  "HTTPS://example.com",
  "Https://example.com",
  "example.com/page",
])

function raw(vector: Vector): string | null {
  if (vector.url === null) return null
  return vector.pad_to ? vector.url.padEnd(vector.pad_to, "a") : vector.url
}

describe("link vectors (the SQL answers)", () => {
  for (const vector of vectors.vectors as Vector[]) {
    const url = raw(vector)
    if (url === null) continue
    const label = `${vector.why}: ${JSON.stringify(url.slice(0, 40))}`
    if (vector.valid) {
      it(`accepts as is, ${label}`, () => {
        expect(normalizeLink(url)).toBe(url)
        expect(linkError(url)).toBeNull()
      })
    } else if (CLEANED_BY_THE_FORM.has(url)) {
      it(`cleans, ${label}`, () => {
        expect(normalizeLink(url)).not.toBe(url)
        expect(linkError(normalizeLink(url))).toBeNull()
      })
    } else {
      it(`refuses, ${label}`, () => {
        expect(linkError(normalizeLink(url))).not.toBeNull()
      })
    }
  }
})

describe("splitLinks", () => {
  it("splits on spaces and new lines only", () => {
    expect(splitLinks("a.com/x  b.com/y\nhttps://c.com/z?q=1&r=2\n")).toEqual([
      "a.com/x",
      "b.com/y",
      "https://c.com/z?q=1&r=2",
    ])
  })

  it("gives nothing for blank text", () => {
    expect(splitLinks(" \n ")).toEqual([])
  })
})

describe("normalizeLink", () => {
  it("adds https:// with a dot before the first slash", () => {
    expect(normalizeLink(" canva.com/x ")).toBe("https://canva.com/x")
    expect(normalizeLink("www.canva.com")).toBe("https://www.canva.com")
  })

  it("lowercases an http(s) scheme in any case", () => {
    expect(normalizeLink("HTTPS://Drive.google.com/x")).toBe(
      "https://Drive.google.com/x"
    )
    expect(normalizeLink("hTTp://a.com")).toBe("http://a.com")
  })

  it("leaves other schemes and dotless text alone", () => {
    expect(normalizeLink("mailto:a@b.com")).toBe("mailto:a@b.com")
    expect(normalizeLink("FTP://x.com")).toBe("FTP://x.com")
    expect(normalizeLink("hello")).toBe("hello")
    expect(normalizeLink("localhost/a.b")).toBe("localhost/a.b")
  })
})

describe("linkError", () => {
  it("names each refusal", () => {
    expect(linkError("mailto:a@b")).toBe("notWeb")
    expect(linkError("ftp://x")).toBe("notWeb")
    expect(linkError("hello")).toBe("notALink")
    expect(linkError("https://localhost")).toBe("notALink")
    expect(linkError("https:/x.com")).toBe("notALink")
    expect(linkError(`https://a.com/${"a".repeat(2049)}`)).toBe("tooLong")
    expect(linkError("https://a.com/" + String.fromCharCode(0x200b))).toBe(
      "hasSpace"
    )
    expect(linkError("https://a.com/a b")).toBe("hasSpace")
  })

  it("counts code points, as the database does", () => {
    const url = `https://a.com/${"😀".repeat(2048 - "https://a.com/".length)}`
    expect(linkError(url)).toBeNull()
  })
})

describe("referenceLinkSchema", () => {
  it("returns the cleaned address", () => {
    expect(referenceLinkSchema.parse("canva.com/x")).toBe("https://canva.com/x")
  })

  it("carries the copy of the refusal", () => {
    const result = referenceLinkSchema.safeParse("hello")
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe(LINK_ERRORS.notALink)
  })
})

describe("referenceLinksSchema", () => {
  it("never cuts 6 to 5", () => {
    const six = Array.from({ length: 6 }, (_, i) => `https://a.com/${i}`)
    expect(referenceLinksSchema.safeParse(six).success).toBe(false)
    expect(referenceLinksSchema.parse(six.slice(0, 5))).toHaveLength(5)
  })

  it("keeps [] as []", () => {
    expect(referenceLinksSchema.parse([])).toEqual([])
  })
})

describe("placeLinks", () => {
  const seven = Array.from({ length: 7 }, (_, i) => `https://a.com/${i + 1}`)

  it("fills five rows from one paste of seven", () => {
    const result = placeLinks([""], 0, seven)
    expect(result.rows).toEqual(seven.slice(0, 5))
    expect(result.placed).toBe(5)
    expect(result.leftOut).toEqual(seven.slice(5))
  })

  it("never overwrites a filled row", () => {
    const rows = ["https://a.com/1", "https://a.com/2", "", "https://a.com/4"]
    const result = placeLinks(rows, 2, [
      "https://b.com/1",
      "https://b.com/2",
      "https://b.com/3",
    ])
    expect(result.rows).toEqual([
      "https://a.com/1",
      "https://a.com/2",
      "https://b.com/1",
      "https://a.com/4",
      "https://b.com/2",
    ])
    expect(result.placed).toBe(2)
    expect(result.leftOut).toEqual(["https://b.com/3"])
  })

  it("cleans what it places", () => {
    expect(placeLinks([""], 0, ["a.com/x", "b.com"]).rows).toEqual([
      "https://a.com/x",
      "https://b.com",
    ])
  })
})

describe("shortLink", () => {
  it("names the host, with … when there is a path", () => {
    expect(shortLink("https://www.instagram.com/p/abc")).toBe("instagram.com/…")
    expect(shortLink("https://youtu.be/")).toBe("youtu.be")
    expect(shortLink("https://youtu.be")).toBe("youtu.be")
  })
})
