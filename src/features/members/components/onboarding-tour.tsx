"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { scrollBehavior } from "@/lib/reduced-motion"

import { focusHeading as focusElement } from "./focus-next-heading"

type TourStep = { target: string; title: string; body: string }

// EXPERIENCE.md › Component Patterns › Onboarding tour, verbatim.
const STEPS: readonly TourStep[] = [
  {
    target: "counts",
    title: "Needs you",
    body: "What needs you shows up here.",
  },
  {
    target: "new-task",
    title: "New task",
    body: "New task, on every page, creates and assigns a task.",
  },
  {
    target: "my-dashboard",
    title: "My dashboard",
    body: "The Board and your own tasks are under My dashboard.",
  },
  {
    target: "members",
    title: "Members",
    body: "Approve people who sign in, under Members.",
  },
]

const POPOVER_WIDTH = 320
const GAP = 12
const PAD = 6
const MARGIN = 16

type Placement = {
  /** The target's box, padded, or null when it centers. */
  spot: { top: number; left: number; width: number; height: number } | null
  popover: React.CSSProperties
}

/** The first element with this `data-tour` that is on screen (rendered). */
function findTarget(name: string): HTMLElement | null {
  const found = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)
  ).find((element) => element.getClientRects().length > 0)
  return found ?? null
}

function placementFor(target: HTMLElement | null): Placement {
  if (!target) return { spot: null, popover: {} }
  const rect = target.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(POPOVER_WIDTH, vw - 2 * MARGIN)
  const left = Math.max(MARGIN, Math.min(rect.left, vw - width - MARGIN))
  const below = rect.bottom + PAD + GAP
  const fitsBelow = below + 200 <= vh
  return {
    spot: {
      top: rect.top - PAD,
      left: rect.left - PAD,
      width: rect.width + 2 * PAD,
      height: rect.height + 2 * PAD,
    },
    popover: fitsBelow
      ? { top: below, left }
      : { bottom: vh - rect.top + PAD + GAP, left },
  }
}

/**
 * The Admin home tour (EXPERIENCE.md › Onboarding tour): a modal dialog of
 * four steps, each spotlighting one place (`data-tour` in the DOM) through a
 * 30% ink scrim with a cut-out and a popover beside it. The dialog is named
 * "Tour, step n of 4: <title>"; focus moves to the step heading on open and on
 * each Next, Escape is Skip tour, and at the end focus goes to
 * `returnFocusId`. A target that isn't on screen makes the popover center.
 *
 * `record` writes `tour_seen` when the tour ends, unless `replay` (the member
 * had already seen it). A failed write is ignored: the UI carries on.
 */
export function OnboardingTour({
  replay,
  record,
  returnFocusId,
}: {
  /** The tour was seen already: replaying writes nothing. */
  replay: boolean
  record: (step: "tour_seen") => Promise<unknown>
  /** The element focused when the tour ends (Admin home's h1). */
  returnFocusId: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(true)
  const [index, setIndex] = useState(0)
  const [placement, setPlacement] = useState<Placement>({
    spot: null,
    popover: {},
  })
  // The heading mounts after the portal does, and again on each step (it is
  // keyed), so focusing it in a ref callback covers open and every Next.
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
    node?.focus()
  }, [])
  const ended = useRef(false)

  const step = STEPS[index]
  const last = index === STEPS.length - 1

  // Scroll the step's target into view, then follow it as the page moves.
  useEffect(() => {
    if (!open) return
    const target = findTarget(step.target)
    if (target) {
      target.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: scrollBehavior(),
      })
    }
    const place = () => setPlacement(placementFor(findTarget(step.target)))
    place()
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => {
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [open, step.target])

  function finish() {
    if (ended.current) return
    ended.current = true
    setOpen(false)
    if (!replay) {
      void Promise.resolve(record("tour_seen")).catch(() => undefined)
    }
    if (new URLSearchParams(window.location.search).has("tour")) {
      router.replace(window.location.pathname, { scroll: false })
    }
  }

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) finish()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="onboarding-tour-scrim"
          className="fixed inset-0 z-[60] overflow-hidden data-open:animate-in data-open:fade-in-0 data-open:[--tw-animation-duration:var(--motion-tour-in)] data-closed:animate-out data-closed:fade-out-0"
          style={{
            backgroundColor: placement.spot
              ? "transparent"
              : "var(--tour-scrim)",
          }}
        >
          {placement.spot && (
            <div
              aria-hidden="true"
              className="pointer-events-none fixed rounded-lg transition-[top,left,width,height] duration-(--motion-tour-step) ease-(--ease-out)"
              style={{
                ...placement.spot,
                boxShadow: "0 0 0 9999px var(--tour-scrim)",
              }}
            />
          )}
        </DialogPrimitive.Overlay>
        <DialogPrimitive.Content
          data-onboarding-tour=""
          // Only Done, Skip tour and Escape end the tour: a click on the
          // scrim or the spotlit target doesn't.
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            focusElement(document.getElementById(returnFocusId))
          }}
          className={
            "fixed z-[60] flex flex-col gap-3 rounded-lg bg-card p-4 text-sm text-card-foreground shadow-(--tour-shadow) outline-none data-open:animate-in data-open:fade-in-0 data-open:[--tw-animation-duration:var(--motion-tour-in)] data-open:zoom-in-(--motion-tour-scale) data-closed:animate-out data-closed:fade-out-0 " +
            (placement.spot
              ? ""
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2")
          }
          style={{
            width: `min(${POPOVER_WIDTH}px, 100vw - ${2 * MARGIN}px)`,
            ...placement.popover,
          }}
        >
          <div
            key={index}
            className="flex animate-in flex-col gap-1 fade-in-0 [--tw-animation-duration:var(--motion-tour-step)]"
          >
            <p aria-hidden="true" className="text-xs text-muted-foreground">
              {index + 1} of {STEPS.length}
            </p>
            <DialogPrimitive.Title
              ref={focusHeading}
              tabIndex={-1}
              className="font-heading text-heading-sm text-navy outline-offset-2 focus-visible:outline-2"
            >
              <span className="sr-only">
                {`Tour, step ${index + 1} of ${STEPS.length}:`}
              </span>{" "}
              {step.title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description>
              {step.body}
            </DialogPrimitive.Description>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 px-3"
              onClick={finish}
            >
              Skip tour
            </Button>
            <Button
              type="button"
              className="min-h-11 px-4"
              onClick={() => (last ? finish() : setIndex(index + 1))}
            >
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
