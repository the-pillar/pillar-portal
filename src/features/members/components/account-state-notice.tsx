import { Button } from "@/components/ui/button"

import { cn } from "@/lib/utils"

import { ACCOUNT_STATE_COPY, type InactiveMemberState } from "../account-state"
import { signOutAction } from "../actions"

const DOT_FAMILY: Record<InactiveMemberState, "progress" | "attention"> = {
  pending: "progress",
  declined: "attention",
  deactivated: "attention",
}
const DOT_COLOR = {
  progress: "bg-status-progress",
  attention: "bg-status-attention",
}

/**
 * What /login shows a signed-in member who isn't active (UX-DR52): the
 * state's title and text, and Sign out, which on Access declined is how they
 * try another account. `next` (already checked by `safeReturnPath`) rides
 * along, so signing out comes back to /login with it, and the other account
 * still lands on the link they opened.
 */
export function AccountStateNotice({
  state,
  next,
}: {
  state: InactiveMemberState
  next: string
}) {
  const copy = ACCOUNT_STATE_COPY[state]

  return (
    <>
      {/* A tan circle with the state's status dot: waiting reads as progress,
          a refusal as attention. Decorative; the title says it. */}
      <span
        aria-hidden="true"
        className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-muted"
      >
        <span
          data-family={DOT_FAMILY[state]}
          className={cn("size-3 rounded-full", DOT_COLOR[DOT_FAMILY[state]])}
        />
      </span>
      <h1 className="font-heading text-heading text-navy">{copy.title}</h1>
      <p className="mt-2">{copy.text}</p>
      <form action={signOutAction} className="mt-4">
        <input type="hidden" name="next" value={next} />
        <Button
          type="submit"
          variant="link"
          className="min-h-11 px-0 text-base font-semibold underline"
        >
          Sign out
        </Button>
      </form>
    </>
  )
}
