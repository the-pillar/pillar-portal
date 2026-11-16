"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

import { focusHeading, focusNextHeading } from "./focus-next-heading"
import { TwoFactorSetup } from "./two-factor-setup"

/** Which of the four items are done, as `src/app` derives them. */
export type ChecklistItems = {
  twoFactor: boolean
  createdTask: boolean
  copiedTask: boolean
  /** `approved_member`, or nobody pending. */
  approvedMember: boolean
}

const KEYS = [
  "twoFactor",
  "createdTask",
  "copiedTask",
  "approvedMember",
] as const satisfies readonly (keyof ChecklistItems)[]

// What a tick that happens while the admin is on the page says.
const ANNOUNCEMENTS: Record<keyof ChecklistItems, string> = {
  twoFactor: "Two-factor set up.",
  createdTask: "Task created.",
  copiedTask: "Task copied.",
  approvedMember: "Member approved.",
}

const LEAVE_MS = 250
const HEADING_ID = "onboarding-checklist-heading"

function Tick({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-[background-color,border-color] duration-(--motion-check) ease-(--ease-out)",
        done
          ? "border-positive-strong bg-positive-strong text-white"
          : "border-input bg-card"
      )}
    >
      <Check
        className={cn(
          "size-3.5 transition-[opacity,scale] duration-(--motion-check) ease-(--ease-overshoot)",
          done
            ? "scale-100 opacity-100"
            : "scale-(--motion-check-scale) opacity-0"
        )}
        strokeWidth={3}
      />
    </span>
  )
}

const LINK_CLASS =
  "inline-flex min-h-11 items-center rounded-sm text-left font-medium text-navy underline underline-offset-4 hover:no-underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"

/**
 * Admin home's "Get started" card (EXPERIENCE.md › Onboarding checklist):
 * four items that tick themselves from what the admin does. `items` is
 * derived by `src/app` (`my_onboarding()`, the tasks slice's created-task
 * read and the pending count); `createTask` is the tasks slice's **Create a
 * task** trigger, passed as a slot (null when the viewer can't create tasks).
 *
 * Each item tells screen readers "done" or "to do"; "n of 4" carries the
 * progress and the bar is decorative. A tick that lands while the page is
 * open is read politely by a live region that outlives the card. At 4 of 4
 * the card records `checklist_done`, says "Checklist complete." and leaves;
 * a page that renders already at 4 of 4 records it and shows no card.
 */
export function OnboardingChecklist({
  items,
  pending,
  createTask,
  record,
  fallbackHeadingId,
  className,
}: {
  items: ChecklistItems
  /** Members awaiting approval right now. */
  pending: number
  createTask: React.ReactNode
  record: (step: "checklist_done") => Promise<unknown>
  /** Where focus goes when the card leaves holding it and nothing follows. */
  fallbackHeadingId?: string
  /** Replaces the card's default `mt-6 max-w-xl`, where a layout sets its own. */
  className?: string
}) {
  const router = useRouter()
  const cardRef = useRef<HTMLElement>(null)
  const previous = useRef(items)
  const completed = useRef(false)
  const [message, setMessage] = useState("")
  const [leaving, setLeaving] = useState(false)
  // Already 4 of 4 on the first render: no card at all, not even a flash.
  const [gone, setGone] = useState(
    () => KEYS.filter((key) => items[key]).length === 4
  )
  const [setupOpen, setSetupOpen] = useState(false)
  const verified = useRef(false)

  const done = KEYS.filter((key) => items[key]).length

  useEffect(() => {
    const turned = KEYS.filter((key) => items[key] && !previous.current[key])
    previous.current = items
    const total = KEYS.filter((key) => items[key]).length

    if (turned.length > 0) {
      const last = turned[turned.length - 1]
      setMessage(
        `${ANNOUNCEMENTS[last]} ${total} of 4 done.${total === 4 ? " Checklist complete." : ""}`
      )
    }

    if (total === 4 && !completed.current) {
      completed.current = true
      void Promise.resolve(record("checklist_done")).catch(() => undefined)
      if (turned.length === 0) {
        setGone(true)
      } else {
        const card = cardRef.current
        if (card?.contains(document.activeElement)) {
          focusNextHeading(card, fallbackHeadingId)
        }
        setLeaving(true)
      }
    }
  }, [items, record, fallbackHeadingId])

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setGone(true), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [leaving])

  const status = (isDone: boolean) => (
    <span className="sr-only">{isDone ? "done" : "to do"}</span>
  )

  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {message}
      </div>
      {!gone && (
        <section
          ref={cardRef}
          aria-labelledby={HEADING_ID}
          aria-hidden={leaving ? true : undefined}
          className={cn(
            className ?? "mt-6 max-w-xl",
            "rounded-lg border border-border bg-card p-card-padding transition-[opacity,translate] duration-(--motion-card-leave) ease-(--ease-out)",
            leaving && "translate-y-(--motion-card-leave-y) opacity-0"
          )}
        >
          <div className="flex items-baseline justify-between gap-3">
            <h2
              id={HEADING_ID}
              tabIndex={-1}
              className="rounded-sm font-heading text-heading-sm text-navy outline-offset-2 focus-visible:outline-2"
            >
              Get started
            </h2>
            <p className="text-sm text-muted-foreground">{done} of 4</p>
          </div>
          <div
            aria-hidden="true"
            className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full origin-left rounded-full bg-navy transition-transform duration-(--motion-progress) ease-(--ease-out)"
              style={{ transform: `scaleX(${done / 4})` }}
            />
          </div>
          <ul className="mt-3 flex flex-col gap-1">
            <li
              className="first-run-item flex gap-3"
              style={{ animationDelay: "0ms" }}
            >
              <Tick done={items.twoFactor} />
              <div className="min-w-0">
                {items.twoFactor ? (
                  <p className="min-h-11 py-2.5">
                    Set up two-factor — needed for releases, resets and member
                    changes.
                  </p>
                ) : (
                  <p className="py-0.5">
                    <button
                      type="button"
                      onClick={() => setSetupOpen(true)}
                      className={LINK_CLASS}
                    >
                      Set up two-factor
                    </button>{" "}
                    — needed for releases, resets and member changes.
                  </p>
                )}
                {status(items.twoFactor)}
              </div>
            </li>
            <li
              className="first-run-item flex gap-3"
              style={{ animationDelay: "50ms" }}
            >
              <Tick done={items.createdTask} />
              <div className="min-w-0">
                {items.createdTask || createTask === null ? (
                  <p className="min-h-11 py-2.5">Create a task</p>
                ) : (
                  createTask
                )}
                {status(items.createdTask)}
              </div>
            </li>
            <li
              className="first-run-item flex gap-3"
              style={{ animationDelay: "100ms" }}
            >
              <Tick done={items.copiedTask} />
              <div className="min-w-0">
                <p className="min-h-11 py-2.5">
                  Copy a task to your section chat
                </p>
                {status(items.copiedTask)}
              </div>
            </li>
            <li
              className="first-run-item flex gap-3"
              style={{ animationDelay: "150ms" }}
            >
              <Tick done={items.approvedMember} />
              <div className="min-w-0">
                {pending > 0 ? (
                  <p className="py-0.5">
                    <Link href="/admin/members" className={LINK_CLASS}>
                      Approve a member
                    </Link>
                    <span className="ml-2 text-muted-foreground">
                      {pending} waiting
                    </span>
                  </p>
                ) : (
                  <p className="min-h-11 py-2.5">
                    Approve a member
                    <span className="ml-2 text-muted-foreground">
                      Nobody&apos;s waiting — done for now
                    </span>
                  </p>
                )}
                {status(items.approvedMember)}
              </div>
            </li>
          </ul>
        </section>
      )}
      <Dialog
        open={setupOpen}
        onOpenChange={(next) => {
          if (!next) verified.current = false
          setSetupOpen(next)
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            // After a verified code the trigger is gone: land on the card.
            if (verified.current) {
              event.preventDefault()
              focusHeading(document.getElementById(HEADING_ID))
              verified.current = false
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Set up two-factor</DialogTitle>
            <DialogDescription>
              Needed for releases, resets and member changes.
            </DialogDescription>
          </DialogHeader>
          {setupOpen && (
            <TwoFactorSetup
              onVerified={() => {
                verified.current = true
                setSetupOpen(false)
                router.refresh()
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
