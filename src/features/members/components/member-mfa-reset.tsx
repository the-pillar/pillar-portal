"use client"

import { useRef, useState } from "react"
import { toast } from "@/components/ui/toast"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { PENDING_STYLE } from "@/lib/pending-style"
import { useCommand } from "@/lib/use-command"
import { cn } from "@/lib/utils"

import { resetMemberMfaAction } from "../actions"
import { memberErrorMessage } from "../errors"

/**
 * **Reset two-factor** on an active-roster row, offered only when
 * `canResetMfa` (`member_capabilities`' answer; nothing here decides who
 * may). It confirms first; the command may then ask for a fresh code through
 * the step-up prompt (`useCommand`). On success the toast says "<name>'s
 * two-factor was reset." and focus goes to `focusTargetId`, since the button
 * leaves the row once the member has no factor.
 */
export function MemberMfaReset({
  member,
  focusTargetId,
}: {
  member: { id: string; name: string; canResetMfa: boolean }
  focusTargetId: string
}) {
  const { isPending, run } = useCommand({
    errorMessage: memberErrorMessage,
    thrownCode: "members.save_failed",
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  if (!member.canResetMfa) return null

  function reset() {
    run(() => resetMemberMfaAction({ memberId: member.id }), {
      onSuccess: () => {
        toast.success(`${member.name}'s two-factor was reset.`)
        document.getElementById(focusTargetId)?.focus()
      },
      // After a verified code the step-up dialog leaves focus alone, so a
      // refused retry would leave it on the page.
      onFailure: () => document.getElementById(focusTargetId)?.focus(),
    })
  }

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="sm"
        className={cn("min-h-11 self-start", PENDING_STYLE)}
        aria-label={`Reset two-factor for ${member.name}`}
        aria-disabled={isPending || undefined}
        onClick={() => {
          if (!isPending) setDialogOpen(true)
        }}
      >
        Reset two-factor
      </Button>
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // A confirmed reset moves focus to the heading itself; focus
            // returns to the button only if it has fallen to the page.
            event.preventDefault()
            const active = document.activeElement
            if (active === null || active === document.body) {
              buttonRef.current?.focus()
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reset {member.name}&apos;s two-factor?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They&apos;ll set it up again the next time it&apos;s needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={reset}>
              Reset two-factor
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
