"use client"

import { useId, useRef, useState } from "react"
import { toast } from "sonner"

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

import { deactivateMemberAction } from "../actions"
import { memberErrorMessage } from "../errors"
import type { DeactivateBlocker } from "../queries"

/**
 * **Deactivate** on an active-roster row, offered only when `canDeactivate`
 * (`member_capabilities`' answer; nothing here decides who may). When
 * `deactivateBlockedBy` names a guard, the button stays but is
 * `aria-disabled` and the guard's line sits beside it as visible text,
 * tied by `aria-describedby`. Otherwise it confirms first; the command may
 * then ask for a fresh code through the step-up prompt (`useCommand`). On
 * success the toast says "<name> deactivated." and focus goes to
 * `focusTargetId`, since the row leaves the roster.
 */
export function MemberDeactivate({
  member,
  focusTargetId,
}: {
  member: {
    id: string
    name: string
    canDeactivate: boolean
    deactivateBlockedBy: DeactivateBlocker | null
  }
  focusTargetId: string
}) {
  const { isPending, run } = useCommand({
    errorMessage: memberErrorMessage,
    thrownCode: "members.save_failed",
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const noteId = useId()

  if (!member.canDeactivate) return null

  const blocked = member.deactivateBlockedBy

  function deactivate() {
    run(() => deactivateMemberAction({ memberId: member.id }), {
      onSuccess: () => {
        toast.success(`${member.name} deactivated.`)
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
        aria-label={`Deactivate ${member.name}`}
        aria-disabled={isPending || blocked !== null || undefined}
        aria-describedby={blocked ? noteId : undefined}
        onClick={() => {
          if (!isPending && blocked === null) setDialogOpen(true)
        }}
      >
        Deactivate
      </Button>
      {blocked && (
        <p id={noteId} className="basis-full text-sm text-muted-foreground">
          {memberErrorMessage(blocked)}
        </p>
      )}
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // A confirmed deactivation moves focus to the heading itself;
            // focus returns to the button only if it has fallen to the page.
            event.preventDefault()
            const active = document.activeElement
            if (active === null || active === document.body) {
              buttonRef.current?.focus()
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {member.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access right away, and their open slots move to Needs
              reassignment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="min-h-11"
              onClick={deactivate}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
