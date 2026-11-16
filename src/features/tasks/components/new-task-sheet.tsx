"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Loader2, X } from "lucide-react"

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
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { toast } from "@/components/ui/toast"

import { emitCreatedTask } from "../created-task-signal"
import {
  closeNewTask,
  isNewTaskRequested,
  NEW_DUE_PARAM,
  NEW_OWNER_PARAM,
  noteNewTaskLeft,
  resolveNewTaskPrefill,
  restoreNewTaskEntry,
  type NewTaskPrefill,
} from "../new-task-url"
import type { TaskFormOptions } from "../queries/task-form"
import { copyForMessengerAction } from "./messenger-toast"
import { TaskForm } from "./task-form"

const FORM_ID = "new-task-form"
const ID_PREFIX = "new-task"

type Session = {
  id: number
  prefill: NewTaskPrefill
  /** The URL's own `new_owner` and `new_due`, to put the entry back as it was. */
  raw: { owner: string | null; due: string | null }
  pathname: string
}

/**
 * The New task sheet (Story 8.8, EXPERIENCE.md › New task sheet), mounted
 * once by the member and admin layouts for a caller `can_create_task()`
 * allows. It opens from the URL (`new=task`, `new_owner`, `new_due`), which
 * every entry point only sets, so Back closes it and a refresh keeps it open
 * with just its prefills. It wraps the task form: below `md` a full-height
 * bottom sheet, from `md` a 480px panel from the right, each with a sticky
 * header and a sticky footer holding **Create task**.
 *
 * Whatever closes it (Escape, Close, an outside tap, Back) first asks
 * "Discard this task?" when the form differs from its prefills; Back while
 * dirty puts its history entry back and asks. Create closes it, toasts "Task
 * created." with Copy for Messenger and signals the new id so the Board or
 * Planner highlights it. A refused command leaves it open with what was typed.
 * Focus starts on Title and, on leaving, returns to the opener, or the page's
 * h1 when the URL opened it.
 */
export function NewTaskSheet({
  options,
  homeOwner,
  onCopied,
}: {
  options: TaskFormOptions
  /** The caller's home scope as `section:<id>` / `desk:<id>`, or null. */
  homeOwner: string | null
  /** Called after Copy for Messenger copies (Story 8.9 records it). */
  onCopied?: () => void
}) {
  const params = useSearchParams()
  const pathname = usePathname()
  const requested = isNewTaskRequested(params)

  const [open, setOpen] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)
  const [asking, setAsking] = useState(false)
  const opener = useRef<HTMLElement | null>(null)

  // The URL asks for the sheet: it opens on a fresh form with that URL's
  // prefills, kept for the length of the visit (and its exit animation).
  if (requested && !open) {
    setOpen(true)
    setDirty(false)
    setAsking(false)
    setSession((previous) => ({
      id: (previous?.id ?? 0) + 1,
      prefill: resolveNewTaskPrefill(params, options.owners, homeOwner),
      raw: {
        owner: params.get(NEW_OWNER_PARAM),
        due: params.get(NEW_DUE_PARAM),
      },
      pathname,
    }))
  }

  // The entry went away while the sheet is open: Back, Forward, or a link
  // elsewhere. Back over typed text puts the entry back and asks first;
  // otherwise the sheet closes.
  const left = open && !requested
  const navigatedAway =
    left && session !== null && session.pathname !== pathname
  const keepAndAsk = left && dirty && !navigatedAway
  if (left && !keepAndAsk) setOpen(false)
  // The entry is gone, however the sheet closes: nothing of ours is left to pop.
  useEffect(() => {
    if (!requested) noteNewTaskLeft()
  }, [requested])
  useEffect(() => {
    if (!left) return
    if (keepAndAsk && session) {
      restoreNewTaskEntry(session.raw)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAsking(true)
    }
  }, [left, keepAndAsk, session])

  // Everything that dismisses by choice (Escape, Close, an outside tap) asks
  // first when there is something to lose.
  function requestClose() {
    if (dirty) setAsking(true)
    else leave()
  }

  const leave = useCallback(() => {
    setAsking(false)
    setDirty(false)
    closeNewTask()
  }, [])

  const onCreated = useCallback(
    (id: string, message: string | null) => {
      emitCreatedTask(id)
      leave()
      toast.success(
        "Task created.",
        message === null ? undefined : copyForMessengerAction(message, onCopied)
      )
    },
    [leave, onCopied]
  )

  function returnFocus(event: Event) {
    const target = opener.current
    if (target && target.isConnected && target !== document.body) {
      event.preventDefault()
      target.focus()
      return
    }
    // Opened from the URL: the page's h1 takes it.
    const heading = document.querySelector<HTMLElement>("h1")
    if (heading) {
      event.preventDefault()
      if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1
      heading.focus()
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose()
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          data-slot="new-task-sheet"
          onOpenAutoFocus={(event) => {
            opener.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null
            event.preventDefault()
            document.getElementById(`${ID_PREFIX}-title`)?.focus()
          }}
          onCloseAutoFocus={returnFocus}
          onInteractOutside={(event) => {
            // A toast (a refusal, say) is outside the sheet but not a tap away.
            const target = event.target
            if (
              target instanceof Element &&
              target.closest("[data-sonner-toast], [data-sonner-toaster]")
            ) {
              event.preventDefault()
            }
          }}
          // Below 480px of viewport height every sticky bar flows in place instead
          // (DESIGN.md › Sticky budget), so the whole sheet scrolls.
          className="inset-0! h-dvh! w-auto! max-w-none! gap-0 rounded-t-xl p-0 md:left-auto! md:w-120! md:rounded-none [@media(max-height:479px)]:overflow-y-auto"
        >
          <div
            aria-hidden="true"
            className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border md:hidden"
          />
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-4 py-1">
            <SheetTitle className="text-heading-sm font-bold">
              New task
            </SheetTitle>
            <SheetDescription className="sr-only">
              Add a task for the Board and the Planner.
            </SheetDescription>
            <SheetClose asChild>
              <Button
                type="button"
                variant="ghost"
                aria-label="Close New task"
                className="size-11"
              >
                <X aria-hidden="true" />
              </Button>
            </SheetClose>
          </div>
          <div className="min-h-0 flex-1 scroll-py-4 overflow-y-auto px-4 py-4 [&_[data-slot=select-trigger]]:w-full max-md:[&_[data-slot=select-trigger]]:text-base [@media(max-height:479px)]:flex-none [@media(max-height:479px)]:overflow-visible">
            {session && (
              <TaskForm
                key={session.id}
                options={options}
                defaultValues={{
                  owner: session.prefill.owner,
                  dueAt: session.prefill.dueAt,
                }}
                formId={FORM_ID}
                idPrefix={ID_PREFIX}
                hideSubmit
                onCreated={onCreated}
                onDirtyChange={setDirty}
                onPendingChange={setPending}
              />
            )}
          </div>
          <div className="shrink-0 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {/* Never grayed out: a spinner while it saves, still focusable,
                and a second press is ignored. */}
            <Button
              type="submit"
              form={FORM_ID}
              aria-disabled={pending || undefined}
              onClick={(event) => {
                if (pending) event.preventDefault()
              }}
              className="h-11 w-full text-base"
            >
              {pending && (
                <Loader2 aria-hidden="true" className="animate-spin" />
              )}
              Create task
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this task?</AlertDialogTitle>
            <AlertDialogDescription>
              What you typed will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction variant="outline" onClick={leave}>
              Discard task
            </AlertDialogAction>
            <AlertDialogCancel variant="default">
              Keep editing
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
