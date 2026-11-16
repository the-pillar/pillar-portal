"use client"

import { toast } from "@/components/ui/toast"

import { Button } from "@/components/ui/button"
import { PENDING_STYLE } from "@/lib/pending-style"
import { useCommand } from "@/lib/use-command"
import { cn } from "@/lib/utils"

import { handBackSlotAction } from "../actions"
import { taskErrorMessage } from "../errors"
import { HandBackForm } from "./hand-back-form"
import { useHandBackPanel } from "./use-hand-back-panel"

/**
 * Hand back, for one slot the viewer may hand back (the page renders this
 * only for a slot in task_capabilities' hand_back_slot_ids). A secondary
 * button opens the same inline form as Can't take this; nothing changes on
 * screen until the database has the answer, and focus moves to the slot's row
 * (`rowId`) before the page re-renders without this component. A reason the
 * schema refuses shows its message inline and sends nothing.
 */
export function HandBack({
  slotId,
  slotLabel,
  rowId,
  inBar = false,
}: {
  slotId: string
  slotLabel: string
  rowId: string
  /**
   * In Task detail's action bar the button takes one cell of the bar's two
   * columns and its form the full row beneath.
   */
  inBar?: boolean
}) {
  const { isPending, run } = useCommand({
    errorMessage: taskErrorMessage,
    thrownCode: "tasks.save_failed",
  })
  const {
    open,
    reason,
    setReason,
    reasonError,
    checkReason,
    rootRef,
    reasonRef,
    triggerRef,
    panelId,
    openPanel,
    cancel,
  } = useHandBackPanel({ rowId, pending: isPending })

  function submit() {
    if (isPending || !checkReason()) return
    run(() => handBackSlotAction({ slotId, reason }), {
      onSuccess: () => {
        document.getElementById(rowId)?.focus()
        toast.success("Handed back — your head will reassign it.")
      },
    })
  }

  return (
    <div
      ref={rootRef}
      className={cn("flex flex-col gap-3", inBar && "contents")}
    >
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        className={cn("min-h-11", !inBar && "self-start", PENDING_STYLE)}
        aria-disabled={isPending || undefined}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={openPanel}
      >
        Hand back<span className="sr-only"> ({slotLabel})</span>
      </Button>
      {open && (
        <div className={cn(inBar && "order-last col-span-2 md:basis-full")}>
          <HandBackForm
            id={panelId}
            reason={reason}
            reasonError={reasonError}
            onReasonChange={setReason}
            onSubmit={submit}
            onCancel={cancel}
            pending={isPending}
            reasonRef={reasonRef}
            showIntro={false}
          />
        </div>
      )}
    </div>
  )
}
