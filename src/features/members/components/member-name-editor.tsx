"use client"

import { useEffect, useId, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PENDING_STYLE } from "@/lib/pending-style"
import { useCommand } from "@/lib/use-command"
import { cn } from "@/lib/utils"

import { renameMemberAction } from "../actions"
import { displayNameSchema } from "../display-name"
import { memberErrorMessage, type MemberErrorCode } from "../errors"

/**
 * A member's name on /admin/members, with **Edit name** beside it when
 * `canRename` (`member_capabilities`' answer; nothing here decides who may).
 * Edit name swaps the name for a form: a "Display name" field, the hint
 * "Google: <name>" when Google sent one, **Save** and **Cancel**. Enter or
 * Save saves; Escape or Cancel cancels; focus returns to Edit name either
 * way. A blank or over-long name shows its line under the field and makes no
 * call (there is no `maxLength`: nothing is cut silently). On success the
 * toast says "Name changed to <name>." and the page re-reads. Pending cards
 * keep their ticked positions: only this component's state changes.
 */
export function MemberNameEditor({
  member,
  as: Name,
  nameClassName,
}: {
  member: {
    id: string
    name: string
    googleName: string | null
    canRename: boolean
  }
  as: "h3" | "p"
  nameClassName?: string
}) {
  const { isPending, run } = useCommand({
    errorMessage: memberErrorMessage,
    thrownCode: "members.save_failed",
  })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [problem, setProblem] = useState<MemberErrorCode | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const returnFocus = useRef(false)
  const id = useId()
  const inputId = `${id}-name`
  const hintId = `${id}-hint`
  const problemId = `${id}-problem`

  // Focus follows the swap: into the field when the form opens, back to Edit
  // name when it closes by Save or Cancel.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    } else if (returnFocus.current) {
      returnFocus.current = false
      buttonRef.current?.focus()
    }
  }, [editing])

  function open() {
    setDraft(member.name)
    setProblem(null)
    setEditing(true)
  }

  function close() {
    returnFocus.current = true
    setEditing(false)
  }

  function cancel() {
    if (isPending) return
    close()
  }

  function save() {
    if (isPending) return
    const parsed = displayNameSchema.safeParse(draft)
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message
      setProblem(
        message === "members.name_too_long"
          ? "members.name_too_long"
          : "members.name_blank"
      )
      inputRef.current?.focus()
      return
    }
    setProblem(null)
    run(() => renameMemberAction({ memberId: member.id, name: parsed.data }), {
      onSuccess: (result) => {
        close()
        toast.success(`Name changed to ${result.data.name}.`)
      },
    })
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* min-w-0 lets a long unbroken name shrink and wrap in the row. */}
        <Name className={cn("min-w-0", nameClassName)}>{member.name}</Name>
        {member.canRename && (
          <Button
            ref={buttonRef}
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            aria-label={`Edit name for ${member.name}`}
            onClick={open}
          >
            Edit name
          </Button>
        )}
      </div>
    )
  }

  const pending = isPending || undefined

  return (
    <form
      className="flex flex-col gap-1.5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          cancel()
        }
      }}
    >
      <Label htmlFor={inputId}>Display name</Label>
      <Input
        ref={inputRef}
        id={inputId}
        value={draft}
        autoComplete="off"
        aria-invalid={problem !== null || undefined}
        aria-describedby={
          [
            member.googleName !== null ? hintId : null,
            problem !== null ? problemId : null,
          ]
            .filter((describedBy) => describedBy !== null)
            .join(" ") || undefined
        }
        aria-disabled={pending}
        readOnly={isPending}
        className={cn("min-h-11 sm:max-w-md", PENDING_STYLE)}
        onChange={(event) => {
          setDraft(event.target.value)
          setProblem(null)
        }}
      />
      {member.googleName !== null && (
        <p id={hintId} className="text-sm break-words text-muted-foreground">
          Google: {member.googleName}
        </p>
      )}
      {problem !== null && (
        <FieldError id={problemId}>{memberErrorMessage(problem)}</FieldError>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          className={cn("min-h-11", PENDING_STYLE)}
          aria-disabled={pending}
        >
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          className={cn("min-h-11", PENDING_STYLE)}
          aria-disabled={pending}
          onClick={cancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
