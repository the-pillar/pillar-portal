import { z } from "zod"

// Reference links (spine AD-24). Pure and client-safe: the form, the schemas
// and the Vitest vectors share it. `private.is_valid_link` stays the
// authority; this refuses what it refuses, and cleans what a person types.

export const LINK_MAX_LENGTH = 2048
export const LINKS_MAX = 5

// is_valid_link's refused characters, as the same explicit set (never `\s`,
// whose meaning differs between Postgres locales and JavaScript), plus
// U+0000, which Postgres text cannot hold anyway.
const REFUSED_CHARACTERS =
  /[\u0000-\u0020\u007f\u0085\u00a0\u200b-\u200f\u2028\u2029\u202f\u205f\u3000\ufeff]/

// Half of a surrogate pair with no other half: Postgres text can't hold it.
const LONE_SURROGATE = /\p{Cs}/u

const SCHEME = /^([a-z][a-z0-9+.-]*):/i

export const LINK_ERRORS = {
  notALink:
    "This doesn't look like a link. Copy the full address from your browser.",
  notWeb: "Only web links work here, like https://…",
  tooLong:
    "This link is too long. Use the site's Share button to get a shorter one.",
  hasSpace: "This link has a space in it. Paste it again from the address bar.",
  tooMany: `A task holds up to ${LINKS_MAX} links.`,
} as const

export type LinkError = keyof typeof LINK_ERRORS

/** Links pasted together, split on whitespace only. */
export function splitLinks(text: string): string[] {
  return text.split(/\s+/).filter((part) => part !== "")
}

/**
 * What a typed link becomes: trimmed, an http(s) scheme in lowercase, and
 * `https://` added when there is no `scheme:` and a dot comes before the
 * first `/`. Anything else is returned trimmed, for `linkError` to refuse.
 */
export function normalizeLink(raw: string): string {
  const text = raw.trim()
  const scheme = SCHEME.exec(text)
  if (scheme) {
    const name = scheme[1].toLowerCase()
    return name === "http" || name === "https"
      ? name + text.slice(scheme[1].length)
      : text
  }
  const slash = text.indexOf("/")
  const authority = slash === -1 ? text : text.slice(0, slash)
  return authority.includes(".") ? `https://${text}` : text
}

/** U+0000 or half a surrogate pair: text Postgres can't store (22P05). */
export function hasUnsavableCharacter(link: string): boolean {
  return link.includes(String.fromCharCode(0)) || LONE_SURROGATE.test(link)
}

/** Why a normalized link is refused, or null when it is fine. */
export function linkError(link: string): LinkError | null {
  if (REFUSED_CHARACTERS.test(link)) return "hasSpace"
  if (LONE_SURROGATE.test(link)) return "notALink"
  if (Array.from(link).length > LINK_MAX_LENGTH) return "tooLong"
  const scheme = SCHEME.exec(link)
  if (scheme && !/^https?$/.test(scheme[1])) return "notWeb"
  if (!/^https?:\/\//.test(link)) return "notALink"
  try {
    return new URL(link).hostname.includes(".") ? null : "notALink"
  } catch {
    return "notALink"
  }
}

/** One link: cleaned, then checked. The output is the cleaned address. */
export const referenceLinkSchema = z
  .string()
  .transform((value) => normalizeLink(value))
  .superRefine((link, ctx) => {
    const error = linkError(link)
    if (error) ctx.addIssue({ code: "custom", message: LINK_ERRORS[error] })
  })

/**
 * The list: never splits, drops or cuts 6 to 5, and is `[]` rather than null
 * when empty. The form drops its empty rows before this runs.
 */
export const referenceLinksSchema = z
  .array(referenceLinkSchema)
  .max(LINKS_MAX, { message: LINK_ERRORS.tooMany })

export type PlacedLinks = {
  rows: string[]
  /** How many links went into a row. */
  placed: number
  /** The links that did not fit, cleaned. */
  leftOut: string[]
}

/**
 * Pasted links into a row: the first stays in `rows[index]`, the rest fill
 * the empty rows below it, then new rows, up to `LINKS_MAX`. A filled row is
 * never overwritten.
 */
export function placeLinks(
  rows: readonly string[],
  index: number,
  links: readonly string[]
): PlacedLinks {
  const next = [...rows]
  const [first, ...rest] = links.map(normalizeLink)
  next[index] = first
  let placed = 1
  const leftOut: string[] = []
  for (const link of rest) {
    const empty = next.findIndex((row, i) => i > index && row === "")
    if (empty !== -1) {
      next[empty] = link
      placed += 1
    } else if (next.length < LINKS_MAX) {
      next.push(link)
      placed += 1
    } else {
      leftOut.push(link)
    }
  }
  return { rows: next, placed, leftOut }
}

/** `instagram.com/…`: a link as the "didn't fit" note names it. */
export function shortLink(link: string): string {
  const bare = link.replace(/^https?:\/\//, "").replace(/^www\./, "")
  const slash = bare.search(/[/?#]/)
  return slash === -1 || slash === bare.length - 1
    ? bare.replace(/\/$/, "")
    : `${bare.slice(0, slash)}/…`
}
