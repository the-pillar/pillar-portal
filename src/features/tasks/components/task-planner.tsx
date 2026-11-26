"use client"

import { useEffect, useMemo, useState } from "react"
import Link, { useLinkStatus } from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useSearchParams } from "next/navigation"

import { buttonVariants } from "@/components/ui/button"
import { phtMonthLabel } from "@/lib/time"
import { cn } from "@/lib/utils"

import {
  type OwnerFilter,
  ownerFilterParam,
  matchesFilter,
  type TaskOwnerOption,
} from "../board"
import { pushBoardParams } from "../board-url"
import { clearCreatedTask, subscribeCreatedTask } from "../created-task-signal"
import {
  parsePlannerFilter,
  plannerEmptyMessage,
  plannerFilterChips,
  plannerHref,
} from "../planner"
import type { PlannerCard } from "../queries/planner"
import { BoardFilterChips } from "./board-filter-chips"
import { PlannerDayList } from "./planner-day-list"
import { PlannerGrid } from "./planner-grid"

const HEADING_ID = "planner-month-heading"

const CONTROL = cn(buttonVariants({ variant: "outline" }), "h-11")

// The label dims while the link's navigation is pending, so the pressed
// control shows it was heard; it stays mounted, so focus stays on it.
function Dimmed({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus()
  return (
    <span
      data-pending={pending ? "" : undefined}
      className={cn("inline-flex items-center", pending && "opacity-50")}
    >
      {children}
    </span>
  )
}

function deadlines(count: number) {
  return `${count} ${count === 1 ? "deadline" : "deadlines"}`
}

/**
 * The Planner (EXPERIENCE.md › Planner): the Board's filter chips, the month
 * heading with its Previous, Today and Next links, then the month grid (from
 * `md` with a fine pointer) or the day list (below `md`, and on any-pointer
 * coarse screens at every width, by CSS). The month's every task arrives once;
 * a chip filters it in the client and writes `owner` with a history entry, so
 * a tap makes no request. Any `owner` other than Mine or the viewer's home
 * scope means All. The month links keep `owner`. Nothing here is keyed to the
 * month, so a month change keeps the chips and the focused link mounted; a
 * polite status reads "December 2026, 9 deadlines." once the new month
 * arrives, never on first render.
 */
export function TaskPlanner({
  month,
  today,
  previous,
  next,
  home,
  owners,
  cards,
  canCreate = false,
}: {
  /** `YYYY-MM`, a Manila month. */
  month: string
  /** Today's Manila date, `YYYY-MM-DD`. */
  today: string
  /** The month before, or null at the edge of the months the page accepts. */
  previous: string | null
  next: string | null
  /** The viewer's home scope through the Board's owner check. */
  home: OwnerFilter | null
  owners: TaskOwnerOption[]
  /** The month's tasks, Done included, ordered by due date then id. */
  cards: PlannerCard[]
  /** `can_create_task()`: each day offers a way to add a task due that day. */
  canCreate?: boolean
}) {
  const searchParams = useSearchParams()
  const urlOwner = searchParams.get("owner")
  const [ownerParam, setOwnerParam] = useState(urlOwner)
  const [seenOwner, setSeenOwner] = useState(urlOwner)
  if (urlOwner !== seenOwner) {
    // Back, Forward or a link changed the URL.
    setSeenOwner(urlOwner)
    setOwnerParam(urlOwner)
  }
  // On the render the URL changed, the state above is still queued: use the
  // URL's value, so a same-navigation month change counts the new chip.
  const effectiveOwner = urlOwner !== seenOwner ? urlOwner : ownerParam
  const filter = useMemo(
    () => parsePlannerFilter(effectiveOwner, home),
    [effectiveOwner, home]
  )
  const visible = useMemo(
    () => cards.filter((card) => matchesFilter(card, filter)),
    [cards, filter]
  )
  const chips = useMemo(
    () => plannerFilterChips(cards, home, owners),
    [cards, home, owners]
  )

  // The task this viewer just created in the New task sheet: its chip
  // highlights once it is among the month's cards (their own creations never
  // reach a highlight any other way), then lets go after the animation.
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  useEffect(
    () =>
      subscribeCreatedTask((id) => {
        clearCreatedTask(id)
        setCreatedId(id)
      }),
    []
  )
  if (createdId !== null && cards.some((card) => card.id === createdId)) {
    setCreatedId(null)
    if (visible.some((card) => card.id === createdId)) {
      setHighlightId(createdId)
    }
  }
  useEffect(() => {
    if (highlightId === null) return
    const timer = setTimeout(() => setHighlightId(null), 3000)
    return () => clearTimeout(timer)
  }, [highlightId])

  const [seenMonth, setSeenMonth] = useState(month)
  const [announcement, setAnnouncement] = useState("")
  if (month !== seenMonth) {
    setSeenMonth(month)
    setAnnouncement(`${phtMonthLabel(month)}, ${deadlines(visible.length)}.`)
  }

  function chooseFilter(value: string) {
    if (value === ownerFilterParam(filter)) return
    setOwnerParam(value)
    pushBoardParams({ owner: value })
  }

  // The month links keep a chosen filter; without one they leave `owner` out.
  const owner = effectiveOwner === null ? undefined : ownerFilterParam(filter)
  // Task detail's return link: this month with the chip as shown now.
  const from = plannerHref({ month, owner: ownerFilterParam(filter) })

  return (
    <div>
      <BoardFilterChips
        chips={chips}
        value={ownerFilterParam(filter)}
        onChange={chooseFilter}
      />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id={HEADING_ID} className="text-heading">
          {phtMonthLabel(month)}
        </h2>
        <nav aria-label="Months" className="flex items-center gap-2">
          {previous && (
            <Link
              href={plannerHref({ month: previous, owner })}
              aria-label="Previous month"
              className={cn(CONTROL, "w-11")}
            >
              <Dimmed>
                <ChevronLeft aria-hidden="true" />
              </Dimmed>
            </Link>
          )}
          <Link href={plannerHref({ owner })} className={cn(CONTROL, "px-4")}>
            <Dimmed>Today</Dimmed>
          </Link>
          {next && (
            <Link
              href={plannerHref({ month: next, owner })}
              aria-label="Next month"
              className={cn(CONTROL, "w-11")}
            >
              <Dimmed>
                <ChevronRight aria-hidden="true" />
              </Dimmed>
            </Link>
          )}
        </nav>
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <div className="mt-4">
        {visible.length === 0 ? (
          <p className="text-muted-foreground">
            {plannerEmptyMessage(filter, owners)}
          </p>
        ) : (
          <>
            <div className="hidden md:not-any-pointer-coarse:block">
              <PlannerGrid
                month={month}
                today={today}
                tasks={visible}
                labelledBy={HEADING_ID}
                canCreate={canCreate}
                highlightId={highlightId}
                from={from}
              />
            </div>
            <div className="md:not-any-pointer-coarse:hidden">
              <PlannerDayList
                month={month}
                today={today}
                tasks={visible}
                canCreate={canCreate}
                highlightId={highlightId}
                from={from}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
