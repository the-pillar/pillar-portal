"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { after } from "next/server"

import { clientEnv } from "@/lib/env.client"
import { personasEnabled, serverEnv } from "@/lib/env.server"
import { mapCommandError } from "@/lib/map-command-error"
import {
  type ErrorEventWhere,
  recordErrorEvent,
} from "@/lib/record-error-event"
import { ADMIN_AREA, MEMBER_AREA } from "@/lib/revalidate-paths"
import { finishSignIn } from "@/lib/supabase/idle"
import { createClient } from "@/lib/supabase/server"
import {
  SHARED_SIGN_IN_COOKIE,
  SHARED_UNTIL_COOKIE,
  sharedSignInCookieOptions,
} from "@/lib/supabase/shared-session"

import type { MemberErrorCode } from "./errors"
import { PERSONAS } from "./personas"
import { loginPath, safeReturnPath } from "./return-path"
import {
  memberApproveSchema,
  memberDeactivateSchema,
  memberDeclineSchema,
  memberMfaResetSchema,
  memberRenameSchema,
  memberUpdateSchema,
  personaSignInSchema,
} from "./schemas"

const GOOGLE_SIGN_IN: ErrorEventWhere = {
  route: "action signInWithGoogleAction",
}

/**
 * Starts Google sign-in (AD-7). PKCE: `signInWithOAuth` on the server writes
 * the code verifier cookie and returns Supabase's authorize URL, which this
 * redirects to (outside the `try`, since redirect() throws). Google sends
 * the member back through Supabase to /auth/callback, the only redirect URL,
 * carrying the form's `next` once `safeReturnPath` has checked it; the
 * callback checks it again. A ticked "This is a shared computer" (`shared=1`)
 * rides along on `redirectTo`, so the callback marks the session (AD-22).
 *
 * `prompt=select_account` makes Google show its account chooser every time:
 * otherwise, after Sign out, Google silently signs the same account in
 * again, and a declined member couldn't try another account.
 *
 * Any failure goes back to /login with the "didn't finish" line, keeping
 * `next`; a returned error (its name, code, status and message only) and a
 * throw are logged first, and recorded in error_events after the response
 * (the code and this action only), since both are server faults no visitor
 * causes.
 * `skipBrowserRedirect` is never passed: on the server the client never
 * redirects by itself.
 */
export async function signInWithGoogleAction(
  formData: FormData
): Promise<void> {
  const next = safeReturnPath(formData.get("next"))
  const shared = formData.get("shared") === "1"

  // A backup for the callback if Supabase falls back to the Site URL and
  // drops `shared` from redirectTo: a short-lived cookie says the same.
  const cookieStore = await cookies()
  if (shared) {
    cookieStore.set(SHARED_SIGN_IN_COOKIE, "1", sharedSignInCookieOptions())
  } else {
    cookieStore.delete(SHARED_SIGN_IN_COOKIE)
  }

  let url: string | null = null
  try {
    const supabase = await createClient({ shared })
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: new URL(
          `/auth/callback?next=${encodeURIComponent(next)}${shared ? "&shared=1" : ""}`,
          clientEnv.NEXT_PUBLIC_SITE_URL
        ).href,
        queryParams: { prompt: "select_account" },
      },
    })
    if (error) {
      const { name, code, status, message } = error
      console.error(
        "signInWithGoogleAction: signInWithOAuth returned an error",
        {
          name,
          code,
          status,
          message,
        }
      )
      after(() => recordErrorEvent(error, GOOGLE_SIGN_IN))
    } else if (data.url) {
      url = data.url
    }
  } catch (error) {
    console.error("signInWithGoogleAction: signInWithOAuth threw", error)
    after(() => recordErrorEvent(error, GOOGLE_SIGN_IN))
  }

  if (url === null) redirect(loginPath({ next, error: true }))
  redirect(url)
}

/** What the persona form shows after a failed attempt; success redirects. */
export type PersonaSignInState = { ok: false; code: MemberErrorCode } | null

/**
 * Signs in as the persona whose button was pressed, with the password only
 * the server holds (AD-7), then goes to the form's `next` when
 * `safeReturnPath` accepts it, else /dashboard. Refuses without calling Auth
 * unless PROTOTYPE_PERSONAS is on. A bad button value and any Auth failure
 * look the same to the visitor. A ticked shared-computer box (`shared=1`)
 * marks the session and sets the deadline cookie, else a stale one goes
 * (AD-22); a mark that fails counts as a failed sign-in.
 */
export async function signInAsPersonaAction(
  _previous: PersonaSignInState,
  formData: FormData
): Promise<PersonaSignInState> {
  const password = serverEnv.PROTOTYPE_PERSONA_PASSWORD
  if (!personasEnabled || password === undefined) {
    return { ok: false, code: "auth.personas_off" }
  }

  const parsed = personaSignInSchema.safeParse({
    persona: formData.get("persona"),
  })
  if (!parsed.success) return { ok: false, code: "auth.sign_in_failed" }

  const shared = formData.get("shared") === "1"

  let signedIn = false
  try {
    const supabase = await createClient({ shared })
    const { error } = await supabase.auth.signInWithPassword({
      email: PERSONAS[parsed.data.persona].email,
      password,
    })
    signedIn =
      error === null && (await finishSignIn(supabase, await cookies(), shared))
  } catch {
    signedIn = false
  }
  if (!signedIn) return { ok: false, code: "auth.sign_in_failed" }

  // redirect() throws, so it stays outside the try.
  redirect(safeReturnPath(formData.get("next")))
}

/**
 * Ends this browser's session only. Personas are shared accounts, so a global
 * sign-out would sign out everyone else using the same persona.
 *
 * supabase-js `signOut()` reports most failures as a returned `{ error }` and
 * then leaves the session cookies in place. On any failure, returned or
 * thrown, this deletes the browser's auth cookies itself, so the visitor is
 * signed out here even when Auth can't be reached.
 *
 * A form that carries a `next` field (the account-state screens on /login)
 * comes back to /login keeping it, once `safeReturnPath` has checked it, so
 * a member who switches accounts still reaches the link they opened. Any
 * other form (MemberMenu's) goes to /login.
 */
export async function signOutAction(formData?: FormData): Promise<void> {
  let failed: boolean
  try {
    const supabase = await createClient()
    // Forget a shared session's idle row (best effort: a failure must not keep
    // the person signed in). An idle sign-out never does this.
    try {
      await supabase.rpc("end_shared_session")
    } catch {
      // Ignored: the sign-out below still runs.
    }
    const { error } = await supabase.auth.signOut({ scope: "local" })
    failed = error !== null
  } catch {
    failed = true
  }
  if (failed) await deleteAuthCookies()
  ;(await cookies()).delete(SHARED_UNTIL_COOKIE)

  redirect(
    formData?.has("next")
      ? loginPath({ next: safeReturnPath(formData.get("next")) })
      : "/login"
  )
}

// The @supabase/ssr session cookies: `sb-<ref>-auth-token`, its `.0`, `.1`...
// chunks, and `sb-<ref>-auth-token-code-verifier`.
async function deleteAuthCookies() {
  const cookieStore = await cookies()
  for (const { name } of cookieStore.getAll()) {
    if (name.startsWith("sb-") && name.includes("-auth-token")) {
      cookieStore.delete(name)
    }
  }
}

// AD-3's result shape for the approval commands.
export type MemberCommandState =
  | { ok: true; data: { memberId: string } }
  | { ok: false; code: MemberErrorCode; params?: Record<string, unknown> }

// The codes approve_member, decline_member and set_member_name raise that the
// page has copy for (set_member_name also raises members.name_blank and
// members.name_too_long, shown under the field; the client checks first).
// Anything else (members.not_admin, the position backstops, a raw
// database or network error) is members.save_failed, and mapCommandError
// records it in error_events after the response (code, action, member id
// only). A parse failure never gets there: anyone can send one, so it isn't
// recorded.
const COMMAND_ERROR_CODES: ReadonlySet<MemberErrorCode> = new Set([
  "auth.not_active",
  "auth.step_up_required",
  "members.stale",
  "members.not_found",
  "members.last_admin",
  "members.sole_editor_in_chief",
  "members.name_blank",
  "members.name_too_long",
])

/**
 * Approves a pending member with their positions and primary (AD-3, AD-4).
 * approve_member decides whether the caller may and whether the member is
 * still pending, and the role follows the positions; this only parses, calls
 * it, maps the error and revalidates the admin area.
 */
export async function approveMemberAction(
  input: unknown
): Promise<MemberCommandState> {
  const parsed = memberApproveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, code: "members.save_failed" }
  const { memberId, positions, primaryPosition } = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.rpc("approve_member", {
    member_id: memberId,
    positions,
    primary_position: primaryPosition,
  })
  if (error) {
    return {
      ok: false,
      code: mapCommandError(error, COMMAND_ERROR_CODES, "members.save_failed", {
        route: "action approveMemberAction",
        entityType: "member",
        entityId: memberId,
      }),
    }
  }

  revalidatePath(ADMIN_AREA, "layout")
  return { ok: true, data: { memberId } }
}

/**
 * Declines a pending member (AD-3, AD-4): decline_member keeps the row and
 * sets `declined_at`, so their next sign-in shows Access declined. This only
 * parses, calls it, maps the error and revalidates the admin area.
 */
export async function declineMemberAction(
  input: unknown
): Promise<MemberCommandState> {
  const parsed = memberDeclineSchema.safeParse(input)
  if (!parsed.success) return { ok: false, code: "members.save_failed" }
  const { memberId } = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.rpc("decline_member", {
    member_id: memberId,
  })
  if (error) {
    return {
      ok: false,
      code: mapCommandError(error, COMMAND_ERROR_CODES, "members.save_failed", {
        route: "action declineMemberAction",
        entityType: "member",
        entityId: memberId,
      }),
    }
  }

  revalidatePath(ADMIN_AREA, "layout")
  return { ok: true, data: { memberId } }
}

/** What the name editor gets back: the member and the name as saved. */
export type MemberRenameState =
  | { ok: true; data: { memberId: string; name: string } }
  | { ok: false; code: MemberErrorCode; params?: Record<string, unknown> }

/**
 * Renames a pending or active member (AD-3, AD-4): set_member_name decides
 * whether the caller may and whether the member can still be renamed, trims
 * and returns the saved name. A name issue (blank, too long) returns its
 * code without calling; any other parse failure is members.save_failed. This
 * only parses, calls it, maps the error and revalidates both areas.
 */
export async function renameMemberAction(
  input: unknown
): Promise<MemberRenameState> {
  const parsed = memberRenameSchema.safeParse(input)
  if (!parsed.success) {
    const message = parsed.error.issues.find(
      (issue) => issue.path[0] === "name"
    )?.message
    return {
      ok: false,
      code:
        message === "members.name_blank" || message === "members.name_too_long"
          ? message
          : "members.save_failed",
    }
  }
  const { memberId, name } = parsed.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("set_member_name", {
    member_id: memberId,
    name,
  })
  if (error) {
    return {
      ok: false,
      code: mapCommandError(error, COMMAND_ERROR_CODES, "members.save_failed", {
        route: "action renameMemberAction",
        entityType: "member",
        entityId: memberId,
      }),
    }
  }

  revalidatePath(ADMIN_AREA, "layout")
  revalidatePath(MEMBER_AREA, "layout")
  return { ok: true, data: { memberId, name: data ?? name } }
}

/**
 * Resets another admin's two-factor (AD-22): reset_member_mfa checks the
 * caller, the fresh code (`auth.step_up_required`, which the step-up prompt
 * answers before retrying), the target and that the reset is still possible,
 * deletes the target's TOTP factors and logs it. This only parses, calls it,
 * maps the error and revalidates the admin area.
 */
export async function resetMemberMfaAction(
  input: unknown
): Promise<MemberCommandState> {
  const parsed = memberMfaResetSchema.safeParse(input)
  if (!parsed.success) return { ok: false, code: "members.save_failed" }
  const { memberId } = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.rpc("reset_member_mfa", {
    member_id: memberId,
  })
  if (error) {
    return {
      ok: false,
      code: mapCommandError(error, COMMAND_ERROR_CODES, "members.save_failed", {
        route: "action resetMemberMfaAction",
        entityType: "member",
        entityId: memberId,
      }),
    }
  }

  revalidatePath(ADMIN_AREA, "layout")
  return { ok: true, data: { memberId } }
}

/**
 * Replaces another member's positions (AD-3, AD-4, AD-22): update_member
 * checks the caller, the fresh code (`auth.step_up_required`, answered by the
 * step-up prompt before a retry), the set, the Editor-in-Chief rule and the
 * target, and the role follows the positions. This only parses, calls it,
 * maps the error and revalidates the admin area.
 */
export async function updateMemberAction(
  input: unknown
): Promise<MemberCommandState> {
  const parsed = memberUpdateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, code: "members.save_failed" }
  const { memberId, positions, primaryPosition } = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.rpc("update_member", {
    member_id: memberId,
    positions,
    primary_position: primaryPosition,
  })
  if (error) {
    return {
      ok: false,
      code: mapCommandError(error, COMMAND_ERROR_CODES, "members.save_failed", {
        route: "action updateMemberAction",
        entityType: "member",
        entityId: memberId,
      }),
    }
  }

  revalidatePath(ADMIN_AREA, "layout")
  return { ok: true, data: { memberId } }
}

/**
 * Deactivates another member (AD-3, AD-4, AD-22): deactivate_member checks
 * the caller, the fresh code, the guards (last admin, Editor-in-Chief) and
 * the target, then moves their open slots to Needs reassignment. This only
 * parses, calls it, maps the error and revalidates every page from the root
 * layout, since the member's slots show on both areas.
 */
export async function deactivateMemberAction(
  input: unknown
): Promise<MemberCommandState> {
  const parsed = memberDeactivateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, code: "members.save_failed" }
  const { memberId } = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.rpc("deactivate_member", {
    member_id: memberId,
  })
  if (error) {
    return {
      ok: false,
      code: mapCommandError(error, COMMAND_ERROR_CODES, "members.save_failed", {
        route: "action deactivateMemberAction",
        entityType: "member",
        entityId: memberId,
      }),
    }
  }

  revalidatePath("/", "layout")
  return { ok: true, data: { memberId } }
}
