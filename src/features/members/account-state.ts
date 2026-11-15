// A member's account state, read from their own `members` row (never from
// the token). No runtime imports (only the generated role type): pure, so
// client and server code can both use it.
//
// It mirrors the database's definitions of active (`private.is_member_active`:
// a role other than `pending`, with neither `declined_at` nor `deactivated_at`
// set) and pending (`private.is_member_pending`: role `pending`, with neither
// set). `memberStateOf` gives the state of a row already held;
// `whereMemberState` filters a query to pending or active members. Routing
// uses them; RLS and the commands still decide what anyone can read or do.

import type { Enums } from "@/lib/supabase/database.types"

export type MemberState = "active" | "pending" | "declined" | "deactivated"

/** Every state but active: the ones /login shows instead of the portal. */
export type InactiveMemberState = Exclude<MemberState, "active">

/**
 * The state, by precedence: deactivated, then declined, then pending, else
 * active. (Only a pending member can be declined; the database checks it.)
 */
export function memberStateOf({
  role,
  declinedAt,
  deactivatedAt,
}: {
  role: Enums<"member_role">
  declinedAt: string | null
  deactivatedAt: string | null
}): MemberState {
  if (deactivatedAt !== null) return "deactivated"
  if (declinedAt !== null) return "declined"
  if (role === "pending") return "pending"
  return "active"
}

/**
 * Keeps the `members` rows in one state: `pending` is role `pending` with
 * neither `declined_at` nor `deactivated_at` set (`private.is_member_pending`),
 * `active` a role other than `pending` with neither
 * (`private.is_member_active`). The one TS restatement of those predicates for
 * queries; RLS still decides what a caller reads.
 */
export function whereMemberState<
  Q extends {
    eq(column: "role", value: "pending"): Q
    neq(column: "role", value: "pending"): Q
    is(column: "declined_at" | "deactivated_at", value: null): Q
  },
>(query: Q, state: "pending" | "active"): Q {
  const byRole =
    state === "pending"
      ? query.eq("role", "pending")
      : query.neq("role", "pending")
  return byRole.is("declined_at", null).is("deactivated_at", null)
}

/** What /login shows for each state but active (EXPERIENCE.md, UX-DR52). */
export const ACCOUNT_STATE_COPY = {
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
} as const satisfies Record<
  InactiveMemberState,
  { title: string; text: string }
>
