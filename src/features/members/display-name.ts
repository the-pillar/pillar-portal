import { z } from "zod"

/** The longest display name, in code points (the database counts characters). */
export const DISPLAY_NAME_MAX = 100

/**
 * A display name as the editor and the action take it: trimmed, then blank
 * (`members.name_blank`) or over 100 code points (`members.name_too_long`).
 * Each issue's message is the error code. Client-safe: no server imports.
 * Nothing is cut silently, so the input has no `maxLength`.
 */
export const displayNameSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, { message: "members.name_blank" })
      .refine((value) => [...value].length <= DISPLAY_NAME_MAX, {
        message: "members.name_too_long",
      })
  )
