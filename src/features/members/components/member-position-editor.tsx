"use client"

import { useId, useRef, useState } from "react"
import { toast } from "@/components/ui/toast"

import { Button } from "@/components/ui/button"
import { PENDING_STYLE } from "@/lib/pending-style"
import { useCommand } from "@/lib/use-command"
import { cn } from "@/lib/utils"

import { updateMemberAction } from "../actions"
import { memberErrorMessage } from "../errors"
import {
  EDITOR_IN_CHIEF_POSITION_ID,
  type OfferedPosition,
  type PositionGroup,
} from "../position-groups"
import { PositionPicker, usePositionChoice } from "./position-picker"

type EditableMember = {
  id: string
  name: string
  heldPositions: readonly { id: string; title: string; isPrimary: boolean }[]
  canChangePositions: boolean
}

/**
 * **Change positions** on an active-roster row, offered only when
 * `canChangePositions` (`member_capabilities`' answer; nothing here decides
 * who may). It opens the grouped picker filled with the member's positions;
 * a held Editor-in-Chief shows checked and fixed ("Moves only by
 * transfer"), since update_member neither adds nor removes it. Save runs
 * `updateMemberAction`, which may ask for a fresh code through the step-up
 * prompt (`useCommand`). On success the toast says "Positions updated." and
 * the picker closes.
 */
export function MemberPositionEditor({
  member,
  positionGroups,
  focusTargetId,
}: {
  member: EditableMember
  positionGroups: readonly PositionGroup[]
  focusTargetId: string
}) {
  const { isPending, run } = useCommand({
    errorMessage: memberErrorMessage,
    thrownCode: "members.save_failed",
  })
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const formId = `${id}-form`

  if (!member.canChangePositions) return null

  function save(positions: string[], primary: string) {
    run(
      () =>
        updateMemberAction({
          memberId: member.id,
          positions,
          primaryPosition: primary,
        }),
      {
        onSuccess: () => {
          setOpen(false)
          toast.success("Positions updated.")
          buttonRef.current?.focus()
        },
        // After a verified code the step-up dialog leaves focus alone, and a
        // stale refusal can remove the row, so focus goes to the heading.
        onFailure: () => document.getElementById(focusTargetId)?.focus(),
      }
    )
  }

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="sm"
        className={cn("min-h-11 self-start", PENDING_STYLE)}
        aria-label={`Change positions for ${member.name}`}
        aria-expanded={open}
        aria-controls={open ? formId : undefined}
        aria-disabled={isPending || undefined}
        onClick={() => {
          if (!isPending) setOpen((current) => !current)
        }}
      >
        Change positions
      </Button>
      {open && (
        <PositionEditorForm
          // Remounts with fresh state whenever the member's positions change.
          key={member.heldPositions
            .map((held) => `${held.id}:${held.isPrimary}`)
            .join(",")}
          id={formId}
          member={member}
          positionGroups={positionGroups}
          isPending={isPending}
          onSave={save}
        />
      )}
    </>
  )
}

function PositionEditorForm({
  id,
  member,
  positionGroups,
  isPending,
  onSave,
}: {
  id: string
  member: EditableMember
  positionGroups: readonly PositionGroup[]
  isPending: boolean
  onSave: (positions: string[], primary: string) => void
}) {
  const held = member.heldPositions.find(
    (position) => position.id === EDITOR_IN_CHIEF_POSITION_ID
  )
  const fixed: OfferedPosition | null = held
    ? { id: held.id, title: held.title }
    : null
  const choice = usePositionChoice({
    groups: positionGroups,
    initialChecked: member.heldPositions
      .map((position) => position.id)
      .filter((id) => id !== EDITOR_IN_CHIEF_POSITION_ID),
    initialPrimary:
      member.heldPositions.find((position) => position.isPrimary)?.id ?? null,
    fixed,
  })
  const { checkedPositions, primary } = choice

  return (
    <div id={id} className="mt-1 flex basis-full flex-col gap-4">
      <PositionPicker
        idPrefix={id}
        groups={positionGroups}
        choice={choice}
        fixed={fixed}
        isPending={isPending}
        popupOwner={id}
      />
      <Button
        type="button"
        className={cn("min-h-11 self-start", PENDING_STYLE)}
        disabled={primary === null}
        aria-disabled={isPending || undefined}
        onClick={() => {
          if (isPending || primary === null) return
          onSave(
            checkedPositions.map((position) => position.id),
            primary
          )
        }}
      >
        Save<span className="sr-only">, {member.name}</span>
      </Button>
    </div>
  )
}
