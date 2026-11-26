"use client"

import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

import { focusNextHeading } from "./focus-next-heading"

const LEAVE_MS = 250

/**
 * The staff first-run card on What's mine (EXPERIENCE.md › Staff first-run
 * card): "Welcome to the portal." with three numbered tips. It records
 * `first_run_shown` whenever it renders unshown, and `first_run_closed`
 * on its close button, whose focus then moves to the next heading. A staff
 * member who answers a slot has it closed by the server, so after
 * revalidation it simply isn't rendered. A failed write is ignored.
 */
export function FirstRunCard({
  shown,
  record,
  fallbackHeadingId,
}: {
  /** `first_run_shown`: the card has been shown before. */
  shown: boolean
  record: (step: "first_run_shown" | "first_run_closed") => Promise<unknown>
  /** Where focus goes when nothing follows the card. */
  fallbackHeadingId?: string
}) {
  const cardRef = useRef<HTMLElement>(null)
  const [wasShown, setWasShown] = useState(shown)
  const [leaving, setLeaving] = useState(false)
  const [gone, setGone] = useState(false)

  // Show tips again clears `first_run_shown`: when `shown` goes from true
  // back to false, a card closed earlier on this page comes back.
  if (shown !== wasShown) {
    setWasShown(shown)
    if (wasShown && !shown) {
      setLeaving(false)
      setGone(false)
    }
  }

  useEffect(() => {
    if (shown) return
    void Promise.resolve(record("first_run_shown")).catch(() => undefined)
  }, [shown, record])

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setGone(true), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [leaving])

  if (gone) return null

  function close() {
    void Promise.resolve(record("first_run_closed")).catch(() => undefined)
    if (cardRef.current) focusNextHeading(cardRef.current, fallbackHeadingId)
    setLeaving(true)
  }

  return (
    <section
      ref={cardRef}
      aria-labelledby="first-run-heading"
      aria-hidden={leaving ? true : undefined}
      className={cn(
        "relative mt-6 rounded-lg border border-border bg-card p-card-padding transition-[opacity,translate] duration-(--motion-card-leave) ease-(--ease-out)",
        leaving && "translate-y-(--motion-card-leave-y) opacity-0"
      )}
    >
      <h2
        id="first-run-heading"
        className="pr-12 font-heading text-heading-sm text-navy"
      >
        Welcome to the portal.
      </h2>
      <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5 marker:font-semibold marker:text-navy">
        <li className="first-run-item" style={{ animationDelay: "0ms" }}>
          When you&apos;re assigned, tap <strong>I&apos;m on it</strong> or{" "}
          <strong>Can&apos;t take this</strong>.
        </li>
        <li className="first-run-item" style={{ animationDelay: "50ms" }}>
          <strong>Board</strong> shows everyone&apos;s work; your cards say
          Yours.
        </li>
        <li className="first-run-item" style={{ animationDelay: "100ms" }}>
          <strong>Add to Google Calendar</strong> keeps deadlines on your phone.
        </li>
      </ol>
      <button
        type="button"
        aria-label="Close welcome tips"
        onClick={close}
        className="absolute top-1 right-1 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </section>
  )
}
