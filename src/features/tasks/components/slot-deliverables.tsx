"use client"

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ClipboardEvent,
  type FormEvent,
} from "react"
import { Loader2, Plus, X } from "lucide-react"
import { useRouter } from "next/navigation"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import { PENDING_STYLE } from "@/lib/pending-style"
import { refreshAfterFailure } from "@/lib/refresh-after-failure"
import { useCommand } from "@/lib/use-command"
import { cn } from "@/lib/utils"

import {
  addDeliverableLinksAction,
  removeDeliverableLinkAction,
} from "../actions"
import {
  deliverableAddMessage,
  deliverableRemoveMessage,
  taskErrorMessage,
} from "../errors"
import {
  LINK_ERRORS,
  LINKS_MAX,
  linkError,
  normalizeLink,
  shortLink,
  splitLinks,
} from "../links"
import type { TaskDetailLink } from "../queries/task-detail"
import { siteLabel } from "../site-label"
import { focusTarget, KeepFocusOnTarget } from "./keep-focus-on-target"
import { LinkRow } from "./link-row"

// How long a remembered focus move waits for the refreshed links before it
// is dropped, so a much later live refresh never takes focus.
const FOCUS_WAIT_MS = 5000

type FocusTarget =
  | { to: "newest" }
  | { to: "add" }
  | { to: "remove"; linkId: string }
  | { to: "row" }

type PendingFocus = {
  target: FocusTarget
  /** Waits for the links to change (a saved add or remove) before it moves. */
  afterChange: boolean
  /** The slot's link ids when it was asked for. */
  signature: string
  at: number
}

export const ADD_HINT = "Add the link to your work here when it's ready."

function plural(count: number): string {
  return count === 1 ? "1 link" : `${count} links`
}

/**
 * One slot's deliverable links on Task detail (EXPERIENCE.md › Deliverable
 * links): its link rows, oldest first, with "added by <name>" where someone
 * other than the holder added one; for the holder **+ Add a link**, which
 * opens an inline field (several links may be pasted at once), and a remove
 * button on each row that asks first. Every control is offered from the three
 * booleans task_capabilities gave the page: `canAdd`, `canRemove` and `full`
 * (the holder's slot with five links); nothing here looks at a role, a state
 * or who holds the slot.
 *
 * The component is keyed by the slot, so an open field and its text survive a
 * refresh, even one that takes the offer to add away. Focus after an add or a
 * remove waits for the refreshed links (the target is remembered, then
 * focused in an effect once `links` changes); a row that leaves with focus
 * inside, in a live refresh, hands focus to the slot's row (`rowId`).
 */
export function SlotDeliverables({
  slotId,
  roleLabel,
  links,
  canAdd,
  canRemove,
  full,
  rowId,
  headingId,
}: {
  slotId: string
  /** The slot's role as labelled ("Layout Artist"). */
  roleLabel: string
  links: TaskDetailLink[]
  /** task_capabilities: the viewer may add links to this slot. */
  canAdd: boolean
  /** task_capabilities: the viewer may remove this slot's links. */
  canRemove: boolean
  /** The viewer's slot is at five links ("5 of 5 links"). */
  full: boolean
  /** The slot's row, where focus lands when a control goes away. */
  rowId: string
  /** Task detail's h1, where focus lands when the slot is gone. */
  headingId: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [isAdding, startAdding] = useTransition()
  const addButton = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingFocus = useRef<PendingFocus | null>(null)
  const id = useId()
  const inputId = `${id}-input`
  const errorId = `${id}-error`
  const noteId = `${id}-note`

  const signature = links.map((link) => link.id).join(",")

  function remember(target: FocusTarget, afterChange: boolean) {
    pendingFocus.current = {
      target,
      afterChange,
      signature,
      at: 0,
    }
  }

  // Moves remembered focus once the render it was waiting for has landed.
  useEffect(() => {
    const pending = pendingFocus.current
    if (pending === null) return
    if (pending.afterChange && pending.signature === signature) {
      // Still waiting for the refreshed links; give up after a while, so a
      // much later live refresh never takes focus. The clock starts at the
      // first render after the request.
      if (pending.at === 0) pending.at = Date.now()
      else if (Date.now() - pending.at > FOCUS_WAIT_MS) {
        pendingFocus.current = null
      }
      return
    }
    pendingFocus.current = null
    const { target } = pending
    const list = rootRef.current
    let element: HTMLElement | null = null
    if (target.to === "newest") {
      element =
        list?.querySelector<HTMLElement>("ul > li:last-child a[href]") ?? null
    } else if (target.to === "remove") {
      element =
        list?.querySelector<HTMLElement>(
          `button[data-remove-link="${target.linkId}"]`
        ) ?? null
    }
    if (element === null && (target.to === "add" || target.to === "remove")) {
      element = addButton.current
    }
    if (element !== null) element.focus()
    else focusTarget(rowId, headingId)
  })

  // Focus moves into the field as it opens.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function closeField() {
    setOpen(false)
    setText("")
    setError(null)
    setNote("")
    remember({ to: "add" }, false)
  }

  // A refusal shows under the field and keeps focus in it, wherever the press
  // of Add left it.
  function refuse(message: string) {
    setError(message)
    inputRef.current?.focus()
  }

  // A paste of several links, with new lines between them, would lose the
  // breaks in a one-line input; the breaks become spaces, which split links.
  function paste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text")
    if (!/\s/.test(pasted.trim())) return
    event.preventDefault()
    const field = event.currentTarget
    const start = field.selectionStart ?? text.length
    const end = field.selectionEnd ?? text.length
    setText(
      text.slice(0, start) +
        pasted.trim().replace(/\s+/g, " ") +
        text.slice(end)
    )
    if (error !== null) setError(null)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isAdding) return
    setNote("")
    const typed = splitLinks(text).map(normalizeLink)
    if (typed.length === 0) {
      refuse(LINK_ERRORS.notALink)
      return
    }
    for (const link of typed) {
      const failure = linkError(link)
      if (failure !== null) {
        refuse(
          typed.length > 1
            ? `${link}: ${LINK_ERRORS[failure]}`
            : LINK_ERRORS[failure]
        )
        return
      }
    }
    // Judged by the links the page shows; the server's count is the authority.
    const room = LINKS_MAX - links.length
    if (room <= 0) {
      refuse(
        deliverableAddMessage("tasks.invalid_links", {
          reason: "limit",
          remaining: 0,
        })
      )
      return
    }
    const urls = typed.slice(0, room)
    const leftOut = typed.slice(room)
    setError(null)

    startAdding(async () => {
      let result: Awaited<ReturnType<typeof addDeliverableLinksAction>>
      try {
        result = await addDeliverableLinksAction({ slotId, urls })
      } catch {
        toast.error(taskErrorMessage("tasks.save_failed"))
        refreshAfterFailure(router)
        return
      }

      if (result.ok) {
        const added = `Added ${plural(urls.length)}.`
        toast.success(added)
        if (leftOut.length > 0) {
          // Focus stays in the (emptied) field.
          setText("")
          setNote(
            `${plural(leftOut.length)} didn't fit: ${leftOut
              .map(shortLink)
              .join(", ")}. A slot holds up to ${LINKS_MAX}.`
          )
          inputRef.current?.focus()
          return
        }
        setOpen(false)
        setText("")
        setNote("")
        remember({ to: "newest" }, true)
        return
      }

      refreshAfterFailure(router)
      if (result.code === "tasks.invalid_links") {
        refuse(deliverableAddMessage(result.code, result.params))
        return
      }
      toast.error(deliverableAddMessage(result.code, result.params))
      if (
        result.code === "tasks.not_allowed" ||
        result.code === "tasks.not_found"
      ) {
        setOpen(false)
        setText("")
        // A gone slot or task takes its row with it: the heading.
        if (result.code === "tasks.not_found") focusTarget(headingId)
        else focusTarget(rowId, headingId)
      }
    })
  }

  // The remove button on a row (offered to whoever may remove).
  function removeAction(link: TaskDetailLink, index: number) {
    return (
      <RemoveLink
        link={link}
        number={index + 1}
        roleLabel={roleLabel}
        onRemoved={() => {
          const next = links[index + 1] ?? links[index - 1]
          remember(
            next !== undefined
              ? { to: "remove", linkId: next.id }
              : { to: "add" },
            true
          )
        }}
        keepFocus={() => pendingFocus.current !== null}
      />
    )
  }

  const showHint = links.length === 0 && (canAdd || open)
  if (links.length === 0 && !canAdd && !open && !full) return null

  return (
    <KeepFocusOnTarget targetId={rowId} fallbackId={headingId}>
      <div ref={rootRef} className="mt-1 ml-9.5">
        {links.length > 0 && (
          <ul className="flex flex-col">
            {links.map((link, index) => (
              <li key={link.id} id={`link-${link.id}`} className="min-w-0">
                <KeepFocusOnTarget targetId={rowId}>
                  <LinkRow
                    url={link.url}
                    addedBy={link.addedByName ?? undefined}
                    action={
                      canRemove ? (
                        <KeepFocusOnTarget targetId={rowId}>
                          {removeAction(link, index)}
                        </KeepFocusOnTarget>
                      ) : undefined
                    }
                  />
                </KeepFocusOnTarget>
              </li>
            ))}
          </ul>
        )}

        {showHint && <p className="text-muted-foreground">{ADD_HINT}</p>}

        {open && (
          <form
            noValidate
            className="mt-2 flex flex-col gap-2"
            onSubmit={submit}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return
              // Closes the field and nothing else: the toaster ignores a
              // default-prevented Escape.
              event.preventDefault()
              if (!isAdding) closeField()
            }}
          >
            <label htmlFor={inputId} className="font-medium">
              {`Link for ${roleLabel}`}
            </label>
            <Input
              id={inputId}
              ref={inputRef}
              value={text}
              placeholder="Paste a link"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={error !== null}
              aria-describedby={
                [error !== null && errorId, note !== "" && noteId]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              className="h-11 text-base"
              onPaste={paste}
              onChange={(event) => {
                setText(event.target.value)
                if (error !== null) setError(null)
              }}
            />
            {error !== null && <FieldError id={errorId}>{error}</FieldError>}
            <p
              id={noteId}
              role="status"
              className="text-sm text-muted-foreground empty:hidden"
            >
              {note}
            </p>
            <div className="flex gap-2">
              <Button
                type="submit"
                className={cn("min-h-11", PENDING_STYLE)}
                aria-disabled={isAdding || undefined}
              >
                {isAdding && (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                )}
                Add
              </Button>
              <Button
                type="button"
                variant="ghost"
                className={cn("min-h-11", PENDING_STYLE)}
                aria-disabled={isAdding || undefined}
                onClick={() => {
                  if (!isAdding) closeField()
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {canAdd && !open && (
          <KeepFocusOnTarget targetId={rowId}>
            <Button
              ref={addButton}
              type="button"
              variant="ghost"
              aria-label={`Add a link for ${roleLabel}`}
              className="-ml-3 min-h-11 text-navy"
              onClick={() => setOpen(true)}
            >
              <Plus aria-hidden="true" />
              Add a link
            </Button>
          </KeepFocusOnTarget>
        )}

        {full && !canAdd && !open && (
          <p className="min-h-11 py-2 text-sm text-muted-foreground">
            {LINKS_MAX} of {LINKS_MAX} links
          </p>
        )}
      </div>
    </KeepFocusOnTarget>
  )
}

/**
 * A row's remove button and its confirmation (EXPERIENCE.md › Remove a link):
 * **Keep link** is the primary button and takes focus first; Escape and Keep
 * return focus to the remove button. Nothing changes on screen until the
 * database has the answer. A link already removed says so; one the member
 * may no longer remove says so and the page refreshes (useCommand).
 */
function RemoveLink({
  link,
  number,
  roleLabel,
  onRemoved,
  keepFocus,
}: {
  link: TaskDetailLink
  number: number
  roleLabel: string
  /** Remembers where focus goes once the refreshed links arrive. */
  onRemoved: () => void
  /** Whether a remembered move should win over Radix's return to the button. */
  keepFocus: () => boolean
}) {
  const site = siteLabel(link.url)
  const [open, setOpen] = useState(false)
  const { isPending, run } = useCommand({
    errorMessage: deliverableRemoveMessage,
    thrownCode: "tasks.save_failed",
  })

  function changeOpen(next: boolean) {
    if (isPending) return
    setOpen(next)
  }

  function confirm(event: React.MouseEvent<HTMLButtonElement>) {
    // The dialog stays open while the remove saves.
    event.preventDefault()
    if (isPending) return
    run(() => removeDeliverableLinkAction({ linkId: link.id }), {
      onSuccess: (result) => {
        onRemoved()
        setOpen(false)
        if (result.data.removed) toast.success("Link removed.")
        else toast("That link was already removed.")
      },
      onFailure: () => setOpen(false),
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-remove-link={link.id}
          aria-label={`Remove ${site} link ${number} from ${roleLabel}`}
          className="size-11 text-muted-foreground"
        >
          <X aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          // After a saved remove the button is going: the remembered target
          // takes focus instead of a flash on a doomed button.
          if (keepFocus()) event.preventDefault()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this link?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {`${site} (${link.url}) will be removed from ${roleLabel}. This can't be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            variant="default"
            className={cn("min-h-11", PENDING_STYLE)}
            aria-disabled={isPending || undefined}
          >
            Keep link
          </AlertDialogCancel>
          <AlertDialogAction
            variant="outline"
            className={cn("min-h-11", PENDING_STYLE)}
            aria-disabled={isPending || undefined}
            onClick={confirm}
          >
            Remove link
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
